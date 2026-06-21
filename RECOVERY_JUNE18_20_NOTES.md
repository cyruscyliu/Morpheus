# Recovery Notes For June 18-20, 2026

This file records both:

- recovered changes that were strong enough to commit
- weaker transcript-only or partial fragments that were not safe to turn into
  code automatically

The goal is to preserve reminders of what was likely done in the lost
`/root/Morpheus` / workspace state, so the remaining pieces can be redone later
without pretending they were recovered exactly.

## Strong Recoveries Already Committed

- `86bb5aa` `libafl: force oracle-enable in nesting stubs`
- `e333ff9` `infra: add harness arg parsing and corepack bootstrap`
- `8661d2a` `libafl: add initial inputs and oracle-seeded empty corpus`
- `e166c00` `workflow: forward passthrough args to tool runs`
- `e7b088e` `libafl: restore hyperarm qemu_nesting build wrappers`
- `1afedcc` `libafl: restore hyperarm qemu_nesting inspect wrapper`
- `e41ceb1` `libafl: restore hyperarm qemu_nesting exec wrapper`

The restored HyperArm workspace wrapper subtree is now:

- `projects/hyperarm/workspace/tools/libafl/scripts/qemu_nesting/build.sh`
- `projects/hyperarm/workspace/tools/libafl/scripts/qemu_nesting/exec.sh`
- `projects/hyperarm/workspace/tools/libafl/scripts/qemu_nesting/inspect.sh`
- `projects/hyperarm/workspace/tools/libafl/scripts/qemu_nesting/patch.sh`

## Transcript-Only / Partial Fragments

These are the pieces that were visible in deleted transcript fragments but were
not strong enough to apply as exact code recovery without interpretation.

### 1. Stronger `fuzzer_breakpoint.rs` Oracle-Forcing Mutator Variant

Transcript fragments showed a later or alternate `qemu_nesting`
`fuzzer_breakpoint.rs` variant with:

- `const ORACLE_MAGIC_PAIR: u64 = 0x5aa5;`
- `CmpLogFocusMutator`
- imports for:
  - `cmp::CmpValuesMetadata`
  - `ShadowTracingStage`
  - `CmpLogModule`
  - `CmpLogObserver`
  - `Rand` alongside `StdRand`
- support for `MORPHEUS_LIBAFL_INITIAL_INPUTS`
- explicit evaluation of initial inputs before entering `fuzz_loop()`
- an `inject_oracle_pair(input: &mut ScenarioInput)` helper

Recovered helper body fragment:

```rust
const ORACLE_MAGIC_PAIR: u64 = 0x5aa5;

fn inject_oracle_pair(input: &mut ScenarioInput) -> bool {
    for group in input.groups_mut() {
        for action in group.actions_mut() {
            match action {
                libafl_nesting::Action::Hyper(libafl_nesting::HyperAction::MmioWrite {
                    width, value, ..
                })
                | libafl_nesting::Action::Hyper(libafl_nesting::HyperAction::MemWrite {
                    width, value, ..
                })
                | libafl_nesting::Action::Hyper(libafl_nesting::HyperAction::PioWrite {
                    width, value, ..
                }) => {
                    *width = 2;
                    *value = (*value & !0xffff) | ORACLE_MAGIC_PAIR;
                    return true;
                }
                libafl_nesting::Action::Hyper(libafl_nesting::HyperAction::MmioRead {
                    addr, width, ..
                })
                | libafl_nesting::Action::Hyper(libafl_nesting::HyperAction::MemRead {
                    addr, width, ..
                }) => {
                    *width = 2;
                    *addr = (*addr & !0xffff) | ORACLE_MAGIC_PAIR;
                    return true;
                }
                libafl_nesting::Action::Hyper(libafl_nesting::HyperAction::PioRead {
                    port, width, ..
                }) => {
                    *width = 2;
                    *port = (*port & !0xffff) | ORACLE_MAGIC_PAIR;
                    return true;
                }
                libafl_nesting::Action::PageTable(
                    libafl_nesting::PageTableAction::WritePte { value, .. },
                ) => {
                    *value = (*value & !0xffff) | ORACLE_MAGIC_PAIR;
                    return true;
                }
                libafl_nesting::Action::PageTable(
                    libafl_nesting::PageTableAction::WalkGuestVa { va, .. },
                ) => {
                    *va = (*va & !0xffff) | ORACLE_MAGIC_PAIR;
                    return true;
                }
                libafl_nesting::Action::PageTable(
                    libafl_nesting::PageTableAction::ReadPte { table_pa, .. },
                ) => {
                    *table_pa = (*table_pa & !0xffff) | ORACLE_MAGIC_PAIR;
                    return true;
                }
                libafl_nesting::Action::PageTable(
                    libafl_nesting::PageTableAction::InvalidateTlb { va, .. },
                ) => {
                    *va = Some(u64::from(ORACLE_MAGIC_PAIR as u16));
                    return true;
                }
                _ => {}
            }
        }
    }

    if let Some(group) = input.groups_mut().first_mut() {
        group.actions_mut().insert(
            0,
            libafl_nesting::Action::Hyper(libafl_nesting::HyperAction::MmioWrite {
                addr: 0,
                width: 2,
                value: ORACLE_MAGIC_PAIR,
            }),
        );
        return true;
    }

    false
}
```

Important caveat:

- transcript recovery also showed `let mutator = ScenarioMutator::default();`
  and `let mut stages = tuple_list!(StdMutationalStage::new(mutator));`
- I did not recover a later exact line that switched the stage list to
  `CmpLogFocusMutator`

So this variant is likely real work, but the exact final wiring is uncertain.

### 2. `exec.sh` Transient Launcher Variant

The committed `exec.sh` already includes the replay/state extraction and
seed-input support recovered from June 19.

Transcript fragments also showed an intermediate launcher variant with:

- `runner_log_file="${run_dir}/launcher.stdout.log"`
- `source_log_file()`
- `spawn_launcher()`
- `tee -a "${runner_log_file}"` on launcher stdout/stderr
- manifest writes during retry loops
- `extract_l1_runtime_from_log "${l1_runtime_dir}" "$(source_log_file)" ...`

A transient extra experiment also appeared:

```bash
buildroot_host_lib_dir="/root/.cache/morpheus/hyperarm/tools/buildroot/builds/arm64-dev/output/host/lib"

if ! ldconfig -p 2>/dev/null | grep -q 'libpixman-1\.so\.0' \
  && [ -f "${buildroot_host_lib_dir}/libpixman-1.so.0" ]; then
  launch_env+=("LD_LIBRARY_PATH=${buildroot_host_lib_dir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}")
fi
```

That `libpixman` fallback looked transient and was later removed in one
transcript branch, so I did not preserve it as exact recovered behavior.

### 3. Possible June 20 `#[must_use]` Removal

One June 20 transcript fragment clearly showed an `apply_patch` stream removing
a line ending in `#[must_use]`, but the file path was not recovered with enough
confidence to apply it.

Recovered token sequence:

```text
-
    #[
must
_use
```

Treat this only as a reminder that one Rust file may have had a `#[must_use]`
annotation removed around June 20.

### 4. `pnpm-lock.yaml` Partial Fragment

Transcript diff context showed a small lockfile edit:

```diff
diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
@@ -119,8 +119,6 @@ importers:
-  tools/outline-to-paper: {}
```

I did not commit this because it was isolated transcript evidence with no
stronger supporting context that it was an intentional repo change rather than
side effect / local drift.

### 5. June 18 Failure Reminder

This June 18 run definitely happened:

- workflow id: `wf-20260618124124-dcd4ee83`
- step: `01-libafl-exec`
- status: `error`

Recovered direct error:

```text
missing libafl harness script: projects/hyperarm/workspace/tools/libafl/scripts/qemu_nesting/exec.sh
```

Recovered argv fragment:

```text
--json exec --tool libafl --workspace /root/Morpheus/projects/hyperarm/workspace -- \
  --source /root/.cache/morpheus/hyperarm/tools/libafl/builds/libafl-main/source \
  --harness-script projects/hyperarm/workspace/tools/libafl/scripts/qemu_nesting/exec.sh \
  --harness-arg --nvirsh-state \
  --harness-arg /root/.cache/morpheus/hyperarm/tools/nvirsh/builds/qemu-debian-arm64/install/state.json \
  --harness-arg --replay-input \
  --harness-arg projects/hyperarm/workspace/replay-seeds/oracle-virtio-mmio-driver.raw \
  --harness-arg --l2-run-window-ms \
  --harness-arg 30000
```

This is useful if you want to replay the exact missing-script failure later.

## Recovery Method Notes

- `patch.sh`, `build.sh`, and `inspect.sh` were restored from direct raw
  file-body recovery.
- `exec.sh` was restored from a directly recovered replay-aware base body, then
  completed using exact later June 19 transcript deltas where available.
- `generator.rs` and the initial-input-support part of `fuzzer_breakpoint.rs`
  were recovered strongly enough to commit.
- the more aggressive oracle-forcing `CmpLogFocusMutator` variant remains only
  a transcript reminder, not an exact committed recovery.

## If You Want To Redo The Weak Fragments Later

The first place to revisit is:

- `projects/hyperarm/workspace/tools/libafl/patches/overlay/fuzzers/full_system/qemu_nesting/src/fuzzer_breakpoint.rs`

The likely theme of the missing work is:

- reach `vm_get_features()`
- collect cmp/read values through cmplog
- bias the right raw serialized bytes
- possibly add a dedicated `CmpLogFocusMutator` path on top of the regular
  `ScenarioMutator`
