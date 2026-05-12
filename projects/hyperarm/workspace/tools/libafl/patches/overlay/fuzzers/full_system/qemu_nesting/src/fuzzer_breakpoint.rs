use core::time::Duration;
use std::{env, path::PathBuf, process};

use libafl::{
    corpus::{Corpus, InMemoryCorpus, OnDiskCorpus},
    events::{EventConfig, launcher::Launcher},
    executors::ExitKind,
    feedback_or, feedback_or_fast,
    feedbacks::{CrashFeedback, MaxMapFeedback, TimeFeedback, TimeoutFeedback},
    fuzzer::{Fuzzer, StdFuzzer},
    generators::Generator,
    monitors::MultiMonitor,
    mutators::scheduled::{StdScheduledMutator, havoc_mutations::havoc_mutations},
    observers::{CanTrack, HitcountsMapObserver, TimeObserver, VariableMapObserver},
    schedulers::{IndexesLenTimeMinimizerScheduler, QueueScheduler},
    stages::{CalibrationStage, StdMutationalStage},
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
use libafl_nesting::{ScenarioGenerator, ScenarioInput};
use libafl_qemu::{
    GuestPhysAddr, GuestReg, InputLocation, QemuMemoryChunk, breakpoint::Breakpoint,
    command::{EndCommand, StartCommand},
    elf::EasyElf,
    emu::Emulator,
    executor::QemuExecutor,
    modules::edges::StdEdgeCoverageModule,
};
use libafl_targets::{EDGES_MAP_DEFAULT_SIZE, MAX_EDGES_FOUND, edges_map_mut_ptr};

pub static mut MAX_INPUT_SIZE: usize = 512;

pub fn fuzz() {
    env_logger::init();

    let timeout = Duration::from_secs(3);
    let broker_port = 1341;
    let cores = Cores::from_cmdline("1").unwrap();
    let objective_dir = PathBuf::from("./crashes");

    let mut elf_buffer = Vec::new();
    let elf = EasyElf::from_file(
        env::var("KERNEL").expect("KERNEL env not set"),
        &mut elf_buffer,
    )
    .unwrap();

    let input_addr = elf
        .resolve_symbol(
            &env::var("FUZZ_INPUT").unwrap_or_else(|_| "FUZZ_INPUT".to_owned()),
            0,
        )
        .expect("Symbol or env FUZZ_INPUT not found") as GuestPhysAddr;
    let main_addr = elf
        .resolve_symbol("main", 0)
        .expect("Symbol main not found");
    let breakpoint = elf
        .resolve_symbol(
            &env::var("BREAKPOINT").unwrap_or_else(|_| "BREAKPOINT".to_owned()),
            0,
        )
        .expect("Symbol or env BREAKPOINT not found");

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
            .build()?;

        let qemu = emu.qemu();

        emu.add_breakpoint(
            Breakpoint::with_command(
                main_addr,
                StartCommand::new(InputLocation::new(
                    qemu,
                    &QemuMemoryChunk::phys(
                        input_addr,
                        unsafe { MAX_INPUT_SIZE } as GuestReg,
                        qemu.cpu_from_index(0).unwrap(),
                    ),
                    None,
                ))
                .into(),
                true,
            ),
            true,
        );
        emu.add_breakpoint(
            Breakpoint::with_command(
                breakpoint,
                EndCommand::new(Some(ExitKind::Ok)).into(),
                false,
            ),
            true,
        );

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
                InMemoryCorpus::new(),
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

        let mutator = StdScheduledMutator::new(havoc_mutations());
        let calibration_feedback = MaxMapFeedback::new(&edges_observer);
        let mut stages = tuple_list!(
            StdMutationalStage::new(mutator),
            CalibrationStage::new(&calibration_feedback)
        );

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
