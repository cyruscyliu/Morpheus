#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
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

function waitForFile(filePath: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return true;
    }
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

function appendLog(logFile: string, chunk: string | null | undefined) {
  if (!chunk) {
    return;
  }
  fs.appendFileSync(logFile, chunk.endsWith('\n') ? chunk : `${chunk}\n`, 'utf8');
}

function makeVariableArgs(options: {
  microkitSdk: string;
  board: string;
  microkitConfig: string;
  kernel: string;
  initrd: string;
  wrapper: string;
  python: string | null;
}) {
  return [
    `MICROKIT_SDK=${options.microkitSdk}`,
    `MICROKIT_BOARD=${options.board}`,
    `MICROKIT_CONFIG=${options.microkitConfig}`,
    `LINUX=${options.kernel}`,
    `INITRD=${options.initrd}`,
    `QEMU=${options.wrapper}`,
    ...(options.python ? [`PYTHON=${options.python}`] : []),
  ];
}

async function main(argv: string[]) {
  const manifestPath = argv[0];
  if (!manifestPath) {
    throw new Error('runtime-runner requires a manifest path');
  }

  const manifest = readJson(manifestPath);
  const inputs = manifest.inputs || {};
  const runDir = requireValue(manifest.runDir, 'manifest.runDir');
  const logFile = requireValue(manifest.logFile, 'manifest.logFile');
  const provider = requireValue(manifest.provider, 'manifest.provider');

  const libvmmDir = requireValue(inputs.libvmmDir, 'inputs.libvmmDir');
  const qemu = requireValue(inputs.qemu, 'inputs.qemu');
  const microkitSdk = requireValue(inputs.microkitSdk, 'inputs.microkitSdk');
  const toolchainBinDir = inputs.toolchainBinDir ? String(inputs.toolchainBinDir) : null;
  const board = requireValue(inputs.board, 'inputs.board');
  const microkitConfig = inputs.microkitConfig ? String(inputs.microkitConfig) : 'debug';
  const kernel = requireValue(inputs.kernel, 'inputs.kernel');
  const initrd = requireValue(inputs.initrd, 'inputs.initrd');

  const exampleDir = requireValue(provider.exampleDir, 'provider.exampleDir');
  if (!fs.existsSync(exampleDir)) {
    throw new Error(`missing libvmm example directory: ${exampleDir}`);
  }
  const buildDir = path.join(exampleDir, 'build');
  if (!fs.existsSync(path.join(buildDir, 'Makefile'))) {
    throw new Error(`missing libvmm example build directory: ${buildDir}`);
  }

  const sharedBlkStorage = path.join(buildDir, 'blk_storage');
  const runBlkStorage = path.join(runDir, 'blk_storage');

  const pidFile = path.join(runDir, 'qemu.pid');
  const wrapper = path.join(runDir, 'qemu-wrapper.js');
  const consoleLog = path.join(runDir, 'console.log');
  let monitorSock = path.join(runDir, 'monitor.sock');
  if (monitorSock.length >= 100) {
    const digest = crypto.createHash('sha1').update(runDir).digest('hex').slice(0, 12);
    monitorSock = path.join(os.tmpdir(), `morpheus-libvmm-${digest}.sock`);
  }
  fs.mkdirSync(runDir, { recursive: true });
  if (fs.existsSync(monitorSock)) {
    fs.rmSync(monitorSock, { force: true });
  }

  fs.writeFileSync(
    wrapper,
    [
      '#!/usr/bin/env node',
      "const { spawnSync } = require('node:child_process');",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const real = process.env.LIBVMM_REAL_QEMU;",
      "const pidFile = process.env.LIBVMM_QEMU_PID_FILE;",
      "const attach = String(process.env.LIBVMM_ATTACH || '') === '1' || Boolean(process.stdout.isTTY);",
      "const consoleLog = process.env.LIBVMM_CONSOLE_LOG || '';",
      "const monitorSock = process.env.LIBVMM_MONITOR_SOCK || '';",
      "const blkStorage = process.env.LIBVMM_BLK_STORAGE || '';",
      "if (!real) throw new Error('missing LIBVMM_REAL_QEMU');",
      "if (!pidFile) throw new Error('missing LIBVMM_QEMU_PID_FILE');",
      "fs.mkdirSync(path.dirname(pidFile), { recursive: true });",
      "fs.writeFileSync(pidFile, `${process.pid}\\n`, 'utf8');",
      'const args = process.argv.slice(2);',
      'const rewritten = args.slice();',
      'if (blkStorage) {',
      '  const localBlkStorage = path.resolve(process.cwd(), "blk_storage");',
      '  if (!fs.existsSync(blkStorage) && fs.existsSync(localBlkStorage)) {',
      '    fs.copyFileSync(localBlkStorage, blkStorage);',
      '  }',
      '  for (let index = 0; index < rewritten.length; index += 1) {',
      "    if (rewritten[index] === '-drive' && index + 1 < rewritten.length) {",
      '      rewritten[index + 1] = String(rewritten[index + 1]).replace("file=blk_storage", `file=${blkStorage}`);',
      '    }',
      '  }',
      '}',
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
      "const result = spawnSync(real, rewritten, { stdio: 'inherit' });",
      'process.exit(result.status == null ? 1 : result.status);',
      '',
    ].join('\n'),
    { encoding: 'utf8', mode: 0o755 },
  );

  const attach = String(process.env.LIBVMM_ATTACH || '') === '1';
  const venvPython = path.resolve(libvmmDir, '..', '..', '..', 'pyvenv', 'bin', 'python');
  const python = process.env.LIBVMM_PYTHON && String(process.env.LIBVMM_PYTHON).trim()
    ? String(process.env.LIBVMM_PYTHON).trim()
    : (fs.existsSync(venvPython) ? venvPython : null);
  const env = {
    ...process.env,
    LIBVMM_REAL_QEMU: qemu,
    LIBVMM_QEMU_PID_FILE: pidFile,
    LIBVMM_CONSOLE_LOG: consoleLog,
    LIBVMM_MONITOR_SOCK: monitorSock,
    LIBVMM_BLK_STORAGE: runBlkStorage,
    LIBVMM: libvmmDir,
    MICROKIT_BOARD: board,
    MICROKIT_CONFIG: microkitConfig,
    MICROKIT_SDK: microkitSdk,
    LINUX: kernel,
    INITRD: initrd,
    QEMU: wrapper,
    ...(python ? { PYTHON: python } : {}),
    PATH: [
      ...(toolchainBinDir ? [toolchainBinDir] : []),
      '/usr/sbin',
      '/sbin',
      process.env.PATH || '',
    ].filter(Boolean).join(path.delimiter),
  };
  const makeArgs = makeVariableArgs({
    microkitSdk,
    board,
    microkitConfig,
    kernel,
    initrd,
    wrapper,
    python,
  });

  const log = fs.createWriteStream(logFile, { flags: 'a' });
  log.write(`make ${makeArgs.join(' ')} clean\n`);
  const cleanResult = spawnSync('make', [...makeArgs, 'clean'], {
    cwd: exampleDir,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (cleanResult.stdout) {
    log.write(cleanResult.stdout);
    if (attach) {
      process.stdout.write(cleanResult.stdout);
    }
  }
  if (cleanResult.stderr) {
    log.write(cleanResult.stderr);
    if (attach) {
      process.stderr.write(cleanResult.stderr);
    }
  }
  if (cleanResult.status !== 0) {
    log.end();
    throw new Error(cleanResult.stderr || cleanResult.stdout || 'libvmm make clean failed');
  }

  if (!fs.existsSync(sharedBlkStorage)) {
    try {
      if (fs.lstatSync(sharedBlkStorage).isSymbolicLink()) {
        fs.unlinkSync(sharedBlkStorage);
      }
    } catch {}
  }

  log.write(`make ${makeArgs.join(' ')} qemu\n`);
  const child = spawn('make', [...makeArgs, 'qemu'], {
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
    monitorSock,
    consoleLog,
    control: {
      type: 'monitor',
      endpoint: monitorSock,
      graceful_methods: ['system_powerdown', 'quit'],
    },
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
  const message = error instanceof Error ? error.message : 'Unexpected libvmm runtime runner error';
  const manifestPath = process.argv[2];
  if (manifestPath && fs.existsSync(manifestPath)) {
    try {
      const manifest = readJson(manifestPath);
      if (manifest?.logFile) {
        appendLog(String(manifest.logFile), message);
      }
      updateManifest(manifestPath, (current) => ({
        ...current,
        status: 'error',
        errorMessage: message,
        runnerPid: current.runnerPid || process.pid,
        finishedAt: new Date().toISOString(),
      }));
    } catch {}
  }
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
