## 1. Lifecycle Contract

- [x] 1.1 Add shared managed-run lifecycle metadata for stop/remove semantics and optional control endpoints
- [x] 1.2 Update workflow-run manifests and helpers to preserve stopped metadata until explicit removal

## 2. Runtime Commands

- [x] 2.1 Replace runtime-facing `clean` semantics in `nvirsh` with explicit `remove` semantics
- [x] 2.2 Enforce “remove requires prior successful stop” for runtime-managed state
- [x] 2.3 Update help text, JSON responses, and tests for the new runtime lifecycle surface

## 3. Workflow Commands

- [x] 3.1 Add workflow-level `remove` and require stopped/non-running state before deletion
- [x] 3.2 Update workflow `stop` to preserve manifests and logs while marking the run as stopped
- [x] 3.3 Update workflow lifecycle tests to cover stop/remove sequencing and rejection cases

## 4. Graceful Shutdown Plumbing

- [x] 4.1 Extend runtime manifests to record control metadata when a provider can expose it
- [x] 4.2 Make stop prefer graceful control endpoints and fall back to signals only when needed
- [x] 4.3 Document the new lifecycle contract in relevant READMEs and skills
