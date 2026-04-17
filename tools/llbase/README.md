# llbase

Stable Docker runtime images for the `ll*` tooling family.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![latest](https://img.shields.io/badge/image-latest-blue)](#usage)
[![mid](https://img.shields.io/badge/image-mid-blue)](#usage)
[![legacy](https://img.shields.io/badge/image-legacy-blue)](#usage)

## Introduction

`llbase` provides the shared container build context for the `ll*` toolchain
projects. It packages the LLVM/Linux runtime environment that used to live
inside `llbic` and makes it reusable by sibling tools.

## Usage

Published image families:

- `ghcr.io/jianxiaoyitech/llbase:latest` for recent kernels (`6.x`, `7.x`)
  with Clang `14`, `15`, `16`, and `18`
- `ghcr.io/jianxiaoyitech/llbase:mid` for mid-era kernels (`4.x`, `5.x`)
  with Clang `8`, `9`, `10`, `11`, and `12`
- `ghcr.io/jianxiaoyitech/llbase:legacy` for older kernels (`2.6`, `3.x`)
  with Clang `6.0`, `7`, and `8`

Build the images from this repository root:

```bash
docker build -f docker/Dockerfile -t ghcr.io/jianxiaoyitech/llbase:latest .
docker build -f docker/Dockerfile.mid -t ghcr.io/jianxiaoyitech/llbase:mid .
docker build -f docker/Dockerfile.legacy -t ghcr.io/jianxiaoyitech/llbase:legacy .
```

Or use Compose:

```bash
docker compose build llbase
docker compose build llbase-mid
docker compose build llbase-legacy
```

Images are published to GHCR by the workflow in
[`publish-images.yml`](.github/workflows/publish-images.yml).
Pushing to `main`, pushing a `v*` tag, or running the workflow manually
builds and publishes:

- `ghcr.io/jianxiaoyitech/llbase:latest`
- `ghcr.io/jianxiaoyitech/llbase:mid`
- `ghcr.io/jianxiaoyitech/llbase:legacy`

## Contributing

Contributions should keep `llbase` focused on shared runtime concerns only.

- Put reusable container/toolchain logic, not tool-specific workflow logic
- Keep image family behavior aligned across `docker/Dockerfile`,
  `docker/Dockerfile.mid`, and `docker/Dockerfile.legacy`
- Update this README when image names, supported Clang ranges, or runtime
  conventions change

## License

`llbase` is released under the MIT License. See [`LICENSE`](LICENSE).
