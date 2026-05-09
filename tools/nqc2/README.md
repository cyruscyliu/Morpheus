# NQC2 Without Morpheus

`nqc2` has two practical pieces:

- the QEMU plugin that records execution traces
- the `qemu-etrace`-backed postprocess path that turns a trace into LCOV and
  HTML

This document explains how to use those pieces directly, without Morpheus.

## What Gets Built

The current standalone build produces:

- `lib/nqc2/nqc2-plugin.so`
- `bin/qemu-etrace`
- `bin/nqc2`

`bin/nqc2` is just a small wrapper around `bin/qemu-etrace`.

## Host Dependencies

Install these first:

```bash
sudo apt-get update
sudo apt-get install -y \
  lcov \
  binutils-dev \
  dwarfdump \
  libglib2.0-dev \
  libiberty-dev
```

You also need:

- a C compiler such as `gcc`
- `make`
- `git`
- a QEMU build or install that provides `qemu-plugin.h`

## Build The Plugin And Backend

The easiest standalone path is to reuse the tool build script with the
environment it expects.

Example:

```bash
export MORPHEUS_NQC2_SOURCE="$PWD/tools/nqc2/src/manual"
export MORPHEUS_NQC2_BUILD_DIR="$PWD/tools/nqc2/builds/manual/build"
export MORPHEUS_NQC2_INSTALL_DIR="$PWD/tools/nqc2/builds/manual/install"
export MORPHEUS_NQC2_TRACE_DIR="$PWD/tools/nqc2/builds/manual/trace"
export MORPHEUS_NQC2_BUILD_VERSION="manual"
export MORPHEUS_NQC2_RESULT_FILE="$PWD/tools/nqc2/builds/manual/result.json"
export MORPHEUS_NQC2_QEMU="/path/to/qemu/install/bin/qemu-system-aarch64"

mkdir -p "$MORPHEUS_NQC2_SOURCE"
printf '%s\n' "$MORPHEUS_NQC2_BUILD_VERSION" > "$MORPHEUS_NQC2_SOURCE/VERSION"

tools/nqc2/scripts/build.sh
```

After that, the useful outputs are:

```bash
$MORPHEUS_NQC2_INSTALL_DIR/lib/nqc2/nqc2-plugin.so
$MORPHEUS_NQC2_INSTALL_DIR/bin/qemu-etrace
$MORPHEUS_NQC2_INSTALL_DIR/bin/nqc2
```

## Run QEMU With The Plugin

Example:

```bash
TRACE="$PWD/buildroot-qemu-runtime-nqc2.trace"
PLUGIN="$MORPHEUS_NQC2_INSTALL_DIR/lib/nqc2/nqc2-plugin.so"

qemu-system-aarch64 \
  ... \
  -plugin "${PLUGIN},trace=${TRACE}"
```

This produces an NQC2 trace file in the `etrace`-compatible packet format used
by the backend.

## Generate LCOV

The current backend is `qemu-etrace`.

The repo postprocess script does three important things:

1. copies the trace
2. clears the TB-chaining info flag in the copied trace
3. runs `qemu-etrace` and normalizes the LCOV output

If you want the same behavior manually, use the script.

Example:

```bash
export MORPHEUS_NQC2_INSTALL_DIR="$PWD/tools/nqc2/builds/manual/install"
export MORPHEUS_NQC2_TRACE="$PWD/buildroot-qemu-runtime-nqc2.trace"
export MORPHEUS_NQC2_ELF="/path/to/vmlinux"
export MORPHEUS_NQC2_TRACE_OUTPUT="none"
export MORPHEUS_NQC2_COVERAGE_OUTPUT="$PWD/buildroot-qemu-runtime-nqc2.info"
export MORPHEUS_NQC2_COVERAGE_FORMAT="lcov"
export MORPHEUS_NQC2_RESULT_FILE="$PWD/tools/nqc2/builds/manual/postprocess.json"

tools/nqc2/scripts/postprocess.sh
```

That writes a normalized LCOV file to:

```bash
$MORPHEUS_NQC2_COVERAGE_OUTPUT
```

## Generate HTML

Example:

```bash
export MORPHEUS_NQC2_INSTALL_DIR="$PWD/tools/nqc2/builds/manual/install"
export MORPHEUS_NQC2_COVERAGE_OUTPUT="$PWD/buildroot-qemu-runtime-nqc2.info"
export MORPHEUS_NQC2_OUTPUT="$PWD/html"
export MORPHEUS_NQC2_TITLE="NQC2 Coverage"
export MORPHEUS_NQC2_RESULT_FILE="$PWD/tools/nqc2/builds/manual/genhtml.json"

tools/nqc2/scripts/genhtml.sh
```

The report will be under:

```bash
$MORPHEUS_NQC2_OUTPUT/index.html
```

## Direct Backend Use

If you do not want the wrapper script, you can invoke the backend directly:

```bash
$MORPHEUS_NQC2_INSTALL_DIR/bin/qemu-etrace \
  --trace /path/to/trace.etrace \
  --elf /path/to/vmlinux \
  --coverage-output /path/to/output.info \
  --coverage-format lcov \
  --trace-output /dev/null \
  --trace-out-format none
```

But for NQC2 traces, the wrapper script is preferred because it handles the
trace copy, the info-flag patch, and the LCOV normalization.

## Notes

- The plugin is the NQC2-specific part.
- The LCOV backend is `qemu-etrace`.
- The normalized LCOV output is the current authoritative coverage result.
