import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sel4-tool-test-'));
  fs.writeFileSync(path.join(root, 'VERSION'), '15.0.0\n');

  const result = run(['--json', 'inspect', '--path', root]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(payload.details.artifact.path, 'source-dir');
  assert.equal(payload.details.directory.version, '15.0.0');

  fs.rmSync(root, { recursive: true, force: true });
});

test('build can clone a managed seL4 source tree from git', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sel4-tool-fetch-'));
  const origin = path.join(root, 'origin');
  const source = path.join(root, 'managed-src', 'seL4-15.0.0');
  fs.mkdirSync(origin, { recursive: true });

  let result = spawnSync('git', ['init'], { cwd: origin, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  result = spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: origin, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  result = spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: origin, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  fs.writeFileSync(path.join(origin, 'README.md'), '# seL4\n');
  result = spawnSync('git', ['add', '.'], { cwd: origin, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  result = spawnSync('git', ['commit', '-m', 'init'], { cwd: origin, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  result = spawnSync('git', ['tag', '15.0.0'], { cwd: origin, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout || result.stderr);

  result = run([
    '--json',
    'build',
    '--source',
    source,
    '--sel4-version',
    '15.0.0',
    '--git-url',
    origin,
    '--git-ref',
    '15.0.0',
  ]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(payload.details.fetched_source, true);
  assert.equal(fs.existsSync(path.join(source, 'README.md')), true);

  fs.rmSync(root, { recursive: true, force: true });
});
