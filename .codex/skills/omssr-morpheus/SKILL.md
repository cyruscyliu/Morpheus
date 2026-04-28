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
manifests, logs, and the top-level wrappers that invoke repo-local tool CLIs.

Morpheus does not own tool internals.
Tool CLIs own tool behavior.
Morpheus owns the managed workspace and the management contract around it.

## First Steps

When operating in this repo:

1. Run `pnpm --filter @morpheus/app build` if the CLI may be stale.
2. Run `node apps/morpheus/dist/cli.js --help` to confirm the live surface.
3. Prefer `--json` for anything that may be consumed programmatically.
4. Re-read existing state with `inspect`, `logs`, or the checked-in schema
   before rerunning work.

Minimal local-plus-remote config:

```yaml
workspace:
  root: ./workspace

remote:
  ssh: builder@example.com:2222
  workspace:
    root: /home/builder/workspace
```

## Core Rules

- Treat `--workspace` as the shared managed workspace root.
- Treat `tools.<name>` in `morpheus.yaml` as management policy, not tool
  business logic.
- Treat `build-version` as the common Morpheus selector for versioned fetch
  and build flows.
- Treat `patch-dir` as a managed workspace-relative input when possible.
- Treat `--source` as the concrete destination path selected by Morpheus.
- Do not let tool CLIs invent managed workspace roots.
- Treat run ids as the stable lookup key for managed run lifecycle commands.

## Top-Level Contract

Top-level Morpheus commands:

```text
morpheus workspace create
morpheus workspace show
morpheus config check
morpheus fetch --tool <name>
morpheus patch --tool <name>
morpheus build --tool <name>
morpheus run --tool <name>
morpheus workflow run
morpheus workflow inspect
morpheus workflow logs
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

## CLI Contract

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
    "allowed_tool_modes": ["local", "remote"],
    "issues": []
  }
}
```

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

## Static Schema

Use the checked-in schema file for a stable machine-readable contract:

```text
.codex/skills/omssr-morpheus/schema.json
```

It contains:

- the top-level Morpheus command surface
- the common JSON envelope
- the workspace layout contract
- the declared tool catalog and each tool's `cli-contract`

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

## Boundary Rules

- Use Morpheus when the user needs managed workspace selection, managed run
  records, or workflow execution.
- Use repo-local tool CLIs directly when the user needs unmanaged tool
  behavior.
- Use the checked-in schema when you need the machine-readable Morpheus
  contract.
- Keep tool-specific behavior out of the Morpheus contract unless it appears
  in a tool descriptor or tool CLI response.
