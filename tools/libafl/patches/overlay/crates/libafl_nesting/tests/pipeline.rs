//! End-to-end pipeline coverage of the documented architecture: a synthetic
//! non-empty extractor JSON rule goes through convert_to_sdg.py, the
//! generated directory is loaded with the actual Rust parser, the runtime
//! generates semantically, lowers, registers corpus metadata, mutates with
//! the actual Mutator trait, and registers child metadata with exact
//! target/precondition/placement validation.

use libafl::mutators::{MutationResult, Mutator};
use libafl_bolts::rands::StdRand;
use libafl_nesting::{
    ScenarioGenerator, ScenarioInput, ScenarioMutator, SemanticDependencyGraph,
};

fn converter_path() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("SDG_CONVERTER") {
        let path = std::path::PathBuf::from(path);
        assert!(path.exists(), "SDG_CONVERTER points at a missing converter: {}", path.display());
        return path;
    }
    // Overlay layout: <tools>/libafl/patches/overlay/crates/libafl_nesting.
    let candidate = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../../../sdg-extractor/scripts/convert_to_sdg.py");
    assert!(
        candidate.exists(),
        "convert_to_sdg.py not found at {}; set SDG_CONVERTER to its path",
        candidate.display()
    );
    candidate
}

/// A synthetic but valid extractor rule: the docs' feature-guard pattern
/// with a feature-word read, a config-byte read, a BitSet precondition, a
/// Gt target state, and a SetBoundary hint.
const RULES_JSON: &str = r#"{"rules": [{
  "id": "rule:probe|target:mmio:273:1:rss_max_key_size|predicate:gt:unsigned:40",
  "function": "probe",
  "vars": [
    {"id": "mmio:16:4:features",
     "source": {"class": "Mmio", "access_kind": "config", "offset": 16,
                "size_bytes": 4, "field": "features"}},
    {"id": "mmio:273:1:rss_max_key_size",
     "source": {"class": "Mmio", "access_kind": "config", "offset": 273,
                "size_bytes": 1, "field": "rss_max_key_size"}}
  ],
  "preconditions": [
    {"src": "mmio:16:4:features", "dst": "mmio:273:1:rss_max_key_size",
     "head": "head_guard",
     "predicate": {"kind": "BitSet", "bit": 25}}
  ],
  "target_state": {
    "src": "mmio:273:1:rss_max_key_size",
    "dst": "mmio:273:1:rss_max_key_size",
    "head": "head_bound",
    "predicate": {"kind": "Gt", "value": 40, "signedness": "Unsigned"}
  },
  "mutation": {"operator": "SetBoundary", "side": "Above",
               "var": "mmio:273:1:rss_max_key_size"}
}]}"#;

/// Serialize the env-var manipulation behind one lock, like the unit tests.
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Minimal state handle: the Generator and Mutator impls require `HasRand`.
#[derive(Clone, Debug)]
struct TestState {
    rand: StdRand,
}

impl libafl::state::HasRand for TestState {
    type Rand = StdRand;

    fn rand(&self) -> &Self::Rand {
        &self.rand
    }

    fn rand_mut(&mut self) -> &mut Self::Rand {
        &mut self.rand
    }
}

fn generator_from_rules_dir(dir: &std::path::Path) -> ScenarioGenerator {
    let _guard = ENV_LOCK.lock().unwrap();
    // SAFETY: test-only environment manipulation
    unsafe { std::env::set_var("MORPHEUS_LIBAFL_SDG_RULES", dir); }
    // SAFETY: test-only environment manipulation
    unsafe { std::env::remove_var("MORPHEUS_LIBAFL_DISABLE_SDG"); }
    let generator = ScenarioGenerator::from_env()
        .expect("the converted rule directory should load through from_env");
    // SAFETY: test-only environment manipulation
    unsafe { std::env::remove_var("MORPHEUS_LIBAFL_SDG_RULES"); }
    generator
}

#[test]
fn end_to_end_json_to_runtime_pipeline() {
    let converter = converter_path();

    let dir = std::env::temp_dir().join(format!(
        "sdg-pipeline-{}-{:?}",
        std::process::id(),
        std::time::SystemTime::now()
    ));
    std::fs::create_dir_all(&dir).expect("temp dir should be created");
    let rules_file = dir.join("sdg-rules.json");
    std::fs::write(&rules_file, RULES_JSON).expect("rules json should be written");
    let out_dir = dir.join("sdg");

    let status = std::process::Command::new("python3")
        .args([
            converter.to_str().expect("converter path should be utf-8"),
            "--rules",
            rules_file.to_str().expect("rules path should be utf-8"),
            "--output",
            out_dir.to_str().expect("out path should be utf-8"),
        ])
        .status()
        .expect("the converter should run");
    assert!(status.success(), "convert_to_sdg.py should succeed");

    // The generated directory loads with the actual Rust parser.
    let sdg = SemanticDependencyGraph::from_dir(&out_dir)
        .expect("the generated rule directory should load");
    assert_eq!(sdg.rules.len(), 1, "one canonical rule");
    let rule = &sdg.rules[0];
    assert_eq!(
        rule.name,
        "rule:probe|target:mmio:273:1:rss_max_key_size|predicate:gt:unsigned:40"
    );
    assert_eq!(rule.preconditions.len(), 1);

    // Semantic generation: the actual Generator registers the semantic
    // scenario and its exact placements for the encoded bytes.
    let generator = generator_from_rules_dir(&out_dir);
    let mut state = TestState { rand: StdRand::with_seed(5) };
    let input: ScenarioInput = libafl::generators::Generator::generate(&mut generator.clone(), &mut state)
        .expect("generation should satisfy the rule");
    assert!(input.is_valid());
    let scenario = generator
        .metadata()
        .lookup(&input)
        .expect("generation registers corpus metadata for the encoded bytes");
    assert_eq!(scenario.target_rule, rule.name);
    let features = scenario
        .value("mmio:16:4:features")
        .expect("the precondition variable is present")
        .as_u64()
        .unwrap();
    assert!(features & (1 << 25) != 0, "the BitSet precondition holds");
    let key_size = scenario
        .value("mmio:273:1:rss_max_key_size")
        .expect("the target variable is present")
        .as_u64()
        .unwrap();
    assert!(key_size > 40, "the target state holds: {key_size}");
    // Placements are recorded for every semantic variable.
    assert!(scenario.placements.contains_key("mmio:16:4:features"));
    assert!(scenario.placements.contains_key("mmio:273:1:rss_max_key_size"));

    // Lowering produces the wire format with aligned word models; the
    // scenario reads back from the wire through its exact placements.
    assert!(
        input.mmio.word_models.iter().any(|m| m.offset == 0x10),
        "the feature word is modelled"
    );
    assert!(
        input.mmio.word_models.iter().any(|m| m.offset == 0x110),
        "the config byte is mask-merged into the aligned word"
    );
    let lifted = libafl_nesting::lift_with(&input, rule, &scenario.placements)
        .expect("the scenario lifts back through its exact placements");
    assert_eq!(lifted.values, scenario.values, "the wire encodes the scenario values");

    // The actual Mutator trait path mutates the exact stored scenario and
    // registers the child scenario for the child bytes.
    let mut mutator = ScenarioMutator::new(generator.clone());
    let parent_placement = scenario
        .placements
        .get("mmio:273:1:rss_max_key_size")
        .copied()
        .expect("the target placement is recorded");
    let mut validated_child = None;
    for seed in 0..64u64 {
        let mut candidate = input.clone();
        let mut rng = TestState { rand: StdRand::with_seed(seed) };
        if !mutator
            .mutate(&mut rng, &mut candidate)
            .is_ok_and(|r| r == MutationResult::Mutated)
        {
            continue;
        }
        let child = generator
            .metadata()
            .lookup(&candidate)
            .expect("the mutator registers metadata for the child bytes");
        // Exact placement validation: the child keeps the target's stored
        // region and visit, and the full placement map is preserved.
        assert_eq!(
            child.placements.get("mmio:273:1:rss_max_key_size").copied(),
            Some(parent_placement),
            "only the stored target region and visit may be used"
        );
        assert_eq!(child.placements, scenario.placements);
        // Exact target and precondition validation.
        let child_key = child
            .value("mmio:273:1:rss_max_key_size")
            .expect("the target variable survives")
            .as_u64()
            .unwrap();
        assert!(child_key > 40, "the target state holds after mutation: {child_key}");
        let child_features = child
            .value("mmio:16:4:features")
            .expect("the precondition variable survives")
            .as_u64()
            .unwrap();
        assert!(child_features & (1 << 25) != 0, "the precondition is preserved");
        // The child scenario lifts back from the child bytes.
        let child_lifted =
            libafl_nesting::lift_with(&candidate, rule, &child.placements)
                .expect("the child scenario lifts back from the child bytes");
        assert_eq!(child_lifted.values, child.values);
        validated_child = Some((candidate, child));
        break;
    }
    assert!(validated_child.is_some(), "the rule-aware mutation should apply");
    let (child_input, _) = validated_child.unwrap();
    assert_ne!(encode_of(&child_input), encode_of(&input), "the child bytes differ");

    std::fs::remove_dir_all(&dir).expect("temp dir should be removed");
}

fn encode_of(input: &ScenarioInput) -> Vec<u8> {
    libafl_nesting::encode_scenario(input)
}
