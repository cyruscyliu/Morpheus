import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const bin = path.resolve(process.cwd(), 'dist/index.js');

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    cwd: process.cwd(),
    ...options,
  });
}

async function waitForFile(filePath, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

test('help supports json', () => {
  const result = run(['--json', '--help']);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.command, 'help');
});

test('inspect reports executable metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qemu-tool-test-'));
  const executable = path.join(root, 'qemu-system-aarch64');
  fs.writeFileSync(
    executable,
    [
      '#!/usr/bin/env sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "qemu stub 1.0"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const result = run(['--json', 'inspect', '--path', executable]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(payload.details.artifact.path, 'qemu-system-aarch64');

  fs.rmSync(root, { recursive: true, force: true });
});

test('build produces an installable executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qemu-tool-build-'));
  const source = path.join(root, 'src');
  const buildDir = path.join(root, 'build');
  const installDir = path.join(root, 'install');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'configure'),
    [
      '#!/usr/bin/env sh',
      'set -eu',
      "prefix=''",
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    --prefix=*) prefix="${arg#--prefix=}" ;;',
      '  esac',
      'done',
      'cat > Makefile <<EOF',
      'all:',
      "\t@mkdir -p build-out",
      "\t@printf '%s\\n' '#!/usr/bin/env sh' 'if [ \"$$1\" = \"--version\" ]; then echo \"qemu built 1.0\"; exit 0; fi' 'exit 0' > build-out/qemu-system-aarch64",
      "\t@chmod +x build-out/qemu-system-aarch64",
      'install:',
      '\t@mkdir -p ${prefix}/bin',
      '\t@cp build-out/qemu-system-aarch64 ${prefix}/bin/qemu-system-aarch64',
      'EOF',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const result = run([
    '--json',
    'build',
    '--source',
    source,
    '--build-dir',
    buildDir,
    '--install-dir',
    installDir,
    '--target-list',
    'aarch64-softmmu',
  ]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(fs.existsSync(path.join(installDir, 'bin', 'qemu-system-aarch64')), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('build can fetch and unpack a QEMU release archive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qemu-tool-fetch-'));
  const sourceParent = path.join(root, 'archive-src');
  const archiveSource = path.join(sourceParent, 'qemu-1.0.0');
  const source = path.join(root, 'managed-src', 'qemu-1.0.0');
  const buildDir = path.join(root, 'build');
  const installDir = path.join(root, 'install');
  const archivePath = path.join(root, 'qemu-1.0.0.tar.xz');
  fs.mkdirSync(archiveSource, { recursive: true });
  fs.writeFileSync(
    path.join(archiveSource, 'configure'),
    [
      '#!/usr/bin/env sh',
      'set -eu',
      "prefix=''",
      'for arg in "$@"; do',
      '  case "$arg" in',
      '    --prefix=*) prefix="${arg#--prefix=}" ;;',
      '  esac',
      'done',
      'cat > Makefile <<EOF',
      'all:',
      "\t@mkdir -p build-out",
      "\t@printf '%s\\n' '#!/usr/bin/env sh' 'if [ \"$$1\" = \"--version\" ]; then echo \"qemu fetched 1.0\"; exit 0; fi' 'exit 0' > build-out/qemu-system-aarch64",
      "\t@chmod +x build-out/qemu-system-aarch64",
      'install:',
      '\t@mkdir -p ${prefix}/bin',
      '\t@cp build-out/qemu-system-aarch64 ${prefix}/bin/qemu-system-aarch64',
      'EOF',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );

  const archive = spawnSync('tar', ['-cJf', archivePath, '-C', sourceParent, 'qemu-1.0.0'], {
    encoding: 'utf8',
  });
  assert.equal(archive.status, 0, archive.stdout || archive.stderr);

  const result = run([
    '--json',
    'build',
    '--source',
    source,
    '--qemu-version',
    '1.0.0',
    '--archive-url',
    pathToFileURL(archivePath).toString(),
    '--build-dir',
    buildDir,
    '--install-dir',
    installDir,
    '--target-list',
    'aarch64-softmmu',
  ]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(payload.details.fetched_source, true);
  assert.equal(fs.existsSync(path.join(source, 'configure')), true);
  assert.equal(fs.existsSync(path.join(installDir, 'bin', 'qemu-system-aarch64')), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('run launches a detached local QEMU process and writes a manifest', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qemu-tool-run-'));
  const executable = path.join(root, 'qemu-system-aarch64');
  const kernel = path.join(root, 'Image');
  const initrd = path.join(root, 'rootfs.cpio.gz');
  const runDir = path.join(root, 'run');
  const launchArgs = path.join(runDir, 'launched.args');
  fs.writeFileSync(
    executable,
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'if [ "${1:-}" = "--version" ]; then',
      '  echo "qemu stub 1.0"',
      '  exit 0',
      'fi',
      'sleep 0.1',
      'printf "%s\\n" "$@" > launched.args',
      'exit 0',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  fs.writeFileSync(kernel, 'kernel');
  fs.writeFileSync(initrd, 'initrd');

  const result = run([
    '--json',
    'run',
    '--path',
    executable,
    '--kernel',
    kernel,
    '--initrd',
    initrd,
    '--run-dir',
    runDir,
    '--append',
    'console=ttyAMA0 root=/dev/ram0',
    '--qemu-arg',
    '-smp',
    '--qemu-arg',
    '2',
    '--detach',
  ]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(payload.command, 'run');
  assert.equal(payload.details.run_dir, runDir);

  await waitForFile(path.join(runDir, 'manifest.json'));
  await waitForFile(launchArgs);

  const manifest = JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.tool, 'qemu');
  assert.equal(manifest.command, 'run');
  assert.equal(manifest.detached, true);
  assert.equal(manifest.kernel, kernel);
  assert.equal(manifest.initrd, initrd);

  const launched = fs.readFileSync(launchArgs, 'utf8');
  assert.match(launched, /-kernel/);
  assert.match(launched, /-initrd/);
  assert.match(launched, /console=ttyAMA0 root=\/dev\/ram0/);
  assert.match(launched, /-smp/);

  fs.rmSync(root, { recursive: true, force: true });
});
