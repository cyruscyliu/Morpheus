## 1. Define the tool surface

- [x] 1.1 Add the `nvirsh` tool descriptor and declare the
  `fetch,build,exec,inspect,logs,stop` contract
- [x] 1.2 Add the profile and manifest field schema for phase-driven nested
  stack state
- [x] 1.3 Add stable profile examples under `tools/nvirsh/`

## 2. Implement build and exec flow

- [x] 2.1 Implement `build` to resolve profile inputs and write a runnable
  manifest without launching the stack
- [x] 2.2 Implement `exec --phase` handling for boot, provision, nested launch,
  and readiness transitions
- [x] 2.3 Teach `exec` to persist layered L0, L1, provisioning, and L2 state
  in the manifest

## 3. Implement inspection and lifecycle commands

- [x] 3.1 Implement `inspect` to report the current profile and layered run
  state
- [x] 3.2 Implement `logs` to surface the run logs associated with the current
  nested stack
- [x] 3.3 Implement `stop` to terminate the running nested stack from manifest
  metadata

## 4. Validate the change

- [x] 4.1 Add tests for the public command surface and removed legacy verbs
- [x] 4.2 Add tests for build/exec phase separation and manifest contents
- [x] 4.3 Add tests for inspect, logs, and stop behavior against a prepared
  run
