const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const patchScript = path.join(
  repoRoot,
  "tools",
  "qemu-libafl-bridge",
  "scripts",
  "patch.sh",
);
const buildScript = path.join(
  repoRoot,
  "tools",
  "qemu-libafl-bridge",
  "scripts",
  "build.sh",
);
const edgeMapPatch = path.join(
  repoRoot,
  "tools",
  "qemu-libafl-bridge",
  "patches",
  "0003-share-edge-map-with-libafl-fuzzer.patch",
);
const buildSource = fs.readFileSync(buildScript, "utf8");

function writeExecutable(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
  fs.chmodSync(file, 0o755);
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Morpheus",
      GIT_AUTHOR_EMAIL: "morpheus@example.invalid",
      GIT_COMMITTER_NAME: "Morpheus",
      GIT_COMMITTER_EMAIL: "morpheus@example.invalid",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function seedQemuRepository(root, version) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "VERSION"), `${version}\n`, "utf8");
  writeExecutable(path.join(root, "configure"), "#!/bin/sh\nexit 0\n");
  fs.writeFileSync(path.join(root, "README.rst"), "baseline documentation\n", "utf8");
  git(root, "init", "--initial-branch=main");
  git(root, "add", ".");
  git(root, "commit", "-m", "baseline");
  return git(root, "rev-parse", "HEAD");
}

function makeProvider(root) {
  const base = seedQemuRepository(root, "11.0.1");
  writeExecutable(
    path.join(root, "linker_interceptor.py"),
    "#!/usr/bin/env python3\n",
  );
  writeExecutable(
    path.join(root, "linker_interceptor++.py"),
    "#!/usr/bin/env python3\n",
  );
  fs.writeFileSync(path.join(root, "libafl-hook.c"), "/* bridge hook */\n", "utf8");
  fs.writeFileSync(path.join(root, "README.rst"), "provider documentation\n", "utf8");
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "README.md"), "provider docs\n", "utf8");
  git(root, "add", ".");
  git(root, "commit", "-m", "bridge changes");
  const head = git(root, "rev-parse", "HEAD");
  return { base, head };
}

function runPatch({
  provider,
  providerBase,
  qemu,
  output,
  patchDir,
  buildVersion = "11.0.3",
}) {
  const resultFile = path.join(output, "result.json");
  return spawnSync("bash", [patchScript], {
    encoding: "utf8",
    env: {
      ...process.env,
      MORPHEUS_REPO_ROOT: repoRoot,
      MORPHEUS_QEMU_LIBAFL_BRIDGE_SOURCE: provider,
      MORPHEUS_QEMU_LIBAFL_BRIDGE_BASE_QEMU_SOURCE: qemu,
      MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_DIR: path.join(output, "build"),
      MORPHEUS_QEMU_LIBAFL_BRIDGE_PROVIDER_BASE_REF: providerBase,
      MORPHEUS_QEMU_LIBAFL_BRIDGE_PROVIDER_BASE_VERSION: "11.0.1",
      MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_VERSION: buildVersion,
      MORPHEUS_QEMU_LIBAFL_BRIDGE_RESULT_FILE: resultFile,
      ...(patchDir
        ? { MORPHEUS_QEMU_LIBAFL_BRIDGE_PATCH_DIR: patchDir }
        : {}),
    },
  });
}

test("qemu LibAFL bridge rebases provider changes onto QEMU 11.0.3", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-bridge-"));
  const provider = path.join(tmpDir, "provider");
  const qemu = path.join(tmpDir, "qemu");
  const output = path.join(tmpDir, "output");
  const { base, head } = makeProvider(provider);
  seedQemuRepository(qemu, "11.0.3");
  const patchDir = path.join(tmpDir, "patches");
  fs.mkdirSync(patchDir);
  fs.mkdirSync(output, { recursive: true });

  const result = runPatch({ provider, providerBase: base, qemu, output, patchDir });
  assert.equal(result.status, 0, result.stderr + result.stdout);

  const rebased = path.join(output, "rebased-source");
  assert.equal(fs.readFileSync(path.join(rebased, "VERSION"), "utf8").trim(), "11.0.3");
  assert.equal(fs.existsSync(path.join(rebased, "libafl-hook.c")), true);
  assert.equal(fs.existsSync(path.join(rebased, "linker_interceptor.py")), true);
  assert.equal(fs.existsSync(path.join(rebased, "linker_interceptor++.py")), true);
  assert.equal(fs.existsSync(path.join(rebased, "README.rst")), true);
  assert.equal(fs.existsSync(path.join(rebased, "docs", "README.md")), false);
  assert.equal(git(provider, "rev-parse", "HEAD"), head);
  assert.equal(git(provider, "status", "--porcelain"), "");

  const payload = JSON.parse(fs.readFileSync(path.join(output, "result.json"), "utf8"));
  assert.equal(payload.details.applied, true);
  assert.equal(payload.details.provider_head, head);
  assert.equal(payload.details.provider_base_ref, base);
  const metadata = JSON.parse(
    fs.readFileSync(path.join(rebased, ".morpheus-bridge.json"), "utf8"),
  );
  assert.equal(metadata.buildVersion, "11.0.3");
  assert.equal(metadata.providerBaseVersion, "11.0.1");
});

test("qemu LibAFL bridge rejects a provider without its configured base ancestor", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-bridge-"));
  const provider = path.join(tmpDir, "provider");
  const qemu = path.join(tmpDir, "qemu");
  const output = path.join(tmpDir, "output");
  makeProvider(provider);
  seedQemuRepository(qemu, "11.0.3");
  const patchDir = path.join(tmpDir, "patches");
  fs.mkdirSync(patchDir);
  fs.mkdirSync(output, { recursive: true });

  const result = runPatch({
    provider,
    providerBase: "0000000000000000000000000000000000000000",
    qemu,
    output,
    patchDir,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing configured base commit/);
  assert.equal(fs.existsSync(path.join(output, "rebased-source")), false);
});

test("qemu LibAFL bridge applies configured local patches after provider changes", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-bridge-"));
  const provider = path.join(tmpDir, "provider");
  const qemu = path.join(tmpDir, "qemu");
  const output = path.join(tmpDir, "output");
  const patchDir = path.join(tmpDir, "patches");
  const { base } = makeProvider(provider);
  seedQemuRepository(qemu, "11.0.3");
  fs.mkdirSync(patchDir);
  fs.writeFileSync(
    path.join(patchDir, "0001-local.patch"),
    [
      "diff --git a/libafl-hook.c b/libafl-hook.c",
      "index 8b6f2b2..e1f4c7b 100644",
      "--- a/libafl-hook.c",
      "+++ b/libafl-hook.c",
      "@@ -1 +1 @@",
      "-/* bridge hook */",
      "+/* locally hardened bridge hook */",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.mkdirSync(output, { recursive: true });

  const result = runPatch({ provider, providerBase: base, qemu, output, patchDir });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(
    fs.readFileSync(path.join(output, "rebased-source", "libafl-hook.c"), "utf8"),
    "/* locally hardened bridge hook */\n",
  );
  const payload = JSON.parse(fs.readFileSync(path.join(output, "result.json"), "utf8"));
  assert.equal(payload.details.local_patch_dir, patchDir);
  assert.match(payload.details.local_patch_fingerprint, /^[0-9a-f]{64}$/);
});

test("qemu LibAFL bridge patch keeps the edge map executable-owned", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-bridge-"));
  const source = path.join(tmpDir, "qemu");
  const jitSource = path.join(source, "libafl", "jit.c");
  fs.mkdirSync(path.dirname(jitSource), { recursive: true });
  fs.writeFileSync(
    jitSource,
    [
      "/* synthetic bridge fixture",
      " *",
      "*/",
      "",
      "// from libafl_targets coverage.rs",
      "// correct size doesn't matter here",
      "uint8_t __afl_area_ptr_local[65536] __attribute__((weak));",
      "size_t __afl_map_size __attribute__((weak));",
      "",
      "size_t libafl_jit_trace_edge_hitcount(uint64_t data, uint64_t id)",
      "{",
      "    return data + id;",
      "}",
      "",
    ].join("\n"),
    "utf8",
  );
  git(source, "init", "--initial-branch=main");
  git(source, "add", ".");
  git(source, "commit", "-m", "synthetic bridge fixture");

  const check = spawnSync("git", ["apply", "--check", edgeMapPatch], {
    cwd: source,
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const applied = spawnSync("git", ["apply", edgeMapPatch], {
    cwd: source,
    encoding: "utf8",
  });
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);

  const patched = fs.readFileSync(jitSource, "utf8");
  assert.match(patched, /extern uint8_t __afl_area_ptr_local\[\]/);
  assert.match(patched, /extern size_t __afl_map_size/);
  assert.doesNotMatch(patched, /^uint8_t __afl_area_ptr_local\[65536\]/m);
  assert.doesNotMatch(patched, /^size_t __afl_map_size __attribute__/m);
});

test("qemu LibAFL bridge build signature includes source provenance", () => {
  assert.match(buildSource, /\.morpheus-bridge\.json/);
  assert.match(buildSource, /source_git_head/);
  assert.match(buildSource, /source_diff_fingerprint/);
  assert.match(buildSource, /source-provenance=/);
});

test("qemu LibAFL bridge rebuilds when provenance metadata changes", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-qemu-bridge-"));
  const source = path.join(tmpDir, "rebased-source");
  const output = path.join(tmpDir, "output");
  const fakeBin = path.join(tmpDir, "bin");
  const makeCount = path.join(tmpDir, "make-count");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(output, { recursive: true });

  writeExecutable(
    path.join(source, "configure"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(source, "linker_interceptor.py"),
    "#!/bin/sh\nexit 0\n",
  );
  writeExecutable(
    path.join(source, "linker_interceptor++.py"),
    "#!/bin/sh\nexit 0\n",
  );
  fs.writeFileSync(path.join(source, "VERSION"), "11.0.3\n", "utf8");
  fs.writeFileSync(
    path.join(source, ".morpheus-bridge.json"),
    '{"schemaVersion":1,"providerHead":"provider-a"}\n',
    "utf8",
  );
  git(source, "init", "--initial-branch=main");
  git(source, "add", ".", ":!.morpheus-bridge.json");
  git(source, "commit", "-m", "synthetic QEMU baseline");

  writeExecutable(
    path.join(fakeBin, "make"),
    [
      "#!/bin/sh",
      `printf x >> '${makeCount}'`,
      "mkdir -p qemu-bundle/usr/local/share/qemu",
      "printf bridge > libqemu-system-aarch64.so",
      "printf '{}\\n' > linkinfo.json",
      "",
    ].join("\n"),
  );

  const runBuild = () =>
    spawnSync("bash", [buildScript], {
      cwd: tmpDir,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        MORPHEUS_REPO_ROOT: repoRoot,
        MORPHEUS_QEMU_LIBAFL_BRIDGE_SOURCE: source,
        MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_DIR: path.join(output, "build"),
        MORPHEUS_QEMU_LIBAFL_BRIDGE_INSTALL_DIR: path.join(output, "install"),
        MORPHEUS_QEMU_LIBAFL_BRIDGE_BUILD_VERSION: "11.0.3",
        MORPHEUS_QEMU_LIBAFL_BRIDGE_REUSE_BUILD_DIR: "true",
        MORPHEUS_QEMU_LIBAFL_BRIDGE_JOBS: "1",
        MORPHEUS_QEMU_LIBAFL_BRIDGE_RESULT_FILE: path.join(output, "result.json"),
      },
    });

  let result = runBuild();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(fs.readFileSync(makeCount, "utf8"), "x");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(output, "result.json"), "utf8"))
      .details.reused,
    false,
  );

  result = runBuild();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(fs.readFileSync(makeCount, "utf8"), "x");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(output, "result.json"), "utf8"))
      .details.reused,
    true,
  );

  fs.writeFileSync(
    path.join(source, ".morpheus-bridge.json"),
    '{"schemaVersion":1,"providerHead":"provider-b"}\n',
    "utf8",
  );
  result = runBuild();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(fs.readFileSync(makeCount, "utf8"), "xx");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(output, "result.json"), "utf8"))
      .details.reused,
    false,
  );
});
