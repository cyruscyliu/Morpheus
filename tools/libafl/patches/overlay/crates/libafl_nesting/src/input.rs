use libafl::inputs::{HasTargetBytes, Input};
use libafl_bolts::{HasLen, ownedref::OwnedSlice};
use serde::{Deserialize, Serialize};

use crate::encoding::encode_scenario;

const MAX_VIRTIO_QUEUE: u16 = 1024;
const MAX_QUEUE_DMA_PAYLOAD: u32 = 1 << 20;

/// One device-side override supplied to the native L2 virtio path.
///
/// This is deliberately not a VM execution instruction. The guest driver
/// still performs the normal MMIO and virtqueue operations; QEMU consults
/// these records only when the corresponding native operation occurs.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DeviceOverride {
    /// Return `value` for a matching virtio-MMIO read.
    MmioRead { address: u64, width: u8, value: u64 },
    /// Complete one native device-to-guest virtqueue operation.
    ///
    /// The queue, operation, direction, path, and sequence identify the
    /// operation. `payload_len` and `used_len` are the mutable values used by
    /// the device completion. Descriptor traversal, DMA address translation,
    /// used-ring publication, and interrupt delivery remain native QEMU.
    QueueDma {
        operation: u8,
        direction: u8,
        path: u8,
        sequence: u16,
        queue: u16,
        payload_len: u32,
        used_len: u32,
    },
}

/// A LibAFL corpus item containing only device override records.
///
/// The guest still performs the complete native protocol. A seed is only a
/// small set of values attached to grammar-approved device override sites.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ScenarioInput {
    overrides: Vec<DeviceOverride>,
}

impl ScenarioInput {
    #[must_use]
    pub fn new(overrides: Vec<DeviceOverride>) -> Self {
        Self { overrides }
    }

    #[must_use]
    pub fn overrides(&self) -> &[DeviceOverride] {
        &self.overrides
    }

    #[must_use]
    pub fn overrides_mut(&mut self) -> &mut Vec<DeviceOverride> {
        &mut self.overrides
    }

    #[must_use]
    pub fn total_overrides(&self) -> usize {
        self.overrides.len()
    }

    #[must_use]
    pub fn is_valid(&self) -> bool {
        self.overrides
            .iter()
            .all(|override_record| match override_record {
                DeviceOverride::MmioRead { width, .. } => (1..=8).contains(width),
                DeviceOverride::QueueDma {
                    operation,
                    direction,
                    path,
                    queue,
                    payload_len,
                    ..
                } => {
                    *operation == 4
                        && (*direction == 2 || *direction == 3)
                        && *path <= 1
                        && *queue < MAX_VIRTIO_QUEUE
                        && *payload_len > 0
                        && *payload_len <= MAX_QUEUE_DMA_PAYLOAD
                }
            })
    }
}

impl Input for ScenarioInput {}

impl HasLen for ScenarioInput {
    fn len(&self) -> usize {
        self.total_overrides()
    }
}

impl HasTargetBytes for ScenarioInput {
    fn target_bytes(&self) -> OwnedSlice<'_, u8> {
        OwnedSlice::from(encode_scenario(self))
    }
}

#[cfg(all(test, feature = "std"))]
mod tests {
    use super::{DeviceOverride, ScenarioInput};
    use libafl::inputs::Input;
    use std::path::PathBuf;

    #[test]
    fn seed_contains_only_device_overrides() {
        let input = ScenarioInput::new(vec![DeviceOverride::MmioRead {
            address: 0x111,
            width: 1,
            value: 0xff,
        }]);

        assert!(input.is_valid());
        assert_eq!(input.total_overrides(), 1);
        assert_eq!(input.overrides().len(), 1);
    }

    #[test]
    fn seed_postcard_round_trip_preserves_override_values() {
        let input = ScenarioInput::new(vec![DeviceOverride::QueueDma {
            operation: 4,
            direction: 2,
            path: 1,
            sequence: 7,
            queue: 0,
            payload_len: 70,
            used_len: 4156,
        }]);
        let path = PathBuf::from(std::env::temp_dir())
            .join(format!("libafl-nesting-device-seed-{}", std::process::id()));

        input.to_file(&path).expect("seed should serialize");
        let decoded = ScenarioInput::from_file(&path).expect("seed should deserialize");
        std::fs::remove_file(&path).expect("temporary seed should be removed");

        assert_eq!(decoded, input);
    }

    #[test]
    fn invalid_queue_seed_is_rejected_by_model_validation() {
        let input = ScenarioInput::new(vec![DeviceOverride::QueueDma {
            operation: 6,
            direction: 2,
            path: 1,
            sequence: 0,
            queue: 0,
            payload_len: 70,
            used_len: 4156,
        }]);

        assert!(!input.is_valid());
    }

    #[test]
    fn empty_seed_is_a_valid_native_noop() {
        let input = ScenarioInput::new(Vec::new());

        assert!(input.is_valid());
        assert_eq!(input.total_overrides(), 0);
    }
}
