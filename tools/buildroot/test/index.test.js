import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const bin = path.resolve(process.cwd(), 'dist/index.js');

function parseLastJsonLine(stdout) {
  const lines = String(stdout).trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines.at(-1));
}

test('help supports json', () => {
  const result = spawnSync(process.execPath, [bin, '--json', '--help'], { encoding: 'utf8', cwd: path.resolve(process.cwd()) });
  assert.equal(result.status, 0);
  const payload = parseLastJsonLine(result.stdout);
  assert.equal(payload.command, 'help');
  assert.equal(payload.status, 'success');
});

test('errors support json', () => {
  const result = spawnSync(process.execPath, [bin, '--json', 'remote-build', '--ssh', 'host:22'], { encoding: 'utf8', cwd: path.resolve(process.cwd()) });
  assert.notEqual(result.status, 0);
  const payload = parseLastJsonLine(result.stdout);
  assert.equal(payload.status, 'error');
  assert.equal(payload.error.code, 'unknown_command');
});

test('local build smoke fixture produces an artifact and manifest', () => {
  const fixture = path.resolve(process.cwd(), 'test/fixtures/minimal-buildroot');
  const outDir = path.resolve(process.cwd(), '.tmp-test-out');
  const patchDir = path.resolve(process.cwd(), '.tmp-test-patches');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(patchDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(patchDir, 'linux'), { recursive: true });
  fs.mkdirSync(path.join(patchDir, 'linux-headers'), { recursive: true });
  fs.writeFileSync(path.join(patchDir, 'linux', 'kernel.fragment'), 'CONFIG_TEST_FRAGMENT=y\n');
  fs.writeFileSync(path.join(patchDir, 'linux', 'linux.hash'), 'sha256  deadbeef  linux.tar.gz\n');
  fs.writeFileSync(path.join(patchDir, 'linux-headers', 'linux-headers.hash'), 'sha256  deadbeef  linux.tar.gz\n');

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
    '--patch-dir',
    patchDir,
    '--config-fragment',
    'BR2_PACKAGE_PCIUTILS=y',
    '--make-arg',
    '-j$(nproc)',
  ], { encoding: 'utf8', cwd: path.resolve(process.cwd()) });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = parseLastJsonLine(result.stdout);
  assert.equal(payload.status, 'success');
  assert.match(fs.readFileSync(path.join(outDir, '.config'), 'utf8'), /BR2_PACKAGE_PCIUTILS=y/);
  assert.match(fs.readFileSync(path.join(outDir, '.config'), 'utf8'), /BR2_GLOBAL_PATCH_DIR=/);
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
  const inspectPayload = parseLastJsonLine(inspect.stdout);
  assert.equal(inspectPayload.details.manifest.status, 'success');

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.rmSync(patchDir, { recursive: true, force: true });
});

test('patch ignores package patch trees and non-patch inputs', () => {
  const fixture = path.resolve(process.cwd(), 'test/fixtures/minimal-buildroot');
  const patchDir = path.resolve(process.cwd(), '.tmp-test-buildroot-patch-tree');
  fs.rmSync(patchDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(patchDir, 'linux'), { recursive: true });
  fs.mkdirSync(path.join(patchDir, 'linux-headers'), { recursive: true });
  fs.writeFileSync(path.join(patchDir, 'linux', '0001-kernel.patch'), 'not for buildroot source\n');
  fs.writeFileSync(path.join(patchDir, 'linux', 'kernel.fragment'), 'CONFIG_TEST_FRAGMENT=y\n');
  fs.writeFileSync(path.join(patchDir, 'linux', 'linux.hash'), 'sha256  deadbeef  linux.tar.gz\n');
  fs.writeFileSync(path.join(patchDir, 'linux-headers', 'linux-headers.hash'), 'sha256  deadbeef  linux.tar.gz\n');

  const result = spawnSync(process.execPath, [
    bin,
    '--json',
    'patch',
    '--source',
    fixture,
    '--patch-dir',
    patchDir,
  ], { encoding: 'utf8', cwd: path.resolve(process.cwd()) });

  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = parseLastJsonLine(result.stdout);
  assert.equal(payload.status, 'success');
  assert.deepEqual(payload.details.patches.files, []);

  fs.rmSync(patchDir, { recursive: true, force: true });
});
