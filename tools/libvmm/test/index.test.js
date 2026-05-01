import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(toolRoot, 'dist', 'index.js');

test('libvmm inspect returns libvmm-dir artifact', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'morpheus-libvmm-inspect-'));
  fs.mkdirSync(tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'VERSION'), '0.0.0\n', 'utf8');

  const result = spawnSync(process.execPath, [cli, '--json', 'inspect', '--path', tmp], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.command, 'inspect');
  assert.equal(payload.status, 'success');
  assert.equal(payload.details.artifact.path, 'libvmm-dir');

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('libvmm run launches qemu action from a runtime contract', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'morpheus-libvmm-run-'));
  const source = path.join(root, 'libvmm');
  const microkitSdk = path.join(root, 'microkit-sdk');
  const toolchain = path.join(root, 'toolchain');
  const qemu = path.join(root, 'qemu-system-aarch64');
  const kernel = path.join(root, 'Image');
  const initrd = path.join(root, 'rootfs.cpio.gz');
  const exampleDir = path.join(source, 'examples', 'virtio');

  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(exampleDir, { recursive: true });
  fs.mkdirSync(microkitSdk, { recursive: true });
  fs.mkdirSync(path.join(toolchain, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(source, 'VERSION'), 'libvmm-dev\n');
  fs.writeFileSync(path.join(microkitSdk, 'VERSION'), 'microkit-dev\n');
  fs.writeFileSync(kernel, 'kernel');
  fs.writeFileSync(initrd, 'initrd');
  fs.writeFileSync(
    path.join(exampleDir, 'Makefile'),
    [
      '.PHONY: qemu',
      'qemu:',
      '\t$(QEMU) -machine virt',
      '',
    ].join('\n'),
    'utf8',
  );
  const runtimeContractPath = path.join(source, 'runtime-contract.json');
  fs.writeFileSync(
    runtimeContractPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'libvmm-runtime-contract',
      provider: 'libvmm',
      version: '0.3.0',
      example: 'virtio',
      exampleDir,
      defaultAction: 'qemu',
      actions: {
        qemu: {
          command: 'make',
          args: ['qemu'],
          cwd: exampleDir,
          requiredInputs: ['libvmm-dir', 'microkit-sdk', 'board', 'kernel', 'initrd', 'qemu'],
          optionalInputs: ['microkit-config', 'toolchain-bin-dir'],
          outputs: ['manifest', 'log-file', 'pid', 'monitor-sock', 'console-log'],
        },
      },
      defaults: {
        board: 'qemu_virt_aarch64',
        microkitConfig: 'debug',
      },
    }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
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
    { encoding: 'utf8', mode: 0o755 },
  );

  const runDir = path.join(root, 'run');
  const launched = spawnSync(process.execPath, [
    cli,
    '--json',
    'run',
    '--contract',
    runtimeContractPath,
    '--action',
    'qemu',
    '--run-dir',
    runDir,
    '--libvmm-dir',
    source,
    '--microkit-sdk',
    microkitSdk,
    '--board',
    'qemu_virt_aarch64',
    '--microkit-config',
    'debug',
    '--kernel',
    kernel,
    '--initrd',
    initrd,
    '--qemu',
    qemu,
    '--toolchain-bin-dir',
    path.join(toolchain, 'bin'),
    '--detach',
  ], { encoding: 'utf8' });
  assert.equal(launched.status, 0, launched.stderr || launched.stdout);
  const launchedPayload = JSON.parse(launched.stdout.trim());
  assert.equal(launchedPayload.status, 'success');
  assert.equal(fs.existsSync(path.join(runDir, 'manifest.json')), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('libvmm stop stops a detached runtime run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'morpheus-libvmm-stop-'));
  const runDir = path.join(root, 'run');
  fs.mkdirSync(runDir, { recursive: true });

  const sleeper = spawn('sleep', ['30'], { stdio: 'ignore' });
  const manifestPath = path.join(runDir, 'manifest.json');
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify({
      schemaVersion: 1,
      tool: 'libvmm',
      kind: 'libvmm-runtime-run',
      id: 'libvmm-run-test',
      status: 'running',
      runDir,
      logFile: path.join(runDir, 'stdout.log'),
      manifest: manifestPath,
      pid: sleeper.pid,
      launcherPid: null,
      runnerPid: null,
      control: {
        type: 'monitor',
        endpoint: path.join(runDir, 'missing-monitor.sock'),
        graceful_methods: ['system_powerdown', 'quit'],
      },
    }, null, 2)}\n`,
    'utf8',
  );

  const stopped = spawnSync(process.execPath, [
    cli,
    '--json',
    'stop',
    '--run-dir',
    runDir,
  ], { encoding: 'utf8' });
  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
  const payload = JSON.parse(stopped.stdout.trim());
  assert.equal(payload.status, 'success');

  const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(updated.status, 'stopped');
  assert.equal(updated.signal, 'SIGTERM');

  try {
    process.kill(sleeper.pid, 'SIGKILL');
  } catch {}
  fs.rmSync(root, { recursive: true, force: true });
});
