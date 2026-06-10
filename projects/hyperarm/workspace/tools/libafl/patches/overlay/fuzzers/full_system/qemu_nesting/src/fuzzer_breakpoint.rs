use core::time::Duration;
use std::{env, path::PathBuf, process};

use libafl::{
    corpus::{Corpus, OnDiskCorpus},
    events::{EventConfig, launcher::Launcher},
    feedback_or, feedback_or_fast,
    feedbacks::{CrashFeedback, MaxMapFeedback, TimeFeedback, TimeoutFeedback},
    fuzzer::{Fuzzer, StdFuzzer},
    generators::Generator,
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
use libafl_nesting::{ScenarioGenerator, ScenarioInput, ScenarioMutator};
use libafl_qemu::{
    QemuSnapshotManager, emu::Emulator, executor::QemuExecutor,
    modules::edges::StdEdgeCoverageModule,
};
use libafl_targets::{EDGES_MAP_DEFAULT_SIZE, MAX_EDGES_FOUND, edges_map_mut_ptr};

pub static mut MAX_INPUT_SIZE: usize = 512;

pub fn fuzz() {
    env_logger::init();

    let timeout = Duration::from_secs(3);
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

    let mut run_client = |state: Option<_>, mut mgr, _client_description| {
        let args: Vec<String> = env::args().collect();

        let mut harness = |emulator: &mut Emulator<_, _, _, _, _, _, _>,
                           _state: &mut _,
                           input: &ScenarioInput| unsafe {
            emulator.run(input).unwrap().try_into().unwrap()
        };

        let mut edges_observer = unsafe {
            HitcountsMapObserver::new(VariableMapObserver::from_mut_slice(
                "edges",
                OwnedMutSlice::from_raw_parts_mut(edges_map_mut_ptr(), EDGES_MAP_DEFAULT_SIZE),
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

        let mut state = state.unwrap_or_else(|| {
            let mut generator = ScenarioGenerator::default();
            let mut state = StdState::new(
                StdRand::with_seed(current_nanos()),
                OnDiskCorpus::new(corpus_dir.clone()).unwrap(),
                OnDiskCorpus::new(objective_dir.clone()).unwrap(),
                &mut feedback,
                &mut objective,
            )
            .unwrap();
            for _ in 0..4 {
                let input = generator.generate(&mut state).unwrap();
                state.corpus_mut().add(input.into()).unwrap();
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
            &mut mgr,
            timeout,
        )
        .expect("Failed to create QemuExecutor");

        executor.break_on_timeout();

        fuzzer
            .fuzz_loop(&mut stages, &mut executor, &mut state, &mut mgr)
            .unwrap_or_else(|_| {
                println!("failed fuzz loop");
                process::exit(1);
            });
        Ok(())
    };

    let shmem_provider = StdShMemProvider::new().expect("Failed to init shared memory");
    let monitor = MultiMonitor::new(|s| println!("{s}"));

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
