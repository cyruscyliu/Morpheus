const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const fetchScript = path.join(repoRoot, "tools", "qemu", "scripts", "fetch.sh");
const patchScript = path.join(repoRoot, "tools", "qemu", "scripts", "patch.sh");
const nestingPatchDir = path.join(repoRoot, "tools", "qemu", "patches", "virtio-mmio-nesting");
const nestingPatch = fs.readFileSync(
  path.join(nestingPatchDir, "qemu-virtio-mmio-fuzz-input.patch"),
  "utf8",
);

test("nesting fuzz patch follows the L2 DMA telemetry protocol", () => {
  assert.match(nestingPatch, /MORPHEUS_HP_DMA_EVENT_OFFSET 0x0c0u/);
  assert.match(nestingPatch, /MORPHEUS_HP_DMA_ADDR_LO_OFFSET 0x0c4u/);
  assert.match(nestingPatch, /MORPHEUS_HP_DMA_ADDR_HI_OFFSET 0x0c8u/);
  assert.match(nestingPatch, /MORPHEUS_HP_DMA_LENGTH_OFFSET 0x0ccu/);
  assert.match(nestingPatch, /MORPHEUS_QEMU_FUZZ_VIRTIO_IDS/);
  assert.match(nestingPatch, /VIRTIO_ID_NET/);
  assert.match(nestingPatch, /MORPHEUS_HP_DMA_EVENT_DIR_FROM_DEVICE/);
  assert.match(nestingPatch, /morpheus_virtio_mmio_fuzz_dma_write\(vdev, offset/);
  assert.match(nestingPatch, /address_space_write\(&address_space_memory/);
  assert.match(nestingPatch, /g_try_malloc\(len\)/);
  assert.match(nestingPatch, /MORPHEUS_QEMU_DMA_MAX_LEN/);
  assert.match(nestingPatch, /addr > UINT64_MAX -/);
  assert.doesNotMatch(nestingPatch, /MORPHEUS_HP_DMA_EVENT_SIZE_MASK/);
});

test("nesting fuzz patch matches the current guest QEMU address-spaces header path", () => {
  assert.match(nestingPatch, /#include "system\/address-spaces\.h"/);
  assert.doesNotMatch(nestingPatch, /#include "exec\/address-spaces\.h"/);
});

test("nesting fuzz patch wires the guest QEMU read/write hotpath", () => {
  const maybeFuzzReadMatches = nestingPatch.match(/morpheus_virtio_mmio_maybe_fuzz_read\(/g) || [];
  const dmaWriteMatches = nestingPatch.match(/morpheus_virtio_mmio_fuzz_dma_write\(/g) || [];

  assert.ok(
    maybeFuzzReadMatches.length >= 2,
    "expected nested guest patch to define and call morpheus_virtio_mmio_maybe_fuzz_read",
  );
  assert.ok(
    dmaWriteMatches.length >= 2,
    "expected nested guest patch to define and call morpheus_virtio_mmio_fuzz_dma_write",
  );
  assert.match(
    nestingPatch,
    /morpheus_virtio_mmio_maybe_fuzz_read\(vdev, config_offset,\s*\n?\+?\s*value, size, false\)/,
  );
  assert.match(
    nestingPatch,
    /morpheus_virtio_mmio_fuzz_dma_write\(vdev, offset, value, size\)/,
  );
});

test("qemu patch treats the nesting fuzz patch as already present when the guest tree already carries the same hooks", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-patch-"));
  const seedDir = path.join(tmpDir, "seed");
  const sourceDir = path.join(tmpDir, "source");
  const fetchResultFile = path.join(tmpDir, "fetch-result.json");
  const patchResultFile = path.join(tmpDir, "patch-result.json");

  fs.mkdirSync(path.join(seedDir, "hw", "virtio"), { recursive: true });
  fs.writeFileSync(path.join(seedDir, "configure"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(seedDir, "configure"), 0o755);
  fs.writeFileSync(
    path.join(seedDir, "hw", "virtio", "trace-events"),
    [
      "virtio_mmio_fuzz_read(uint64_t offset, uint64_t base, uint64_t fuzzed, unsigned size, uint64_t cursor) \"fuzz\"",
      "virtio_mmio_dma_fuzz(uint64_t addr, unsigned len, uint32_t event, uint8_t opcode, uint8_t direction, uint64_t cursor, int status) \"dma\"",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
      path.join(seedDir, "hw", "virtio", "virtio-mmio.c"),
      [
        '#include "qemu/osdep.h"',
        '#include "system/address-spaces.h"',
        '#define MORPHEUS_QEMU_INPUT_PATH_ENV "MORPHEUS_QEMU_INPUT_PATH"',
        "static void morpheus_virtio_mmio_fuzz_init(void) {}",
        "static uint64_t morpheus_virtio_mmio_maybe_fuzz_read(void) { return 0; }",
        "static void trace_virtio_mmio_fuzz_read(void) {}",
        "static void trace_virtio_mmio_dma_fuzz(void) {}",
        "morpheus_virtio_mmio_maybe_fuzz_read(vdev, config_offset, value, size, false);",
        "morpheus_virtio_mmio_fuzz_dma_write(offset, value, size);",
        "",
      ].join("\n"),
    "utf8",
  );

  let result = spawnSync("bash", [fetchScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_QEMU_SOURCE: sourceDir,
      MORPHEUS_QEMU_SEED_DIR: seedDir,
      MORPHEUS_QEMU_RESULT_FILE: fetchResultFile,
      MORPHEUS_QEMU_BUILD_VERSION: "guest-cca-2025-09-12",
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);

  result = spawnSync("bash", [patchScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_QEMU_SOURCE: sourceDir,
      MORPHEUS_QEMU_PATCH_DIR: nestingPatchDir,
      MORPHEUS_QEMU_RESULT_FILE: patchResultFile,
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /already present, skipped/);

  const payload = JSON.parse(fs.readFileSync(patchResultFile, "utf8"));
  assert.equal(payload.details.applied, true);
  assert.equal(
    fs.existsSync(path.join(sourceDir, ".morpheus-patches.json")),
    true,
  );
});

test("qemu patch refreshes a clean tree from the local git repo before falling back to network fetch", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-patch-git-"));
  const repoDir = path.join(tmpDir, "repo");
  const sourceDir = path.join(tmpDir, "source");
  const fetchResultFile = path.join(tmpDir, "fetch-result.json");
  const patchResultFile = path.join(tmpDir, "patch-result.json");

  fs.mkdirSync(path.join(repoDir, "hw", "virtio"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "configure"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(repoDir, "configure"), 0o755);
  fs.writeFileSync(
    path.join(repoDir, "hw", "virtio", "trace-events"),
    [
      "virtio_mmio_fuzz_read(uint64_t offset, uint64_t base, uint64_t fuzzed, unsigned size, uint64_t cursor) \"fuzz\"",
      "virtio_mmio_dma_fuzz(uint64_t addr, unsigned len, uint32_t event, uint8_t opcode, uint8_t direction, uint64_t cursor, int status) \"dma\"",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
      path.join(repoDir, "hw", "virtio", "virtio-mmio.c"),
      [
        '#include "qemu/osdep.h"',
        '#include "system/address-spaces.h"',
        '#define MORPHEUS_QEMU_INPUT_PATH_ENV "MORPHEUS_QEMU_INPUT_PATH"',
        "static void morpheus_virtio_mmio_fuzz_init(void) {}",
        "static uint64_t morpheus_virtio_mmio_maybe_fuzz_read(void) { return 0; }",
        "static void trace_virtio_mmio_fuzz_read(void) {}",
        "static void trace_virtio_mmio_dma_fuzz(void) {}",
        "morpheus_virtio_mmio_maybe_fuzz_read(vdev, config_offset, value, size, false);",
        "morpheus_virtio_mmio_fuzz_dma_write(offset, value, size);",
        "",
      ].join("\n"),
    "utf8",
  );

  let result = spawnSync("git", ["init", "--initial-branch=main"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync("git", ["checkout", "-b", "cca/2025-09-12"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync("git", ["add", "configure", "hw/virtio/trace-events", "hw/virtio/virtio-mmio.c"], {
    cwd: repoDir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  result = spawnSync(
    "git",
    [
      "-c",
      "user.name=Morpheus",
      "-c",
      "user.email=morpheus@example.invalid",
      "commit",
      "-m",
      "seed",
    ],
    {
      cwd: repoDir,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  result = spawnSync("bash", [fetchScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_QEMU_SOURCE: sourceDir,
      MORPHEUS_QEMU_GIT_URL: repoDir,
      MORPHEUS_QEMU_GIT_REF: "cca/2025-09-12",
      MORPHEUS_QEMU_RESULT_FILE: fetchResultFile,
      MORPHEUS_QEMU_BUILD_VERSION: "guest-cca-2025-09-12",
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);

  const fetchMetadataPath = path.join(sourceDir, ".morpheus-fetch.json");
  const fetchMetadata = JSON.parse(fs.readFileSync(fetchMetadataPath, "utf8"));
  fetchMetadata.git_url = "https://invalid.example.invalid/qemu.git";
  fs.writeFileSync(fetchMetadataPath, JSON.stringify(fetchMetadata, null, 2));

  result = spawnSync("bash", [patchScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_QEMU_SOURCE: sourceDir,
      MORPHEUS_QEMU_PATCH_DIR: nestingPatchDir,
      MORPHEUS_QEMU_RESULT_FILE: patchResultFile,
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /refreshed clean source from local git clone/);
  assert.match(result.stdout, /already present, skipped/);
  const payload = JSON.parse(fs.readFileSync(patchResultFile, "utf8"));
  assert.equal(payload.details.applied, true);
});
