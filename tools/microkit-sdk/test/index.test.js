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
