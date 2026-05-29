## ADDED Requirements

### Requirement: LibAfl Nesting Provides A Structured Scenario Input
The system SHALL provide a structured `ScenarioInput` for nested fuzzing
scenarios.

#### Scenario: Scenario input preserves grouped ordering
- **WHEN** a user creates a `ScenarioInput` with multiple action groups
- **THEN** the system preserves the order of the groups
- **AND** the system preserves the order of actions within each group

### Requirement: LibAfl Nesting Provides Scenario Generation
The system SHALL provide a generator that can create valid `ScenarioInput`
values from scratch.

#### Scenario: Generator creates a valid scenario
- **WHEN** the generator is asked for a new input
- **THEN** it returns a valid `ScenarioInput`
- **AND** the generated input is suitable for mutation and serialization

### Requirement: LibAfl Nesting Provides Scenario Mutation
The system SHALL provide mutators that operate on `ScenarioInput` while
preserving schema validity.

#### Scenario: Mutator edits a grouped scenario
- **WHEN** a mutator is applied to a `ScenarioInput`
- **THEN** the result remains a valid `ScenarioInput`
- **AND** group ordering remains preserved unless the mutator explicitly
  changes group order

### Requirement: LibAfl Nesting Serializes And Decodes Scenarios
The system SHALL serialize `ScenarioInput` into a grouped wire format and
support decoding canonicalized output back into `ScenarioInput`.

#### Scenario: Scenario round-trips through the wire format
- **WHEN** the system serializes a `ScenarioInput`
- **AND** later decodes the serialized form
- **THEN** the decoded input preserves the original grouping structure

### Requirement: LibAfl Nesting Produces A Guest Stub Artifact
The system SHALL produce a guest stub artifact that can later be installed into
an L1 userspace image.

#### Scenario: Build emits stub artifact
- **WHEN** the `libafl_nesting` crate is built
- **THEN** the build output includes a guest stub artifact
- **AND** the artifact can be consumed by later runtime integration work
