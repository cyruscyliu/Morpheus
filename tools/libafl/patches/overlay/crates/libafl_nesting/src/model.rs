use alloc::{string::String, vec::Vec};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MmioDirection {
    Read,
    Write,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct DevilangMmioOp {
    direction: MmioDirection,
    address: u64,
    size: u8,
    data: Option<u64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DevilangModel {
    mmio_ops: Vec<DevilangMmioOp>,
}

impl DevilangMmioOp {
    #[must_use]
    pub fn direction(&self) -> MmioDirection {
        self.direction
    }

    #[must_use]
    pub fn address(&self) -> u64 {
        self.address
    }

    #[must_use]
    pub fn size(&self) -> u8 {
        self.size
    }

    #[must_use]
    pub fn data(&self) -> Option<u64> {
        self.data
    }
}

impl DevilangModel {
    #[must_use]
    pub fn new(mmio_ops: Vec<DevilangMmioOp>) -> Self {
        Self { mmio_ops }
    }

    #[must_use]
    pub fn mmio_ops(&self) -> &[DevilangMmioOp] {
        &self.mmio_ops
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.mmio_ops.is_empty()
    }

    pub fn parse_state_text(text: &str) -> Result<Self, String> {
        #[derive(Default)]
        struct PendingMmio {
            direction: Option<MmioDirection>,
            address: Option<u64>,
            size: Option<u8>,
            data: Option<u64>,
        }

        let mut mmio_ops = Vec::new();
        let mut pending: Option<PendingMmio> = None;

        for raw_line in text.lines() {
            let line = raw_line.trim();

            if pending.is_none() {
                if line.starts_with("mmio ") && line.ends_with('{') {
                    pending = Some(PendingMmio::default());
                }
                continue;
            }

            if line == "}" {
                let pending_mmio = pending.take().expect("pending mmio checked");
                let direction = pending_mmio
                    .direction
                    .ok_or_else(|| "devilang mmio block missing direction".to_string())?;
                let address = pending_mmio
                    .address
                    .ok_or_else(|| "devilang mmio block missing address".to_string())?;
                let size = pending_mmio
                    .size
                    .ok_or_else(|| "devilang mmio block missing size".to_string())?;

                let op = DevilangMmioOp {
                    direction,
                    address,
                    size,
                    data: pending_mmio.data,
                };
                if !mmio_ops.contains(&op) {
                    mmio_ops.push(op);
                }
                continue;
            }

            let Some((key, value)) = parse_assignment(line) else {
                continue;
            };
            let current = pending.as_mut().expect("pending mmio checked");
            match key {
                "direction" => {
                    current.direction = match value {
                        "r" => Some(MmioDirection::Read),
                        "w" => Some(MmioDirection::Write),
                        other => {
                            return Err(format!("unsupported devilang mmio direction {other:?}"));
                        }
                    };
                }
                "address" => {
                    current.address = Some(
                        parse_u64(value)
                            .ok_or_else(|| format!("invalid devilang mmio address {value:?}"))?,
                    );
                }
                "size" => {
                    let size = parse_u64(value)
                        .ok_or_else(|| format!("invalid devilang mmio size {value:?}"))?;
                    current.size = Some(
                        u8::try_from(size)
                            .map_err(|_| format!("devilang mmio size out of range: {size}"))?,
                    );
                }
                "data" => {
                    current.data = Some(
                        parse_u64(value)
                            .ok_or_else(|| format!("invalid devilang mmio data {value:?}"))?,
                    );
                }
                _ => {}
            }
        }

        Ok(Self { mmio_ops })
    }
}

fn parse_assignment(line: &str) -> Option<(&str, &str)> {
    let clean = line.trim_end_matches(';').trim();
    let (key, value) = clean.split_once('=')?;
    Some((key.trim(), value.trim()))
}

fn parse_u64(value: &str) -> Option<u64> {
    let trimmed = value.trim();
    if let Some(hex) = trimmed
        .strip_prefix("0x")
        .or_else(|| trimmed.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16).ok()
    } else {
        trimmed.parse::<u64>().ok()
    }
}

#[cfg(feature = "std")]
impl DevilangModel {
    pub fn from_manifest_path(
        manifest_path: impl AsRef<std::path::Path>,
    ) -> Result<Option<Self>, String> {
        let manifest_path = manifest_path.as_ref();
        if !manifest_path.exists() {
            return Ok(None);
        }

        let manifest = std::fs::read_to_string(manifest_path).map_err(|err| {
            format!(
                "failed to read devilang state manifest {}: {err}",
                manifest_path.display()
            )
        })?;

        let mut mmio_ops = Vec::new();
        for raw_line in manifest.lines() {
            let path = raw_line.trim();
            if path.is_empty() {
                continue;
            }

            let state_text = std::fs::read_to_string(path)
                .map_err(|err| format!("failed to read devilang state {path}: {err}"))?;
            let parsed = Self::parse_state_text(&state_text)?;
            for op in parsed.mmio_ops {
                if !mmio_ops.contains(&op) {
                    mmio_ops.push(op);
                }
            }
        }

        Ok(Some(Self { mmio_ops }))
    }

    pub fn from_env() -> Result<Option<Self>, String> {
        let Ok(manifest_path) = std::env::var("MORPHEUS_LIBAFL_DEVILANG_STATES") else {
            return Ok(None);
        };
        Self::from_manifest_path(manifest_path)
    }
}

#[cfg(test)]
mod tests {
    use super::{DevilangModel, MmioDirection};

    #[test]
    fn parses_devilang_mmio_blocks() {
        let text = r#"
op virtio_mmio_magic_value_read {
    mmio virtio_mmio_magic_value_read {
        direction = r;
        region = 0;
        address = 0;
        size = 4;
    }
}

op virtio_mmio_guest_page_size_write {
    mmio virtio_mmio_guest_page_size_write {
        direction = w;
        region = 0;
        address = 0x28;
        size = 4;
        data = 4096;
    }
}
"#;

        let parsed = DevilangModel::parse_state_text(text).expect("state parsing should work");
        assert_eq!(parsed.mmio_ops().len(), 2);

        assert_eq!(parsed.mmio_ops()[0].direction(), MmioDirection::Read);
        assert_eq!(parsed.mmio_ops()[0].address(), 0);
        assert_eq!(parsed.mmio_ops()[0].size(), 4);
        assert_eq!(parsed.mmio_ops()[0].data(), None);

        assert_eq!(parsed.mmio_ops()[1].direction(), MmioDirection::Write);
        assert_eq!(parsed.mmio_ops()[1].address(), 0x28);
        assert_eq!(parsed.mmio_ops()[1].size(), 4);
        assert_eq!(parsed.mmio_ops()[1].data(), Some(4096));
    }

    #[test]
    fn deduplicates_identical_mmio_blocks() {
        let text = r#"
op a {
    mmio a {
        direction = w;
        address = 80;
        size = 4;
    }
}
op b {
    mmio b {
        direction = w;
        address = 80;
        size = 4;
    }
}
"#;

        let parsed = DevilangModel::parse_state_text(text).expect("state parsing should work");
        assert_eq!(parsed.mmio_ops().len(), 1);
    }
}
