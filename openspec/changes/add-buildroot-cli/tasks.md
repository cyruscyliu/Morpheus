## 1. CLI scaffold

- [x] 1.1 Create the standalone `tools/buildroot` command structure and entrypoint
- [x] 1.2 Define the flat top-level verb parser and shared global flag handling
- [x] 1.3 Implement universal `--help` and `--json` response formatting for success and error paths

## 2. Local workflows

- [x] 2.1 Implement local `build` command execution with explicit CLI flag inputs
- [x] 2.2 Implement local `inspect` and `clean` command behavior with matching JSON responses
- [x] 2.3 Document how Buildroot-specific arguments are passed through the CLI

## 3. Remote provisioning and metadata

- [x] 3.1 Implement SSH target parsing with host and port support
- [x] 3.2 Implement remote workspace initialization and build ID generation
- [x] 3.3 Implement provisioning from official Buildroot release tarballs with cache reuse
- [x] 3.4 Persist remote metadata for IDs, logs, provisioning state, and inspection

## 4. Remote command surface

- [x] 4.1 Implement blocking `remote-build` with default live log streaming
- [x] 4.2 Implement detached `remote-build --detach` behavior returning generated IDs
- [x] 4.3 Implement `remote-inspect` and `remote-logs` keyed by build ID
- [x] 4.4 Implement `remote-fetch` with explicit path/glob selection and no implicit artifact defaults

## 5. Validation and docs

- [x] 5.1 Add tests for help, JSON output, parsing, and remote metadata flows
- [x] 5.2 Add tests for provisioning reuse, detached mode, and explicit remote fetch validation
- [x] 5.3 Write tool documentation with human examples and agent-oriented JSON examples
