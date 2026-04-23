# morpheus-app Specification

## ADDED Requirements

### Requirement: Workflow Runs Are A First-Class Morpheus Surface
The system SHALL provide a workflow-run-first execution and inspection model.

#### Scenario: Morpheus provides workflow-centric run commands
- **WHEN** a user interacts with Morpheus run history and inspection
- **THEN** Morpheus presents run ids and metadata as workflow runs
- **AND** tool execution details are expressed as steps within the workflow run

## REMOVED Requirements

### Requirement: Workflow Runtime Is Deferred
**Reason**: Workflow runs are now required to make run records coherent and to
eliminate ambiguity between run roots and tool-owned run records.

**Migration**: Use workflow run inspection (`morpheus runs ...`) and invoke
tools through Morpheus so tool executions are recorded as workflow steps.

