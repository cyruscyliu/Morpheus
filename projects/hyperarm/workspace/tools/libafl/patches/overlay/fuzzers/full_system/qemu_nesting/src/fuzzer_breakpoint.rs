use core::time::Duration;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process,
};

use libafl::{
    corpus::{Corpus, OnDiskCorpus, Testcase},
    events::{EventConfig, SimpleEventManager, launcher::Launcher},
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
    Error,
};
use libafl_bolts::{
    core_affinity::Cores,
    current_nanos,
    ownedref::OwnedMutSlice,
    rands::StdRand,
    shmem::{ShMemProvider, StdShMemProvider},
    tuples::tuple_list,
};
use libafl_nesting::{ScenarioGenerator, ScenarioInput, ScenarioMutator, decode_scenario};
use libafl_qemu::{
    QemuSnapshotManager, emu::Emulator, executor::QemuExecutor,
    modules::edges::StdEdgeCoverageModule,
};
use libafl_targets::{EDGES_MAP_DEFAULT_SIZE, MAX_EDGES_FOUND, edges_map_mut_ptr};

pub static mut MAX_INPUT_SIZE: usize = 512;

fn parse_env_u64(name: &str) -> Option<u64> {
    env::var(name).ok()?.parse::<u64>().ok()
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

fn replay_input_paths() -> Option<Vec<PathBuf>> {
    let manifest = env::var("MORPHEUS_LIBAFL_REPLAY_INPUTS").ok()?;
    input_paths_from_manifest(&manifest, "replay")
}

fn initial_input_paths() -> Option<Vec<PathBuf>> {
    let manifest = env::var("MORPHEUS_LIBAFL_INITIAL_INPUTS").ok()?;
    input_paths_from_manifest(&manifest, "initial")
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

fn load_replay_input(path: &Path) -> Result<ScenarioInput, Error> {
    if path.extension().is_some_and(|ext| ext == "raw") {
        let bytes = fs::read(path)?;
        return decode_scenario(&bytes).map_err(|decode_err| {
            Error::illegal_argument(format!(
                "failed to load replay input {} as raw scenario bytes ({decode_err})",
                path.display()
            ))
        });
    }

    match <ScenarioInput as Input>::from_file(path) {
        Ok(input) => Ok(input),
        Err(postcard_err) => {
            let bytes = fs::read(path)?;
            decode_scenario(&bytes).map_err(|decode_err| {
                Error::illegal_argument(format!(
                    "failed to load replay input {} as ScenarioInput ({postcard_err}) or raw scenario bytes ({decode_err})",
                    path.display()
                ))
            })
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
    let cores = Cores::from_cmdline("1").unwrap();
    let corpus_dir = env::var("MORPHEUS_LIBAFL_CORPUS_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./corpus"));
    let objective_dir = env::var("MORPHEUS_LIBAFL_OBJECTIVE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./crashes"));

    macro_rules! run_client_body {
        ($state:expr, $mgr:ident) => {{
            (|| -> Result<(), Error> {
                let args: Vec<String> = env::args().collect();

                let mut harness = |emulator: &mut Emulator<_, _, _, _, _, _, _>,
                                   _state: &mut _,
                                   input: &ScenarioInput| unsafe {
                    emulator.run(input).unwrap().try_into().unwrap()
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
                let modules = tuple_list!(StdEdgeCoverageModule::builder()
                    .map_observer(edges_observer.as_mut())
                    .build()?);

                let mut emu = Emulator::builder()
                    .qemu_parameters(args)
                    .modules(modules)
                    .snapshot_manager(QemuSnapshotManager::default())
                    .build()?;

                unsafe {
                    emu.start().unwrap();
                }

                let mut feedback = feedback_or!(
                    MaxMapFeedback::new(&edges_observer),
                    TimeFeedback::new(&time_observer)
                );
                let mut objective = feedback_or_fast!(CrashFeedback::new(), TimeoutFeedback::new());

                let mut state = $state.unwrap_or_else(|| {
                    let mut state = StdState::new(
                        StdRand::with_seed(current_nanos()),
                        OnDiskCorpus::new(corpus_dir.clone()).unwrap(),
                        OnDiskCorpus::new(objective_dir.clone()).unwrap(),
                        &mut feedback,
                        &mut objective,
                    )
                    .unwrap();
                    if let Some(paths) = replay_inputs.as_ref() {
                        for path in paths {
                            let input = load_replay_input(path).unwrap();
                            let mut testcase = Testcase::from(input);
                            *testcase.filename_mut() =
                                Some(path.file_name().unwrap().to_string_lossy().to_string());
                            state.corpus_mut().add(testcase).unwrap();
                        }
                    } else if let Some(paths) = initial_inputs.as_ref() {
                        let mut loaded = 0usize;
                        for path in paths {
                            let input = match load_replay_input(path) {
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
                            state.corpus_mut().add(testcase).unwrap();
                            loaded += 1;
                        }
                        if loaded == 0 {
                            panic!("no valid initial fuzz inputs loaded");
                        }
                    } else {
                        let mut generator = ScenarioGenerator::default();
                        for _ in 0..4 {
                            let input = generator.generate(&mut state).unwrap();
                            state.corpus_mut().add(input.into()).unwrap();
                        }
                    }
                    state
                });

                let scheduler =
                    IndexesLenTimeMinimizerScheduler::new(&edges_observer, QueueScheduler::new());
                let mut fuzzer = StdFuzzer::new(scheduler, feedback, objective);

                let mutator = ScenarioMutator::default();
                let mut stages = tuple_list!(StdMutationalStage::new(mutator));

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
                                println!("failed replay: {err:?}");
                                process::exit(1);
                            });
                    }
                } else {
                    if initial_inputs.is_some() {
                        let corpus_ids = state.corpus().ids().collect::<Vec<_>>();
                        for corpus_id in corpus_ids {
                            let input = {
                                let mut testcase = state.corpus().get(corpus_id)?.borrow_mut();
                                testcase.load_input(state.corpus())?.clone()
                            };
                            fuzzer
                                .evaluate_input(&mut state, &mut executor, &mut $mgr, &input)
                                .unwrap_or_else(|err| {
                                    println!("failed initial input: {err:?}");
                                    process::exit(1);
                                });
                        }
                    }
                    fuzzer
                        .fuzz_loop(&mut stages, &mut executor, &mut state, &mut $mgr)
                        .unwrap_or_else(|_| {
                            println!("failed fuzz loop");
                            process::exit(1);
                        });
                }
                Ok(())
            })()
        }};
    }

    let monitor = MultiMonitor::new(|s| println!("{s}"));
    if replay_inputs.is_some() {
        let mut mgr = SimpleEventManager::new(monitor);
        run_client_body!(None, mgr)
            .unwrap_or_else(|err| panic!("Failed to run replay: {err:?}"));
        return;
    }

    let mut run_client = |state: Option<_>, mut mgr, _client_description| {
        run_client_body!(state, mgr)
    };

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
        Err(Error::ShuttingDown) => println!("Fuzzing stopped by user. Good bye."),
        Err(err) => panic!("Failed to run launcher: {err:?}"),
    }
}
