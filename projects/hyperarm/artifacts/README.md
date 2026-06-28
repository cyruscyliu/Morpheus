# HyperArm Demo Artifacts

This directory contains two demo entrypoints.

`run-demo-via-morpheus.sh` runs the HyperArm demo through Morpheus workflows.
It is the managed path.

`export-demo-artifact.sh` extracts a clean runnable demo bundle from the
current Morpheus-managed artifacts and writes it under `artifacts/out/`.
The extracted bundle contains its own `run-demo.sh`.

Typical flow:

```bash
projects/hyperarm/artifacts/run-demo-via-morpheus.sh --mode replay
projects/hyperarm/artifacts/export-demo-artifact.sh
projects/hyperarm/artifacts/out/<bundle>/run-demo.sh --minutes 5
```
