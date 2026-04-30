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

function requireValue(value: any, label: string) {
  if (!value) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

function updateRunningState(manifestPath: string) {
  updateManifest(manifestPath, (current) => {
    if (current.status === 'running') {
      return current;
    }
    return {
      ...current,
      status: 'running',
      qemuStartedAt: new Date().toISOString(),
    };
  });
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

  const exampleDir = path.join(libvmmDir, 'examples', 'virtio');
  if (!fs.existsSync(exampleDir)) {
    throw new Error(`missing libvmm virtio example directory: ${exampleDir}`);
  }
  const buildDir = path.join(exampleDir, 'build');
  fs.mkdirSync(stateDir, { recursive: true });
  const sharedBlkStorage = path.join(buildDir, 'blk_storage');
  const runBlkStorage = path.join(stateDir, 'blk_storage');

  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const attach = String(process.env.NVIRSH_ATTACH || '') === '1';
  const toolchainBin = path.join(toolchain, 'bin');
  const venvPython = path.resolve(libvmmDir, '..', '..', '..', 'pyvenv', 'bin', 'python');
  const python = process.env.NVIRSH_PYTHON && String(process.env.NVIRSH_PYTHON).trim()
    ? String(process.env.NVIRSH_PYTHON).trim()
    : (fs.existsSync(venvPython) ? venvPython : null);
  const env = {
    ...process.env,
    ...(python ? { PYTHON: python } : {}),
    PATH: [
      path.dirname(qemu),
      fs.existsSync(toolchainBin) ? toolchainBin : '',
      '/usr/local/sbin',
      '/usr/sbin',
      '/sbin',
      process.env.PATH || '',
    ].filter(Boolean).join(path.delimiter),
  };

  const args = [
    `MICROKIT_BOARD=${board}`,
    `MICROKIT_CONFIG=${microkitConfig}`,
    `MICROKIT_SDK=${microkitSdk}`,
    `LINUX=${kernel}`,
    `INITRD=${initrd}`,
    'qemu',
  ];

  const cleanArgs = [
    `MICROKIT_BOARD=${board}`,
    `MICROKIT_CONFIG=${microkitConfig}`,
    `MICROKIT_SDK=${microkitSdk}`,
    `LINUX=${kernel}`,
    `INITRD=${initrd}`,
    'clean',
  ];

  const clean = spawn('make', cleanArgs, {
    cwd: exampleDir,
    detached: false,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    clean.stdout.on('data', (chunk) => {
      log.write(chunk);
      if (attach) {
        process.stdout.write(chunk);
      }
    });
    clean.stderr.on('data', (chunk) => {
      log.write(chunk);
      if (attach) {
        process.stderr.write(chunk);
      }
    });
    clean.on('error', reject);
    clean.on('close', (code) => {
      if ((code ?? 1) !== 0) {
        reject(new Error(`make clean failed with exit code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });

  try {
    if (fs.existsSync(sharedBlkStorage) && !fs.existsSync(runBlkStorage)) {
      fs.copyFileSync(sharedBlkStorage, runBlkStorage);
    }
    if (fs.existsSync(sharedBlkStorage)) {
      fs.rmSync(sharedBlkStorage, { force: true });
    }
    fs.symlinkSync(runBlkStorage, sharedBlkStorage);
  } catch (error) {
    log.end();
    throw error;
  }

  const child = spawn('make', args, {
    cwd: exampleDir,
    detached: false,
    env,
    stdio: [attach ? 'inherit' : 'ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    log.write(chunk);
    if (String(chunk).includes('qemu-system-')) {
      updateRunningState(manifestPath);
    }
    if (attach) {
      process.stdout.write(chunk);
    }
  });
  child.stderr.on('data', (chunk) => {
    log.write(chunk);
    if (String(chunk).includes('qemu-system-')) {
      updateRunningState(manifestPath);
    }
    if (attach) {
      process.stderr.write(chunk);
    }
  });

  updateManifest(manifestPath, (current) => ({
    ...current,
    status: 'starting',
    pid: child.pid,
    launcherPid: child.pid,
    runnerPid: process.pid,
    runtime: {
      ...(current.runtime || {}),
      providerRun: {
        provider: 'libvmm',
        run_dir: stateDir,
        manifest: manifestPath,
        log_file: logFile,
      },
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
  process.stderr.write(`${error instanceof Error ? error.message : 'Unexpected libvmm runner error'}\n`);
  process.exit(1);
});
