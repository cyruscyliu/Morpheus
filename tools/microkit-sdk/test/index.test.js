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

test('inspect reports directory metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'microkit-sdk-tool-test-'));
  fs.writeFileSync(path.join(root, 'VERSION'), '2.0.1\n');

  const result = run(['--json', 'inspect', '--path', root]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(payload.details.artifact.path, 'sdk-dir');
  assert.equal(payload.details.directory.version, '2.0.1');

  fs.rmSync(root, { recursive: true, force: true });
});

test('build can unpack a managed sdk directory from an archive', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'microkit-sdk-tool-fetch-'));
  const sourceParent = path.join(root, 'archive-src');
  const archiveSource = path.join(sourceParent, 'microkit-sdk-2.0.1');
  const source = path.join(root, 'managed-src', 'microkit-sdk-2.0.1');
  const archivePath = path.join(root, 'microkit-sdk-2.0.1.tar.gz');
  fs.mkdirSync(archiveSource, { recursive: true });
  fs.writeFileSync(path.join(archiveSource, 'VERSION'), '2.0.1\n');

  const archive = spawnSync('tar', ['-czf', archivePath, '-C', sourceParent, 'microkit-sdk-2.0.1'], {
    encoding: 'utf8',
  });
  assert.equal(archive.status, 0, archive.stdout || archive.stderr);

  const result = run([
    '--json',
    'build',
    '--source',
    source,
    '--microkit-version',
    '2.0.1',
    '--archive-url',
    pathToFileURL(archivePath).toString(),
  ]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(payload.details.fetched_source, true);
  assert.equal(fs.existsSync(path.join(source, 'VERSION')), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('build can materialize board SDK outputs from a source tree with build_sdk.py', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'microkit-sdk-tool-materialize-'));
  const sourceParent = path.join(root, 'archive-src');
  const archiveSource = path.join(sourceParent, 'microkit-sdk-2.0.1');
  const source = path.join(root, 'managed-src', 'source');
  const archivePath = path.join(root, 'microkit-sdk-2.0.1.tar.gz');
  const sel4Dir = path.join(root, 'sel4');
  fs.mkdirSync(archiveSource, { recursive: true });
  fs.mkdirSync(sel4Dir, { recursive: true });
  fs.writeFileSync(path.join(sel4Dir, 'CMakeLists.txt'), '# fake sel4\n');
  fs.writeFileSync(path.join(archiveSource, 'VERSION'), '2.0.1\n');
  fs.writeFileSync(
    path.join(archiveSource, 'build_sdk.py'),
    [
      '#!/usr/bin/env python3',
      'import argparse',
      'from pathlib import Path',
      'parser = argparse.ArgumentParser()',
      "parser.add_argument('--sel4', required=True)",
      "parser.add_argument('--boards', required=True)",
      "parser.add_argument('--configs', required=True)",
      "parser.add_argument('--skip-docs', action='store_true')",
      "parser.add_argument('--skip-tar', action='store_true')",
      "parser.add_argument('--tool-target-triple')",
      "parser.add_argument('--gcc-toolchain-prefix-aarch64')",
      'args = parser.parse_args()',
      "version = Path('VERSION').read_text(encoding='utf8').strip()",
      "root = Path('release') / f'microkit-sdk-{version}'",
      "for board in args.boards.split(','):",
      "  for config in args.configs.split(','):",
      "    target = root / 'board' / board / config / 'include' / 'kernel'",
      "    target.mkdir(parents=True, exist_ok=True)",
      "    (target / 'gen_config.h').write_text('// generated\\n', encoding='utf8')",
      "    (root / 'VERSION').write_text(version + '\\n', encoding='utf8')",
    ].join('\n'),
    { mode: 0o755 },
  );

  const archive = spawnSync('tar', ['-czf', archivePath, '-C', sourceParent, 'microkit-sdk-2.0.1'], {
    encoding: 'utf8',
  });
  assert.equal(archive.status, 0, archive.stdout || archive.stderr);

  const result = run([
    '--json',
    'build',
    '--source',
    source,
    '--microkit-version',
    '2.0.1',
    '--archive-url',
    pathToFileURL(archivePath).toString(),
    '--sel4',
    sel4Dir,
    '--boards',
    'qemu_virt_aarch64',
    '--configs',
    'debug,release',
  ]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(
    fs.existsSync(path.join(root, 'managed-src', 'install', 'board', 'qemu_virt_aarch64', 'debug', 'include', 'kernel', 'gen_config.h')),
    true,
  );
  assert.equal(
    fs.existsSync(path.join(root, 'managed-src', 'install', 'board', 'qemu_virt_aarch64', 'release', 'include', 'kernel', 'gen_config.h')),
    true,
  );

  fs.rmSync(root, { recursive: true, force: true });
});
