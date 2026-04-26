#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';

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
  const microkitConfig = prerequisites.microkitConfig ? String(prerequisites.microkitConfig) : 'debug';

  const kernel = requireValue(runtime.kernel, 'runtime.kernel');
  const initrd = requireValue(runtime.initrd, 'runtime.initrd');

  const disableBlk = String(process.env.NVIRSH_DISABLE_BLK || '') === '1';
  const disableNet = String(process.env.NVIRSH_DISABLE_NET || '') === '1';

  const exampleDir = path.join(libvmmDir, 'examples', 'virtio');
  if (!fs.existsSync(exampleDir)) {
    throw new Error(`missing libvmm virtio example directory: ${exampleDir}`);
  }

  const blkStorage = path.join(exampleDir, 'build', 'blk_storage');
  if (fs.existsSync(blkStorage)) {
    fs.rmSync(blkStorage);
  }

  const pidFile = path.join(stateDir, 'qemu.pid');
  const wrapper = path.join(stateDir, 'qemu-wrapper.js');
  const consoleLog = path.join(stateDir, 'console.log');
  let monitorSock = path.join(stateDir, 'monitor.sock');
  if (monitorSock.length >= 100) {
    const digest = crypto.createHash('sha1').update(stateDir).digest('hex').slice(0, 12);
    monitorSock = path.join(os.tmpdir(), `morpheus-nvirsh-${digest}.sock`);
  }
  fs.mkdirSync(stateDir, { recursive: true });
  if (fs.existsSync(monitorSock)) {
    fs.rmSync(monitorSock);
  }
  fs.writeFileSync(
    wrapper,
    [
      '#!/usr/bin/env node',
      "const { spawnSync } = require('node:child_process');",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      '',
      "const real = process.env.NVIRSH_REAL_QEMU;",
      "const pidFile = process.env.NVIRSH_QEMU_PID_FILE;",
      "const attach = String(process.env.NVIRSH_ATTACH || '') === '1' || Boolean(process.stdout.isTTY);",
      "const consoleLog = process.env.NVIRSH_CONSOLE_LOG || '';",
      "const monitorSock = process.env.NVIRSH_MONITOR_SOCK || '';",
      "if (!real) throw new Error('missing NVIRSH_REAL_QEMU');",
      "if (!pidFile) throw new Error('missing NVIRSH_QEMU_PID_FILE');",
      "fs.mkdirSync(path.dirname(pidFile), { recursive: true });",
      "fs.writeFileSync(pidFile, `${process.pid}\\n`, 'utf8');",
      '',
      'const args = process.argv.slice(2);',
      'const rewritten = args.slice();',
      'if (!attach && consoleLog) {',
      '  for (let index = 0; index < rewritten.length - 1; index += 1) {',
      "    if (rewritten[index] === '-serial' && rewritten[index + 1] === 'mon:stdio') {",
      "      rewritten[index + 1] = `file:${consoleLog}`;",
      '    }',
      '  }',
      '  if (monitorSock && !rewritten.includes("-monitor")) {',
      '    rewritten.push("-monitor", `unix:${monitorSock},server,nowait`);',
      '  }',
      '}',
      '',
      "const result = spawnSync(real, rewritten, { stdio: 'inherit' });",
      'process.exit(result.status == null ? 1 : result.status);',
      '',
    ].join('\n'),
    'utf8',
  );
  ensureExecutable(wrapper);

  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const attach = String(process.env.NVIRSH_ATTACH || '') === '1';
  const toolchainBin = path.join(toolchain, 'bin');
  const venvPython = path.resolve(libvmmDir, '..', '..', '..', 'pyvenv', 'bin', 'python');
  const python = process.env.NVIRSH_PYTHON && String(process.env.NVIRSH_PYTHON).trim()
    ? String(process.env.NVIRSH_PYTHON).trim()
    : (fs.existsSync(venvPython) ? venvPython : null);
  const env = {
    ...process.env,
    NVIRSH_REAL_QEMU: qemu,
    NVIRSH_QEMU_PID_FILE: pidFile,
    NVIRSH_CONSOLE_LOG: consoleLog,
    NVIRSH_MONITOR_SOCK: monitorSock,
    ...(python ? { PYTHON: python } : {}),
    PATH: fs.existsSync(toolchainBin)
      ? `${toolchainBin}${path.delimiter}${process.env.PATH || ''}`
      : (process.env.PATH || ''),
  };

  // Match the "make qemu" flow used for nested virtualization bringup.
  const args = [
    `MICROKIT_BOARD=${board}`,
    `MICROKIT_CONFIG=${microkitConfig}`,
    `MICROKIT_SDK=${microkitSdk}`,
    `LINUX=${kernel}`,
    `INITRD=${initrd}`,
    `QEMU=${wrapper}`,
    ...(disableBlk ? ['QEMU_BLK_ARGS='] : []),
    ...(disableNet ? ['QEMU_NET_ARGS='] : []),
    'qemu',
  ];

  const child = spawn('make', args, {
    cwd: exampleDir,
    detached: false,
    env,
    stdio: [attach ? 'inherit' : 'ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    log.write(chunk);
    if (attach) {
      process.stdout.write(chunk);
    }
  });
  child.stderr.on('data', (chunk) => {
    log.write(chunk);
    if (attach) {
      process.stderr.write(chunk);
    }
  });

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
