# Minimal Buildroot Fixture

This fixture is a tiny Makefile-based stand-in for a Buildroot tree.

It exists only for CLI smoke tests. It validates that `buildroot build`,
`inspect`, and `clean` work correctly with an `O=<output>` workflow and a
small defconfig target.
