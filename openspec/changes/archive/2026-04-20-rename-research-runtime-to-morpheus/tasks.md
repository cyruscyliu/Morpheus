## 1. Rename the app

- [x] 1.1 Rename `apps/research-runtime` to `apps/morpheus`
- [x] 1.2 Update package metadata, script names, and internal path references
- [x] 1.3 Update docs and help text to use the Morpheus app identity

## 2. Reset the product boundary

- [x] 2.1 Audit current runtime and workflow surfaces in the renamed app
- [x] 2.2 Remove or defer workflow-runtime-first commands and documentation
- [x] 2.3 Keep reusable inspection, metadata, and JSON output infrastructure that still fits the Morpheus boundary

## 3. Reconcile repo integration

- [x] 3.1 Update repo references to the renamed app across scripts, docs, and wrappers
- [x] 3.2 Verify tool CLIs remain first-class public interfaces beside Morpheus
- [x] 3.3 Add or update tests for the renamed app and its narrowed scope
