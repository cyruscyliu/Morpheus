//! Adapter for the machine grammar emitted by Devilang.
//!
//! A Devilang state is represented as one LibAFL [`ActionGroup`]. The parser
//! consumes the stable part of generated `.state` files (machines, states,
//! transitions, traces, MMIO calls, and DMA telemetry). Branch labels are
//! flattened into their enclosing trace, so the generated input remains a
//! normal LibAFL `ScenarioInput`.

use alloc::{format, string::String, vec::Vec};
use core::{fmt::Write, num::NonZeroUsize};

use libafl_bolts::rands::Rand;

use crate::input::{Action, ActionGroup, HyperAction, ScenarioInput};

/// A Devilang state and the actions observed on transitions leaving it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DevilangGrammarState {
    name: String,
    actions: Vec<Action>,
}

impl DevilangGrammarState {
    #[must_use]
    pub fn new(name: String, actions: Vec<Action>) -> Self {
        Self { name, actions }
    }
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }
    #[must_use]
    pub fn actions(&self) -> &[Action] {
        &self.actions
    }
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.actions.is_empty()
    }
    #[must_use]
    pub fn action_group(&self) -> ActionGroup {
        ActionGroup::new(self.actions.clone())
    }
}

/// Parsed Devilang grammar. Declaration order is retained for group generation.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DevilangGrammar {
    machine: Option<String>,
    states: Vec<DevilangGrammarState>,
    dma_events: usize,
}

impl DevilangGrammar {
    /// Parse one Devilang `.state` file.
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut machine = None;
        let mut states = Vec::new();
        let mut transitions = Vec::new();
        let mut traces = Vec::new();
        let mut active: Option<ActiveBlock> = None;
        let mut brace_depth = 0i32;
        let mut dma_events = 0usize;

        let normalized = logical_lines(text);
        for raw_line in normalized.lines() {
            let line = strip_comment(raw_line).trim();
            if line.is_empty() {
                continue;
            }

            if let Some(block) = active.as_mut() {
                block.actions_mut().extend(parse_actions(line));
                dma_events = dma_events.saturating_add(count_occurrences(line, "dma_event("));
                brace_depth += brace_delta(line);
                if brace_depth <= block.start_depth() {
                    finish_block(&mut active, &mut states, &mut traces);
                }
                continue;
            }

            if machine.is_none() {
                machine = declaration_name(line, "machine");
            }
            if let Some(transition) = parse_transition(line) {
                transitions.push(transition);
            }

            if let Some(name) = trace_name(line) {
                let start_depth = brace_depth;
                active = Some(ActiveBlock::Trace {
                    name,
                    actions: parse_actions(line),
                    start_depth,
                });
                dma_events = dma_events.saturating_add(count_occurrences(line, "dma_event("));
                brace_depth += brace_delta(line);
                if brace_depth <= start_depth {
                    finish_block(&mut active, &mut states, &mut traces);
                }
                continue;
            }

            // Generated files use both `state foo` and `final state foo`.
            if let Some(name) = state_name(line) {
                if line.contains('{') {
                    let start_depth = brace_depth;
                    active = Some(ActiveBlock::State {
                        name,
                        actions: parse_actions(line),
                        start_depth,
                    });
                    brace_depth += brace_delta(line);
                    if brace_depth <= start_depth {
                        finish_block(&mut active, &mut states, &mut traces);
                    }
                } else if !states
                    .iter()
                    .any(|state: &DevilangGrammarState| state.name == name)
                {
                    states.push(DevilangGrammarState::new(name, Vec::new()));
                }
                continue;
            }
            brace_depth += brace_delta(line);
        }

        if active.is_some() {
            finish_block(&mut active, &mut states, &mut traces);
        }
        Ok(Self {
            machine,
            states: materialize_states(states, traces, transitions),
            dma_events,
        })
    }

    #[must_use]
    pub fn machine(&self) -> Option<&str> {
        self.machine.as_deref()
    }
    #[must_use]
    pub fn states(&self) -> &[DevilangGrammarState] {
        &self.states
    }
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.states.iter().all(DevilangGrammarState::is_empty)
    }
    #[must_use]
    pub fn dma_event_count(&self) -> usize {
        self.dma_events
    }

    /// Merge state files from one Devilang run.
    pub fn extend(&mut self, other: Self) {
        if self.machine.is_none() {
            self.machine = other.machine;
        }
        self.dma_events = self.dma_events.saturating_add(other.dma_events);
        for incoming in other.states {
            if let Some(existing) = self
                .states
                .iter_mut()
                .find(|state| state.name == incoming.name)
            {
                existing.actions.extend(incoming.actions);
            } else {
                self.states.push(incoming);
            }
        }
    }

    /// Pick an action template for grammar-guided insertion/replacement.
    pub(crate) fn random_action<R: Rand>(&self, rand: &mut R) -> Option<Action> {
        let actions: Vec<&Action> = self
            .states
            .iter()
            .flat_map(|state| state.actions.iter())
            .collect();
        let bound = NonZeroUsize::new(actions.len())?;
        Some(actions[rand.below(bound)].clone())
    }

    /// Generate groups from grammar states. Each selected state becomes one
    /// group, preserving state and action order. Empty states are skipped
    /// because LibAFL requires every `ActionGroup` to contain an action.
    pub(crate) fn generate_groups<R: Rand>(
        &self,
        rand: &mut R,
        max_groups: usize,
        max_actions_per_group: usize,
    ) -> Vec<ActionGroup> {
        if max_groups == 0 || max_actions_per_group == 0 {
            return Vec::new();
        }
        let states: Vec<&DevilangGrammarState> = self
            .states
            .iter()
            .filter(|state| !state.actions.is_empty())
            .collect();
        if states.is_empty() {
            return Vec::new();
        }
        let group_cap = max_groups.min(states.len());
        let group_count = 1 + rand.below(unsafe { NonZeroUsize::new_unchecked(group_cap) });
        let start_cap = states.len() - group_count + 1;
        let start = if start_cap == 1 {
            0
        } else {
            rand.below(unsafe { NonZeroUsize::new_unchecked(start_cap) })
        };
        let mut groups = Vec::with_capacity(group_count);
        for state in states.iter().skip(start).take(group_count) {
            let action_cap = max_actions_per_group.min(state.actions.len());
            let action_start_cap = state.actions.len() - action_cap + 1;
            let action_start = if action_start_cap == 1 {
                0
            } else {
                rand.below(unsafe { NonZeroUsize::new_unchecked(action_start_cap) })
            };
            groups.push(ActionGroup::new(
                state.actions[action_start..action_start + action_cap].to_vec(),
            ));
        }
        groups
    }

    /// Load a `.state` file, a directory containing state files, or a
    /// newline-delimited/JSON manifest produced by Devilang.
    #[cfg(feature = "std")]
    pub fn from_path(path: impl AsRef<std::path::Path>) -> Result<Self, String> {
        let path = path.as_ref();
        if path.is_dir() {
            let mut entries: Vec<_> = std::fs::read_dir(path)
                .map_err(|err| {
                    format!(
                        "failed to read Devilang directory {}: {err}",
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
            let text = std::fs::read_to_string(path).map_err(|err| {
                format!("failed to read Devilang state {}: {err}", path.display())
            })?;
            return Self::parse(&text);
        }
        let text = std::fs::read_to_string(path)
            .map_err(|err| format!("failed to read Devilang grammar {}: {err}", path.display()))?;
        let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
        let mut manifest_paths = Vec::new();
        for token in text.split(|ch: char| ch == '"' || ch.is_whitespace() || ch == ',') {
            if !token.ends_with(".state") {
                continue;
            }
            let candidate = std::path::PathBuf::from(token);
            let candidate = if candidate.is_absolute() {
                candidate
            } else {
                parent.join(candidate)
            };
            if candidate.exists() {
                manifest_paths.push(candidate);
            }
        }
        if !manifest_paths.is_empty() {
            manifest_paths.sort();
            manifest_paths.dedup();
            return Self::from_paths(manifest_paths);
        }
        Self::parse(&text)
    }

    #[cfg(feature = "std")]
    pub fn from_paths<I, P>(paths: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = P>,
        P: AsRef<std::path::Path>,
    {
        let mut grammar = Self::default();
        for path in paths {
            let path = path.as_ref();
            let text = std::fs::read_to_string(path).map_err(|err| {
                format!("failed to read Devilang state {}: {err}", path.display())
            })?;
            grammar.extend(Self::parse(&text)?);
        }
        Ok(grammar)
    }

    #[cfg(feature = "std")]
    pub fn from_env() -> Result<Option<Self>, String> {
        let Ok(path) = std::env::var("MORPHEUS_LIBAFL_DEVILANG_GRAMMAR") else {
            return Ok(None);
        };
        Self::from_path(path).map(Some)
    }
}

#[derive(Clone, Debug)]
struct Trace {
    name: String,
    actions: Vec<Action>,
}
#[derive(Clone, Debug)]
struct Transition {
    from: String,
    trace: String,
}
#[derive(Clone, Debug)]
enum ActiveBlock {
    Trace {
        name: String,
        actions: Vec<Action>,
        start_depth: i32,
    },
    State {
        name: String,
        actions: Vec<Action>,
        start_depth: i32,
    },
}
impl ActiveBlock {
    fn start_depth(&self) -> i32 {
        match self {
            Self::Trace { start_depth, .. } | Self::State { start_depth, .. } => *start_depth,
        }
    }
    fn actions_mut(&mut self) -> &mut Vec<Action> {
        match self {
            Self::Trace { actions, .. } | Self::State { actions, .. } => actions,
        }
    }
}

fn finish_block(
    active: &mut Option<ActiveBlock>,
    states: &mut Vec<DevilangGrammarState>,
    traces: &mut Vec<Trace>,
) {
    let Some(block) = active.take() else { return };
    match block {
        ActiveBlock::Trace { name, actions, .. } => traces.push(Trace { name, actions }),
        ActiveBlock::State { name, actions, .. } => {
            states.push(DevilangGrammarState::new(name, actions))
        }
    }
}

fn materialize_states(
    mut states: Vec<DevilangGrammarState>,
    traces: Vec<Trace>,
    transitions: Vec<Transition>,
) -> Vec<DevilangGrammarState> {
    if states.is_empty() {
        return traces
            .into_iter()
            .map(|trace| DevilangGrammarState::new(trace.name, trace.actions))
            .collect();
    }
    let mut assigned = vec![false; traces.len()];
    for transition in &transitions {
        let Some(index) = traces
            .iter()
            .position(|trace| trace.name == transition.trace)
        else {
            continue;
        };
        let Some(state) = states
            .iter_mut()
            .find(|state| state.name == transition.from)
        else {
            continue;
        };
        state.actions.extend(traces[index].actions.clone());
        assigned[index] = true;
    }
    let mut leftovers = Vec::new();
    for (index, trace) in traces.into_iter().enumerate() {
        if assigned[index] {
            continue;
        }
        let state_name = trace.name.strip_suffix("_trace").unwrap_or(&trace.name);
        if let Some(state) = states.iter_mut().find(|state| state.name == state_name) {
            state.actions.extend(trace.actions);
        } else {
            leftovers.extend(trace.actions);
        }
    }
    if !leftovers.is_empty() {
        if let Some(state) = states.iter_mut().find(|state| !state.actions.is_empty()) {
            state.actions.extend(leftovers);
        } else if let Some(state) = states.first_mut() {
            state.actions.extend(leftovers);
        }
    }
    states
}

fn strip_comment(line: &str) -> &str {
    line.split_once("//").map_or(line, |(before, _)| before)
}

/// Split declarations and nested blocks into logical lines while preserving
/// commas and braces that occur inside call arguments.
fn logical_lines(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut paren_depth = 0usize;
    for ch in text.chars() {
        match ch {
            '(' => {
                paren_depth += 1;
                output.push(ch);
            }
            ')' => {
                paren_depth = paren_depth.saturating_sub(1);
                output.push(ch);
            }
            '{' if paren_depth == 0 => {
                output.push(ch);
                output.push('\n');
            }
            '}' if paren_depth == 0 => {
                output.push('\n');
                output.push(ch);
                output.push('\n');
            }
            ';' if paren_depth == 0 => {
                output.push(ch);
                output.push('\n');
            }
            _ => output.push(ch),
        }
    }
    output
}
fn brace_delta(line: &str) -> i32 {
    line.bytes().fold(0, |delta, byte| match byte {
        b'{' => delta + 1,
        b'}' => delta - 1,
        _ => delta,
    })
}
fn declaration_name(line: &str, keyword: &str) -> Option<String> {
    let rest = line.strip_prefix(keyword)?;
    if rest.chars().next().is_some_and(is_identifier_char) {
        return None;
    }
    let name = rest
        .trim_start()
        .split(|ch: char| ch.is_whitespace() || ch == '{')
        .next()?;
    (!name.is_empty()).then(|| name.to_string())
}
fn state_name(line: &str) -> Option<String> {
    declaration_name(line, "state").or_else(|| {
        line.strip_prefix("final ")
            .and_then(|rest| declaration_name(rest, "state"))
    })
}
fn trace_name(line: &str) -> Option<String> {
    let rest = line
        .strip_prefix("entry trace")
        .or_else(|| line.strip_prefix("trace"))?;
    if rest.chars().next().is_some_and(is_identifier_char) {
        return None;
    }
    let name = rest
        .trim_start()
        .split(|ch: char| ch.is_whitespace() || ch == '{')
        .next()?;
    (!name.is_empty()).then(|| name.to_string())
}
fn parse_transition(line: &str) -> Option<Transition> {
    let rest = line
        .strip_prefix("transition ")?
        .trim_end_matches(';')
        .trim();
    let (path, trace) = rest.split_once(" on ")?;
    let (from, _) = path.split_once(" -> ")?;
    Some(Transition {
        from: from.trim().to_string(),
        trace: trace.trim().to_string(),
    })
}
fn count_occurrences(haystack: &str, needle: &str) -> usize {
    haystack.match_indices(needle).count()
}

fn parse_actions(line: &str) -> Vec<Action> {
    let mut found = parse_dma_actions(line);
    for width in [1u8, 2, 4, 8] {
        // Devilang spells widths in bits (`read32`), while HyperAction stores
        // the corresponding byte width (`4`).
        let suffix = (u16::from(width) * 8).to_string();
        let read = format!("read{suffix}");
        let write = format!("write{suffix}");
        let cread = format!("virtio_cread{suffix}");
        let cwrite = format!("virtio_cwrite{suffix}");
        collect_calls(line, &read, |position, args| {
            if let Some(address) = args.first() {
                found.push((
                    position,
                    Action::Hyper(HyperAction::MmioRead {
                        addr: expression_value(address, 0x5245_4144),
                        width,
                    }),
                ))
            }
        });
        collect_calls(line, &write, |position, args| {
            if args.len() >= 2 {
                found.push((
                    position,
                    Action::Hyper(HyperAction::MmioWrite {
                        addr: expression_value(args[1], 0x5752_4954),
                        width,
                        value: expression_value(args[0], 0x5641_4c55),
                    }),
                ))
            }
        });
        collect_calls(line, &cread, |position, args| {
            if args.len() >= 2 {
                found.push((
                    position,
                    Action::Hyper(HyperAction::MmioRead {
                        addr: expression_value(args[1], 0x4352_4541),
                        width,
                    }),
                ))
            }
        });
        collect_calls(line, &cwrite, |position, args| {
            if args.len() >= 3 {
                found.push((
                    position,
                    Action::Hyper(HyperAction::MmioWrite {
                        addr: expression_value(args[1], 0x4357_5249),
                        width,
                        value: expression_value(args[2], 0x5641_4c55),
                    }),
                ))
            }
        });
    }
    found.sort_by_key(|(position, _)| *position);
    found.into_iter().map(|(_, action)| action).collect()
}

fn parse_dma_actions(line: &str) -> Vec<(usize, Action)> {
    let mut result = Vec::new();
    let needle = "dma_event(";
    let mut search_from = 0;
    while let Some(relative) = line[search_from..].find(needle) {
        let start = search_from + relative;
        let open = start + needle.len() - 1;
        let Some(close) = matching_paren(line, open) else {
            break;
        };
        let mut direction = None;
        let mut address = None;
        let mut length = None;
        for item in split_args(&line[open + 1..close]) {
            let Some((key, value)) = item.split_once('=') else {
                continue;
            };
            match key.trim() {
                "dir" => direction = Some(value.trim()),
                "addr" => address = Some(expression_value(value, 0x444d_4141)),
                "len" => length = Some(expression_value(value, 0x444d_4c45)),
                _ => {}
            }
        }
        if let (Some(direction), Some(address), Some(length)) = (direction, address, length) {
            let width = u8::try_from(length.clamp(1, 8)).unwrap_or(8);
            let hyper = match direction {
                // FROM_DEVICE means the device writes guest memory. QEMU
                // supplies the actual fuzz payload for this telemetry event.
                "from_device" | "from-device" => Some(HyperAction::MemWrite {
                    addr: address,
                    width,
                    value: 0,
                }),
                "to_device" | "to-device" => Some(HyperAction::MemRead {
                    addr: address,
                    width,
                }),
                _ => None,
            };
            if let Some(hyper) = hyper {
                result.push((start, Action::Hyper(hyper)));
            }
        }
        search_from = close.saturating_add(1);
    }
    result
}
fn collect_calls<F>(line: &str, name: &str, mut callback: F)
where
    F: FnMut(usize, Vec<&str>),
{
    let needle = format!("{name}(");
    let mut search_from = 0;
    while let Some(relative) = line[search_from..].find(&needle) {
        let start = search_from + relative;
        if start > 0
            && line[..start]
                .chars()
                .next_back()
                .is_some_and(is_identifier_char)
        {
            search_from = start + needle.len();
            continue;
        }
        let open = start + needle.len() - 1;
        let Some(close) = matching_paren(line, open) else {
            break;
        };
        callback(start, split_args(&line[open + 1..close]));
        search_from = close.saturating_add(1);
    }
}
fn is_identifier_char(ch: char) -> bool {
    ch == '_' || ch.is_ascii_alphanumeric()
}
fn matching_paren(text: &str, open: usize) -> Option<usize> {
    let mut depth: usize = 0;
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
    let mut depth: usize = 0;
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

fn expression_value(expression: &str, salt: u64) -> u64 {
    let expression = expression.trim().trim_end_matches(';');
    if let Some(value) = parse_integer(expression) {
        return value;
    }
    let bytes = expression.as_bytes();
    let mut value: u64 = 0;
    let mut found = false;
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_digit()
            && (index == 0 || !is_identifier_char(bytes[index - 1] as char))
        {
            let start = index;
            index += 1;
            if bytes[start] == b'0' && index < bytes.len() && matches!(bytes[index], b'x' | b'X') {
                index += 1;
            }
            while index < bytes.len() && (bytes[index].is_ascii_hexdigit() || bytes[index] == b'_')
            {
                index += 1;
            }
            if let Some(number) = parse_integer(&expression[start..index]) {
                value = value.wrapping_add(number);
                found = true;
            }
            continue;
        }
        if bytes[index].is_ascii_alphabetic() || bytes[index] == b'_' {
            let start = index;
            index += 1;
            while index < bytes.len() && is_identifier_char(bytes[index] as char) {
                index += 1;
            }
            if let Some(number) = known_constant(&expression[start..index]) {
                value = value.wrapping_add(number);
                found = true;
            }
            continue;
        }
        index += 1;
    }
    if found {
        value
    } else {
        stable_hash(expression, salt) & 0x0fff
    }
}
fn parse_integer(value: &str) -> Option<u64> {
    let value = value
        .trim()
        .trim_end_matches(|ch: char| matches!(ch, 'u' | 'U' | 'l' | 'L'))
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
fn known_constant(name: &str) -> Option<u64> {
    Some(match name {
        "PAGE_SIZE" => 4096,
        "VIRTIO_MMIO_MAGIC_VALUE" => 0,
        "VIRTIO_MMIO_VERSION" => 4,
        "VIRTIO_MMIO_DEVICE_ID" => 8,
        "VIRTIO_MMIO_VENDOR_ID" => 12,
        "VIRTIO_MMIO_DEVICE_FEATURES" => 16,
        "VIRTIO_MMIO_DEVICE_FEATURES_SEL" => 20,
        "VIRTIO_MMIO_DRIVER_FEATURES" => 32,
        "VIRTIO_MMIO_DRIVER_FEATURES_SEL" => 36,
        "VIRTIO_MMIO_GUEST_PAGE_SIZE" => 40,
        "VIRTIO_MMIO_QUEUE_SEL" => 48,
        "VIRTIO_MMIO_QUEUE_NUM_MAX" => 52,
        "VIRTIO_MMIO_QUEUE_NUM" => 56,
        "VIRTIO_MMIO_QUEUE_ALIGN" => 60,
        "VIRTIO_MMIO_QUEUE_PFN" => 64,
        "VIRTIO_MMIO_QUEUE_READY" => 68,
        "VIRTIO_MMIO_QUEUE_NOTIFY" => 80,
        "VIRTIO_MMIO_INTERRUPT_STATUS" => 96,
        "VIRTIO_MMIO_INTERRUPT_ACK" => 100,
        "VIRTIO_MMIO_STATUS" => 112,
        "VIRTIO_MMIO_QUEUE_DESC_LOW" => 128,
        "VIRTIO_MMIO_QUEUE_DESC_HIGH" => 132,
        "VIRTIO_MMIO_QUEUE_AVAIL_LOW" => 144,
        "VIRTIO_MMIO_QUEUE_AVAIL_HIGH" => 148,
        "VIRTIO_MMIO_QUEUE_USED_LOW" => 160,
        "VIRTIO_MMIO_QUEUE_USED_HIGH" => 164,
        "VIRTIO_MMIO_SHM_SEL" => 172,
        "VIRTIO_MMIO_SHM_LEN_LOW" => 176,
        "VIRTIO_MMIO_SHM_LEN_HIGH" => 180,
        "VIRTIO_MMIO_SHM_BASE_LOW" => 184,
        "VIRTIO_MMIO_SHM_BASE_HIGH" => 188,
        "VIRTIO_MMIO_CONFIG_GENERATION" => 252,
        "VIRTIO_MMIO_CONFIG" => 256,
        _ => return None,
    })
}
fn stable_hash(text: &str, salt: u64) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64 ^ salt;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    hash
}

/// Render generated scenarios for corpus/debug logs and the mutation test.
#[must_use]
pub fn format_scenario(scenario: &ScenarioInput) -> String {
    let mut rendered = String::new();
    for (group_index, group) in scenario.groups().iter().enumerate() {
        let _ = writeln!(rendered, "group[{group_index}]");
        for (action_index, action) in group.actions().iter().enumerate() {
            let _ = writeln!(
                rendered,
                "  action[{action_index}] {}",
                format_action(action)
            );
        }
    }
    rendered
}
fn format_action(action: &Action) -> String {
    match action {
        Action::Hyper(HyperAction::MmioRead { addr, width }) => {
            format!("hyper.mmio_read addr=0x{addr:x} width={width}")
        }
        Action::Hyper(HyperAction::MmioWrite { addr, width, value }) => {
            format!("hyper.mmio_write addr=0x{addr:x} width={width} value=0x{value:x}")
        }
        Action::Hyper(other) => format!("hyper.{other:?}"),
        Action::Vm(other) => format!("vm.{other:?}"),
        Action::Cpu(other) => format!("cpu.{other:?}"),
        Action::PageTable(other) => format!("page_table.{other:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{generator::ScenarioGenerator, mutator::ScenarioMutator};
    use libafl::{generators::Generator, mutators::Mutator, state::HasRand};
    use libafl_bolts::rands::StdRand;

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
    const FIXTURE: &str = r#"
machine virtio_net {
    initial start
    state start
    state ready
    transition start -> ready on boot_trace
    trace boot_trace {
        sequence {
            read32(vm_dev.base + VIRTIO_MMIO_MAGIC_VALUE);
            write32(PAGE_SIZE, vm_dev.base + VIRTIO_MMIO_GUEST_PAGE_SIZE);
            virtio_cread16(vdev, VIRTIO_MMIO_QUEUE_NUM_MAX);
        }
    }
}
"#;

    #[test]
    fn state_transitions_become_groups() {
        let grammar = DevilangGrammar::parse(FIXTURE).expect("grammar should parse");
        assert_eq!(grammar.machine(), Some("virtio_net"));
        assert_eq!(grammar.states().len(), 2);
        assert_eq!(grammar.states()[0].name(), "start");
        assert_eq!(grammar.states()[0].actions().len(), 3);
        assert!(matches!(
            grammar.states()[0].actions()[0],
            Action::Hyper(HyperAction::MmioRead { addr: 0, width: 4 })
        ));
        assert!(matches!(
            grammar.states()[0].actions()[1],
            Action::Hyper(HyperAction::MmioWrite {
                addr: 40,
                width: 4,
                value: 4096
            })
        ));
        let mut rand = StdRand::with_seed(1);
        let groups = grammar.generate_groups(&mut rand, 2, 8);
        assert!(!groups.is_empty());
        assert!(groups.iter().all(ActionGroup::is_valid));
    }

    #[test]
    fn dma_from_device_maps_to_guest_memory_write() {
        let grammar = DevilangGrammar::parse("machine m { state s transition s -> s on t trace t { sequence { dma_event(op=map, dir=from_device, addr=0x1000, len=4); } } }").expect("grammar should parse");
        assert_eq!(grammar.dma_event_count(), 1);
        assert!(matches!(
            grammar.states()[0].actions()[0],
            Action::Hyper(HyperAction::MemWrite {
                addr: 0x1000,
                width: 4,
                value: 0
            })
        ));
    }

    #[test]
    fn generated_and_mutated_actions_are_printable() {
        let grammar = DevilangGrammar::parse(FIXTURE).expect("grammar should parse");
        let generator = ScenarioGenerator::default().with_devilang_grammar(grammar);
        let mut state = TestState {
            rand: StdRand::with_seed(7),
        };
        let mut input = generator
            .clone()
            .generate(&mut state)
            .expect("generation should work");
        let before = format_scenario(&input);
        let mut mutator = ScenarioMutator::new(generator);
        let mut changed = false;
        for _ in 0..32 {
            let _ = mutator
                .mutate(&mut state, &mut input)
                .expect("mutation should work");
            if format_scenario(&input) != before {
                changed = true;
                break;
            }
        }
        let after = format_scenario(&input);
        println!("before mutation:\n{before}after mutation:\n{after}");
        assert!(input.is_valid());
        assert!(
            changed,
            "grammar-guided mutation did not change the scenario"
        );
    }
}
