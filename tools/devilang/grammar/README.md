# Devilang

A domain-specific language for describing device models, data structures, and DMA topology.

## Prerequisites

```bash
sudo apt-get install antlr4 libantlr4-runtime-dev
```

## Build

```bash
make
```

## Usage

Parse a single file:
```bash
./devilang models/merged/ac97.devilang
```

Run the test target:
```bash
make test
```

Test all models:
```bash
make test-all
```

## Sample Output

```
Parsing: models/merged/ac97.devilang
============================================================
Parse successful!
------------------------------------------------------------
AST Structure:
------------------------------------------------------------
Program (6 declarations)
  Struct: AC97_BD (2 fields)
    Field: addr : ptr<u32> [flag, align2] (bits: 1 entries)
    Field: ctl_len : u32 [flag] (bits: 4 entries)
  Pointer declaration
    from = AC97_BD.addr
    to = AC97_BUF0
    value = 2
  ...
============================================================
Done.
```

## Regenerating the Parser

If you modify the grammar:

```bash
make generate
make clean
make
```
