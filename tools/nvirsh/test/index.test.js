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

function makeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, { mode: 0o755 });
}

test('help supports json', () => {
  const result = run(['--json', '--help']);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.command, 'help');
  assert.equal(payload.status, 'success');
});

test('run manages local sel4 state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvirsh-test-'));
  const stateDir = path.join(root, 'state');
  const depsDir = path.join(root, 'deps');
  fs.mkdirSync(depsDir, { recursive: true });

  const qemu = path.join(depsDir, 'qemu-system-aarch64');
  const microkitSdk = path.join(depsDir, 'microkit-sdk');
  const toolchain = path.join(depsDir, 'arm-toolchain');
  const libvmmDir = path.join(depsDir, 'libvmm');
  const kernel = path.join(root, 'Image');
  const initrd = path.join(root, 'rootfs.cpio.gz');

  makeExecutable(
    qemu,
    [
      '#!/usr/bin/env sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "qemu stub 1.0"',
      '  exit 0',
      'fi',
      'echo "qemu launch: $*"',
      'exit 0',
      '',
    ].join('\n'),
  );
  for (const dir of [microkitSdk, toolchain, libvmmDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(libvmmDir, 'examples', 'virtio'), { recursive: true });
  fs.writeFileSync(
    path.join(libvmmDir, 'examples', 'virtio', 'Makefile'),
    [
      '.PHONY: qemu',
      'qemu:',
      '\t$(QEMU) -machine virt',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(microkitSdk, 'VERSION'), '1.4.1\n');
  fs.writeFileSync(path.join(toolchain, 'VERSION'), 'arm-toolchain\n');
  fs.writeFileSync(path.join(libvmmDir, 'VERSION'), 'libvmm-dev\n');
  fs.writeFileSync(kernel, 'kernel');
  fs.writeFileSync(initrd, 'initrd');

  const launch = run([
    '--json',
    'run',
    '--state-dir',
    stateDir,
    '--name',
    'sel4-dev',
    '--target',
    'sel4',
    '--qemu',
    qemu,
    '--microkit-sdk',
    microkitSdk,
    '--microkit-version',
    '1.4.1',
    '--toolchain',
    toolchain,
    '--libvmm-dir',
    libvmmDir,
    '--kernel',
    kernel,
    '--initrd',
    initrd,
    '--detach',
    '--qemu-arg',
    '-machine',
    '--qemu-arg',
    'virt',
  ]);
  assert.equal(launch.status, 0, launch.stdout || launch.stderr);

  const inspect = run(['--json', 'inspect', '--state-dir', stateDir]);
  assert.equal(inspect.status, 0, inspect.stdout || inspect.stderr);
  const inspectPayload = JSON.parse(inspect.stdout.trim());
  assert.equal(
    ['starting', 'running', 'success'].includes(inspectPayload.details.manifest.status),
    true,
  );

  const logs = run(['--json', 'logs', '--state-dir', stateDir]);
  assert.equal(logs.status, 0, logs.stdout || logs.stderr);
  assert.match(logs.stdout, /qemu launch/);

  const clean = run(['--json', 'clean', '--state-dir', stateDir, '--force']);
  assert.equal(clean.status, 0, clean.stdout || clean.stderr);
  assert.equal(fs.existsSync(stateDir), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('run defaults state under workspace tmp when morpheus.yaml is present', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvirsh-workspace-'));
  const workspaceRoot = path.join(root, 'workspace');
  const depsDir = path.join(root, 'deps');
  fs.mkdirSync(depsDir, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'morpheus.yaml'),
    ['workspace:', '  root: ./workspace', ''].join('\n'),
    'utf8',
  );

  const qemu = path.join(depsDir, 'qemu-system-aarch64');
  const microkitSdk = path.join(depsDir, 'microkit-sdk');
  const toolchain = path.join(depsDir, 'arm-toolchain');
  const libvmmDir = path.join(depsDir, 'libvmm');
  const kernel = path.join(root, 'Image');
  const initrd = path.join(root, 'rootfs.cpio.gz');

  makeExecutable(
    qemu,
    [
      '#!/usr/bin/env sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "qemu stub 1.0"',
      '  exit 0',
      'fi',
      'echo "qemu launch: $*"',
      'exit 0',
      '',
    ].join('\n'),
  );
  for (const dir of [microkitSdk, toolchain, libvmmDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(libvmmDir, 'examples', 'virtio'), { recursive: true });
  fs.writeFileSync(
    path.join(libvmmDir, 'examples', 'virtio', 'Makefile'),
    ['.PHONY: clean qemu', 'clean:', '\t@true', 'qemu:', '\t$(QEMU) -machine virt', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(microkitSdk, 'VERSION'), '1.4.1\n');
  fs.writeFileSync(path.join(toolchain, 'VERSION'), 'arm-toolchain\n');
  fs.writeFileSync(path.join(libvmmDir, 'VERSION'), 'libvmm-dev\n');
  fs.writeFileSync(kernel, 'kernel');
  fs.writeFileSync(initrd, 'initrd');

  const launch = run(
    [
      '--json',
      'run',
      '--name',
      'sel4-dev',
      '--target',
      'sel4',
      '--qemu',
      qemu,
      '--microkit-sdk',
      microkitSdk,
      '--microkit-version',
      '1.4.1',
      '--toolchain',
      toolchain,
      '--libvmm-dir',
      libvmmDir,
      '--kernel',
      kernel,
      '--initrd',
      initrd,
      '--detach',
    ],
    { cwd: root },
  );
  assert.equal(launch.status, 0, launch.stdout || launch.stderr);

  const payload = JSON.parse(launch.stdout.trim());
  const expectedStateDir = path.join(workspaceRoot, 'tmp', 'nvirsh', 'sel4-dev');
  assert.equal(payload.details.manifest.stateDir, expectedStateDir);
  assert.equal(fs.existsSync(path.join(expectedStateDir, 'manifest.json')), true);

  run(['--json', 'clean', '--state-dir', expectedStateDir, '--force'], { cwd: root });
  fs.rmSync(root, { recursive: true, force: true });
});
