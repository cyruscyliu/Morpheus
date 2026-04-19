import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const bin = path.resolve(process.cwd(), 'dist/index.js');

test('help supports json', () => {
  const result = spawnSync(process.execPath, [bin, '--json', '--help'], { encoding: 'utf8', cwd: path.resolve(process.cwd()) });
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.command, 'help');
  assert.equal(payload.status, 'success');
});

test('errors support json', () => {
  const result = spawnSync(process.execPath, [bin, '--json', 'remote-build', '--ssh', 'host:22'], { encoding: 'utf8', cwd: path.resolve(process.cwd()) });
  assert.notEqual(result.status, 0);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'error');
  assert.equal(payload.error.code, 'unknown_command');
});

test('local build smoke fixture produces an artifact and manifest', () => {
  const fixture = path.resolve(process.cwd(), 'test/fixtures/minimal-buildroot');
  const outDir = path.resolve(process.cwd(), '.tmp-test-out');
  fs.rmSync(outDir, { recursive: true, force: true });

  const result = spawnSync(process.execPath, [
    bin,
    '--json',
    'build',
    '--source',
    fixture,
    '--output',
    outDir,
    '--defconfig',
    'qemu_x86_64_defconfig',
  ], { encoding: 'utf8', cwd: path.resolve(process.cwd()) });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'success');
  assert.equal(fs.existsSync(path.join(outDir, 'images', 'smoke-rootfs.tar')), true);
  assert.equal(
    fs.existsSync(path.join(outDir, '.buildroot-cli', 'build.json')),
    true,
  );

  const inspect = spawnSync(process.execPath, [
    bin,
    '--json',
    'inspect',
    '--output',
    outDir,
  ], { encoding: 'utf8', cwd: path.resolve(process.cwd()) });

  assert.equal(inspect.status, 0, inspect.stdout || inspect.stderr);
  const inspectPayload = JSON.parse(inspect.stdout.trim());
  assert.equal(inspectPayload.details.manifest.status, 'success');

  fs.rmSync(outDir, { recursive: true, force: true });
});
