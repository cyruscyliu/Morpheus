//! Devilang-derived device override sites.
//!
//! A Devilang state file describes the normal guest-driver protocol. This
//! module extracts the device operations that a seed may override; it does
//! not interpret transitions or build an execution trace.

use alloc::{format, string::String, vec::Vec};
use core::num::NonZeroUsize;

use libafl_bolts::rands::Rand;

use crate::input::{DeviceOverride, ScenarioInput};

pub const MAX_ENCODED_SCENARIO_BYTES: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct MmioReadSite {
    name: String,
    address: u64,
    width: u8,
}

impl MmioReadSite {
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub fn address(&self) -> u64 {
        self.address
    }

    #[must_use]
    pub fn width(&self) -> u8 {
        self.width
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct QueueDmaSite {
    name: String,
    operation: u8,
    direction: u8,
    path: u8,
    sequence: u16,
    queue: u16,
    payload_len: u32,
    used_len: u32,
}

impl QueueDmaSite {
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub fn queue(&self) -> u16 {
        self.queue
    }

    #[must_use]
    pub fn operation(&self) -> u8 {
        self.operation
    }

    #[must_use]
    pub fn direction(&self) -> u8 {
        self.direction
    }

    #[must_use]
    pub fn path(&self) -> u8 {
        self.path
    }

    #[must_use]
    pub fn sequence(&self) -> u16 {
        self.sequence
    }

    #[must_use]
    pub fn payload_len(&self) -> u32 {
        self.payload_len
    }

    #[must_use]
    pub fn used_len(&self) -> u32 {
        self.used_len
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DevilangGrammar {
    mmio_read_sites: Vec<MmioReadSite>,
    queue_dma_sites: Vec<QueueDmaSite>,
    explicit_overrides: Vec<DeviceOverride>,
}

impl DevilangGrammar {
    /// Parse a Devilang file into native device override sites.
    pub fn parse(text: &str) -> Result<Self, String> {
        let grammar = parse_sites(&without_comments(text))?;
        if grammar.is_empty() {
            return Err("Devilang grammar contains no device override site".to_string());
        }
        Ok(grammar)
    }

    #[must_use]
    pub fn mmio_read_sites(&self) -> &[MmioReadSite] {
        &self.mmio_read_sites
    }

    #[must_use]
    pub fn queue_dma_sites(&self) -> &[QueueDmaSite] {
        &self.queue_dma_sites
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.mmio_read_sites.is_empty() && self.queue_dma_sites.is_empty()
    }

    /// Merge sites from another state file, removing duplicate locations.
    pub fn extend(&mut self, other: Self) {
        for site in other.mmio_read_sites {
            push_unique_mmio_site(
                &mut self.mmio_read_sites,
                site.name,
                site.address,
                site.width,
            );
        }
        for site in other.queue_dma_sites {
            push_unique_queue_site(&mut self.queue_dma_sites, site);
        }
        for override_record in other.explicit_overrides {
            push_unique_override(&mut self.explicit_overrides, override_record);
        }
    }

    /// Generate a small seed containing values for grammar-approved sites.
    pub(crate) fn generate_seed<R: Rand>(
        &self,
        rand: &mut R,
        max_overrides: usize,
    ) -> Result<ScenarioInput, String> {
        if !self.explicit_overrides.is_empty() {
            return Ok(ScenarioInput::new(self.explicit_overrides.clone()));
        }

        let total_sites = self.mmio_read_sites.len() + self.queue_dma_sites.len();
        if total_sites == 0 {
            return Err("Devilang grammar contains no device override site".to_string());
        }

        let limit = max_overrides.max(1).min(total_sites);
        let count = 1 + random_index(rand, limit);
        let mut selected = Vec::with_capacity(count);
        while selected.len() < count {
            let index = random_index(rand, total_sites);
            if !selected.contains(&index) {
                selected.push(index);
            }
        }
        selected.sort_unstable();

        let mut overrides = Vec::with_capacity(count);
        for index in selected {
            if let Some(site) = self.mmio_read_sites.get(index) {
                overrides.push(DeviceOverride::MmioRead {
                    address: site.address,
                    width: site.width,
                    value: random_value(rand, site.width),
                });
            } else {
                let site = &self.queue_dma_sites[index - self.mmio_read_sites.len()];
                overrides.push(DeviceOverride::QueueDma {
                    operation: site.operation,
                    direction: site.direction,
                    path: site.path,
                    sequence: site.sequence,
                    queue: site.queue,
                    payload_len: site.payload_len,
                    used_len: site.used_len,
                });
            }
        }

        Ok(ScenarioInput::new(overrides))
    }

    /// Ensure every seed record identifies a site in this grammar.
    pub fn validate_seed(&self, seed: &ScenarioInput) -> Result<(), String> {
        if !seed.is_valid() {
            return Err("device override seed is invalid".to_string());
        }

        for override_record in seed.overrides() {
            match override_record {
                DeviceOverride::MmioRead { address, width, .. } => {
                    if !self
                        .mmio_read_sites
                        .iter()
                        .any(|site| site.address == *address && site.width == *width)
                    {
                        return Err(format!(
                            "MMIO override 0x{address:x}/{width} is not in the Devilang grammar"
                        ));
                    }
                }
                DeviceOverride::QueueDma {
                    operation,
                    direction,
                    path,
                    sequence,
                    queue,
                    ..
                } => {
                    if !self.queue_dma_sites.iter().any(|site| {
                        site.operation == *operation
                            && site.direction == *direction
                            && site.path == *path
                            && site.sequence == *sequence
                            && site.queue == *queue
                    }) {
                        return Err(format!(
                            "queue DMA override queue {queue} is not in the Devilang grammar"
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    #[cfg(feature = "std")]
    pub fn from_path(path: impl AsRef<std::path::Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if path.is_dir() {
            let mut entries: Vec<_> = std::fs::read_dir(path)
                .map_err(|error| {
                    format!(
                        "failed to read Devilang directory {}: {error}",
                        path.display()
                    )
                })?
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|entry| entry.extension().is_some_and(|ext| ext == "state"))
                .collect();
            entries.sort();
            if entries.is_empty() {
                return Err(format!(
                    "Devilang directory {} contains no .state files",
                    path.display()
                ));
            }
            return Self::from_paths(entries);
        }

        if path.extension().is_some_and(|ext| ext == "state") {
            return Self::from_paths([path]);
        }

        let text = std::fs::read_to_string(path).map_err(|error| {
            format!(
                "failed to read Devilang grammar {}: {error}",
                path.display()
            )
        })?;
        let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
        let imports = manifest_state_paths(&text, parent);
        if imports.is_empty() {
            return Self::parse(&text);
        }
        Self::from_paths(imports)
    }

    #[cfg(feature = "std")]
    pub fn from_paths<I, P>(paths: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = P>,
        P: AsRef<std::path::Path>,
    {
        let mut grammar = Self::default();
        let mut visited = Vec::new();
        for path in paths {
            load_state_path(&mut grammar, path.as_ref(), &mut visited)?;
        }
        if grammar.is_empty() {
            return Err("Devilang state input contains no device override site".to_string());
        }
        Ok(grammar)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MmioDirection {
    Read,
    Write,
}

#[derive(Debug)]
struct ParsedMmioSite {
    name: String,
    direction: MmioDirection,
    address: u64,
    width: u8,
    value: Option<u64>,
}

fn parse_sites(text: &str) -> Result<DevilangGrammar, String> {
    let mut grammar = DevilangGrammar::default();

    // Explicit seed directives are authoritative. They can coexist with the
    // normal transport declarations in the same state file, but must not be
    // hidden by a neutral inferred queue site.
    for site in parse_explicit_mmio_sites(text)? {
        push_unique_mmio_site(
            &mut grammar.mmio_read_sites,
            site.name,
            site.address,
            site.width,
        );
        if let Some(value) = site.value {
            push_unique_override(
                &mut grammar.explicit_overrides,
                DeviceOverride::MmioRead {
                    address: site.address,
                    width: site.width,
                    value,
                },
            );
        }
    }
    for site in parse_explicit_queue_sites(text)? {
        push_unique_override(
            &mut grammar.explicit_overrides,
            DeviceOverride::QueueDma {
                operation: site.operation,
                direction: site.direction,
                path: site.path,
                sequence: site.sequence,
                queue: site.queue,
                payload_len: site.payload_len,
                used_len: site.used_len,
            },
        );
        push_unique_queue_site(&mut grammar.queue_dma_sites, site);
    }

    for site in parse_mmio_sites(text)? {
        if site.direction == MmioDirection::Read {
            push_unique_mmio_site(
                &mut grammar.mmio_read_sites,
                site.name,
                site.address,
                site.width,
            );
        } else if grammar.queue_dma_sites.is_empty() && site.address == 80 && site.width == 4 {
            // A native virtio queue completion is armed by the guest's normal
            // queue-notify write. The generated grammar does not encode the
            // queue value in the transport operation, so queue zero is the
            // neutral site used by the generic MMIO harness.
            push_unique_queue_site(
                &mut grammar.queue_dma_sites,
                QueueDmaSite {
                    name: site.name,
                    operation: 4,
                    direction: 2,
                    path: 1,
                    sequence: 0,
                    queue: 0,
                    payload_len: 64,
                    used_len: 64,
                },
            );
        }
    }

    Ok(grammar)
}

fn parse_mmio_sites(text: &str) -> Result<Vec<ParsedMmioSite>, String> {
    let mut result = Vec::new();
    for (op_name, body) in named_blocks(text, "op")? {
        for (mmio_name, mmio_body) in named_blocks(body, "mmio")? {
            let mut direction = None;
            let mut address = None;
            let mut width = None;

            for raw_line in mmio_body.lines() {
                let line = raw_line.trim();
                let Some((key, value)) = parse_assignment(line) else {
                    continue;
                };
                match key {
                    "direction" => {
                        direction = match value {
                            "r" => Some(MmioDirection::Read),
                            "w" => Some(MmioDirection::Write),
                            other => {
                                return Err(format!(
                                    "unsupported MMIO direction {other:?} in {mmio_name}"
                                ));
                            }
                        };
                    }
                    "address" => {
                        address = Some(parse_expression(value).ok_or_else(|| {
                            format!("invalid MMIO address {value:?} in {mmio_name}")
                        })?);
                    }
                    "size" => {
                        let parsed = parse_expression(value).ok_or_else(|| {
                            format!("invalid MMIO width {value:?} in {mmio_name}")
                        })?;
                        width = Some(u8::try_from(parsed).map_err(|_| {
                            format!("MMIO width out of range in {mmio_name}: {parsed}")
                        })?);
                    }
                    _ => {}
                }
            }

            let direction =
                direction.ok_or_else(|| format!("MMIO block {mmio_name} has no direction"))?;
            let address =
                address.ok_or_else(|| format!("MMIO block {mmio_name} has no address"))?;
            let width = width.ok_or_else(|| format!("MMIO block {mmio_name} has no size"))?;
            if !(1..=8).contains(&width) {
                return Err(format!("MMIO width out of range in {mmio_name}: {width}"));
            }

            result.push(ParsedMmioSite {
                name: if op_name.is_empty() {
                    mmio_name
                } else {
                    op_name.clone()
                },
                direction,
                address,
                width,
                value: None,
            });
        }
    }
    Ok(result)
}

fn parse_explicit_mmio_sites(text: &str) -> Result<Vec<ParsedMmioSite>, String> {
    let mut result = Vec::new();
    for name in ["mmio_read_slot", "mmio_read_override"] {
        for (position, args) in collect_calls(text, name) {
            if args.len() < 2 {
                return Err(format!("{name} at byte {position} needs address and width"));
            }
            let address = parse_expression(args[0])
                .ok_or_else(|| format!("invalid {name} address {:?}", args[0]))?;
            let width = parse_expression(args[1])
                .and_then(|value| u8::try_from(value).ok())
                .ok_or_else(|| format!("invalid {name} width {:?}", args[1]))?;
            if !(1..=8).contains(&width) {
                return Err(format!("{name} width out of range: {width}"));
            }
            let value = match args.get(2) {
                Some(value) => Some(
                    parse_expression(value)
                        .ok_or_else(|| format!("invalid {name} value {:?}", value))?,
                ),
                None if name == "mmio_read_override" => {
                    return Err(format!("{name} at byte {position} needs a value"));
                }
                None => None,
            };
            result.push(ParsedMmioSite {
                name: format!("{name}@0x{address:x}"),
                direction: MmioDirection::Read,
                address,
                width,
                value,
            });
        }
    }
    Ok(result)
}

fn parse_explicit_queue_sites(text: &str) -> Result<Vec<QueueDmaSite>, String> {
    let mut result = Vec::new();
    for name in ["queue_dma_slot", "queue_dma_write"] {
        for (position, args) in collect_calls(text, name) {
            let fields = named_arguments(&args);
            let queue = parse_named_u16(&fields, "queue", 0)?;
            let operation = parse_named_u8(&fields, "op", 4)?;
            let direction = parse_named_u8(&fields, "dir", 2)?;
            let path = parse_named_u8(&fields, "path", 1)?;
            let sequence = parse_named_u16(&fields, "sequence", 0)?;
            let payload_len = parse_named_u32(&fields, "payload_len", 64)?;
            let used_len = parse_named_u32(&fields, "used_len", payload_len)?;
            if operation != 4 || (direction != 2 && direction != 3) || path > 1 {
                return Err(format!("invalid {name} at byte {position}"));
            }
            result.push(QueueDmaSite {
                name: format!("{name}@queue{queue}"),
                operation,
                direction,
                path,
                sequence,
                queue,
                payload_len,
                used_len,
            });
        }
    }
    Ok(result)
}

fn named_arguments<'a>(args: &'a [&'a str]) -> Vec<(&'a str, &'a str)> {
    args.iter()
        .filter_map(|argument| argument.split_once('='))
        .map(|(key, value)| (key.trim(), value.trim()))
        .collect()
}

fn parse_named_u8(fields: &[(&str, &str)], name: &str, default: u8) -> Result<u8, String> {
    parse_named(fields, name, u64::from(default))
        .and_then(|value| u8::try_from(value).map_err(|_| format!("{name} is out of range")))
}

fn parse_named_u16(fields: &[(&str, &str)], name: &str, default: u16) -> Result<u16, String> {
    parse_named(fields, name, u64::from(default))
        .and_then(|value| u16::try_from(value).map_err(|_| format!("{name} is out of range")))
}

fn parse_named_u32(fields: &[(&str, &str)], name: &str, default: u32) -> Result<u32, String> {
    parse_named(fields, name, u64::from(default))
        .and_then(|value| u32::try_from(value).map_err(|_| format!("{name} is out of range")))
}

fn parse_named(fields: &[(&str, &str)], name: &str, default: u64) -> Result<u64, String> {
    fields
        .iter()
        .find(|(key, _)| *key == name || (name == "sequence" && *key == "seq"))
        .map_or(Ok(default), |(_, value)| {
            parse_expression(value).ok_or_else(|| format!("invalid {name} value {value:?}"))
        })
}

fn push_unique_mmio_site(sites: &mut Vec<MmioReadSite>, name: String, address: u64, width: u8) {
    if !sites
        .iter()
        .any(|site| site.address == address && site.width == width)
    {
        sites.push(MmioReadSite {
            name,
            address,
            width,
        });
    }
}

fn push_unique_queue_site(sites: &mut Vec<QueueDmaSite>, site: QueueDmaSite) {
    if !sites.iter().any(|current| {
        current.operation == site.operation
            && current.direction == site.direction
            && current.path == site.path
            && current.sequence == site.sequence
            && current.queue == site.queue
    }) {
        sites.push(site);
    }
}

fn push_unique_override(overrides: &mut Vec<DeviceOverride>, override_record: DeviceOverride) {
    let duplicate = overrides
        .iter()
        .any(|current| match (current, &override_record) {
            (
                DeviceOverride::MmioRead {
                    address: current_address,
                    width: current_width,
                    ..
                },
                DeviceOverride::MmioRead { address, width, .. },
            ) => current_address == address && current_width == width,
            (
                DeviceOverride::QueueDma {
                    operation: current_operation,
                    direction: current_direction,
                    path: current_path,
                    sequence: current_sequence,
                    queue: current_queue,
                    ..
                },
                DeviceOverride::QueueDma {
                    operation,
                    direction,
                    path,
                    sequence,
                    queue,
                    ..
                },
            ) => {
                current_operation == operation
                    && current_direction == direction
                    && current_path == path
                    && current_sequence == sequence
                    && current_queue == queue
            }
            _ => false,
        });
    if !duplicate {
        overrides.push(override_record);
    }
}

fn random_value<R: Rand>(rand: &mut R, width: u8) -> u64 {
    let mut value = 0;
    for index in 0..usize::from(width.min(8)) {
        value |= (rand.below(NonZeroUsize::new(256).unwrap()) as u64) << (index * 8);
    }
    value
}

fn random_index<R: Rand>(rand: &mut R, length: usize) -> usize {
    if length <= 1 {
        0
    } else {
        rand.below(NonZeroUsize::new(length).unwrap())
    }
}

fn named_blocks<'a>(text: &'a str, keyword: &str) -> Result<Vec<(String, &'a str)>, String> {
    let mut result = Vec::new();
    let mut index = 0;
    while let Some(found) = find_word(text, keyword, index) {
        let name_start = skip_whitespace(text, found + keyword.len());
        let Some((name, name_end)) = read_identifier(text, name_start) else {
            // Calls such as dma_event(op=map, ...) contain the token `op`,
            // but are not `op NAME { ... }` declarations.
            index = found + keyword.len();
            continue;
        };
        let open = skip_whitespace(text, name_end);
        if text.as_bytes().get(open) != Some(&b'{') {
            return Err(format!("{keyword} {name} has no body"));
        }
        let close = matching_brace(text, open)
            .ok_or_else(|| format!("{keyword} {name} has an unterminated body"))?;
        result.push((name, &text[open + 1..close]));
        index = close + 1;
    }
    Ok(result)
}

fn collect_calls<'a>(text: &'a str, name: &str) -> Vec<(usize, Vec<&'a str>)> {
    let needle = format!("{name}(");
    let mut result = Vec::new();
    let mut search_from = 0;
    while let Some(relative) = text[search_from..].find(&needle) {
        let start = search_from + relative;
        if start > 0
            && text[..start]
                .chars()
                .next_back()
                .is_some_and(|character| character == '_' || character.is_ascii_alphanumeric())
        {
            search_from = start + needle.len();
            continue;
        }
        let open = start + needle.len() - 1;
        let Some(close) = matching_paren(text, open) else {
            break;
        };
        result.push((start, split_args(&text[open + 1..close])));
        search_from = close + 1;
    }
    result
}

fn parse_assignment(line: &str) -> Option<(&str, &str)> {
    let clean = line.trim_end_matches(';').trim();
    let (key, value) = clean.split_once('=')?;
    Some((key.trim(), value.trim()))
}

fn parse_expression(expression: &str) -> Option<u64> {
    let expression = expression.trim().trim_end_matches(';');
    if let Some(value) = parse_integer(expression) {
        return Some(value);
    }
    let mut total = 0u64;
    let mut found = false;
    for token in
        expression.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
    {
        if token.is_empty() {
            continue;
        }
        if let Some(value) = parse_integer(token).or_else(|| known_constant(token)) {
            total = total.wrapping_add(value);
            found = true;
        }
    }
    found.then_some(total)
}

fn parse_integer(value: &str) -> Option<u64> {
    let value = value
        .trim()
        .trim_end_matches(['u', 'U', 'l', 'L'])
        .replace('_', "");
    if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16).ok()
    } else {
        value.parse().ok()
    }
}

fn known_constant(value: &str) -> Option<u64> {
    match value {
        "VIRTIO_MMIO_DEVICE_FEATURES" => Some(16),
        "VIRTIO_MMIO_QUEUE_NOTIFY" => Some(80),
        "VIRTIO_MMIO_CONFIG" => Some(256),
        "map" | "HP_DMA_EVENT_OP_MAP" => Some(4),
        "from_device" | "DMA_FROM_DEVICE" | "HP_DMA_EVENT_DIR_FROM_DEVICE" => Some(2),
        "bidirectional" | "DMA_BIDIRECTIONAL" | "HP_DMA_EVENT_DIR_BIDIRECTIONAL" => Some(3),
        "phys" | "HP_DMA_EVENT_PATH_PHYS" => Some(1),
        "dma_api" | "HP_DMA_EVENT_PATH_DMA_API" => Some(0),
        _ => None,
    }
}

fn state_imports(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let rest = line.trim().strip_prefix("import")?.trim();
            let start = rest.find('"')? + 1;
            let end = rest[start..].find('"')? + start;
            Some(rest[start..end].to_string())
        })
        .collect()
}

#[cfg(feature = "std")]
fn manifest_state_paths(text: &str, parent: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut paths = Vec::new();
    for token in text.split(|character: char| {
        character == '"'
            || character == '\''
            || character.is_whitespace()
            || matches!(character, ',' | ':' | '[' | ']' | '{' | '}')
    }) {
        if !token.ends_with(".state") {
            continue;
        }
        let candidate = std::path::PathBuf::from(token);
        let candidate = if candidate.is_absolute() {
            candidate
        } else {
            parent.join(candidate)
        };
        if candidate.exists() && !paths.iter().any(|known| known == &candidate) {
            paths.push(candidate);
        }
    }
    paths
}

fn without_comments(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for line in text.lines() {
        result.push_str(line.split_once("//").map_or(line, |(before, _)| before));
        result.push('\n');
    }
    result
}

fn find_word(text: &str, word: &str, from: usize) -> Option<usize> {
    let mut cursor = from;
    while let Some(offset) = text[cursor..].find(word) {
        let index = cursor + offset;
        if word_at(text, index, word) {
            return Some(index);
        }
        cursor = index + word.len();
    }
    None
}

fn word_at(text: &str, index: usize, word: &str) -> bool {
    let Some(suffix) = text.get(index..) else {
        return false;
    };
    if !suffix.starts_with(word) {
        return false;
    }
    let before = index
        .checked_sub(1)
        .and_then(|offset| text.as_bytes().get(offset));
    let after = text.as_bytes().get(index + word.len());
    !before.is_some_and(|byte| is_identifier_byte(*byte))
        && !after.is_some_and(|byte| is_identifier_byte(*byte))
}

fn read_identifier(text: &str, index: usize) -> Option<(String, usize)> {
    let first = *text.as_bytes().get(index)?;
    if !is_identifier_byte(first) {
        return None;
    }
    let mut end = index + 1;
    while text
        .as_bytes()
        .get(end)
        .is_some_and(|byte| is_identifier_byte(*byte))
    {
        end += 1;
    }
    Some((text[index..end].to_string(), end))
}

fn is_identifier_byte(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}

fn skip_whitespace(text: &str, mut index: usize) -> usize {
    while text
        .as_bytes()
        .get(index)
        .is_some_and(|byte| byte.is_ascii_whitespace())
    {
        index += 1;
    }
    index
}

fn matching_brace(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (index, byte) in text.as_bytes().iter().enumerate().skip(open) {
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

fn matching_paren(text: &str, open: usize) -> Option<usize> {
    let mut depth = 0usize;
    for (index, byte) in text.as_bytes().iter().enumerate().skip(open) {
        match byte {
            b'(' => depth += 1,
            b')' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

fn split_args(text: &str) -> Vec<&str> {
    let mut args = Vec::new();
    let mut start = 0;
    let mut depth = 0usize;
    for (index, byte) in text.bytes().enumerate() {
        match byte {
            b'(' => depth += 1,
            b')' => depth = depth.saturating_sub(1),
            b',' if depth == 0 => {
                args.push(text[start..index].trim());
                start = index + 1;
            }
            _ => {}
        }
    }
    if !text[start..].trim().is_empty() {
        args.push(text[start..].trim());
    }
    args
}

#[cfg(feature = "std")]
fn load_state_path(
    grammar: &mut DevilangGrammar,
    path: &std::path::Path,
    visited: &mut Vec<std::path::PathBuf>,
) -> Result<(), String> {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if visited.iter().any(|known| known == &normalized) {
        return Ok(());
    }
    visited.push(normalized);

    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read Devilang state {}: {error}", path.display()))?;
    let parsed = parse_sites(&without_comments(&text))?;
    grammar.extend(parsed);

    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    for import in state_imports(&text) {
        let imported = parent.join(import);
        if imported.exists() {
            load_state_path(grammar, &imported, visited)?;
        }
    }
    Ok(())
}

/// Render only device override records in a seed.
#[must_use]
pub fn format_seed(seed: &ScenarioInput) -> String {
    let mut rendered = String::new();
    for (index, override_record) in seed.overrides().iter().enumerate() {
        match override_record {
            DeviceOverride::MmioRead {
                address,
                width,
                value,
            } => {
                rendered.push_str(&format!(
                    "override[{index}] mmio-read address=0x{address:x} width={width} value=0x{value:x}\n"
                ));
            }
            DeviceOverride::QueueDma {
                operation,
                direction,
                path,
                sequence,
                queue,
                payload_len,
                used_len,
            } => {
                rendered.push_str(&format!(
                    "override[{index}] queue-dma op={operation} dir={direction} path={path} sequence={sequence} queue={queue} payload_len={payload_len} used_len={used_len}\n"
                ));
            }
        }
    }
    rendered
}

#[cfg(test)]
mod tests {
    use libafl::state::HasRand;
    use libafl_bolts::rands::StdRand;

    use super::*;

    #[derive(Debug)]
    struct TestState {
        rand: StdRand,
    }

    impl HasRand for TestState {
        type Rand = StdRand;

        fn rand(&self) -> &Self::Rand {
            &self.rand
        }

        fn rand_mut(&mut self) -> &mut Self::Rand {
            &mut self.rand
        }
    }

    const GRAMMAR: &str = r#"
op feature_read {
    mmio feature_read {
        direction = r;
        address = VIRTIO_MMIO_DEVICE_FEATURES + 4;
        size = 4;
    }
}
op queue_notify_write {
    mmio queue_notify_write {
        direction = w;
        address = VIRTIO_MMIO_QUEUE_NOTIFY;
        size = 4;
    }
}
"#;

    #[test]
    fn grammar_exposes_device_sites_without_trace_metadata() {
        let grammar = DevilangGrammar::parse(GRAMMAR).expect("grammar should parse");

        assert_eq!(grammar.mmio_read_sites().len(), 1);
        assert_eq!(grammar.mmio_read_sites()[0].address(), 20);
        assert_eq!(grammar.queue_dma_sites().len(), 1);
    }

    #[test]
    fn generated_seed_contains_only_override_records() {
        let grammar = DevilangGrammar::parse(GRAMMAR).expect("grammar should parse");
        let mut state = TestState {
            rand: StdRand::with_seed(7),
        };
        let seed = grammar
            .generate_seed(state.rand_mut(), 2)
            .expect("seed should generate");

        assert!(seed.is_valid());
        assert!(seed.overrides().iter().all(|record| matches!(
            record,
            DeviceOverride::MmioRead { .. } | DeviceOverride::QueueDma { .. }
        )));
        grammar
            .validate_seed(&seed)
            .expect("seed should be grammar-valid");
    }

    #[test]
    fn explicit_seed_directives_are_sites_not_executed_actions() {
        let grammar = DevilangGrammar::parse(
            r#"
machine seed {
    initial state_0
    state state_0
    mmio_read_override(VIRTIO_MMIO_CONFIG + 17, 1, 0xff);
    queue_dma_write(op=map, dir=from_device, path=phys, queue=0,
                    payload_len=70, used_len=4156);
}
"#,
        )
        .expect("seed grammar should parse");

        assert_eq!(grammar.mmio_read_sites()[0].address(), 273);
        assert_eq!(grammar.queue_dma_sites()[0].used_len(), 4156);

        let mut rand = StdRand::with_seed(11);
        let seed = grammar
            .generate_seed(&mut rand, 1)
            .expect("explicit seed should generate");
        assert_eq!(seed.total_overrides(), 2);
        assert!(matches!(
            seed.overrides()[0],
            DeviceOverride::MmioRead {
                address: 273,
                width: 1,
                value: 255
            }
        ));
        assert!(matches!(
            seed.overrides()[1],
            DeviceOverride::QueueDma {
                payload_len: 70,
                used_len: 4156,
                ..
            }
        ));
    }

    #[test]
    fn grammar_rejects_an_override_at_an_unlisted_site() {
        let grammar = DevilangGrammar::parse(GRAMMAR).expect("grammar should parse");
        let seed = ScenarioInput::new(vec![DeviceOverride::MmioRead {
            address: 0x111,
            width: 1,
            value: 0xff,
        }]);

        assert!(grammar.validate_seed(&seed).is_err());
    }
}
