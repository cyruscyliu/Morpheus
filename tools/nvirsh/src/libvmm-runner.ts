#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function updateManifest(manifestPath: string, mutator: (value: Record<string, any>) => Record<string, any>) {
  const current = readJson(manifestPath);
  const next = mutator(current);
  next.updatedAt = new Date().toISOString();
  writeJson(manifestPath, next);
  return next;
}

function ensureExecutable(filePath: string) {
  fs.chmodSync(filePath, 0o755);
}

function waitForFile(filePath: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return true;
    }
    // eslint-disable-next-line no-empty
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  return false;
}

function requireValue(value: any, label: string) {
  if (!value) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

async function main(argv: string[]) {
  const manifestPath = argv[0];
  if (!manifestPath) {
    throw new Error('libvmm-runner requires a manifest path');
  }

  const manifest = readJson(manifestPath);
  const prerequisites = manifest.prerequisites || {};
  const runtime = manifest.runtime || {};

  const stateDir = requireValue(manifest.stateDir, 'manifest.stateDir');
  const logFile = requireValue(manifest.logFile, 'manifest.logFile');

  const qemu = requireValue(prerequisites.qemu, 'prerequisites.qemu');
  const microkitSdk = requireValue(prerequisites.microkitSdk, 'prerequisites.microkitSdk');
  const toolchain = requireValue(prerequisites.toolchain, 'prerequisites.toolchain');
  const libvmmDir = requireValue(prerequisites.libvmmDir, 'prerequisites.libvmmDir');
  const board = requireValue(prerequisites.board, 'prerequisites.board');

  const kernel = requireValue(runtime.kernel, 'runtime.kernel');
  const initrd = requireValue(runtime.initrd, 'runtime.initrd');

  const exampleDir = path.join(libvmmDir, 'examples', 'virtio');
  if (!fs.existsSync(exampleDir)) {
    throw new Error(`missing libvmm virtio example directory: ${exampleDir}`);
  }

  const pidFile = path.join(stateDir, 'qemu.pid');
  const wrapper = path.join(stateDir, 'qemu-wrapper.sh');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    wrapper,
    [
      '#!/usr/bin/env sh',
      'set -eu',
      ': "${NVIRSH_REAL_QEMU:?missing NVIRSH_REAL_QEMU}"',
      ': "${NVIRSH_QEMU_PID_FILE:?missing NVIRSH_QEMU_PID_FILE}"',
      'echo "$$" >"$NVIRSH_QEMU_PID_FILE"',
      'exec "$NVIRSH_REAL_QEMU" "$@"',
      '',
    ].join('\n'),
    'utf8',
  );
  ensureExecutable(wrapper);

  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const toolchainBin = path.join(toolchain, 'bin');
  const env = {
    ...process.env,
    NVIRSH_REAL_QEMU: qemu,
    NVIRSH_QEMU_PID_FILE: pidFile,
    PATH: fs.existsSync(toolchainBin)
      ? `${toolchainBin}${path.delimiter}${process.env.PATH || ''}`
      : (process.env.PATH || ''),
  };

  // Match the "make qemu" flow used for nested virtualization bringup.
  const args = [
    `MICROKIT_BOARD=${board}`,
    `MICROKIT_SDK=${microkitSdk}`,
    `LINUX=${kernel}`,
    `INITRD=${initrd}`,
    `QEMU=${wrapper}`,
    'qemu',
  ];

  const child = spawn('make', args, {
    cwd: exampleDir,
    detached: false,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => log.write(chunk));
  child.stderr.on('data', (chunk) => log.write(chunk));

  const hasPid = waitForFile(pidFile, 10_000);
  const qemuPid = hasPid ? Number.parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10) : null;

  updateManifest(manifestPath, (current) => ({
    ...current,
    status: 'running',
    pid: Number.isFinite(qemuPid) ? qemuPid : child.pid,
    launcherPid: child.pid,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
  }));

  child.on('close', (code, signal) => {
    log.end();
    updateManifest(manifestPath, (current) => ({
      ...current,
      status: code === 0 ? 'success' : signal ? 'stopped' : 'error',
      exitCode: code == null ? null : code,
      signal: signal || null,
      finishedAt: new Date().toISOString(),
    }));
    process.exit(code == null ? 1 : code);
  });

  child.on('error', (error) => {
    log.write(`${String(error.message)}\n`);
    log.end();
    updateManifest(manifestPath, (current) => ({
      ...current,
      status: 'error',
      errorMessage: error.message,
      finishedAt: new Date().toISOString(),
    }));
    process.exit(1);
  });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unexpected libvmm runner error'}\n`);
  process.exit(1);
});
