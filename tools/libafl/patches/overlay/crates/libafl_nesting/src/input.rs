use libafl::inputs::{HasTargetBytes, Input};
use libafl_bolts::{HasLen, ownedref::OwnedSlice};
use serde::{Deserialize, Serialize};

use crate::encoding::encode_scenario;

/// virtio-mmio 窗口槽位总数:0x200 / 4。
pub const MMIO_WINDOW_SLOTS: usize = 128;

/// streaming 单元的最大 payload 字节数(consumer 校验同值)。
pub const MAX_STREAM_UNIT_BYTES: u32 = 8192;

/// 一条寄给 consumer 的种子数据。
///
/// 分界规则:骨架 metadata(`present` 位图)在构造期由 grammar 定死、不参与变异;
/// 值与尺寸是 LibAFL 的变异面。任何访问(读/写/分配)超出种子长度即 native 透传。
///
/// consumer 只有两面:捕获的mmio(`mmio.*` 读表)与 dma mmio event
/// (aperture commit 通道,`dma.*`)。
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ScenarioInput {
    /// virtio-mmio 窗口面(0x200 B,128 个 4 B 槽位)。
    pub mmio: MmioSection,
    /// DMA 两类语义。
    pub dma: DmaSection,
}

/// virtio-mmio 窗口面。
///
/// 槽位按 4 B 划分:bit k ↔ slot k(offset 4k)。同一槽位驱动会读多次,
/// 因此每个被建模槽位携带一条按访问次数消费的值序列。
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MmioSection {
    /// 骨架位图:bit k = slot k 被建模。变异不碰。
    pub present: u128,
    /// len == popcount(present),按 slot 升序。
    pub word_model: Vec<WordModel>,
}

/// 单个槽位的访问模型:第 v 次读取返回 values[v];v >= count 即 native。
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct WordModel {
    /// values 的个数,即该槽位的消费上限。
    pub count: u32,
    /// 按访问序排列的槽位值;guest 读 (offset, 1B) 时按 offset%4 从 word 组装。
    pub values: Vec<u32>,
}

/// DMA 段。
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DmaSection {
    /// coherent:**每个条目一次 alloc**(多个 vring/控制 buffer = 多个条目)。
    /// 每次 dma mmio event 按环形轮转消费一个条目的下一个访问值,写入它的
    /// guest addr。访问超出该条目长度即 native。
    pub coherent: Vec<CoherentAlloc>,
    /// streaming:**每条 = 一次 MAP**;第 k 条 ↔ 第 k 个 MAP
    /// (次数未知,耗尽即停)。
    pub streaming: Vec<StreamUnit>,
}

/// 一次 coherent 分配的访问模型:一次 alloc,读写多次。
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CoherentAlloc {
    /// guest 内存写入地址(consumer 用 QEMU memory API 写入)。
    pub addr: u64,
    /// 骨架位图:bit k = 该 alloc 的第 k 次访问被建模。变异不碰。
    pub present: u128,
    /// len == popcount(present),按访问序;第 k 次访问注入 values[k]。
    pub word_model: Vec<u32>,
}

/// streaming 单元,自描述:size 即 data 长度,addr 即 guest 内存写入点。
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct StreamUnit {
    /// guest 内存写入地址(consumer 用 QEMU memory API 写入)。
    pub addr: u64,
    /// payload 字节数(变异面)。
    pub size: u32,
    /// payload 字节,len == size。
    pub data: Vec<u8>,
}

impl WordModel {
    /// 按 (offset, v) 组装返回值:字节序由 offset%4 决定独 word 内的位置。
    #[must_use]
    pub fn answer(&self, offset: usize, visit: usize) -> Option<u32> {
        if visit >= self.values.len() {
            return None;
        }
        let shift = u32::try_from(offset % 4).ok()? * 8;
        Some(self.values[visit].rotate_right(shift))
    }
}

impl ScenarioInput {
    #[must_use]
    pub fn new(mmio: MmioSection, dma: DmaSection) -> Self {
        Self { mmio, dma }
    }

    /// 被建模单元总数(mmio 槽位 + coherent alloc + streaming 条目)。
    #[must_use]
    pub fn total_units(&self) -> usize {
        self.mmio.word_model.len() + self.dma.coherent.len() + self.dma.streaming.len()
    }

    /// 变异/反馈用的访问单元总数:所有 visit 值与 streaming 字节总量。
    #[must_use]
    pub fn total_actions(&self) -> usize {
        let mmio: usize = self.mmio.word_model.iter().map(|w| w.values.len()).sum();
        let coherent: usize = self
            .dma
            .coherent
            .iter()
            .map(|c| c.word_model.len())
            .sum();
        let streaming: usize = self
            .dma
            .streaming
            .iter()
            .map(|s| usize::try_from(s.size).unwrap_or(0))
            .sum();
        mmio + coherent + streaming
    }

    /// 结构不变量:任何一条被破坏即视为非法种子。
    #[must_use]
    pub fn is_valid(&self) -> bool {
        if self.mmio.word_model.len() != self.mmio.present.count_ones() as usize {
            return false;
        }
        if self.mmio.word_model.iter().any(|w| {
            w.values.len() != w.count as usize || w.count as usize > MMIO_WINDOW_SLOTS
        }) {
            return false;
        }
        if self.dma.coherent.len() > MMIO_WINDOW_SLOTS {
            return false;
        }
        if self.dma.coherent.iter().any(|c| {
            c.word_model.len() != c.present.count_ones() as usize
        }) {
            return false;
        }
        if self.dma.streaming.iter().any(|s| {
            s.size == 0 || s.data.len() != s.size as usize
                || s.size > MAX_STREAM_UNIT_BYTES
        }) {
            return false;
        }
        true
    }
}

impl Input for ScenarioInput {}

impl HasLen for ScenarioInput {
    fn len(&self) -> usize {
        self.total_units()
    }
}

impl HasTargetBytes for ScenarioInput {
    fn target_bytes(&self) -> OwnedSlice<'_, u8> {
        OwnedSlice::from(encode_scenario(self))
    }
}

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::{
        CoherentAlloc, MmioSection, ScenarioInput, StreamUnit, WordModel, DmaSection,
    };
    use libafl::inputs::Input;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn postcard_file_round_trip_matches_ondisk_corpus() {
        let input = ScenarioInput::new(
            MmioSection {
                present: (1 << 68) | 0b100111,
                word_model: vec![
                    WordModel { count: 2, values: vec![0x7472_6976, 0xdead_beef] },
                    WordModel { count: 1, values: vec![2] },
                    WordModel { count: 1, values: vec![1] },
                    WordModel { count: 2, values: vec![0x0200_0103, 0] },
                    WordModel { count: 3, values: vec![0x0000_ff00, 0, 0] },
                ],
            },
            DmaSection {
                coherent: vec![CoherentAlloc { addr: 0x3000, present: 0b111, word_model: vec![1, 0, 1] }],
                streaming: vec![StreamUnit {
                    addr: 0x1000,
                    size: 70,
                    data: vec![0xAA; 70],
                }],
            },
        );
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be valid")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "libafl-nesting-input-roundtrip-{}-{nonce}",
            std::process::id()
        ));
        input.to_file(&path).expect("input should serialize");
        let bytes = fs::read(&path).expect("serialized input should be readable");
        let decoded = ScenarioInput::from_file(&path).expect("input should deserialize");
        fs::remove_file(&path).expect("temporary input should be removed");
        assert!(!bytes.is_empty());
        assert_eq!(decoded, input);
        assert!(decoded.is_valid());
        assert_eq!(decoded.total_actions(), 9 + 3 + 70);
    }

    #[test]
    fn broken_invariants_fail_model_validation() {
        let mismatched = ScenarioInput::new(
            MmioSection {
                present: 1,
                word_model: vec![
                    WordModel { count: 2, values: vec![1] }, // count != values.len()
                ],
            },
            DmaSection::default(),
        );
        assert!(!mismatched.is_valid());

        let oversized = ScenarioInput::new(
            MmioSection::default(),
            DmaSection {
                streaming: vec![StreamUnit {
                    addr: 0x1000,
                    size: 9000,
                    data: vec![0; 9000],
                }],
                ..Default::default()
            },
        );
        assert!(!oversized.is_valid());
    }
}
