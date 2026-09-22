//! Devilang state-machine grammar support for structured `LibAFL` scenarios.
//!
//! The wire format remains a sequence of `LibAFL` action groups. A grammar group
//! corresponds to one fully executed Devilang transition trace, while the
//! state-machine path and control-flow choices stay in `ScenarioInput` corpus
//! metadata. This preserves the generated Devilang state machine without
//! changing the bytes consumed by the L2 QEMU harness.

use alloc::{
    format,
    string::{String, ToString},
    vec::Vec,
};
use core::num::NonZeroUsize;

use libafl_bolts::rands::Rand;
use serde::{Deserialize, Serialize};

use crate::{
    input::{DmaSection, MmioSection, ScenarioInput},
};

pub const MAX_ENCODED_SCENARIO_BYTES: usize = 4096;

/// Grammar-side action view. Grammar code reasons in actions and lowers Hyper
/// actions into consumer data units (MMIO window values / streaming entries).
/// In the new interface only the Hyper family exists; other action families
/// are absent.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Action {
    Hyper(HyperAction),
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum HyperAction {
    MmioWrite { addr: u64, width: u8, value: u64 },
    MmioRead { addr: u64, width: u8 },
    MmioReadOverride { addr: u64, width: u8, value: u64 },
    PioWrite { port: u64, width: u8, value: u64 },
    PioRead { port: u64, width: u8 },
    IrqInject { irq: u32, vcpu: u16, edge: bool, count: u32 },
    WaitIrqAck { irq: u32, vcpu: u16 },
    MemWrite { addr: u64, width: u8, value: u64 },
    MemRead { addr: u64, width: u8 },
    DmaEvent {
        operation: u8,
        direction: u8,
        path: u8,
        sequence: u16,
        addr: u64,
        len: u32,
    },
    QueueDmaWrite {
        operation: u8,
        direction: u8,
        path: u8,
        sequence: u16,
        queue: u16,
        payload_len: u32,
        used_len: u32,
    },
}

/// Devilang transition-path provenance, used internally by the grammar and no
/// longer attached to the seed.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DevilangPath {
    steps: Vec<DevilangPathStep>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DevilangPathStep {
    machine: String,
    from: String,
    to: String,
    trace: String,
    decisions: Vec<DevilangTraceDecision>,
    #[serde(default = "default_devilang_path_step_emits_actions")]
    emits_actions: bool,
}

impl DevilangPathStep {
    #[must_use]
    pub fn with_actions(
        machine: String,
        from: String,
        to: String,
        trace: String,
        decisions: Vec<DevilangTraceDecision>,
        emits_actions: bool,
    ) -> Self {
        Self {
            machine,
            from,
            to,
            trace,
            decisions,
            emits_actions,
        }
    }

    #[must_use]
    pub fn machine(&self) -> &str {
        &self.machine
    }

    #[must_use]
    pub fn emits_actions(&self) -> bool {
        self.emits_actions
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum DevilangTraceDecision {
    Branch { taken: bool },
    Repeat { iterations: u8 },
}

const fn default_devilang_path_step_emits_actions() -> bool {
    true
}

impl DevilangPath {
    #[must_use]
    pub fn new(steps: Vec<DevilangPathStep>) -> Self {
        Self { steps }
    }

    #[must_use]
    pub fn steps(&self) -> &[DevilangPathStep] {
        &self.steps
    }
}

const MAX_TRACE_BLOCK_VISITS: usize = 512;
const MAX_TRACE_CALL_DEPTH: usize = 24;
const MAX_REPEAT_ITERATIONS: u8 = 3;
const MAX_TRANSITION_EXECUTION_ATTEMPTS: usize = 32;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DevilangGrammarState {
    machine: String,
    name: String,
}

impl DevilangGrammarState {
    #[must_use]
    pub fn machine(&self) -> &str {
        &self.machine
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DevilangGrammar {
    machines: Vec<DevilangMachine>,
    phase_machines: Vec<String>,
    dma_events: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DevilangMachine {
    name: String,
    initial: String,
    states: Vec<String>,
    transitions: Vec<DevilangTransition>,
    traces: Vec<DevilangTrace>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DevilangTransition {
    from: String,
    to: String,
    trace: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DevilangTrace {
    name: String,
    blocks: Vec<DevilangTraceBlock>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct DevilangTraceBlock {
    label: Option<String>,
    repeat: bool,
    nodes: Vec<TraceNode>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum TraceNode {
    Statement {
        actions: Vec<Action>,
        call: Option<String>,
    },
    Branch {
        target: String,
    },
    Goto {
        target: String,
    },
    Return,
    Repeat(Vec<TraceNode>),
    Sequence(Vec<TraceNode>),
}

enum TraceControl {
    Goto(String),
    Return,
}

#[derive(Debug)]
struct TraceExecution {
    actions: Vec<Action>,
    decisions: Vec<DevilangTraceDecision>,
}

struct TraceExecutionContext<'a, S> {
    machine_index: usize,
    trace_index: usize,
    trace_name: &'a str,
    visited_blocks: &'a [usize],
    decisions: &'a mut S,
    depth: usize,
    active_traces: &'a mut Vec<(usize, usize)>,
    actions: &'a mut Vec<Action>,
}

impl DevilangMachine {
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub fn initial(&self) -> &str {
        &self.initial
    }

    #[must_use]
    pub fn states(&self) -> &[String] {
        &self.states
    }
}

impl DevilangGrammar {
    /// Parse one or more machine declarations from generated Devilang text.
    pub fn parse(text: &str) -> Result<Self, String> {
        let text = without_comments(text);
        let mut grammar = Self {
            dma_events: count_occurrences(&text, "dma_event("),
            ..Self::default()
        };

        for (name, body) in machine_blocks(&text)? {
            let machine = parse_machine(name, body)?;
            grammar.phase_machines.push(machine.name.clone());
            grammar.machines.push(machine);
        }

        if grammar.machines.is_empty() {
            return Err("Devilang grammar contains no machine declaration".to_string());
        }

        Ok(grammar)
    }

    #[must_use]
    pub fn machine(&self) -> Option<&str> {
        self.machines.first().map(|machine| machine.name.as_str())
    }

    #[must_use]
    pub fn machines(&self) -> &[DevilangMachine] {
        &self.machines
    }

    /// Root machines loaded as ordered grammar phases.
    #[must_use]
    pub fn phase_machines(&self) -> &[String] {
        &self.phase_machines
    }

    #[must_use]
    pub fn states(&self) -> Vec<DevilangGrammarState> {
        self.machines
            .iter()
            .flat_map(|machine| {
                machine
                    .states
                    .iter()
                    .cloned()
                    .map(move |name| DevilangGrammarState {
                        machine: machine.name.clone(),
                        name,
                    })
            })
            .collect()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.machines
            .iter()
            .all(|machine| machine.transitions.is_empty())
    }

    #[must_use]
    pub fn dma_event_count(&self) -> usize {
        self.dma_events
    }

    #[must_use]
    pub fn transition_count(&self) -> usize {
        self.machines
            .iter()
            .map(|machine| machine.transitions.len())
            .sum()
    }

    #[must_use]
    pub fn trace_count(&self) -> usize {
        self.machines
            .iter()
            .map(|machine| machine.traces.len())
            .sum()
    }

    /// Merge whole machines without merging their bare state names.
    pub fn extend(&mut self, other: Self) {
        self.dma_events = self.dma_events.saturating_add(other.dma_events);
        for phase in other.phase_machines {
            if !self.phase_machines.iter().any(|current| current == &phase) {
                self.phase_machines.push(phase);
            }
        }
        for machine in other.machines {
            if !self
                .machines
                .iter()
                .any(|current| current.name == machine.name)
            {
                self.machines.push(machine);
            }
        }
    }

    /// Generate an encoded scenario that follows only declared transitions.
    pub(crate) fn generate_scenario<R: Rand>(
        &self,
        rand: &mut R,
        max_actions: usize,
    ) -> Result<ScenarioInput, String> {
        if max_actions == 0 {
            return Err("Devilang generation requires at least one action output".to_string());
        }

        let phase_indices = self.phase_indices();
        if phase_indices.is_empty() {
            return Err("Devilang grammar contains no executable phase".to_string());
        }

        let desired_outputs = if phase_indices.len() == 1 {
            1 + random_index(rand, max_actions)
        } else {
            max_actions
        };
        let mut actions = Vec::new();
        let mut steps = Vec::new();

        for (phase_position, machine_index) in phase_indices.iter().copied().enumerate() {
            let remaining = desired_outputs.saturating_sub(actions.len());
            if remaining == 0 {
                break;
            }
            let phase_target = if phase_position + 1 == phase_indices.len() {
                remaining
            } else {
                1
            };
            let steps_before = steps.len();
            self.append_machine_path(rand, machine_index, phase_target, &mut actions, &mut steps)?;
            if steps.len() == steps_before {
                return Err(format!(
                    "Devilang phase {} produced no transition path",
                    self.machines[machine_index].name
                ));
            }
        }

        if actions.is_empty() {
            return Err("Devilang grammar produced no encodable actions".to_string());
        }

        let (mmio, dma) = sections_from_actions(&actions, rand);
        Ok(ScenarioInput::new(mmio, dma))
    }

    /// Seed section validation (invariants); transition legality is guaranteed by construction.
    pub fn validate_scenario(&self, scenario: &ScenarioInput) -> Result<(), String> {
        if scenario.is_valid() {
            Ok(())
        } else {
            Err("scenario sections fail the model invariants".to_string())
        }
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
                .filter(|entry| {
                    entry
                        .extension()
                        .is_some_and(|extension| extension == "state")
                })
                .collect();
            entries.sort();
            if entries.is_empty() {
                return Err(format!(
                    "Devilang directory {} contains no .state files",
                    path.display()
                ));
            }
            // A directory is intentionally device- and phase-name agnostic.
            // Use a manifest when it also contains import-only helper modules
            // and the root phase set must be selected explicitly.
            return Self::from_paths(entries);
        }
        if path
            .extension()
            .is_some_and(|extension| extension == "state")
        {
            return Self::from_paths([path]);
        }

        let text = std::fs::read_to_string(path).map_err(|error| {
            format!(
                "failed to read Devilang grammar {}: {error}",
                path.display()
            )
        })?;
        let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
        let mut state_paths = Vec::new();
        for token in text.split(|character: char| {
            character == '"' || character.is_whitespace() || character == ','
        }) {
            if !std::path::Path::new(token)
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("state"))
            {
                continue;
            }
            let candidate = std::path::PathBuf::from(token);
            let candidate = if candidate.is_absolute() {
                candidate
            } else {
                parent.join(candidate)
            };
            if candidate.exists() && !state_paths.iter().any(|known| known == &candidate) {
                state_paths.push(candidate);
            }
        }
        if state_paths.is_empty() {
            return Self::parse(&text);
        }
        Self::from_paths(state_paths)
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
            load_state_path(&mut grammar, path.as_ref(), true, &mut visited)?;
        }
        if grammar.machines.is_empty() {
            return Err("Devilang state input contains no machine declaration".to_string());
        }
        Ok(grammar)
    }

    fn append_machine_path<R: Rand>(
        &self,
        rand: &mut R,
        machine_index: usize,
        target_outputs: usize,
        actions: &mut Vec<Action>,
        steps: &mut Vec<DevilangPathStep>,
    ) -> Result<(), String> {
        let machine = &self.machines[machine_index];
        let mut current = machine.initial.clone();
        let mut emitted = 0usize;
        let mut visits = 0usize;
        let initial_step_count = steps.len();

        while emitted < target_outputs && visits < MAX_TRACE_BLOCK_VISITS {
            visits += 1;
            let outgoing: Vec<_> = machine
                .transitions
                .iter()
                .filter(|transition| transition.from == current)
                .cloned()
                .collect();
            if outgoing.is_empty() {
                if steps.len() > initial_step_count {
                    break;
                }
                return Err(format!(
                    "Devilang phase {} has no transition from state {current}",
                    machine.name
                ));
            }

            let start = random_index(rand, outgoing.len());
            let mut selected = None;
            let mut empty_fallback = None;
            let mut last_error = None;
            let mut candidate_errors = Vec::new();
            for offset in 0..outgoing.len() {
                let transition = &outgoing[(start + offset) % outgoing.len()];
                let mut transition_error = None;
                for _ in 0..MAX_TRANSITION_EXECUTION_ATTEMPTS {
                    let execution =
                        match self.execute_transition_random(machine_index, transition, rand) {
                            Ok(execution) => execution,
                            Err(error) => {
                                last_error = Some(error);
                                transition_error.clone_from(&last_error);
                                continue;
                            }
                        };
                    if !execution.actions.is_empty()
                        && !scenario_can_append(actions, execution.actions.len())
                    {
                        last_error = Some(format!(
                            "transition {} has {} actions, exceeding the 4096-byte scenario budget",
                            transition.trace,
                            execution.actions.len()
                        ));
                        transition_error.clone_from(&last_error);
                        continue;
                    }
                    if execution.actions.is_empty() {
                        if transition.to != current && empty_fallback.is_none() {
                            empty_fallback = Some((transition.clone(), execution));
                        }
                        continue;
                    }
                    selected = Some((transition.clone(), execution));
                    break;
                }
                if selected.is_some() {
                    break;
                }
                if let Some(error) = transition_error {
                    candidate_errors.push(format!("{}: {error}", transition.trace));
                }
            }

            let Some((transition, execution)) = selected.or(empty_fallback) else {
                return Err(format!(
                    "Devilang phase {} cannot choose an in-budget transition from state {current}: {}",
                    machine.name,
                    if candidate_errors.is_empty() {
                        last_error.unwrap_or_else(|| "no executable transition".to_string())
                    } else {
                        candidate_errors.join("; ")
                    }
                ));
            };
            let emits_actions = !execution.actions.is_empty();
            steps.push(DevilangPathStep::with_actions(
                machine.name.clone(),
                transition.from.clone(),
                transition.to.clone(),
                transition.trace.clone(),
                execution.decisions,
                emits_actions,
            ));
            if emits_actions {
                actions.extend(execution.actions);
                emitted += 1;
            }
            current = transition.to;
        }
        Ok(())
    }

    fn execute_transition_random<R: Rand>(
        &self,
        machine_index: usize,
        transition: &DevilangTransition,
        rand: &mut R,
    ) -> Result<TraceExecution, String> {
        let mut decisions = RandomDecisionSource {
            rand,
            decisions: Vec::new(),
        };
        let mut active_traces = Vec::new();
        let actions = self.execute_trace(
            machine_index,
            &transition.trace,
            &mut decisions,
            0,
            &mut active_traces,
        )?;
        Ok(TraceExecution {
            actions,
            decisions: decisions.decisions,
        })
    }

    #[allow(dead_code)]
    fn replay_transition(
        &self,
        machine_index: usize,
        transition: &DevilangTransition,
        decisions: &[DevilangTraceDecision],
    ) -> Result<Vec<Action>, String> {
        let mut source = ReplayDecisionSource {
            decisions,
            index: 0,
        };
        let mut active_traces = Vec::new();
        let actions = self.execute_trace(
            machine_index,
            &transition.trace,
            &mut source,
            0,
            &mut active_traces,
        )?;
        if source.index != decisions.len() {
            return Err(format!(
                "transition {} has {} unused control-flow decisions",
                transition.trace,
                decisions.len().saturating_sub(source.index)
            ));
        }
        Ok(actions)
    }

    fn execute_trace<S: TraceDecisionSource>(
        &self,
        machine_index: usize,
        trace_name: &str,
        decisions: &mut S,
        depth: usize,
        active_traces: &mut Vec<(usize, usize)>,
    ) -> Result<Vec<Action>, String> {
        if depth >= MAX_TRACE_CALL_DEPTH {
            return Err(format!(
                "Devilang trace call depth exceeded at {trace_name}"
            ));
        }
        let (resolved_machine, trace_index) = self
            .trace_location(machine_index, trace_name)
            .ok_or_else(|| format!("unknown Devilang trace {trace_name}"))?;
        let trace = &self.machines[resolved_machine].traces[trace_index];
        if !self.trace_can_terminate(resolved_machine, trace_index) {
            return Err(format!(
                "Devilang trace {trace_name} has no finite terminal path"
            ));
        }
        if active_traces.contains(&(resolved_machine, trace_index)) {
            return Err(format!("Devilang trace call cycle reached at {trace_name}"));
        }
        active_traces.push((resolved_machine, trace_index));

        let mut actions = Vec::new();
        let mut block_index = 0usize;
        let mut visits = 0usize;
        let mut visited_blocks = Vec::new();

        let result = (|| {
            while block_index < trace.blocks.len() {
                visits += 1;
                if visits > MAX_TRACE_BLOCK_VISITS {
                    return Err(format!(
                        "Devilang trace visit budget exceeded at {trace_name}"
                    ));
                }
                if visited_blocks.contains(&block_index) {
                    return Err(format!(
                        "Devilang trace block cycle reached at {trace_name}"
                    ));
                }
                visited_blocks.push(block_index);

                let block = &trace.blocks[block_index];
                let iterations = if block.repeat {
                    usize::from(decisions.repeat_iterations()?)
                } else {
                    1
                };
                let mut jump = None;
                for _ in 0..iterations {
                    let mut context = TraceExecutionContext {
                        machine_index: resolved_machine,
                        trace_index,
                        trace_name,
                        visited_blocks: &visited_blocks,
                        decisions,
                        depth,
                        active_traces,
                        actions: &mut actions,
                    };
                    if let Some(target) =
                        self.execute_nodes(&block.nodes, block_index, &mut context)?
                    {
                        jump = Some(target);
                        break;
                    }
                }
                match jump {
                    Some(TraceControl::Goto(target)) => {
                        block_index = self
                            .trace_block_index(resolved_machine, trace_index, &target)
                            .ok_or_else(|| {
                                format!("trace {trace_name} jumps to unknown label @{target}")
                            })?;
                    }
                    Some(TraceControl::Return) => return Ok(actions),
                    None => block_index += 1,
                }
            }

            Ok(actions)
        })();
        active_traces.pop();
        result
    }

    fn execute_nodes<S: TraceDecisionSource>(
        &self,
        nodes: &[TraceNode],
        block_index: usize,
        context: &mut TraceExecutionContext<'_, S>,
    ) -> Result<Option<TraceControl>, String> {
        for (node_index, node) in nodes.iter().enumerate() {
            match node {
                TraceNode::Statement {
                    actions: node_actions,
                    call,
                } => {
                    context.actions.extend(node_actions.iter().cloned());
                    if let Some(call) = call
                        && let Some((callee_machine, callee_trace_name)) =
                            self.call_trace_location(context.machine_index, call)
                    {
                        let (_, callee_index) = self
                            .trace_location(callee_machine, &callee_trace_name)
                            .expect("call trace location must remain resolvable");
                        // Calls are a projection boundary unless their own finite CFG can
                        // expose fuzz-relevant actions. This keeps the transition's control
                        // flow honest without forcing recursive helper expansion or rejecting
                        // an otherwise valid caller because an opaque helper has a closed SCC.
                        if self.trace_can_terminate(callee_machine, callee_index)
                            && self.trace_has_observable_action(
                                callee_machine,
                                callee_index,
                                &mut Vec::new(),
                            )
                            && !context
                                .active_traces
                                .contains(&(callee_machine, callee_index))
                        {
                            let nested_actions = self.execute_trace(
                                callee_machine,
                                &callee_trace_name,
                                context.decisions,
                                context.depth + 1,
                                context.active_traces,
                            )?;
                            context.actions.extend(nested_actions);
                        }
                    }
                }
                TraceNode::Branch { target } => {
                    let taken_viable = self
                        .trace_block_index(context.machine_index, context.trace_index, target)
                        .is_some_and(|target_index| {
                            !context.visited_blocks.contains(&target_index)
                                && self.trace_block_can_terminate_avoiding(
                                    context.machine_index,
                                    context.trace_index,
                                    target_index,
                                    context.visited_blocks,
                                )
                        });
                    let not_taken_viable = self.nodes_can_terminate_avoiding(
                        context.machine_index,
                        context.trace_index,
                        block_index,
                        nodes,
                        node_index + 1,
                        context.visited_blocks,
                    );
                    if context
                        .decisions
                        .branch_taken(taken_viable, not_taken_viable)?
                    {
                        return Ok(Some(TraceControl::Goto(target.clone())));
                    }
                }
                TraceNode::Goto { target } => {
                    let viable = self
                        .trace_block_index(context.machine_index, context.trace_index, target)
                        .is_some_and(|target_index| {
                            !context.visited_blocks.contains(&target_index)
                                && self.trace_block_can_terminate_avoiding(
                                    context.machine_index,
                                    context.trace_index,
                                    target_index,
                                    context.visited_blocks,
                                )
                        });
                    if !viable {
                        return Err(format!(
                            "Devilang trace {} jumps only into a non-terminating path",
                            context.trace_name,
                        ));
                    }
                    return Ok(Some(TraceControl::Goto(target.clone())));
                }
                TraceNode::Return => return Ok(Some(TraceControl::Return)),
                TraceNode::Repeat(nodes) => {
                    for _ in 0..usize::from(context.decisions.repeat_iterations()?) {
                        if let Some(control) = self.execute_nodes(nodes, block_index, context)? {
                            return Ok(Some(control));
                        }
                    }
                }
                TraceNode::Sequence(nodes) => {
                    if let Some(control) = self.execute_nodes(nodes, block_index, context)? {
                        return Ok(Some(control));
                    }
                }
            }
        }
        Ok(None)
    }

    /// Return the index of a labelled block in one parsed trace.
    fn trace_block_index(
        &self,
        machine_index: usize,
        trace_index: usize,
        label: &str,
    ) -> Option<usize> {
        self.machines
            .get(machine_index)?
            .traces
            .get(trace_index)?
            .blocks
            .iter()
            .position(|block| block.label.as_deref() == Some(label))
    }

    /// Check whether a trace has a finite CFG path to a terminal block.
    ///
    /// Devilang's LLVM-derived runtime grammar contains intentional SCCs. A
    /// fuzzer input must describe a completed grammar transition, so a branch
    /// into a closed SCC is rejected instead of being cut off at an arbitrary
    /// visit limit.
    fn trace_can_terminate(&self, machine_index: usize, trace_index: usize) -> bool {
        self.trace_block_can_terminate(machine_index, trace_index, 0, &mut Vec::new())
    }

    /// Check a successor while excluding the basic blocks already traversed by
    /// the current concrete path.  A fresh CFG reachability query is not
    /// sufficient here: it can prove a successor viable only by returning to
    /// an ancestor block, which would make the emitted scenario cyclic.
    fn trace_block_can_terminate_avoiding(
        &self,
        machine_index: usize,
        trace_index: usize,
        block_index: usize,
        excluded: &[usize],
    ) -> bool {
        let mut visiting = excluded
            .iter()
            .map(|block| (machine_index, trace_index, *block))
            .collect();
        self.trace_block_can_terminate(machine_index, trace_index, block_index, &mut visiting)
    }

    fn nodes_can_terminate_avoiding(
        &self,
        machine_index: usize,
        trace_index: usize,
        block_index: usize,
        nodes: &[TraceNode],
        node_index: usize,
        excluded: &[usize],
    ) -> bool {
        let mut visiting = excluded
            .iter()
            .map(|block| (machine_index, trace_index, *block))
            .collect();
        self.nodes_can_terminate(
            machine_index,
            trace_index,
            block_index,
            nodes,
            node_index,
            &mut visiting,
        )
    }

    fn trace_block_can_terminate(
        &self,
        machine_index: usize,
        trace_index: usize,
        block_index: usize,
        visiting: &mut Vec<(usize, usize, usize)>,
    ) -> bool {
        let Some(trace) = self
            .machines
            .get(machine_index)
            .and_then(|machine| machine.traces.get(trace_index))
        else {
            return false;
        };
        if block_index >= trace.blocks.len() {
            return true;
        }

        let location = (machine_index, trace_index, block_index);
        if visiting.contains(&location) {
            return false;
        }
        visiting.push(location);
        let result = self.nodes_can_terminate(
            machine_index,
            trace_index,
            block_index,
            &trace.blocks[block_index].nodes,
            0,
            visiting,
        );
        visiting.pop();
        result
    }

    fn nodes_can_terminate(
        &self,
        machine_index: usize,
        trace_index: usize,
        block_index: usize,
        nodes: &[TraceNode],
        node_index: usize,
        visiting: &mut Vec<(usize, usize, usize)>,
    ) -> bool {
        if node_index >= nodes.len() {
            return self.trace_block_can_terminate(
                machine_index,
                trace_index,
                block_index + 1,
                visiting,
            );
        }

        match &nodes[node_index] {
            // A callee does not change the caller CFG.  It may be expanded
            // later when it has a finite observable projection, but viability
            // of this caller must not depend on recursively inlining every
            // LLVM helper trace.
            TraceNode::Statement { .. } => self.nodes_can_terminate(
                machine_index,
                trace_index,
                block_index,
                nodes,
                node_index + 1,
                visiting,
            ),
            TraceNode::Branch { target } => {
                let taken = self
                    .trace_block_index(machine_index, trace_index, target)
                    .is_some_and(|target_index| {
                        self.trace_block_can_terminate(
                            machine_index,
                            trace_index,
                            target_index,
                            visiting,
                        )
                    });
                taken
                    || self.nodes_can_terminate(
                        machine_index,
                        trace_index,
                        block_index,
                        nodes,
                        node_index + 1,
                        visiting,
                    )
            }
            TraceNode::Goto { target } => self
                .trace_block_index(machine_index, trace_index, target)
                .is_some_and(|target_index| {
                    self.trace_block_can_terminate(
                        machine_index,
                        trace_index,
                        target_index,
                        visiting,
                    )
                }),
            TraceNode::Return => true,
            // A repeat executes at least once. Checking one finite iteration
            // is sufficient here; execution still records and replays its
            // actual bounded iteration count.
            TraceNode::Repeat(body) | TraceNode::Sequence(body) => {
                self.nodes_can_terminate(machine_index, trace_index, block_index, body, 0, visiting)
                    && self.nodes_can_terminate(
                        machine_index,
                        trace_index,
                        block_index,
                        nodes,
                        node_index + 1,
                        visiting,
                    )
            }
        }
    }

    /// Return whether a finite trace can contribute a fuzz-relevant action.
    fn trace_has_observable_action(
        &self,
        machine_index: usize,
        trace_index: usize,
        visiting: &mut Vec<(usize, usize)>,
    ) -> bool {
        let location = (machine_index, trace_index);
        if visiting.contains(&location) {
            return false;
        }
        let Some(trace) = self
            .machines
            .get(machine_index)
            .and_then(|machine| machine.traces.get(trace_index))
        else {
            return false;
        };

        visiting.push(location);
        let result = trace
            .blocks
            .iter()
            .any(|block| self.nodes_have_observable_action(machine_index, &block.nodes, visiting));
        visiting.pop();
        result
    }

    fn nodes_have_observable_action(
        &self,
        machine_index: usize,
        nodes: &[TraceNode],
        visiting: &mut Vec<(usize, usize)>,
    ) -> bool {
        nodes.iter().any(|node| match node {
            TraceNode::Statement { actions, call } => {
                !actions.is_empty()
                    || call.as_ref().is_some_and(|call| {
                        self.call_trace_location(machine_index, call).is_some_and(
                            |(callee_machine, callee_name)| {
                                self.trace_location(callee_machine, &callee_name)
                                    .is_some_and(|(_, callee_index)| {
                                        self.trace_has_observable_action(
                                            callee_machine,
                                            callee_index,
                                            visiting,
                                        )
                                    })
                            },
                        )
                    })
            }
            TraceNode::Repeat(body) | TraceNode::Sequence(body) => {
                self.nodes_have_observable_action(machine_index, body, visiting)
            }
            TraceNode::Branch { .. } | TraceNode::Goto { .. } | TraceNode::Return => false,
        })
    }

    fn phase_indices(&self) -> Vec<usize> {
        let mut result = Vec::new();
        for phase in &self.phase_machines {
            if let Some(index) = self.machine_index(phase)
                && !result.contains(&index)
            {
                result.push(index);
            }
        }
        if result.is_empty() {
            result.extend(0..self.machines.len());
        }
        result
    }

    #[allow(dead_code)]
    fn phase_index(&self, machine_index: usize) -> Option<usize> {
        self.phase_indices()
            .iter()
            .position(|index| *index == machine_index)
    }

    fn machine_index(&self, name: &str) -> Option<usize> {
        self.machines
            .iter()
            .position(|machine| machine.name == name)
    }

    fn trace_location(&self, preferred_machine: usize, name: &str) -> Option<(usize, usize)> {
        if let Some(index) = self
            .machines
            .get(preferred_machine)?
            .traces
            .iter()
            .position(|trace| trace.name == name)
        {
            return Some((preferred_machine, index));
        }
        self.machines
            .iter()
            .enumerate()
            .find_map(|(machine_index, machine)| {
                machine
                    .traces
                    .iter()
                    .position(|trace| trace.name == name)
                    .map(|trace_index| (machine_index, trace_index))
            })
    }

    fn call_trace_location(&self, preferred_machine: usize, call: &str) -> Option<(usize, String)> {
        let location = self.trace_location(preferred_machine, call).or_else(|| {
            (!call.ends_with("_trace"))
                .then(|| format!("{call}_trace"))
                .and_then(|name| self.trace_location(preferred_machine, &name))
        })?;
        Some((
            location.0,
            self.machines[location.0].traces[location.1].name.clone(),
        ))
    }
}

trait TraceDecisionSource {
    fn branch_taken(&mut self, taken_viable: bool, not_taken_viable: bool) -> Result<bool, String>;
    fn repeat_iterations(&mut self) -> Result<u8, String>;
}

struct RandomDecisionSource<'a, R> {
    rand: &'a mut R,
    decisions: Vec<DevilangTraceDecision>,
}

impl<R: Rand> TraceDecisionSource for RandomDecisionSource<'_, R> {
    fn branch_taken(&mut self, taken_viable: bool, not_taken_viable: bool) -> Result<bool, String> {
        if !taken_viable && !not_taken_viable {
            return Err("Devilang branch has no finite terminal successor".to_string());
        }
        let taken = if taken_viable && not_taken_viable {
            random_index(self.rand, 2) == 1
        } else {
            taken_viable
        };
        self.decisions.push(DevilangTraceDecision::Branch { taken });
        Ok(taken)
    }

    fn repeat_iterations(&mut self) -> Result<u8, String> {
        let iterations =
            1 + u8::try_from(random_index(self.rand, usize::from(MAX_REPEAT_ITERATIONS)))
                .map_err(|_| "repeat iteration count is out of range".to_string())?;
        self.decisions
            .push(DevilangTraceDecision::Repeat { iterations });
        Ok(iterations)
    }
}

#[allow(dead_code)]
struct ReplayDecisionSource<'a> {
    decisions: &'a [DevilangTraceDecision],
    index: usize,
}

impl TraceDecisionSource for ReplayDecisionSource<'_> {
    fn branch_taken(&mut self, taken_viable: bool, not_taken_viable: bool) -> Result<bool, String> {
        let decision = self
            .decisions
            .get(self.index)
            .ok_or_else(|| "missing Devilang branch decision".to_string())?;
        self.index += 1;
        match decision {
            DevilangTraceDecision::Branch { taken }
                if (*taken && taken_viable) || (!*taken && not_taken_viable) =>
            {
                Ok(*taken)
            }
            DevilangTraceDecision::Branch { .. } => Err(
                "recorded Devilang branch does not have a finite terminal successor".to_string(),
            ),
            DevilangTraceDecision::Repeat { .. } => {
                Err("expected a Devilang branch decision".to_string())
            }
        }
    }

    fn repeat_iterations(&mut self) -> Result<u8, String> {
        let decision = self
            .decisions
            .get(self.index)
            .ok_or_else(|| "missing Devilang repeat decision".to_string())?;
        self.index += 1;
        match decision {
            DevilangTraceDecision::Repeat { iterations }
                if (1..=MAX_REPEAT_ITERATIONS).contains(iterations) =>
            {
                Ok(*iterations)
            }
            DevilangTraceDecision::Repeat { .. } => {
                Err("Devilang repeat decision exceeds the bounded repeat range".to_string())
            }
            DevilangTraceDecision::Branch { .. } => {
                Err("expected a Devilang repeat decision".to_string())
            }
        }
    }
}

#[cfg(feature = "std")]
fn load_state_path(
    grammar: &mut DevilangGrammar,
    path: &std::path::Path,
    phase: bool,
    visited: &mut Vec<std::path::PathBuf>,
) -> Result<(), String> {
    let normalized = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if visited.iter().any(|known| known == &normalized) {
        return Ok(());
    }
    visited.push(normalized);

    let text = std::fs::read_to_string(path)
        .map_err(|error| format!("failed to read Devilang state {}: {error}", path.display()))?;
    let mut parsed = DevilangGrammar::parse(&text)?;
    if !phase {
        parsed.phase_machines.clear();
    }
    grammar.extend(parsed);

    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    for import in state_imports(&text) {
        let imported = parent.join(import);
        if imported.exists() {
            load_state_path(grammar, &imported, false, visited)?;
        }
    }
    Ok(())
}

fn parse_machine(name: String, body: &str) -> Result<DevilangMachine, String> {
    let mut initial = None;
    let mut states = Vec::new();
    let mut transitions = Vec::new();
    let mut traces = Vec::new();
    let mut index = 0usize;

    while index < body.len() {
        index = skip_whitespace(body, index);
        if index >= body.len() {
            break;
        }

        if let Some((trace_name, open_brace)) = trace_header_at(body, index) {
            let close_brace = matching_brace(body, open_brace)
                .ok_or_else(|| format!("unterminated Devilang trace {trace_name}"))?;
            traces.push(parse_trace(trace_name, &body[open_brace + 1..close_brace]));
            index = close_brace + 1;
            continue;
        }

        if word_at(body, index, "initial") {
            let value_start = skip_whitespace(body, index + "initial".len());
            if let Some((state, _)) = read_identifier(body, value_start) {
                initial = Some(state);
            }
            index = next_statement(body, index);
            continue;
        }

        let state_start = if word_at(body, index, "state") {
            Some(index + "state".len())
        } else if word_at(body, index, "final") {
            let after_final = skip_whitespace(body, index + "final".len());
            word_at(body, after_final, "state").then_some(after_final + "state".len())
        } else {
            None
        };
        if let Some(state_start) = state_start {
            let value_start = skip_whitespace(body, state_start);
            if let Some((state, _)) = read_identifier(body, value_start)
                && !states.iter().any(|current| current == &state)
            {
                states.push(state);
            }
            index = next_statement(body, index);
            continue;
        }

        if word_at(body, index, "transition") {
            let end = statement_end(body, index);
            if let Some(transition) = parse_transition(&body[index..end]) {
                transitions.push(transition);
            }
            index = skip_statement_end(body, end);
            continue;
        }

        index = next_statement(body, index);
    }

    let initial = initial.ok_or_else(|| format!("machine {name} has no initial state"))?;
    if !states.iter().any(|state| state == &initial) {
        states.push(initial.clone());
    }
    Ok(DevilangMachine {
        name,
        initial,
        states,
        transitions,
        traces,
    })
}

fn parse_trace(name: String, body: &str) -> DevilangTrace {
    let mut blocks = Vec::new();
    let mut index = 0usize;
    while index < body.len() {
        index = skip_whitespace(body, index);
        if index >= body.len() {
            break;
        }
        let (label, block_start) = if body.as_bytes().get(index) == Some(&b'@') {
            let label_start = index + 1;
            if let Some((label, label_end)) = read_identifier(body, label_start) {
                let colon = skip_whitespace(body, label_end);
                if body.as_bytes().get(colon) == Some(&b':') {
                    (Some(label), skip_whitespace(body, colon + 1))
                } else {
                    (None, index)
                }
            } else {
                (None, index)
            }
        } else {
            (None, index)
        };
        let (repeat, after_keyword) = if word_at(body, block_start, "sequence") {
            (false, block_start + "sequence".len())
        } else if word_at(body, block_start, "repeat") {
            (true, block_start + "repeat".len())
        } else {
            index = next_statement(body, index);
            continue;
        };
        let open_brace = skip_whitespace(body, after_keyword);
        if body.as_bytes().get(open_brace) != Some(&b'{') {
            index = next_statement(body, index);
            continue;
        }
        let Some(close_brace) = matching_brace(body, open_brace) else {
            break;
        };
        blocks.push(DevilangTraceBlock {
            label,
            repeat,
            nodes: parse_nodes(&body[open_brace + 1..close_brace]),
        });
        index = close_brace + 1;
    }
    DevilangTrace { name, blocks }
}

fn parse_nodes(body: &str) -> Vec<TraceNode> {
    let mut nodes = Vec::new();
    let mut index = 0usize;
    while index < body.len() {
        index = skip_whitespace(body, index);
        if index >= body.len() {
            break;
        }
        if let Some((repeat, after_keyword)) = block_keyword_at(body, index) {
            let open_brace = skip_whitespace(body, after_keyword);
            if body.as_bytes().get(open_brace) == Some(&b'{')
                && let Some(close_brace) = matching_brace(body, open_brace)
            {
                let nested = parse_nodes(&body[open_brace + 1..close_brace]);
                nodes.push(if repeat {
                    TraceNode::Repeat(nested)
                } else {
                    TraceNode::Sequence(nested)
                });
                index = close_brace + 1;
                continue;
            }
        }

        let end = statement_end(body, index);
        if end <= index {
            index += 1;
            continue;
        }
        let statement = body[index..end].trim();
        if statement == "..." {
            nodes.push(TraceNode::Return);
        } else if let Some(target) = branch_target(statement) {
            nodes.push(TraceNode::Branch { target });
        } else if let Some(target) = goto_target(statement) {
            nodes.push(TraceNode::Goto { target });
        } else {
            let actions = parse_actions(statement);
            let call = call_target(statement);
            if !actions.is_empty() || call.is_some() {
                nodes.push(TraceNode::Statement { actions, call });
            }
        }
        index = skip_statement_end(body, end);
    }
    nodes
}

fn machine_blocks(text: &str) -> Result<Vec<(String, &str)>, String> {
    let mut result = Vec::new();
    let mut index = 0usize;
    while let Some(machine_index) = find_word(text, "machine", index) {
        let name_start = skip_whitespace(text, machine_index + "machine".len());
        let (name, name_end) = read_identifier(text, name_start)
            .ok_or_else(|| "Devilang machine declaration has no name".to_string())?;
        let open_brace = skip_whitespace(text, name_end);
        if text.as_bytes().get(open_brace) != Some(&b'{') {
            return Err(format!("machine {name} has no body"));
        }
        let close_brace = matching_brace(text, open_brace)
            .ok_or_else(|| format!("machine {name} has an unterminated body"))?;
        result.push((name, &text[open_brace + 1..close_brace]));
        index = close_brace + 1;
    }
    Ok(result)
}

fn trace_header_at(text: &str, index: usize) -> Option<(String, usize)> {
    let mut cursor = index;
    if word_at(text, cursor, "entry") {
        cursor = skip_whitespace(text, cursor + "entry".len());
    }
    if !word_at(text, cursor, "trace") {
        return None;
    }
    cursor = skip_whitespace(text, cursor + "trace".len());
    let (name, name_end) = read_identifier(text, cursor)?;
    let open_brace = skip_whitespace(text, name_end);
    (text.as_bytes().get(open_brace) == Some(&b'{')).then_some((name, open_brace))
}

fn block_keyword_at(text: &str, index: usize) -> Option<(bool, usize)> {
    if word_at(text, index, "sequence") {
        return Some((false, index + "sequence".len()));
    }
    word_at(text, index, "repeat").then_some((true, index + "repeat".len()))
}

fn parse_transition(text: &str) -> Option<DevilangTransition> {
    let text = text.trim().trim_end_matches(';').trim();
    let rest = text.strip_prefix("transition")?.trim();
    let fields: Vec<_> = rest.split_whitespace().collect();
    (fields.len() == 5 && fields[1] == "->" && fields[3] == "on").then(|| DevilangTransition {
        from: fields[0].to_string(),
        to: fields[2].to_string(),
        trace: fields[4].to_string(),
    })
}

fn branch_target(statement: &str) -> Option<String> {
    let rest = statement
        .trim()
        .trim_end_matches(';')
        .strip_prefix("neqj")?
        .trim();
    let (_, target) = rest.rsplit_once(", @")?;
    let (target, _) = read_identifier(target.trim(), 0)?;
    Some(target)
}

fn goto_target(statement: &str) -> Option<String> {
    let target = statement
        .trim()
        .trim_end_matches(';')
        .strip_prefix("goto")?
        .trim()
        .strip_prefix('@')?;
    let (target, _) = read_identifier(target, 0)?;
    Some(target)
}

fn call_target(statement: &str) -> Option<String> {
    let statement = statement.trim().trim_end_matches(';').trim();
    let candidate = statement
        .strip_prefix("call")
        .map(str::trim)
        .or_else(|| statement.rsplit_once('=').map(|(_, value)| value.trim()))
        .unwrap_or(statement);
    let (name, end) = read_qualified_name(candidate, 0)?;
    let suffix = candidate[end..].trim();
    (suffix.is_empty() || suffix.starts_with('(')).then_some(name)
}

/// Lower the action stream produced by the grammar into consumer data units:
/// - MmioRead/MmioWrite/MmioReadOverride within the window become visit-value
///   sequences for window slots;
/// - QueueDmaWrite/DmaEvent becomes a streaming entry (`present` selects
///   32-bit slots, `addr` is the zero-based runtime streaming-MAP ordinal);
/// - other action families (PIO/IRQ/Mem) have no target in the new interface
///   and are ignored; the coherent section remains empty here.
fn sections_from_actions<R: Rand>(actions: &[Action], rand: &mut R) -> (MmioSection, DmaSection) {
    let mut visits: alloc::collections::BTreeMap<usize, Vec<u32>> =
        alloc::collections::BTreeMap::new();
    let mut streaming = Vec::new();

    for action in actions {
        let Action::Hyper(hyper) = action;
        match hyper {
            HyperAction::MmioWrite { addr, width, value }
            | HyperAction::MmioReadOverride { addr, width, value } => {
                push_mmio_visit(&mut visits, *addr, *width, *value);
            }
            HyperAction::MmioRead { addr, width } => {
                push_mmio_visit(&mut visits, *addr, *width, 0);
            }
            HyperAction::QueueDmaWrite { payload_len, .. }
            | HyperAction::DmaEvent { len: payload_len, .. } => {
                // Model the planned payload by 32-bit slots: one u32 per slot.
                let slots = usize::try_from(*payload_len)
                    .unwrap_or(0)
                    .div_ceil(4)
                    .min(usize::try_from(crate::input::MAX_STREAM_UNIT_SLOTS).unwrap_or(1));
                if slots == 0 {
                    continue;
                }
                let present = if slots >= u128::BITS as usize {
                    u128::MAX
                } else {
                    (u128::from(1u32) << slots) - 1
                };
                let values: Vec<u32> = (0..slots)
                    .map(|_| {
                        let lo = (rand.below(unsafe { NonZeroUsize::new_unchecked(65536) })
                            & 0xffff) as u32;
                        let hi = (rand.below(unsafe { NonZeroUsize::new_unchecked(65536) })
                            & 0xffff) as u32;
                        (hi << 16) | lo
                    })
                    .collect();
                streaming.push(crate::input::StreamUnit {
                    addr: u64::try_from(streaming.len()).unwrap_or(u64::MAX),
                    present,
                    values,
                });
            }
            _ => {}
        }
    }

    let mut mmio = MmioSection::default();
    for (slot, values) in visits {
        let count = values.len() as u32;
        mmio.present |= 1u128 << slot;
        mmio.word_model.push(crate::input::WordModel { count, values });
    }
    let dma = DmaSection {
        coherent: Vec::new(),
        streaming,
    };
    (mmio, dma)
}

/// Project an action's (addr, width, value) into a window-word visit value.
/// `addr % 4` determines byte placement; cross-word tails are truncated.
fn push_mmio_visit(
    visits: &mut alloc::collections::BTreeMap<usize, Vec<u32>>,
    addr: u64,
    width: u8,
    value: u64,
) {
    let offset = usize::try_from(addr % 0x200).unwrap_or(0);
    let slot = offset / 4;
    let shift = u32::try_from(offset % 4).unwrap_or(0) * 8;
    let width_mask = if width >= 4 {
        u32::MAX
    } else {
        (1u32 << (u32::from(width) * 8)) - 1
    };
    let raw = ((value as u32) & width_mask).wrapping_shl(shift);
    visits.entry(slot).or_default().push(raw);
}

fn occurrence_estimate(action: &Action) -> usize {
    let Action::Hyper(hyper) = action;
    match hyper {
        HyperAction::QueueDmaWrite { payload_len, .. } => {
            4 + usize::try_from(*payload_len).unwrap_or(0).min(8192)
        }
        HyperAction::DmaEvent { len, .. } => {
            4 + usize::try_from(*len).unwrap_or(0).min(8192)
        }
        _ => 8,
    }
}

fn scenario_can_append(actions: &[Action], action_count: usize) -> bool {
    let acc: usize = actions.iter().map(occurrence_estimate).sum();
    let extra: usize = actions
        .iter()
        .rev()
        .take(action_count)
        .map(occurrence_estimate)
        .sum();
    acc.saturating_add(extra).saturating_add(16) <= MAX_ENCODED_SCENARIO_BYTES
}

fn random_index<R: Rand>(rand: &mut R, length: usize) -> usize {
    if length <= 1 {
        0
    } else {
        rand.below(NonZeroUsize::new(length).expect("length checked to be non-zero"))
    }
}

#[cfg(feature = "std")]
fn state_imports(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| {
            let line = strip_comment(line).trim();
            let rest = line.strip_prefix("import")?.trim();
            let start = rest.find('"')? + 1;
            let end = rest[start..].find('"')? + start;
            Some(rest[start..end].to_string())
        })
        .collect()
}

fn without_comments(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for line in text.lines() {
        result.push_str(strip_comment(line));
        result.push('\n');
    }
    result
}

fn strip_comment(line: &str) -> &str {
    line.split_once("//").map_or(line, |(before, _)| before)
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
    let end = read_identifier_end(text, index, false)?;
    Some((text[index..end].to_string(), end))
}

fn read_qualified_name(text: &str, index: usize) -> Option<(String, usize)> {
    let end = read_identifier_end(text, index, true)?;
    Some((text[index..end].to_string(), end))
}

fn read_identifier_end(text: &str, index: usize, qualified: bool) -> Option<usize> {
    let first = *text.as_bytes().get(index)?;
    if !is_identifier_byte(first) {
        return None;
    }
    let mut end = index + 1;
    while let Some(byte) = text.as_bytes().get(end) {
        if is_identifier_byte(*byte) || (qualified && *byte == b'.') {
            end += 1;
        } else {
            break;
        }
    }
    Some(end)
}

fn is_identifier_byte(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}

fn skip_whitespace(text: &str, mut index: usize) -> usize {
    while text
        .as_bytes()
        .get(index)
        .is_some_and(u8::is_ascii_whitespace)
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

fn statement_end(text: &str, start: usize) -> usize {
    let mut paren_depth = 0usize;
    for (index, byte) in text.as_bytes().iter().enumerate().skip(start) {
        match byte {
            b'(' => paren_depth += 1,
            b')' => paren_depth = paren_depth.saturating_sub(1),
            b';' | b'\n' if paren_depth == 0 => return index,
            _ => {}
        }
    }
    text.len()
}

fn skip_statement_end(text: &str, end: usize) -> usize {
    let mut index = end;
    if text.as_bytes().get(index).is_some_and(|byte| *byte == b';') {
        index += 1;
    }
    if text
        .as_bytes()
        .get(index)
        .is_some_and(|byte| *byte == b'\n')
    {
        index += 1;
    }
    index
}

fn next_statement(text: &str, index: usize) -> usize {
    let end = statement_end(text, index);
    let next = skip_statement_end(text, end);
    if next > index { next } else { index + 1 }
}

fn count_occurrences(haystack: &str, needle: &str) -> usize {
    haystack.match_indices(needle).count()
}

fn parse_actions(line: &str) -> Vec<Action> {
    let mut found = parse_dma_actions(line);
    found.extend(parse_queue_dma_actions(line));
    for width in [1u8, 2, 4, 8] {
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
                ));
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
                ));
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
                ));
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
                ));
            }
        });
    }

    // These are explicit device-input directives. They use `call` syntax so
    // they remain valid Devilang trace instructions, while their arguments
    // are preserved as seed data instead of being hidden in a QEMU patch.
    collect_calls(line, "mmio_read_override", |position, args| {
        if args.len() >= 3 {
            let width = expression_value(args[1], 0x5245_5744);
            if let (Ok(width), value) =
                (u8::try_from(width), expression_value(args[2], 0x5245_5644))
            {
                found.push((
                    position,
                    Action::Hyper(HyperAction::MmioReadOverride {
                        addr: expression_value(args[0], 0x5245_4144),
                        width,
                        value,
                    }),
                ));
            }
        }
    });
    found.sort_by_key(|(position, _)| *position);
    found.into_iter().map(|(_, action)| action).collect()
}

fn parse_queue_dma_actions(line: &str) -> Vec<(usize, Action)> {
    let mut result = Vec::new();
    let needle = "queue_dma_write(";
    let mut search_from = 0usize;
    while let Some(relative) = line[search_from..].find(needle) {
        let start = search_from + relative;
        let open = start + needle.len() - 1;
        let Some(close) = matching_paren(line, open) else {
            break;
        };
        let mut operation = None;
        let mut direction = None;
        let mut path = None;
        let mut sequence = None;
        let mut queue = None;
        let mut payload_len = None;
        let mut used_len = None;
        for item in split_args(&line[open + 1..close]) {
            let Some((key, value)) = item.split_once('=') else {
                continue;
            };
            match key.trim() {
                "op" => operation = dma_operation_value(value),
                "dir" => direction = dma_direction_value(value),
                "path" => path = dma_path_value(value),
                "sequence" | "seq" => sequence = parse_integer(value),
                "queue" => queue = Some(expression_value(value, 0x51554555)),
                "payload" | "payload_len" | "write_len" => {
                    payload_len = Some(expression_value(value, 0x5041594c))
                }
                "used" | "used_len" | "completion_len" => {
                    used_len = Some(expression_value(value, 0x55534544))
                }
                _ => {}
            }
        }
        if let (Some(operation), Some(direction), Some(payload_len), Some(used_len)) =
            (operation, direction, payload_len, used_len)
            && let (Ok(operation), Ok(direction), Ok(path), Ok(sequence), Ok(queue),
                Ok(payload_len), Ok(used_len)) = (
                u8::try_from(operation),
                u8::try_from(direction),
                u8::try_from(path.unwrap_or(0)),
                u16::try_from(sequence.unwrap_or(0)),
                u16::try_from(queue.unwrap_or(0)),
                u32::try_from(payload_len),
                u32::try_from(used_len),
            )
        {
            result.push((
                start,
                Action::Hyper(HyperAction::QueueDmaWrite {
                    operation,
                    direction,
                    path,
                    sequence,
                    queue,
                    payload_len,
                    used_len,
                }),
            ));
        }
        search_from = close.saturating_add(1);
    }
    result
}

fn parse_dma_actions(line: &str) -> Vec<(usize, Action)> {
    let mut result = Vec::new();
    let needle = "dma_event(";
    let mut search_from = 0usize;
    while let Some(relative) = line[search_from..].find(needle) {
        let start = search_from + relative;
        let open = start + needle.len() - 1;
        let Some(close) = matching_paren(line, open) else {
            break;
        };
        let mut operation = None;
        let mut direction = None;
        let mut path = None;
        let mut sequence = None;
        let mut address = None;
        let mut length = None;
        for item in split_args(&line[open + 1..close]) {
            let Some((key, value)) = item.split_once('=') else {
                continue;
            };
            match key.trim() {
                "op" => operation = dma_operation_value(value),
                "dir" => direction = dma_direction_value(value),
                "path" => path = dma_path_value(value),
                "sequence" | "seq" => sequence = parse_integer(value),
                "addr" => address = Some(expression_value(value, 0x444d_4141)),
                "len" => length = Some(expression_value(value, 0x444d_4c45)),
                _ => {}
            }
        }
        // Keep every telemetry event in the structured seed. These records
        // describe the observed DMA protocol; the native L2 QEMU consumer
        // uses the guest's MMIO transaction for the actual DMA operation.
        if let (Some(operation), Some(direction), Some(address), Some(length)) =
            (operation, direction, address, length)
            && let (Ok(operation), Ok(direction), Ok(path), Ok(sequence), Ok(length)) = (
                u8::try_from(operation),
                u8::try_from(direction),
                u8::try_from(path.unwrap_or(0)),
                u16::try_from(sequence.unwrap_or(0)),
                u32::try_from(length),
            )
        {
            result.push((
                start,
                Action::Hyper(HyperAction::DmaEvent {
                    operation,
                    direction,
                    path,
                    sequence,
                    addr: address,
                    len: length,
                }),
            ));
        }
        search_from = close.saturating_add(1);
    }
    result
}

fn dma_operation_value(value: &str) -> Option<u64> {
    match value.trim() {
        "HP_DMA_EVENT_OP_ALLOC_SUCCESS" => Some(1),
        "HP_DMA_EVENT_OP_ALLOC_FAIL" => Some(2),
        "HP_DMA_EVENT_OP_FREE" => Some(3),
        "HP_DMA_EVENT_OP_MAP" => Some(4),
        "HP_DMA_EVENT_OP_MAP_FAIL" => Some(5),
        "HP_DMA_EVENT_OP_UNMAP" => Some(6),
        "HP_DMA_EVENT_OP_SYNC_FOR_CPU" => Some(7),
        "HP_DMA_EVENT_OP_SYNC_FOR_DEVICE" => Some(8),
        "HP_DMA_EVENT_OP_VQ_POLL_HIT" => Some(9),
        "HP_DMA_EVENT_OP_VQ_POLL_MISS" => Some(10),
        "HP_DMA_EVENT_OP_VQ_GET_BUF" => Some(11),
        "HP_DMA_EVENT_OP_VQ_GET_BUF_EMPTY" => Some(12),
        "alloc" | "alloc_success" | "alloc-success" => Some(1),
        "alloc_fail" | "alloc-fail" => Some(2),
        "free" => Some(3),
        "map" => Some(4),
        "map_fail" | "map-fail" => Some(5),
        "unmap" => Some(6),
        "sync_for_cpu" | "sync-for-cpu" => Some(7),
        "sync_for_device" | "sync-for-device" => Some(8),
        "vq_poll_hit" | "vq-poll-hit" => Some(9),
        "vq_poll_miss" | "vq-poll-miss" => Some(10),
        "vq_get_buf" | "vq-get-buf" => Some(11),
        "vq_get_buf_empty" | "vq-get-buf-empty" => Some(12),
        other => parse_integer(other),
    }
}

fn dma_direction_value(value: &str) -> Option<u64> {
    match value.trim() {
        "DMA_NONE" | "HP_DMA_EVENT_DIR_NONE" => Some(0),
        "DMA_TO_DEVICE" | "HP_DMA_EVENT_DIR_TO_DEVICE" => Some(1),
        "DMA_FROM_DEVICE" | "HP_DMA_EVENT_DIR_FROM_DEVICE" => Some(2),
        "DMA_BIDIRECTIONAL" | "HP_DMA_EVENT_DIR_BIDIRECTIONAL" => Some(3),
        "none" => Some(0),
        "to_device" | "to-device" => Some(1),
        "from_device" | "from-device" => Some(2),
        "bidirectional" => Some(3),
        other => parse_integer(other),
    }
}

fn dma_path_value(value: &str) -> Option<u64> {
    match value.trim() {
        "HP_DMA_EVENT_PATH_DMA_API" => Some(0),
        "HP_DMA_EVENT_PATH_PHYS" => Some(1),
        "dma_api" | "dma-api" => Some(0),
        "phys" => Some(1),
        other => parse_integer(other),
    }
}

fn collect_calls<F>(line: &str, name: &str, mut callback: F)
where
    F: FnMut(usize, Vec<&str>),
{
    let needle = format!("{name}(");
    let mut search_from = 0usize;
    while let Some(relative) = line[search_from..].find(&needle) {
        let start = search_from + relative;
        if start > 0
            && line[..start]
                .chars()
                .next_back()
                .is_some_and(|character| character == '_' || character.is_ascii_alphanumeric())
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
    let mut start = 0usize;
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

fn expression_value(expression: &str, salt: u64) -> u64 {
    let expression = expression.trim().trim_end_matches(';');
    if let Some(value) = parse_integer(expression) {
        return value;
    }
    let bytes = expression.as_bytes();
    let mut value = 0u64;
    let mut found = false;
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index].is_ascii_digit() && (index == 0 || !is_identifier_byte(bytes[index - 1])) {
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
            while index < bytes.len() && is_identifier_byte(bytes[index]) {
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

#[allow(dead_code)]
fn format_action(action: &Action) -> String {
    match action {
        Action::Hyper(HyperAction::MmioRead { addr, width }) => {
            format!("hyper.mmio_read addr=0x{addr:x} width={width}")
        }
        Action::Hyper(HyperAction::MmioReadOverride { addr, width, value }) => {
            format!("hyper.mmio_read_override addr=0x{addr:x} width={width} value=0x{value:x}")
        }
        Action::Hyper(HyperAction::DmaEvent {
            operation,
            direction,
            path,
            sequence,
            addr,
            len,
        }) => format!(
            "hyper.dma_event op={operation} dir={direction} path={path} sequence={sequence} addr=0x{addr:x} len={len}"
        ),
        Action::Hyper(HyperAction::QueueDmaWrite {
            operation,
            direction,
            path,
            sequence,
            queue,
            payload_len,
            used_len,
        }) => format!(
            "hyper.queue_dma_write op={operation} dir={direction} path={path} sequence={sequence} queue={queue} payload_len={payload_len} used_len={used_len}"
        ),
        Action::Hyper(HyperAction::MmioWrite { addr, width, value }) => {
            format!("hyper.mmio_write addr=0x{addr:x} width={width} value=0x{value:x}")
        }
        Action::Hyper(other) => format!("hyper.{other:?}"),
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs, process,
        time::{SystemTime, UNIX_EPOCH},
    };

    use libafl::{generators::Generator, mutators::Mutator, state::HasRand};
    use libafl_bolts::rands::StdRand;

    use super::*;
    use crate::input::{WordModel, format_scenario};
    use crate::{ScenarioGenerator, ScenarioMutator, encode_scenario};

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

    const STATE_MACHINE_FIXTURE: &str = r#"
machine booting {
    initial state_0
    state state_0
    state ready
    transition state_0 -> ready on probe_trace
    trace probe_trace {
        sequence {
            read32(VIRTIO_MMIO_MAGIC_VALUE);
            neqj probe_ok, 0, @fallback;
            write32(1, VIRTIO_MMIO_STATUS);
        }
        @fallback: sequence {
            write32(2, VIRTIO_MMIO_STATUS);
        }
    }
}

machine runtime {
    initial state_0
    state state_0
    state running
    transition state_0 -> running on start_trace
    transition running -> running on run_trace
    trace start_trace {
        sequence {
            call configure_queue();
        }
    }
    trace configure_queue_trace {
        sequence {
            virtio_cread16(vdev, VIRTIO_MMIO_QUEUE_NUM_MAX);
        }
    }
    trace run_trace {
        sequence {
            repeat {
                write32(3, VIRTIO_MMIO_QUEUE_NOTIFY);
            }
            dma_event(op=map, dir=from_device, addr=0x1000, len=4);
        }
    }
}
"#;

    #[test]
    fn generated_paths_follow_machine_transitions() {
        let grammar = DevilangGrammar::parse(STATE_MACHINE_FIXTURE).expect("grammar should parse");
        assert_eq!(grammar.machines().len(), 2);
        assert_eq!(grammar.machines()[0].name(), "booting");
        assert_eq!(grammar.machines()[1].name(), "runtime");
        assert_eq!(grammar.dma_event_count(), 1);

        for seed in 0..32 {
            let mut rand = StdRand::with_seed(seed);
            let scenario = grammar
                .generate_scenario(&mut rand, 4)
                .expect("grammar should yield a scenario");
            grammar
                .validate_scenario(&scenario)
                .expect("generated path must be valid");
            assert!(encode_scenario(&scenario).len() <= MAX_ENCODED_SCENARIO_BYTES);
            assert!(scenario.is_valid());
        }
    }

    #[test]
    fn dma_events_keep_operation_direction_path_and_sequence() {
        let grammar = DevilangGrammar::parse(
            r#"
machine dma_trace {
    initial start
    state start
    state done
    transition start -> done on trace
    trace trace {
        sequence {
            dma_event(op=unmap, dir=DMA_FROM_DEVICE, path=phys, sequence=7, addr=0x2000, len=1024);
        }
    }
}
"#,
        )
        .expect("DMA grammar should parse");
        let mut rand = StdRand::with_seed(0x444d_41);
        let scenario = grammar
            .generate_scenario(&mut rand, 1)
            .expect("DMA grammar should generate");
        assert!(matches!(
            scenario.dma.streaming.as_slice(),
            [crate::input::StreamUnit { present: u128::MAX, .. }]
        ));
        grammar
            .validate_scenario(&scenario)
            .expect("DMA scenario should validate");
    }

    #[test]
    fn grammar_mutation_regenerates_valid_paths_and_prints_actions() {
        let grammar = DevilangGrammar::parse(STATE_MACHINE_FIXTURE).expect("grammar should parse");
        let generator =
            ScenarioGenerator::default().with_devilang_grammar(grammar.clone());
        let mut state = TestState {
            rand: StdRand::with_seed(7),
        };
        let mut scenario = generator
            .clone()
            .generate(&mut state)
            .expect("grammar generation should work");
        let before = format_scenario(&scenario);
        let mut mutator = ScenarioMutator::new(generator);
        let _ = mutator
            .mutate(&mut state, &mut scenario)
            .expect("grammar mutation should work");
        let after = format_scenario(&scenario);
        println!("before mutation:\n{before}after mutation:\n{after}");
        grammar
            .validate_scenario(&scenario)
            .expect("mutated path must be valid");
        assert!(encode_scenario(&scenario).len() <= MAX_ENCODED_SCENARIO_BYTES);
    }

    #[test]
    fn generated_phase_files_keep_machine_namespaces_and_imports() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "libafl-nesting-devilang-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&directory).expect("temporary grammar directory should exist");
        let booting = directory.join("booting.state");
        let runtime = directory.join("runtime.state");
        fs::write(
            &booting,
            r#"
import "helper.state";
machine phase_one {
    initial state_0
    state state_0
    transition state_0 -> state_0 on entry_trace
    trace entry_trace {
        sequence {
            call helper();
        }
    }
}
"#,
        )
        .expect("booting state should be written");
        fs::write(
            &runtime,
            r#"
machine phase_two {
    initial state_0
    state state_0
    transition state_0 -> state_0 on runtime_trace
    trace runtime_trace {
        sequence {
            write32(1, VIRTIO_MMIO_STATUS);
        }
    }
}
"#,
        )
        .expect("runtime state should be written");
        fs::write(
            directory.join("helper.state"),
            r#"
machine helper_machine {
    initial state_0
    state state_0
    transition state_0 -> state_0 on helper_trace
    trace helper_trace {
        sequence {
            read32(VIRTIO_MMIO_DEVICE_ID);
        }
    }
}
"#,
        )
        .expect("imported state should be written");
        let manifest = directory.join("grammar-roots.txt");
        fs::write(&manifest, "runtime.state\nbooting.state\n")
            .expect("grammar manifest should be written");

        let grammar =
            DevilangGrammar::from_path(&manifest).expect("generated phase manifest should load");
        fs::remove_dir_all(&directory).expect("temporary grammar directory should be removed");

        assert_eq!(grammar.machines().len(), 3);
        assert_eq!(
            grammar.phase_machines(),
            &["phase_two".to_string(), "phase_one".to_string()]
        );
        assert_eq!(
            grammar
                .states()
                .iter()
                .filter(|state| state.name() == "state_0")
                .count(),
            3
        );
        let mut rand = StdRand::with_seed(9);
        let scenario = grammar
            .generate_scenario(&mut rand, 2)
            .expect("phase grammars should generate a scenario");
        grammar
            .validate_scenario(&scenario)
            .expect("imported phase scenario must be valid");
    }

    #[test]
    fn arbitrary_named_state_file_is_a_valid_grammar_source() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "libafl-nesting-devilang-generic-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&directory).expect("temporary grammar directory should exist");
        let grammar_path = directory.join("custom-device.state");
        fs::write(
            &grammar_path,
            r#"
machine custom_device {
    initial initial
    state initial
    state ready
    transition initial -> ready on setup_trace
    trace setup_trace {
        sequence {
            write32(1, 0x100);
        }
    }
}
"#,
        )
        .expect("generic grammar should be written");

        let grammar = DevilangGrammar::from_path(&grammar_path)
            .expect("an arbitrary .state filename should load");
        fs::remove_dir_all(&directory).expect("temporary grammar directory should be removed");

        assert_eq!(grammar.phase_machines(), &["custom_device".to_string()]);
        let mut rand = StdRand::with_seed(11);
        let scenario = grammar
            .generate_scenario(&mut rand, 1)
            .expect("generic grammar should generate a scenario");
        grammar
            .validate_scenario(&scenario)
            .expect("generic grammar scenario must validate");
    }

    #[test]
    fn low_level_seed_directives_preserve_mmio_and_dma_order() {
        let grammar = DevilangGrammar::parse(
            r#"
machine low_level_seed {
    initial state_0
    state state_0
    transition state_0 -> state_0 on device_input
    trace device_input {
        sequence {
            mmio_read_override(0x22, 1, 0x5a);
            mmio_read_override(0x100, 4, 0x1234abcd);
            queue_dma_write(op=map, dir=to_device, path=dma_api, sequence=3, queue=1, payload_len=64, used_len=256);
        }
    }
}
"#,
        )
        .expect("low-level seed grammar should parse");
        let mut rand = StdRand::with_seed(23);
        let scenario = grammar
            .generate_scenario(&mut rand, 1)
            .expect("low-level seed grammar should generate");

        assert!(matches!(
            scenario.mmio.word_model.as_slice(),
            [WordModel { count: 1, .. }, WordModel { count: 1, .. }]
        ));
        assert_eq!(scenario.mmio.word_model[0].values, [0x005a_0000]); // addr 0x22, slot 8, byte 2
        assert_eq!(scenario.mmio.word_model[1].values, [0x1234_abcd]); // addr 0x100, slot 64
        // payload_len=64 -> 16 32-bit slots, contiguous low-bit mask.
        assert!(matches!(
            scenario.dma.streaming.as_slice(),
            [crate::input::StreamUnit { present: 0xFFFF, .. }]
        ));
        grammar
            .validate_scenario(&scenario)
            .expect("low-level seed scenario should validate");
    }

    #[test]
    fn grammar_directory_loads_every_root_state_without_phase_name_rules() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be after the Unix epoch")
            .as_nanos();
        let directory = std::env::temp_dir().join(format!(
            "libafl-nesting-devilang-directory-{}-{unique}",
            process::id()
        ));
        fs::create_dir_all(&directory).expect("temporary grammar directory should exist");
        for (file_name, machine_name) in [
            ("booting.state", "first_device"),
            ("custom-device.state", "second_device"),
            ("runtime.state", "third_device"),
        ] {
            fs::write(
                directory.join(file_name),
                format!(
                    "machine {machine_name} {{\ninitial ready\nstate ready\ntransition ready -> ready on trace\ntrace trace {{ sequence {{ write32(1, 0x100); }} }}\n}}\n"
                ),
            )
            .expect("root grammar should be written");
        }

        let grammar = DevilangGrammar::from_path(&directory)
            .expect("grammar directory should load all root state files");
        fs::remove_dir_all(&directory).expect("temporary grammar directory should be removed");

        assert_eq!(grammar.machines().len(), 3);
        assert_eq!(
            grammar.phase_machines(),
            &[
                "first_device".to_string(),
                "second_device".to_string(),
                "third_device".to_string(),
            ]
        );
    }

    #[test]
    fn oversized_trace_is_skipped_instead_of_truncated() {
        let mut oversized_actions = String::new();
        for _ in 0..128 {
            oversized_actions.push_str("read32(VIRTIO_MMIO_STATUS);\n");
        }
        let grammar = DevilangGrammar::parse(&format!(
            "machine m {{\ninitial state_0\nstate state_0\nstate done\ntransition state_0 -> done on oversized\ntransition state_0 -> done on short\ntrace oversized {{ sequence {{ {oversized_actions} }} }}\ntrace short {{ sequence {{ write32(1, VIRTIO_MMIO_STATUS); }} }}\n}}"
        ))
        .expect("grammar should parse");
        let mut rand = StdRand::with_seed(1);
        let scenario = grammar
            .generate_scenario(&mut rand, 1)
            .expect("short transition should be selected");
        grammar
            .validate_scenario(&scenario)
            .expect("scenario must remain valid");
        assert!(encode_scenario(&scenario).len() <= MAX_ENCODED_SCENARIO_BYTES);
        assert_eq!(scenario.total_actions(), 1);
    }

    #[test]
    fn finite_branch_is_selected_over_closed_scc() {
        let grammar = DevilangGrammar::parse(
            r#"
machine m {
    initial state_0
    state state_0
    state done
    transition state_0 -> done on choose_trace
    trace choose_trace {
        @entry: sequence {
            neqj selector, 0, @closed;
            write32(1, VIRTIO_MMIO_STATUS);
            goto @done;
        }
        @closed: sequence {
            goto @closed;
        }
        @done: sequence {
            ...;
        }
    }
}
"#,
        )
        .expect("grammar should parse");

        let mut rand = StdRand::with_seed(1);
        let scenario = grammar
            .generate_scenario(&mut rand, 1)
            .expect("finite branch should remain available");
        grammar
            .validate_scenario(&scenario)
            .expect("finite branch scenario must validate");

        assert!(matches!(
            scenario.mmio.word_model.as_slice(),
            [WordModel { count: 1, .. }]
        ));
        assert_eq!(scenario.mmio.word_model[0].values, [1]);
        assert!(scenario.mmio.present == 1u128 << 28);
    }

    #[test]
    fn closed_scc_fails_without_truncating_a_trace() {
        let grammar = DevilangGrammar::parse(
            r#"
machine m {
    initial state_0
    state state_0
    transition state_0 -> state_0 on loop_trace
    trace loop_trace {
        @loop: sequence {
            write32(1, VIRTIO_MMIO_STATUS);
            goto @loop;
        }
    }
}
"#,
        )
        .expect("grammar should parse");

        let mut rand = StdRand::with_seed(1);
        let error = grammar
            .generate_scenario(&mut rand, 1)
            .expect_err("closed SCC must not be silently truncated");
        assert!(error.contains("cannot choose"));
        assert!(error.contains("no finite terminal path"));
    }

    #[test]
    fn elided_trace_terminates_without_falling_through() {
        let grammar = DevilangGrammar::parse(
            r#"
machine virtio_net {
    initial state_0
    state state_0
    state done
    transition state_0 -> done on probe_trace
    trace probe_trace {
        @entry: sequence {
            read32(VIRTIO_MMIO_MAGIC_VALUE);
            goto @done;
        }
        @done: sequence {
            ...;
        }
        @unreachable: sequence {
            write32(1, VIRTIO_MMIO_STATUS);
        }
    }
}
"#,
        )
        .expect("grammar should parse");
        let mut rand = StdRand::with_seed(1);
        let scenario = grammar
            .generate_scenario(&mut rand, 1)
            .expect("grammar should generate the terminal trace");

        assert_eq!(scenario.mmio.word_model.len(), 1);
        assert!(matches!(
            scenario.mmio.word_model.as_slice(),
            [WordModel { count: 1, .. }]
        ));
        assert_eq!(scenario.mmio.word_model[0].values, [0]);
        grammar
            .validate_scenario(&scenario)
            .expect("terminal trace should validate");
    }
}
