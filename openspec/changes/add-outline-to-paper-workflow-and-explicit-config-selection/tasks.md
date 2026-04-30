## 1. Add the outline-to-paper tool surface

- [ ] 1.1 Create `tools/outline-to-paper/` with a tool descriptor and a stable
  `run` entrypoint that fits Morpheus-managed execution.
- [ ] 1.2 Define the tool's input and output contract for normalized outline,
  support, planning, review, and LaTeX export artifacts.
- [ ] 1.3 Add the repo-local skill and tool metadata needed for discovery,
  documentation, and managed invocation.

## 2. Support explicit config file selection

- [ ] 2.1 Extend shared Morpheus config loading so commands can use an explicit
  `--config <path>` file instead of only upward discovery from `cwd`.
- [ ] 2.2 Ensure config-relative paths, including `workspace.root`, resolve
  relative to the selected config file.
- [ ] 2.3 Thread the explicit config selection through command entrypoints and
  shared path/workspace helpers that currently call `loadConfig(process.cwd())`.

## 3. Wire the paper workflow into managed runs

- [ ] 3.1 Implement managed workflow execution for `outline-to-paper` so it
  records steps, logs, and outputs under the workflow run root.
- [ ] 3.2 Publish a stable public artifact set for the workflow, including plan,
  gap, review, and LaTeX outputs, while keeping tool-private scratch state out
  of the managed contract.
- [ ] 3.3 Ensure later workflows can cite stable `outline-to-paper` artifacts
  without depending on tool-private intermediate files.

## 4. Validate compatibility and workflow behavior

- [ ] 4.1 Add tests for explicit `--config` selection and the fallback behavior
  when `--config` is not provided.
- [ ] 4.2 Add tests or fixtures for `outline-to-paper` managed runs and stable
  artifact publication.
- [ ] 4.3 Update relevant docs, skills, and usage notes to describe the new
  workflow and explicit config-file selection behavior.
