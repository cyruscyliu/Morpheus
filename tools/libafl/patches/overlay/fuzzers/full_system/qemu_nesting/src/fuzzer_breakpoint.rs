use core::time::Duration;
use std::{
    collections::HashSet,
    env, fs,
    num::NonZeroUsize,
    path::{Path, PathBuf},
    process,
};

use libafl::{
    Error,
    corpus::{Corpus, OnDiskCorpus, Testcase},
    events::{EventConfig, ProgressReporter, SimpleEventManager, launcher::Launcher},
    feedback_or, feedback_or_fast,
    feedbacks::{CrashFeedback, MaxMapFeedback, TimeFeedback, TimeoutFeedback},
    fuzzer::{Evaluator, Fuzzer, StdFuzzer},
    generators::Generator,
    inputs::Input,
    monitors::MultiMonitor,
    observers::{CanTrack, HitcountsMapObserver, TimeObserver, VariableMapObserver},
    schedulers::{IndexesLenTimeMinimizerScheduler, QueueScheduler},
    stages::StdMutationalStage,
    state::{HasCorpus, StdState},
};
use libafl_bolts::{
    core_affinity::Cores,
    current_nanos,
    ownedref::OwnedMutSlice,
    rands::StdRand,
    shmem::{ShMemProvider, StdShMemProvider},
    tuples::tuple_list,
};
use libafl_nesting::{
    MAX_ENCODED_SCENARIO_BYTES, ScenarioGenerator, ScenarioInput, ScenarioMutator, decode_scenario,
    encode_scenario,
};
use libafl_qemu::{
    FastSnapshotManager, QemuSnapshotManager, SnapshotManager, emu::Emulator,
    executor::QemuExecutor, modules::edges::StdEdgeCoverageModule,
};
use libafl_targets::{EDGES_MAP_DEFAULT_SIZE, MAX_EDGES_FOUND, edges_map_mut_ptr};

const MAX_INPUT_SIZE: usize = MAX_ENCODED_SCENARIO_BYTES;

fn parse_env_u64(name: &str) -> Option<u64> {
    env::var(name).ok()?.parse::<u64>().ok()
}

const DEFAULT_MUTATIONAL_MAX_ITERATIONS: &str = "1";
const DEFAULT_INITIAL_GENERATED_SEEDS: &str = "8";

fn parse_initial_generated_seed_count(value: Option<&str>) -> Result<usize, String> {
    let value = value.unwrap_or(DEFAULT_INITIAL_GENERATED_SEEDS);
    let count = value.parse::<usize>().map_err(|_| {
        format!(
            "MORPHEUS_LIBAFL_INITIAL_GENERATED_SEEDS must be a non-negative integer, got {value:?}"
        )
    })?;
    if count > 1024 {
        return Err(format!(
            "MORPHEUS_LIBAFL_INITIAL_GENERATED_SEEDS must be at most 1024, got {count}"
        ));
    }
    Ok(count)
}

fn initial_generated_seed_count() -> usize {
    let configured = env::var("MORPHEUS_LIBAFL_INITIAL_GENERATED_SEEDS").ok();
    parse_initial_generated_seed_count(configured.as_deref())
        .unwrap_or_else(|err| panic!("invalid grammar-generated corpus configuration: {err}"))
}

fn parse_mutational_max_iterations(value: Option<&str>) -> Result<NonZeroUsize, String> {
    let value = value.unwrap_or(DEFAULT_MUTATIONAL_MAX_ITERATIONS);
    value.parse::<NonZeroUsize>().map_err(|_| {
        format!(
            "MORPHEUS_LIBAFL_MUTATIONAL_MAX_ITERATIONS must be a positive integer, got {value:?}"
        )
    })
}

fn mutational_max_iterations() -> NonZeroUsize {
    let configured = env::var("MORPHEUS_LIBAFL_MUTATIONAL_MAX_ITERATIONS").ok();
    let iterations = parse_mutational_max_iterations(configured.as_deref())
        .unwrap_or_else(|err| panic!("invalid mutational stage configuration: {err}"));
    eprintln!(
        "[libafl/qemu_nesting] mutational max iterations={}",
        iterations
    );
    iterations
}

fn report_progress<EM, S>(manager: &mut EM, state: &mut S) -> Result<(), Error>
where
    EM: ProgressReporter<S>,
{
    manager.report_progress(state)
}

fn executor_timeout(replay_enabled: bool) -> Duration {
    if let Some(seconds) = parse_env_u64("MORPHEUS_LIBAFL_EXECUTOR_TIMEOUT_SECONDS") {
        return Duration::from_secs(seconds);
    }

    if replay_enabled {
        let l2_window_ms = parse_env_u64("MORPHEUS_LIBAFL_L2_RUN_WINDOW_MS").unwrap_or(30_000);
        let l2_window_seconds = l2_window_ms.div_ceil(1000);
        return Duration::from_secs(l2_window_seconds + 30);
    }

    Duration::from_secs(12)
}

fn snapshot_manager_from_env() -> SnapshotManager {
    match env::var("MORPHEUS_LIBAFL_SNAPSHOT_MANAGER")
        .unwrap_or_else(|_| "fast".to_owned())
        .to_ascii_lowercase()
        .as_str()
    {
        "qemu" => {
            eprintln!("[libafl/qemu_nesting] snapshot manager=qemu");
            SnapshotManager::Qemu(QemuSnapshotManager::default())
        }
        "fast" => {
            eprintln!("[libafl/qemu_nesting] snapshot manager=fast");
            SnapshotManager::Fast(FastSnapshotManager::default())
        }
        value => panic!("unsupported MORPHEUS_LIBAFL_SNAPSHOT_MANAGER={value:?}; use fast or qemu"),
    }
}

fn replay_input_paths() -> Option<Vec<PathBuf>> {
    let manifest = env::var("MORPHEUS_LIBAFL_REPLAY_INPUTS").ok()?;
    input_paths_from_manifest(&manifest, "replay")
}

fn initial_input_paths() -> Option<Vec<PathBuf>> {
    let manifest = env::var("MORPHEUS_LIBAFL_INITIAL_INPUTS").ok()?;
    let paths = input_paths_from_manifest(&manifest, "initial");
    if let Some(paths) = paths.as_ref() {
        eprintln!(
            "[libafl/qemu_nesting] initial input manifest={} entries={}",
            manifest,
            paths.len()
        );
    }
    paths
}

fn scenario_generator_from_env() -> ScenarioGenerator {
    let generator = ScenarioGenerator::from_env()
        .unwrap_or_else(|err| panic!("failed to load grammar-backed scenario generator: {err}"));
    if let Some(grammar) = generator.grammar() {
        eprintln!(
            "[libafl/qemu_nesting] device override grammar loaded: mmio-sites={} mmio-write-sites={} queue-dma-sites={} dma-sites={} dma-events={}",
            grammar.mmio_read_sites().len(),
            grammar.mmio_write_sites().len(),
            grammar.queue_dma_sites().len(),
            grammar.dma_sites().len(),
            grammar.dma_event_count(),
        );
    }
    generator
}

fn grammar_probe_requested() -> bool {
    env::args()
        .skip(1)
        .any(|argument| argument == "--check-grammar" || argument == "--check-devilang-grammar")
}

fn input_paths_from_manifest(manifest: &str, kind: &str) -> Option<Vec<PathBuf>> {
    let content = fs::read_to_string(&manifest)
        .unwrap_or_else(|err| panic!("failed to read {kind} input manifest {manifest}: {err}"));
    let paths = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    Some(paths)
}

fn validate_input_size(input: ScenarioInput, path: &Path) -> Result<ScenarioInput, Error> {
    if !input.is_valid() {
        return Err(Error::illegal_argument(format!(
            "input {} is not a valid device override seed",
            path.display()
        )));
    }
    let encoded_len = encode_scenario(&input).len();
    if encoded_len > MAX_INPUT_SIZE {
        return Err(Error::illegal_argument(format!(
            "input {} encodes to {encoded_len} bytes, over the {MAX_INPUT_SIZE}-byte limit",
            path.display()
        )));
    }
    Ok(input)
}

fn validate_seed_against_grammar(
    input: ScenarioInput,
    path: &Path,
    generator: &ScenarioGenerator,
) -> Result<ScenarioInput, Error> {
    if let Some(grammar) = generator.grammar() {
        grammar.validate_seed(&input).map_err(|error| {
            Error::illegal_argument(format!(
                "seed {} is not compatible with the configured grammar: {error}",
                path.display()
            ))
        })?;
    }
    Ok(input)
}

fn load_replay_input(path: &Path) -> Result<ScenarioInput, Error> {
    if path.extension().is_some_and(|ext| ext == "raw") {
        let bytes = fs::read(path)?;
        let input = decode_scenario(&bytes).map_err(|decode_err| {
            Error::illegal_argument(format!(
                "failed to load replay input {} as raw scenario bytes ({decode_err})",
                path.display()
            ))
        })?;
        return validate_input_size(input, path);
    }

    match <ScenarioInput as Input>::from_file(path) {
        Ok(input) => validate_input_size(input, path),
        Err(postcard_err) => {
            let bytes = fs::read(path)?;
            let input = decode_scenario(&bytes).map_err(|decode_err| {
                Error::illegal_argument(format!(
                    "failed to load replay input {} as ScenarioInput ({postcard_err}) or raw scenario bytes ({decode_err})",
                    path.display()
                ))
            })?;
            validate_input_size(input, path)
        }
    }
}

pub fn fuzz() {
    env_logger::init();

    let replay_inputs = replay_input_paths();
    let initial_inputs = initial_input_paths();
    let timeout = executor_timeout(replay_inputs.is_some());
    let broker_port = env::var("BROKER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(1341);
    let cores_value = env::var("MORPHEUS_LIBAFL_CLIENTS").unwrap_or_else(|_| "1".to_string());
    let cores = Cores::from_cmdline(&cores_value).unwrap();
    let corpus_dir = env::var("MORPHEUS_LIBAFL_CORPUS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./corpus"));
    let objective_dir = env::var("MORPHEUS_LIBAFL_OBJECTIVE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./crashes"));
    let scenario_generator = scenario_generator_from_env();
    if grammar_probe_requested() {
        if !scenario_generator.grammar_enabled() {
            panic!("--check-devilang-grammar requires an enabled grammar");
        }
        eprintln!("[libafl/qemu_nesting] Devilang grammar probe succeeded");
        return;
    }

    macro_rules! run_client_body {
        ($state:expr, $mgr:ident) => {{
            (|| -> Result<(), Error> {
                let args: Vec<String> = env::args().collect();

                let mut harness = |emulator: &mut Emulator<_, _, _, _, _, _, _>,
                                   _state: &mut _,
                                   input: &ScenarioInput| unsafe {
                    eprintln!(
                        "[libafl/qemu_nesting] execution start overrides={} encoded-bytes={}",
                        input.total_overrides(),
                        encode_scenario(input).len(),
                    );
                    let exit_kind = emulator.run(input).unwrap().try_into().unwrap();
                    eprintln!("[libafl/qemu_nesting] execution complete exit={exit_kind:?}");
                    exit_kind
                };

                let mut edges_observer = unsafe {
                    HitcountsMapObserver::new(VariableMapObserver::from_mut_slice(
                        "edges",
                        OwnedMutSlice::from_raw_parts_mut(
                            edges_map_mut_ptr(),
                            EDGES_MAP_DEFAULT_SIZE,
                        ),
                        &raw mut MAX_EDGES_FOUND,
                    ))
                    .track_indices()
                };

                let time_observer = TimeObserver::new("time");
                let modules = tuple_list!(
                    StdEdgeCoverageModule::builder()
                        .map_observer(edges_observer.as_mut())
                        .build()?
                );

                let mut emu = Emulator::builder()
                    .qemu_parameters(args)
                    .modules(modules)
                    // Select the snapshot implementation explicitly so a
                    // launcher failure can be compared without changing the
                    // guest input or its MMIO path.
                    .snapshot_manager(snapshot_manager_from_env())
                    .build()?;

                unsafe {
                    eprintln!("[libafl/qemu_nesting] starting outer QEMU");
                    emu.start().expect("failed to start outer QEMU");
                }
                eprintln!("[libafl/qemu_nesting] outer QEMU reached guest stub");

                let mut feedback = feedback_or!(
                    MaxMapFeedback::new(&edges_observer),
                    TimeFeedback::new(&time_observer)
                );
                let mut objective = feedback_or_fast!(CrashFeedback::new(), TimeoutFeedback::new());

                let mut state = $state.unwrap_or_else(|| {
                    let mut initial_scenario_generator = scenario_generator.clone();
                    let mut state = StdState::new(
                        StdRand::with_seed(current_nanos()),
                        OnDiskCorpus::new(corpus_dir.clone()).unwrap(),
                        OnDiskCorpus::new(objective_dir.clone()).unwrap(),
                        &mut feedback,
                        &mut objective,
                    )
                    .unwrap();
                    let mut initial_corpus_inputs = HashSet::new();
                    if let Some(paths) = replay_inputs.as_ref() {
                        let mut loaded = 0usize;
                        for path in paths {
                            eprintln!("[libafl/qemu_nesting] loading replay input {}", path.display());
                            let input = match load_replay_input(path).and_then(|input| {
                                validate_seed_against_grammar(input, path, &scenario_generator)
                            }) {
                                Ok(input) => input,
                                Err(err) => {
                                    eprintln!(
                                        "skipping invalid replay input {}: {err:?}",
                                        path.display()
                                    );
                                    continue;
                                }
                            };
                            let mut testcase = Testcase::from(input);
                            *testcase.filename_mut() =
                                Some(path.file_name().unwrap().to_string_lossy().to_string());
                            state.corpus_mut().add(testcase).unwrap();
                            loaded += 1;
                        }
                        if loaded == 0 {
                            panic!("no valid replay inputs resolved");
                        }
                    } else if let Some(paths) = initial_inputs.as_ref() {
                        let mut loaded = 0usize;
                        for path in paths {
                            eprintln!("[libafl/qemu_nesting] loading initial input {}", path.display());
                            let input = match load_replay_input(path).and_then(|input| {
                                validate_seed_against_grammar(input, path, &scenario_generator)
                            }) {
                                Ok(input) => input,
                                Err(err) => {
                                    eprintln!(
                                        "skipping invalid initial fuzz input {}: {err:?}",
                                        path.display()
                                    );
                                    continue;
                                }
                            };
                            let mut testcase = Testcase::from(input);
                            *testcase.filename_mut() =
                                Some(path.file_name().unwrap().to_string_lossy().to_string());
                            initial_corpus_inputs.insert(testcase.input().clone().unwrap());
                            state.corpus_mut().add(testcase).unwrap();
                            loaded += 1;
                        }
                        if loaded == 0 {
                            panic!("no valid initial fuzz inputs loaded");
                        }
                    }

                    if replay_inputs.is_none() && scenario_generator.grammar_enabled() {
                        let requested = initial_generated_seed_count();
                        let mut generated = 0usize;
                        let mut attempts = 0usize;
                        let max_attempts = requested.saturating_mul(16).max(requested);
                        while generated < requested && attempts < max_attempts {
                            attempts += 1;
                            let input = initial_scenario_generator.generate(&mut state).unwrap();
                            if !initial_corpus_inputs.insert(input.clone()) {
                                continue;
                            }
                            state.corpus_mut().add(input.into()).unwrap();
                            generated += 1;
                        }
                        eprintln!(
                            "[libafl/qemu_nesting] grammar-generated initial corpus entries={} requested={} attempts={}",
                            generated, requested, attempts
                        );
                    } else if replay_inputs.is_none() && initial_inputs.is_none() {
                        for _ in 0..4 {
                            let input = initial_scenario_generator.generate(&mut state).unwrap();
                            state.corpus_mut().add(input.into()).unwrap();
                        }
                    }
                    eprintln!(
                        "[libafl/qemu_nesting] initial corpus entries={}",
                        state.corpus().count()
                    );
                    state
                });

                let scheduler =
                    IndexesLenTimeMinimizerScheduler::new(&edges_observer, QueueScheduler::new());
                let mut fuzzer = StdFuzzer::new(scheduler, feedback, objective);

                let mut executor = QemuExecutor::new(
                    emu,
                    &mut harness,
                    tuple_list!(edges_observer, time_observer),
                    &mut fuzzer,
                    &mut state,
                    &mut $mgr,
                    timeout,
                )
                .expect("Failed to create QemuExecutor");
                eprintln!("[libafl/qemu_nesting] executor ready");

                executor.break_on_timeout();

                if replay_inputs.is_some() {
                    let corpus_ids = state.corpus().ids().collect::<Vec<_>>();
                    for corpus_id in corpus_ids {
                        let input = {
                            let mut testcase = state.corpus().get(corpus_id)?.borrow_mut();
                            testcase.load_input(state.corpus())?.clone()
                        };
                        fuzzer
                            .evaluate_input(&mut state, &mut executor, &mut $mgr, &input)
                            .unwrap_or_else(|err| {
                                eprintln!("failed replay: {err:?}");
                                process::exit(1);
                            });
                    }
                    // Replay runs bypass `fuzz_loop`, so publish the execution
                    // count explicitly instead of leaving the broker with its
                    // initial zero snapshot.
                    report_progress(&mut $mgr, &mut state).unwrap_or_else(|err| {
                        eprintln!("failed replay progress report: {err:?}");
                        process::exit(1);
                    });
                } else {
                    if initial_inputs.is_some() {
                        let corpus_ids = state.corpus().ids().collect::<Vec<_>>();
                        for corpus_id in corpus_ids {
                            eprintln!(
                                "[libafl/qemu_nesting] evaluating initial corpus id={corpus_id:?}"
                            );
                            let input = {
                                let mut testcase = state.corpus().get(corpus_id)?.borrow_mut();
                                testcase
                                    .load_input(state.corpus())
                                    .map_err(|err| {
                                        Error::illegal_state(format!(
                                            "failed to reload initial corpus input {corpus_id:?}: {err:?}"
                                        ))
                                    })?
                                    .clone()
                            };
                            fuzzer
                                .evaluate_input(&mut state, &mut executor, &mut $mgr, &input)
                                .unwrap_or_else(|err| {
                                    eprintln!("failed initial input: {err:?}");
                                    process::exit(1);
                                });
                        }
                        // Initial corpus evaluation also happens before the
                        // regular fuzz loop.  Report it now so a slow first
                        // mutation cannot hide completed executions.
                        report_progress(&mut $mgr, &mut state).unwrap_or_else(|err| {
                            eprintln!("failed initial progress report: {err:?}");
                            process::exit(1);
                        });
                    }

                    // The shadow/CmpLog stage would boot a second nested L2 for
                    // every fuzz input. Guest-side compare logs do not justify
                    // that cost for this systemmode target, so keep only the
                    // structured scenario mutation stage on the hot path.
                    let mut executor = executor;
                    let mut stages = tuple_list!(StdMutationalStage::with_max_iterations(
                        ScenarioMutator::new(scenario_generator.clone()),
                        mutational_max_iterations(),
                    ));

                    // Run one complete fuzzer iteration at a time.  The
                    // regular `fuzz_loop` only checks the reporting timer
                    // before an iteration, while this target's executor can
                    // take longer than the broker heartbeat interval.  The
                    // bounded loop reports after every iteration and keeps
                    // the broker's execution snapshot current.
                    loop {
                        fuzzer
                            .fuzz_loop_for(
                                &mut stages,
                                &mut executor,
                                &mut state,
                                &mut $mgr,
                                1,
                            )
                            .map_err(|err| {
                                eprintln!("[libafl/qemu_nesting] fuzz loop stopped: {err:?}");
                                err
                            })?;
                    }
                }
                Ok(())
            })()
        }};
    }

    let monitor = MultiMonitor::new(|s| eprintln!("{s}"));
    if replay_inputs.is_some() {
        let mut mgr = SimpleEventManager::new(monitor);
        run_client_body!(None, mgr).unwrap_or_else(|err| panic!("Failed to run replay: {err:?}"));
        return;
    }

    let mut run_client =
        |state: Option<_>, mut mgr, _client_description| run_client_body!(state, mgr);

    let shmem_provider = StdShMemProvider::new().expect("Failed to init shared memory");

    match Launcher::builder()
        .shmem_provider(shmem_provider)
        .broker_port(broker_port)
        .configuration(EventConfig::from_build_id())
        .monitor(monitor)
        .run_client(&mut run_client)
        .cores(&cores)
        .build()
        .launch()
    {
        Ok(()) => (),
        Err(Error::ShuttingDown) => eprintln!("Fuzzing stopped by user. Good bye."),
        Err(err) => panic!("Failed to run launcher: {err:?}"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_INITIAL_GENERATED_SEEDS, parse_initial_generated_seed_count,
        parse_mutational_max_iterations,
    };

    #[test]
    fn grammar_generated_corpus_has_a_bounded_default() {
        assert_eq!(
            parse_initial_generated_seed_count(None).unwrap(),
            DEFAULT_INITIAL_GENERATED_SEEDS.parse::<usize>().unwrap()
        );
        assert_eq!(parse_initial_generated_seed_count(Some("0")).unwrap(), 0);
        assert!(parse_initial_generated_seed_count(Some("1025")).is_err());
    }

    #[test]
    fn grammar_generated_corpus_rejects_invalid_configuration() {
        assert!(parse_initial_generated_seed_count(Some("many")).is_err());
    }

    #[test]
    fn slow_target_defaults_to_one_mutation_per_iteration() {
        assert_eq!(parse_mutational_max_iterations(None).unwrap().get(), 1);
    }

    #[test]
    fn mutational_iteration_limit_accepts_positive_values() {
        assert_eq!(parse_mutational_max_iterations(Some("7")).unwrap().get(), 7);
    }

    #[test]
    fn mutational_iteration_limit_rejects_zero_and_non_numbers() {
        assert!(parse_mutational_max_iterations(Some("0")).is_err());
        assert!(parse_mutational_max_iterations(Some("many")).is_err());
    }
}
