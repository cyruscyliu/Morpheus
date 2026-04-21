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
