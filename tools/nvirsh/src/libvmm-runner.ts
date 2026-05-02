#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';

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

function toolRepoEntry(tool: string) {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', tool, 'dist', 'index.js');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerRunDir(stateDir: string) {
  return path.join(stateDir, 'provider-libvmm');
}

function providerManifestPath(stateDir: string) {
  return path.join(providerRunDir(stateDir), 'manifest.json');
}

function providerLogPath(stateDir: string) {
  return path.join(providerRunDir(stateDir), 'stdout.log');
}

function appendLog(log: fs.WriteStream, chunk: string | null | undefined, attach: boolean, target: 'stdout' | 'stderr' = 'stdout') {
  if (!chunk) {
    return;
  }
  log.write(chunk);
  if (attach) {
    if (target === 'stderr') {
      process.stderr.write(chunk);
    } else {
      process.stdout.write(chunk);
    }
  }
}

function currentEventLogFile() {
  return process.env.MORPHEUS_EVENT_LOG_FILE || null;
}

function currentEventContext() {
  const raw = process.env.MORPHEUS_EVENT_CONTEXT || '';
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function emitEvent(event: string, data: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  const filePath = currentEventLogFile();
  if (!filePath) {
    return;
  }
  const context = currentEventContext() as Record<string, unknown>;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify({
    ts: new Date().toISOString(),
    producer: options.producer || 'nvirsh',
    level: options.level || 'info',
    scope: options.scope || 'step',
    event,
    workflow_id: options.workflowId || context.workflow_id || null,
    step_id: options.stepId || context.step_id || null,
    tool: options.tool || context.tool || null,
    data,
  })}\n`, 'utf8');
}

function emitProviderEvent(event: string, stateDir: string, providerLogFile: string, data: Record<string, unknown> = {}) {
  emitEvent(event, {
    provider: 'libvmm',
    provider_run_dir: path.relative(process.cwd(), providerRunDir(stateDir)),
    provider_log_file: path.relative(process.cwd(), providerLogFile),
    ...data,
  });
}

function relativeIfPresent(filePath: string | null | undefined) {
  if (!filePath) {
    return null;
  }
  return path.relative(process.cwd(), filePath);
}

function readNewLogLines(filePath: string, state: { offset: number; remainder: string }) {
  if (!fs.existsSync(filePath)) {
    return [] as string[];
  }
  const stats = fs.statSync(filePath);
  if (stats.size < state.offset) {
    state.offset = 0;
    state.remainder = '';
  }
  if (stats.size === state.offset) {
    return [] as string[];
  }
  const handle = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(stats.size - state.offset);
    fs.readSync(handle, buffer, 0, buffer.length, state.offset);
    state.offset = stats.size;
    const text = state.remainder + buffer.toString('utf8');
    const lines = text.split(/\r?\n/);
    state.remainder = lines.pop() || '';
    return lines.filter((line) => line.length > 0);
  } finally {
    fs.closeSync(handle);
  }
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
  const runtimeContract = requireValue(prerequisites.runtimeContract, 'prerequisites.runtimeContract');
  const kernel = requireValue(runtime.kernel, 'runtime.kernel');
  const initrd = requireValue(runtime.initrd, 'runtime.initrd');

  fs.mkdirSync(stateDir, { recursive: true });
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const attach = String(process.env.NVIRSH_ATTACH || '') === '1';
  const toolchainBin = path.join(toolchain, 'bin');
  const libvmmCli = toolRepoEntry('libvmm');
  const providerDir = providerRunDir(stateDir);

  const args = [
    libvmmCli,
    '--json',
    'run',
    '--contract',
    runtimeContract,
    '--action',
    'qemu',
    '--run-dir',
    providerDir,
    '--libvmm-dir',
    libvmmDir,
    '--microkit-sdk',
    microkitSdk,
    '--board',
    board,
    '--microkit-config',
    microkitConfig,
    '--kernel',
    kernel,
    '--initrd',
    initrd,
    '--qemu',
    qemu,
    '--toolchain-bin-dir',
    toolchainBin,
    ...((Array.isArray(prerequisites.qemuArgs) ? prerequisites.qemuArgs : []).flatMap((value: unknown) => ['--qemu-arg', String(value)])),
    ...(attach ? [] : ['--detach']),
  ];

  const launched = attach
    ? spawn(process.execPath, args, {
        cwd: stateDir,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : null;

  if (launched) {
    launched.stdout.on('data', (chunk) => appendLog(log, String(chunk), attach));
    launched.stderr.on('data', (chunk) => appendLog(log, String(chunk), attach, 'stderr'));
  }

  const launchResult = launched
    ? await new Promise<{ code: number | null }>((resolve, reject) => {
        launched.on('error', reject);
        launched.on('close', (code) => resolve({ code }));
      })
    : (() => {
        const result = spawnSync(process.execPath, args, {
          cwd: stateDir,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        appendLog(log, result.stdout || '', attach);
        appendLog(log, result.stderr || '', attach, 'stderr');
        if (result.status !== 0) {
          throw new Error(result.stderr || result.stdout || 'failed to launch libvmm runtime');
        }
        return { code: result.status };
      })();

  const providerManifestFile = providerManifestPath(stateDir);
  const providerLogFile = providerLogPath(stateDir);
  const providerLogState = { offset: 0, remainder: '' };
  const providerTraceLogState = { offset: 0, remainder: '' };
  const launchDeadline = Date.now() + 30000;
  while (!fs.existsSync(providerManifestFile) && Date.now() < launchDeadline) {
    await sleep(100);
  }
  if (!fs.existsSync(providerManifestFile)) {
    log.end();
    throw new Error('libvmm runtime did not create a provider manifest');
  }

  let providerManifest = readJson(providerManifestFile);
  updateManifest(manifestPath, (current) => ({
    ...current,
    status: providerManifest.status === 'running' ? 'running' : 'starting',
    pid: providerManifest.pid || null,
    launcherPid: providerManifest.launcherPid || null,
    runnerPid: process.pid,
    runtime: {
      ...(current.runtime || {}),
      providerRun: {
        provider: 'libvmm',
        run_dir: providerDir,
        manifest: providerManifestFile,
        log_file: providerLogFile,
      },
    },
    startedAt: new Date().toISOString(),
    ...(providerManifest.status === 'running' ? { qemuStartedAt: new Date().toISOString() } : {}),
  }));
  emitProviderEvent('provider.started', stateDir, providerLogFile, {
    provider_manifest: path.relative(process.cwd(), providerManifestFile),
    pid: providerManifest.pid || null,
    launcher_pid: providerManifest.launcherPid || null,
    runner_pid: providerManifest.runnerPid || null,
    status: providerManifest.status || 'starting',
    console_log: relativeIfPresent(providerManifest.consoleLog),
    trace_log: relativeIfPresent(providerManifest.traceLog),
  });
  emitProviderEvent('provider.log.attached', stateDir, providerLogFile, {
    provider_manifest: path.relative(process.cwd(), providerManifestFile),
  });

  let mirroredRunning = false;
  let mirroredTerminalStatus: string | null = null;
  while (true) {
    providerManifest = readJson(providerManifestFile);
    const providerStatus = String(providerManifest.status || '').trim().toLowerCase();
    const newLines = readNewLogLines(providerLogFile, providerLogState);
    for (const line of newLines) {
      emitProviderEvent('provider.log.line', stateDir, providerLogFile, {
        line,
        stream: 'stdout',
      });
    }
    const providerTraceLogFile = providerManifest.traceLog ? String(providerManifest.traceLog) : null;
    if (providerTraceLogFile) {
      const traceLines = readNewLogLines(providerTraceLogFile, providerTraceLogState);
      for (const line of traceLines) {
        emitProviderEvent('provider.trace.line', stateDir, providerLogFile, {
          line,
          trace_log: relativeIfPresent(providerTraceLogFile),
        });
      }
    }

    if (providerStatus === 'running') {
      updateManifest(manifestPath, (current) => ({
        ...current,
        status: 'running',
        pid: providerManifest.pid || current.pid || null,
        launcherPid: providerManifest.launcherPid || current.launcherPid || null,
        runnerPid: process.pid,
        qemuStartedAt: current.qemuStartedAt || new Date().toISOString(),
      }));
      if (!mirroredRunning) {
        emitProviderEvent('provider.running', stateDir, providerLogFile, {
          pid: providerManifest.pid || null,
          launcher_pid: providerManifest.launcherPid || null,
          runner_pid: providerManifest.runnerPid || null,
          monitor_sock: relativeIfPresent(providerManifest.monitorSock),
          console_log: relativeIfPresent(providerManifest.consoleLog),
          trace_log: relativeIfPresent(providerManifest.traceLog),
        });
        mirroredRunning = true;
      }
    }

    if (providerStatus === 'success' || providerStatus === 'stopped' || providerStatus === 'error') {
      if (mirroredTerminalStatus !== providerStatus) {
        emitProviderEvent(
          providerStatus === 'success'
            ? 'provider.completed'
            : providerStatus === 'stopped'
              ? 'provider.stopped'
              : 'provider.failed',
          stateDir,
          providerLogFile,
          {
            pid: providerManifest.pid || null,
            launcher_pid: providerManifest.launcherPid || null,
            runner_pid: providerManifest.runnerPid || null,
            exit_code: typeof providerManifest.exitCode === 'number' ? providerManifest.exitCode : null,
            signal: providerManifest.signal || null,
            error: providerManifest.errorMessage || null,
          },
        );
        mirroredTerminalStatus = providerStatus;
      }
      log.end();
      updateManifest(manifestPath, (current) => ({
        ...current,
        status: providerStatus,
        pid: providerManifest.pid || current.pid || null,
        launcherPid: providerManifest.launcherPid || current.launcherPid || null,
        runnerPid: process.pid,
        exitCode: typeof providerManifest.exitCode === 'number' ? providerManifest.exitCode : current.exitCode,
        signal: providerManifest.signal || current.signal || null,
        errorMessage: providerManifest.errorMessage || current.errorMessage || null,
        finishedAt: providerManifest.finishedAt || new Date().toISOString(),
      }));
      process.exit(typeof providerManifest.exitCode === 'number' ? providerManifest.exitCode : (providerStatus === 'success' ? 0 : 1));
    }

    if (attach && launchResult.code != null && launchResult.code !== 0) {
      emitProviderEvent('provider.failed', stateDir, providerLogFile, {
        exit_code: launchResult.code,
        error: 'failed to launch libvmm runtime',
      });
      log.end();
      updateManifest(manifestPath, (current) => ({
        ...current,
        status: 'error',
        exitCode: launchResult.code,
        finishedAt: new Date().toISOString(),
      }));
      process.exit(launchResult.code);
    }

    await sleep(250);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unexpected libvmm runner error'}\n`);
  process.exit(1);
});
