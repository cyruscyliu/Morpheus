const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const postprocessScript = path.join(
  repoRoot,
  "tools",
  "nqc2",
  "scripts",
  "postprocess.sh",
);
const genhtmlScript = path.join(
  repoRoot,
  "tools",
  "nqc2",
  "scripts",
  "genhtml.sh",
);

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  fs.chmodSync(filePath, 0o755);
}

function runScript(script, env) {
  return spawnSync("bash", [script], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("NQC2 postprocess merges unique replay traces and publishes coverage", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-nqc2-postprocess-"));
  const installDir = path.join(tmpDir, "install");
  const fakeBin = path.join(tmpDir, "bin");
  const traceDir = path.join(tmpDir, "traces");
  const coverageOutput = path.join(tmpDir, "coverage", "l2.info");
  const resultFile = path.join(tmpDir, "postprocess.json");
  const invocationLog = path.join(tmpDir, "nqc2-invocations.log");

  fs.mkdirSync(path.join(installDir, "bin"), { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.mkdirSync(path.join(traceDir, "replay-000000"), { recursive: true });
  fs.mkdirSync(path.join(traceDir, "replay-000001"), { recursive: true });
  const firstTrace = zlib.gzipSync(Buffer.from("first-trace"));
  const secondTrace = Buffer.from("second-trace");
  fs.writeFileSync(
    path.join(traceDir, "replay-000000", "morpheus-nqc2.trace"),
    firstTrace,
  );
  fs.writeFileSync(
    path.join(traceDir, "replay-000001", "morpheus-nqc2.trace"),
    secondTrace,
  );
  fs.writeFileSync(path.join(traceDir, "morpheus-nqc2.trace"), firstTrace);

  writeExecutable(
    path.join(installDir, "bin", "nqc2"),
    [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      "const args = process.argv.slice(2);",
      "const trace = args[args.indexOf('--trace') + 1];",
      "const output = args[args.indexOf('--coverage-output') + 1];",
      "const count = fs.existsSync(process.env.NQC2_INVOCATION_LOG) ? fs.readFileSync(process.env.NQC2_INVOCATION_LOG, 'utf8').trim().split('\\n').filter(Boolean).length : 0;",
      "fs.appendFileSync(process.env.NQC2_INVOCATION_LOG, trace + '\\n');",
      "if (output && output !== '/dev/null') fs.writeFileSync(output, 'trace=' + (count === 0 ? 'first' : 'second') + '\\n');",
    ].join("\n") + "\n",
  );
  writeExecutable(
    path.join(fakeBin, "lcov"),
    [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      "const args = process.argv.slice(2);",
      "const inputs = [];",
      "for (let i = 0; i < args.length; i += 1) if (args[i] === '--add-tracefile') inputs.push(args[i + 1]);",
      "const output = args[args.indexOf('--output-file') + 1];",
      "fs.writeFileSync(output, inputs.map((file) => fs.readFileSync(file, 'utf8')).join(''));",
    ].join("\n") + "\n",
  );

  const result = runScript(postprocessScript, {
    PATH: `${fakeBin}:${process.env.PATH}`,
    MORPHEUS_NQC2_INSTALL_DIR: installDir,
    MORPHEUS_NQC2_TRACE: traceDir,
    MORPHEUS_NQC2_TRACE_OUTPUT: "none",
    MORPHEUS_NQC2_COVERAGE_OUTPUT: coverageOutput,
    MORPHEUS_NQC2_COVERAGE_FORMAT: "lcov",
    MORPHEUS_NQC2_RESULT_FILE: resultFile,
    NQC2_INVOCATION_LOG: invocationLog,
  });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  const invocations = fs.readFileSync(invocationLog, "utf8").trim().split("\n");
  assert.equal(invocations.length, 2);
  assert.equal(fs.readFileSync(coverageOutput, "utf8"), "trace=first\ntrace=second\n");
  const payload = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.equal(payload.details.trace_count, 2);
  assert.deepEqual(payload.artifacts, [
    { path: "coverage-info", location: coverageOutput },
  ]);
});

test("NQC2 genhtml publishes the report directory and index", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "morpheus-nqc2-genhtml-"));
  const fakeBin = path.join(tmpDir, "bin");
  const installDir = path.join(tmpDir, "install");
  const coverageOutput = path.join(tmpDir, "coverage.info");
  const outputDir = path.join(tmpDir, "html");
  const resultFile = path.join(tmpDir, "genhtml.json");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(coverageOutput, "synthetic coverage\n", "utf8");
  writeExecutable(
    path.join(fakeBin, "genhtml"),
    [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      "const path = require('path');",
      "const args = process.argv.slice(2);",
      "const output = args[args.indexOf('--output-directory') + 1];",
      "fs.mkdirSync(output, { recursive: true });",
      "fs.writeFileSync(path.join(output, 'index.html'), '<html></html>');",
    ].join("\n") + "\n",
  );

  const result = runScript(genhtmlScript, {
    PATH: `${fakeBin}:${process.env.PATH}`,
    MORPHEUS_NQC2_INSTALL_DIR: installDir,
    MORPHEUS_NQC2_COVERAGE_OUTPUT: coverageOutput,
    MORPHEUS_NQC2_OUTPUT: outputDir,
    MORPHEUS_NQC2_TITLE: "Synthetic L2 coverage",
    MORPHEUS_NQC2_RESULT_FILE: resultFile,
  });

  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(fs.existsSync(path.join(outputDir, "index.html")), true);
  const payload = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  assert.deepEqual(payload.artifacts, [
    { path: "html-report", location: outputDir },
    { path: "html-index", location: path.join(outputDir, "index.html") },
  ]);
});
