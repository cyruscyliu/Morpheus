# AGENTS.md

## General Principles

- Prefer clear, concise writing.
- Prefer one-line sentences when possible.
- Wrap generated Markdown at 80 chars.
- Use repo-relative paths or plain code references.
- Do not add absolute filesystem paths.
- Add comments when they improve clarity.
- If you are uncertain, ask instead of fabricating results under pressure.

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
- Treat cache policy as Morpheus-owned configuration, not as tool behavior.
- Treat repo-local tool CLIs as Morpheus-internal execution surfaces.
- Do not invoke repo-local tools directly from the agent shell.
- Run tools only through `morpheus workflow ...`.
- Prefer resuming an existing workflow run over creating a new run when the
  same work can continue safely.
- Never add tool-specific behavior to Morpheus.
- Keep Morpheus generic and move tool-specific logic into `tools/<tool>/`.
- Keep global cache enablement transparent to tools.
- Prefer explicit `cache.namespace` values in `morpheus.yaml`.
- When cache is enabled, Morpheus may create only the `patches` symlink bridge
  for workspace-owned tool patch trees.
- Require explicit user intent for ambiguous or destructive actions.
- When adding a new CLI package or tool, update the relevant build, lint,
  test, and smoke commands.
- `install:bin` installs only the repo-local `morpheus` wrapper in `bin/`.
- Do not expose repo-local tool CLIs as top-level wrappers in `bin/`.
- When updating a tool, update its skill and `tools/<tool>/README.md` in the
  same change unless the README is explicitly for standalone non-Morpheus use.

## Commit Messages

- Use `component: action short-summary` subject-only commit messages.

## Workspace Rule

- Treat `<workspace>/tools/`, `<workspace>/runs/`, and `<workspace>/tmp/` as
  the stable Morpheus-managed layout.
- Treat `~/.cache/morpheus/<namespace>/tools/...` as the stable global cache
  layout when cache is enabled.

## Skills-First Docs

This repo treats `skills/` and tool descriptors as the canonical documentation
source, and avoids maintaining per-tool `README.md` files.
`apps/docs` renders documentation from `skills/*/SKILL.md` plus
`tools/*/tool.json`, while `.codex/skills/` and `.claude/skills/` may contain
additional third-party skills with `omssr-*` entries symlinked to `skills/`.

Standalone tool docs are allowed when they explain non-Morpheus usage, such as
`tools/nqc2/README.md`.
