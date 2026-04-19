# Morpheus

Morpheus is a research platform from North Star Systems Security Lab (NS3L).

## Quick start

Install dependencies:

```bash
pnpm install
```

Build the workspace:

```bash
pnpm build
```

Set up all tools:

```bash
pnpm setup
```

This builds the tool entrypoints and installs repo-local CLI wrappers under
`bin/`.

List available project scripts:

```bash
pnpm run
```

## Development

Start the documentation site locally:

```bash
pnpm dev:docs
```

Then open `http://127.0.0.1:4173`.

## Tool setup

Set up one tool at a time when needed:

```bash
pnpm setup:llbase
pnpm setup:llbic
pnpm setup:llcg
pnpm setup:buildroot
```

Install or refresh the repo-local CLI wrappers directly:

```bash
pnpm run install:bin
```

Use the wrappers from `bin/`:

```bash
./bin/buildroot --help
./bin/llbic --help
./bin/llcg --help
```
