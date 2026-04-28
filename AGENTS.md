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
- Keep tool semantics thin and testable.
- Treat remote mode as transport, not as a separate tool contract.
- Never add tool-specific behavior to Morpheus.
- Keep Morpheus generic and move tool-specific logic into `tools/<tool>/`.
- Require explicit user intent for ambiguous or destructive actions.
- When adding a new CLI package or tool, update the relevant build, lint,
  test, and smoke commands.
- When adding a repo-local tool wrapper, declare it in `tools/<tool>/tool.json`
  so `install:bin` can discover it automatically.
- When updating a tool, update its skill and `tools/<tool>/README.md` in the
  same change.

## `tools/` README Principles

- Write `tools/<name>/README.md` for both humans and agents.
- Start with a short one-line summary under the title.
- Include a `Quick start` section near the top.
- Show one canonical command for the main workflow.
- Include at least one `--json` example when supported.
- Add a `Usage` section with the public command tree.
- Document commands by user intent, not only by flags.
- Include realistic examples for common and advanced paths.
- Use repo-relative paths in examples.
- Keep README structure easy to scan.

## Workspace Rule

- Treat `<workspace>/tools/`, `<workspace>/runs/`, and `<workspace>/tmp/` as
  the stable Morpheus-managed layout.
