---
name: morpheus
description: Manage Morpheus workspace metadata, managed tool execution,
  workflow runs, manifests, logs, and explicit artifact fetches. Use when the
  user needs the Morpheus CLI contract or Morpheus-managed execution.
license: MIT
compatibility: Designed for Codex CLI (or similar products)
---

# morpheus Skill

Use this skill when you need to work with the `morpheus` app in this repo.

## Purpose

`morpheus` is the management CLI.
It owns workspace selection, managed run records, workflow entrypoints,
manifests, logs, and the top-level wrappers that invoke internal tool CLIs.

Morpheus does not own tool internals.
Tool CLIs own tool behavior.
Morpheus owns the managed workspace and the management contract around it.

## First Steps

When operating in this repo:

1. Run `pnpm --filter @morpheus/app build` if the CLI may be stale.
2. Run `node apps/morpheus/dist/cli.js --help` or `./bin/morpheus --help`
   to confirm the live surface.
3. Prefer `--json` for anything that may be consumed programmatically.
4. Re-read existing state with `inspect` or `logs` before rerunning work.

Minimal config:

```yaml
workspace:
  root: ./workspace

```

## Core Rules

- Treat `--workspace` as the shared managed workspace root.
- Treat run ids as the stable lookup key for managed run lifecycle commands.
- Use `morpheus workflow run`, `morpheus workflow inspect`, and
  `morpheus workflow logs` as the canonical execution surface.
- Do not expect top-level `morpheus inspect` or `morpheus logs` aliases.
- Use `morpheus workflow stop` and `morpheus workflow remove` for lifecycle
  actions.
- Prefer Morpheus-managed workflow runs when later steps need reusable
  published artifacts.
- Treat `stop` as an execution-only lifecycle action.
- Treat `remove` as a persisted-state deletion action.
- Require a prior successful stop before managed run removal.
- Treat Morpheus as the owner of workflow ids, logs, and published artifact
  records.
- Treat internal tool CLIs as Morpheus-internal only.
- Do not invoke internal tool CLIs directly from the agent shell.
- Treat `tool.json` as the tool contract schema: tools must implement
  `inspect` and `logs`, and may optionally implement `fetch`, `patch`,
  `build`, and `exec`.
- Treat `tools.<name>` in `morpheus.yaml` as management policy, not tool
  business logic.
- Keep patch inputs in managed workspace locations when possible, and point
  tool patch configuration at those managed paths or at repo-shipped patch
  directories when that is the intended source.
- When patch sets change, prefer resetting managed patch targets before
  reapplying patches so patch iteration stays consistent, unless a tool
  contract defines a different update strategy.
- When `--json` is used, treat stdout as the machine-readable result channel
  and stderr as the progress or diagnostic channel unless a tool contract says
  otherwise.
- Tool CLIs should use the workspace paths Morpheus gives them instead of
  making up their own managed workspace directories.
- Downstream workflows should depend on stable published artifacts rather than
  tool-private scratch files or intermediate prompt state.

## Top-Level Morpheus Contract

This is the documented Morpheus CLI surface that users interact with directly.

Top-level Morpheus commands:

```text
morpheus workspace create
morpheus workspace show
morpheus config check
morpheus workflow run
morpheus workflow inspect
morpheus workflow logs
morpheus workflow stop
morpheus workflow remove
morpheus tool list
```

Common JSON envelope:

```json
{
  "command": "string",
  "status": "success|error|stream|submitted",
  "exit_code": 0,
  "summary": "string",
  "details": {}
}
```

Error JSON shape:

```json
{
  "command": "string",
  "status": "error",
  "exit_code": 1,
  "summary": "string",
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

The common JSON envelope for top-level Morpheus commands is:

```json
{
  "command": "string",
  "status": "success|error|stream|submitted",
  "exit_code": 0,
  "summary": "string",
  "details": {}
}
```

Top-level error JSON shape:

```json
{
  "command": "string",
  "status": "error",
  "exit_code": 1,
  "summary": "string",
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

### `workspace create`

Input:

- Optional `--json`
- Optional workspace root from `morpheus.yaml`

Returned JSON:

```json
{
  "command": "workspace create",
  "status": "success",
  "exit_code": 0,
  "summary": "created managed workspace layout",
  "details": {
    "root": "<workspace>",
    "directories": {
      "tools": "<workspace>/tools",
      "runs": "<workspace>/runs",
      "tmp": "<workspace>/tmp"
    }
  }
}
```

### `workspace show`

Input:

- Optional `--json`
- Optional workspace root from `morpheus.yaml`

Returned JSON:

```json
{
  "command": "workspace show",
  "status": "success",
  "exit_code": 0,
  "summary": "workspace metadata",
  "details": {
    "root": "<workspace>",
    "directories": {
      "tools": { "path": "<workspace>/tools", "exists": true },
      "runs": { "path": "<workspace>/runs", "exists": true },
      "tmp": { "path": "<workspace>/tmp", "exists": true }
    }
  }
}
```

### `config check`

Input:

- Optional `--json`
- Optional config discovered from `morpheus.yaml`

Returned JSON:

```json
{
  "command": "config check",
  "status": "success",
  "exit_code": 0,
  "summary": "config is valid",
  "details": {
    "allowed_tool_modes": ["managed"],
    "issues": []
  }
}
```

### Workflow Lifecycle

Primary lifecycle:

- `workflow run`
- `workflow inspect`
- `workflow logs`

Use workflow commands as the default Morpheus lifecycle surface.

### `workflow run`

Input:

- Required `--name <workflow>`
- Optional `--json`
- Optional workflow defaults from `morpheus.yaml`

Behavior:

- Starts a configured managed workflow.
- May emit stream events before the final JSON summary.

Returned JSON:

```json
{
  "command": "workflow run",
  "status": "success",
  "exit_code": 0,
  "summary": "started workflow run",
  "details": {
    "id": "wf-...",
    "workspace": "<workspace>",
    "run_dir": "<workspace>/runs/wf-...",
    "manifest": "<workspace>/runs/wf-.../manifest.json"
  }
}
```

### `workflow inspect`

Input:

- Required workflow run id
- Optional `--json`

Returned JSON:

```json
{
  "command": "workflow inspect",
  "status": "success",
  "exit_code": 0,
  "summary": "workflow manifest",
  "details": {
    "id": "wf-...",
    "manifest": {}
  }
}
```

### `workflow logs`

Input:

- Required workflow run id
- Optional `--follow`
- Optional `--json`

Returned JSON:

- In text mode, prints log output.
- In JSON mode, may emit stream events and a final summary object.

Final JSON shape:

```json
{
  "command": "workflow logs",
  "status": "success",
  "exit_code": 0,
  "summary": "workflow logs",
  "details": {
    "id": "wf-...",
    "log_file": "<workspace>/runs/wf-.../stdout.log"
  }
}
```


### `tool list`

Input:

- Optional `--json`

Returned JSON:

```json
{
  "command": "tool list",
  "status": "success",
  "exit_code": 0,
  "summary": "listed tool descriptors",
  "details": {
    "tools": [
      {
        "name": "tool-name",
        "runtime": "node|exec",
        "cli-contract": "fetch,patch,build",
        "descriptorPath": "tools/<name>/tool.json",
        "entry": "tools/<name>/dist/index.js"
      }
    ]
  }
}
```

## Morpheus-Tools Contract

This is the tool-side contract that Morpheus may invoke behind the scenes.
Treat it as an internal integration surface described by `tool.json`, not as
the preferred user-facing CLI.

### `fetch --tool <name>`

Input:

- Required `--tool <name>`
- Optional `--workspace DIR`
- Optional `--source DIR`
- Optional `--build-version VER`
- Optional `--archive-url URL`
- Optional `--downloads-dir DIR`
- Optional `--json`

Behavior:

- Morpheus resolves the managed destination path.
- Morpheus invokes the tool CLI `fetch` subcommand.
- `fetch` must only materialize source or archive state.

Returned JSON:

```json
{
  "command": "fetch",
  "status": "success",
  "exit_code": 0,
  "summary": "fetched managed source directory",
  "details": {
    "source": "<workspace>/tools/<tool>/...",
    "artifacts": [
      {
        "path": "source-dir",
        "location": "<workspace>/tools/<tool>/..."
      }
    ]
  }
}
```

### `patch --tool <name>`

Input:

- Required `--tool <name>`
- Required `--patch-dir DIR`
- Optional `--workspace DIR`
- Optional `--source DIR`
- Optional `--json`

Behavior:

- Morpheus resolves the managed source path.
- Morpheus invokes the tool CLI `patch` subcommand.
- `patch` must only apply patch state.

Returned JSON:

```json
{
  "command": "patch",
  "status": "success",
  "exit_code": 0,
  "summary": "patched managed source directory",
  "details": {
    "source": "<workspace>/tools/<tool>/...",
    "patches": {
      "dir": "<workspace>/tools/<tool>/patches",
      "files": ["0001-example.patch"],
      "fingerprint": "sha256",
      "applied": true,
      "log_file": "<workspace>/tools/<tool>/.../.morpheus-patches.log"
    }
  }
}
```

### `build --tool <name>`

Input:

- Required `--tool <name>`
- Optional `--workspace DIR`
- Optional `--source DIR`
- Optional `--build-version VER`
- Optional `--archive-url URL`
- Optional `--build-dir-key KEY`
- Optional `--json`
- Optional tool-specific passthrough after `--`

Behavior:

- Morpheus resolves managed source, output, build, or install paths.
- Morpheus invokes the tool CLI `build` subcommand.
- `build` should assume fetch and patch are explicit earlier stages unless the
  tool contract says otherwise.

Returned JSON:

```json
{
  "command": "build",
  "status": "success",
  "exit_code": 0,
  "summary": "built managed artifact",
  "details": {
    "source": "<workspace>/tools/<tool>/...",
    "artifacts": [
      {
        "path": "artifact-name",
        "location": "<workspace>/tools/<tool>/..."
      }
    ]
  }
}
```

### `exec --tool <name>`

Input:

- Required `--tool <name>`
- Optional `--workspace DIR`
- Optional `--json`
- Optional tool-specific passthrough after `--`

Behavior:

- Morpheus resolves the managed run context and invokes the tool CLI `run`
  subcommand when the tool exposes one.
- `exec` should execute against prepared managed artifacts instead of creating
  its own workspace layout.

Returned JSON:

```json
{
  "command": "exec",
  "status": "success",
  "exit_code": 0,
  "summary": "ran managed tool action",
  "details": {
    "artifacts": [
      {
        "path": "artifact-name",
        "location": "<workspace>/tools/<tool>/..."
      }
    ]
  }
}
```

### `inspect --tool <name>`

Input:

- Required `--tool <name>`
- Optional `--workspace DIR`
- Optional `--json`

Behavior:

- Morpheus invokes the tool CLI `inspect` subcommand to re-read managed state.
- `inspect` should describe existing artifacts and metadata without rerunning
  fetch, patch, build, or exec steps.

Returned JSON:

```json
{
  "command": "inspect",
  "status": "success",
  "exit_code": 0,
  "summary": "inspected managed tool state",
  "details": {
    "artifacts": [
      {
        "path": "artifact-name",
        "location": "<workspace>/tools/<tool>/..."
      }
    ]
  }
}
```

### `logs --tool <name>`

Input:

- Required `--tool <name>`
- Optional `--workspace DIR`
- Optional `--follow`
- Optional `--json`

Behavior:

- Morpheus invokes the tool CLI `logs` subcommand to read existing managed log
  output.
- `logs` should report prior execution logs rather than rerunning tool work.

Returned JSON:

```json
{
  "command": "logs",
  "status": "success",
  "exit_code": 0,
  "summary": "tool logs",
  "details": {
    "log_file": "<workspace>/tools/<tool>/.../stdout.log"
  }
}
```


## Workspace Layout

Managed workspace layout:

```text
<workspace>/
  runs/<run-id>/
    manifest.json
    stdout.log
  tools/<tool>/
    downloads/
    patches/
    src/
    builds/<key>/
  tmp/
```

Treat this layout as stable.
Treat `<workspace>/runs/` as the canonical managed run root.
Do not invent parallel management roots outside it.

## Remote Mode

Remote mode is a Morpheus execution mode, not a separate tool CLI surface.
The user still works through the same `morpheus workflow ...` commands and the
same JSON contract.
Morpheus chooses the configured transport, prepares the managed workspace on
the target system, and invokes the internal tool CLI there.
Tools should not grow `remote-*` commands or transport-specific semantics.
Keep transport handling in Morpheus and keep tool behavior in
`tools/<tool>/`.
