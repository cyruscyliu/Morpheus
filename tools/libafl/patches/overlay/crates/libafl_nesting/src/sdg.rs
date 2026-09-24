//! Static semantic-dependency rules loaded from plain-text rule files.

use alloc::{string::String, vec, vec::Vec};
use core::num::NonZeroUsize;

use libafl_bolts::rands::Rand;

use crate::input::{CoherentAlloc, DmaSection, MmioSection, ScenarioInput, StreamUnit, WordModel};

#[derive(Clone, Debug)]
pub struct Rule {
    pub name: String,
    pub nodes: Vec<Node>,
    pub preconditions: Vec<Condition>,
    pub trigger: Condition,
    pub mutation: Mutation,
}

#[derive(Clone, Debug)]
pub struct Node {
    pub name: String,
    pub source: Source,
}

#[derive(Clone, Copy, Debug)]
pub enum Source {
    Mmio { offset: u32, size: u8 },
    Coherent { region: u8, visit: u8, offset: u32 },
    Streaming { region: u8, slot: u8, offset: u32 },
}

#[derive(Clone, Copy, Debug)]
pub enum Predicate { BitSet(u8), BitClear(u8), Eq(u32), Lt(u32), Gt(u32), Le(u32), Ge(u32) }

#[derive(Clone, Debug)]
pub struct Condition { pub node: String, pub predicate: Predicate }

#[derive(Clone, Copy, Debug)]
pub enum Mutation { SetBoundary, SetValue(u32), FlipBit(u8), SetBits(u32), ClearBits(u32), Inc(u32), Dec(u32), SampleRange(u32, u32), Keep }

#[derive(Clone, Debug, Default)]
pub struct SemanticDependencyGraph { pub rules: Vec<Rule> }

impl SemanticDependencyGraph {
    #[cfg(feature = "std")]
    pub fn from_dir(path: &std::path::Path) -> Result<Self, String> {
        let mut rules = Vec::new();
        let entries = std::fs::read_dir(path).map_err(|e| format!("failed to read SDG rule directory {}: {e}", path.display()))?;
        for entry in entries {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|x| x.to_str()) == Some("sdg") {
                rules.push(parse_rule(&std::fs::read_to_string(&path).map_err(|e| format!("failed to read {}: {e}", path.display()))?)?);
            }
        }
        if rules.is_empty() { return Err(format!("SDG rule directory {} contains no .sdg files", path.display())); }
        Ok(Self { rules })
    }

    pub fn generate<R: Rand>(&self, rand: &mut R) -> ScenarioInput {
        let rule = &self.rules[rand.below(unsafe { NonZeroUsize::new_unchecked(self.rules.len()) })];
        let mut mmio = Vec::new();
        let mut coherent = Vec::new();
        let mut streaming = Vec::new();
        for node in &rule.nodes {
            let value = node_value(rule, node, rand);
            match node.source {
                Source::Mmio { offset, .. } => push_model(&mut mmio, offset, value),
                Source::Coherent { region, offset, .. } => push_alloc(&mut coherent, region, offset, value),
                Source::Streaming { region, offset, .. } => push_stream(&mut streaming, region, offset, value),
            }
        }
        mmio.sort_by_key(|m| m.offset);
        for a in &mut coherent { a.word_models.sort_by_key(|m| m.offset); }
        for u in &mut streaming { u.word_models.sort_by_key(|m| m.offset); }
        ScenarioInput::new(MmioSection { word_models: mmio }, DmaSection { coherent, streaming })
    }

    pub fn mutate<R: Rand>(&self, rand: &mut R, input: &mut ScenarioInput) -> bool {
        let candidates: Vec<&Rule> = self.rules.iter().filter(|rule| {
            rule.nodes.iter().find(|n| n.name == rule.trigger.node)
                .is_some_and(|n| node_present(input, n))
        }).collect();
        if candidates.is_empty() { return false; }
        let rule = candidates[rand.below(unsafe { NonZeroUsize::new_unchecked(candidates.len()) })];
        let node = match rule.nodes.iter().find(|n| n.name == rule.trigger.node) { Some(n) => n, None => return false };
        let value = match &rule.mutation { Mutation::SetBoundary => match rule.trigger.predicate { Predicate::Gt(v) | Predicate::Ge(v) => v.saturating_add(1), Predicate::Lt(v) | Predicate::Le(v) => v.saturating_sub(1), _ => random_u32(rand) }, Mutation::SetValue(v) => *v, Mutation::FlipBit(b) => random_u32(rand) ^ (1u32 << b), Mutation::SetBits(m) => random_u32(rand) | m, Mutation::ClearBits(m) => random_u32(rand) & !m, Mutation::Inc(d) => d.wrapping_add(1), Mutation::Dec(d) => d.saturating_sub(1), Mutation::SampleRange(lo, hi) => lo.saturating_add(rand.below(unsafe { NonZeroUsize::new_unchecked(hi.saturating_sub(*lo).max(1) as usize) }) as u32), Mutation::Keep => return false };
        set_node_value(input, node, value)
    }
}

fn node_present(input: &ScenarioInput, node: &Node) -> bool {
    match node.source {
        Source::Mmio { offset, .. } => input.mmio.word_models.iter().any(|m| m.offset == offset),
        Source::Coherent { region, offset, .. } => input.dma.coherent.get(region as usize).is_some_and(|a| a.word_models.iter().any(|m| m.offset == offset)),
        Source::Streaming { region, offset, .. } => input.dma.streaming.get(region as usize).is_some_and(|u| u.word_models.iter().any(|m| m.offset == offset)),
    }
}

fn node_value<R: Rand>(rule: &Rule, node: &Node, rand: &mut R) -> u32 {
    if let Some(c) = rule.preconditions.iter().find(|c| c.node == node.name) { return predicate_value(&c.predicate, rand); }
    if rule.trigger.node == node.name { return predicate_value(&rule.trigger.predicate, rand); }
    random_u32(rand)
}
fn predicate_value<R: Rand>(p: &Predicate, _rand: &mut R) -> u32 { match *p { Predicate::BitSet(b) => 1u32 << b, Predicate::BitClear(b) => !(1u32 << b), Predicate::Eq(v) => v, Predicate::Lt(v) => v.saturating_sub(1), Predicate::Gt(v) => v.saturating_add(1), Predicate::Le(v) => v, Predicate::Ge(v) => v, } }
fn push_model(v: &mut Vec<WordModel>, offset: u32, value: u32) { if let Some(m) = v.iter_mut().find(|m| m.offset == offset) { m.values.push(value); } else { v.push(WordModel { offset, values: vec![value] }); } }
fn push_alloc(v: &mut Vec<CoherentAlloc>, region: u8, offset: u32, value: u32) { while v.len() <= region as usize { v.push(CoherentAlloc { addr: v.len() as u64, word_models: Vec::new() }); } push_model(&mut v[region as usize].word_models, offset, value); }
fn push_stream(v: &mut Vec<StreamUnit>, region: u8, offset: u32, value: u32) { while v.len() <= region as usize { v.push(StreamUnit { addr: v.len() as u64, word_models: Vec::new() }); } push_model(&mut v[region as usize].word_models, offset, value); }
fn set_node_value(input: &mut ScenarioInput, node: &Node, value: u32) -> bool { match node.source { Source::Mmio { offset, .. } => input.mmio.word_models.iter_mut().find(|m| m.offset == offset).map(|m| { m.values[0] = value; true }).unwrap_or(false), Source::Coherent { region, offset, .. } => input.dma.coherent.get_mut(region as usize).and_then(|a| a.word_models.iter_mut().find(|m| m.offset == offset)).map(|m| { m.values[0] = value; true }).unwrap_or(false), Source::Streaming { region, offset, .. } => input.dma.streaming.get_mut(region as usize).and_then(|u| u.word_models.iter_mut().find(|m| m.offset == offset)).map(|m| { m.values[0] = value; true }).unwrap_or(false) } }
fn random_u32<R: Rand>(rand: &mut R) -> u32 { ((rand.below(unsafe { NonZeroUsize::new_unchecked(65536) }) as u32) << 16) | rand.below(unsafe { NonZeroUsize::new_unchecked(65536) }) as u32 }

fn parse_u32(s: &str) -> Result<u32, String> { let (digits, radix) = s.strip_prefix("0x").map_or((s, 10), |v| (v, 16)); u32::from_str_radix(digits, radix).map_err(|_| format!("invalid integer {s}")) }
fn parse_rule(text: &str) -> Result<Rule, String> {
    let mut name = String::new(); let mut nodes = Vec::new(); let mut pre = Vec::new(); let mut trigger = None; let mut mutation = Mutation::Keep;
    for line in text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        let p: Vec<_> = line.split_whitespace().collect();
        match p.first().copied() { Some("rule") => name = p.get(1).ok_or("rule name missing")?.to_string(), Some("node") => { let node_name = p.get(1).ok_or("node name missing")?.to_string(); let src = p.get(2).ok_or("node source missing")?; let source = match *src { "mmio" => Source::Mmio { offset: parse_u32(p.get(3).ok_or("mmio offset missing")?)?, size: p.get(4).ok_or("mmio size missing")?.parse().map_err(|_| "invalid mmio size".to_string())? }, "coherent" => Source::Coherent { region: p.get(3).ok_or("region missing")?.parse().map_err(|_| "invalid region".to_string())?, visit: p.get(4).ok_or("visit missing")?.parse().map_err(|_| "invalid visit".to_string())?, offset: parse_u32(p.get(5).ok_or("offset missing")?)? }, "streaming" => Source::Streaming { region: p.get(3).ok_or("region missing")?.parse().map_err(|_| "invalid region".to_string())?, slot: p.get(4).ok_or("slot missing")?.parse().map_err(|_| "invalid slot".to_string())?, offset: parse_u32(p.get(5).ok_or("offset missing")?)? }, _ => return Err(format!("unknown source {src}")) }; nodes.push(Node { name: node_name, source }); }, Some("precondition") | Some("trigger") => { let c = parse_condition(&p[1..])?; if p[0] == "trigger" { trigger = Some(c); } else { pre.push(c); } }, Some("mutation") => { mutation = parse_mutation(&p[1..])?; }, _ => return Err(format!("unrecognized SDG line: {line}")) }
    }
    Ok(Rule { name, nodes, preconditions: pre, trigger: trigger.ok_or("trigger missing")?, mutation })
}
fn parse_condition(p: &[&str]) -> Result<Condition, String> { let node = p.first().ok_or("condition node missing")?.to_string(); let op = *p.get(1).ok_or("condition predicate missing")?; let n = p.get(2).map(|s| parse_u32(s)).transpose()?.unwrap_or(0); let predicate = match op { "bit_set" => Predicate::BitSet(n as u8), "bit_clear" => Predicate::BitClear(n as u8), "eq" => Predicate::Eq(n), "lt" => Predicate::Lt(n), "gt" => Predicate::Gt(n), "le" => Predicate::Le(n), "ge" => Predicate::Ge(n), _ => return Err(format!("unknown predicate {op}")) }; Ok(Condition { node, predicate }) }
fn parse_mutation(p: &[&str]) -> Result<Mutation, String> { match p.first().copied().ok_or("mutation missing")? { "set_boundary" => Ok(Mutation::SetBoundary), "set_value" => Ok(Mutation::SetValue(parse_u32(p.get(1).ok_or("value missing")?)?)), "flip_bit" => Ok(Mutation::FlipBit(parse_u32(p.get(1).ok_or("bit missing")?)? as u8)), "set_bits" => Ok(Mutation::SetBits(parse_u32(p.get(1).ok_or("mask missing")?)?)), "clear_bits" => Ok(Mutation::ClearBits(parse_u32(p.get(1).ok_or("mask missing")?)?)), "inc" => Ok(Mutation::Inc(parse_u32(p.get(1).ok_or("delta missing")?)?)), "dec" => Ok(Mutation::Dec(parse_u32(p.get(1).ok_or("delta missing")?)?)), "sample_range" => Ok(Mutation::SampleRange(parse_u32(p.get(1).ok_or("minimum missing")?)?, parse_u32(p.get(2).ok_or("maximum missing")?)?)), "keep" => Ok(Mutation::Keep), x => Err(format!("unknown mutation {x}")) } }
