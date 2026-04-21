# AGENTS.md

## General Principles

- Prefer clear, concise writing.
- Prefer one-line sentences when possible.
- Wrap generated Markdown at 80 chars.
- Use repo-relative paths or plain code references.
- Do not add absolute filesystem paths.
- Add comments when they improve clarity.

## CLI Principles

- Design CLIs in a Unix-like style.
- Prefer simple, composable commands.
- Prefer clear top-level verbs over deep nesting.
- Treat `--json` as a first-class interface.
- Keep `--help`, success output, and error output consistent.
- Prefer explicit flags and arguments over hidden state.
- Use stable field names and predictable exit codes.
- Keep output deterministic for scripts and agents.
- Keep tool semantics thin; wrap upstream tools cleanly.
- Require explicit user intent for ambiguous or destructive actions.
- Prefer persistent metadata for long-running or remote workflows.
- Keep implementations small, testable, and easy to extend.
- When adding a new CLI package or tool, update the relevant `pnpm` workspace,
  build, lint, test, and smoke commands as needed.
- When adding a repo-local tool wrapper, declare it in `tools/<tool>/tool.json`
  so `install:bin` can discover it automatically.
- When updating a tool, update its skill and `tools/<tool>/README.md` in the
  same change.
- When inspecting Morpheus-managed tool runs, prefer Morpheus `tool`
  subcommands over direct remote shell access.
- For source-managing tools such as Buildroot and QEMU, prefer stable managed
  source paths under `<workspace>/tools/<tool>/src/`.
- For those tools, keep reusable builds under
  `<workspace>/tools/<tool>/builds/` and run records under
  `<workspace>/tools/<tool>/runs/`.
- Treat external source trees as transient sync inputs when needed, not as the
  canonical paths stored in `morpheus.yaml`.

## `tools/` README Principles

- Write `tools/<name>/README.md` for both humans and agents.
- Start with a short one-line summary under the title.
- Add badges near the top when they help communicate status or metadata.
- Add a short positioning paragraph after the summary.
- Include a `Quick start` section near the top.
- Show one canonical command for the main workflow.
- Explain what that command does in a short bullet list.
- Show the expected output layout when files are produced.
- Include at least one `--json` example when supported.
- Show an abridged machine-readable response shape when relevant.
- Add a `Usage` section with the public command tree.
- Document commands by user intent, not only by flags.
- Add a `Flags` section when options are non-trivial.
- Include realistic examples for common and advanced paths.
- Use repo-relative paths in examples.
- Explain multi-environment modes such as local, remote, or container.
- Keep README structure easy to scan.
