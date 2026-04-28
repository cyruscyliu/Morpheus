#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { COMMANDS, getHelp, renderHelp } from './help.js';

const VERSION = '0.2.0';

class CliError extends Error {
  code: string;
  exitCode: number;

  constructor(code: string, message: string, exitCode = 1) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function emitJson(value: unknown) {
  fs.writeSync(1, `${JSON.stringify(value)}\n`);
}

function emitText(value: string) {
  fs.writeSync(1, `${value}\n`);
}

function emitJsonEvent(command: string, event: string, details: Record<string, unknown>) {
  emitJson({
    command,
    status: 'stream',
    exit_code: 0,
    details: { event, ...details },
  });
}

function parseArgv(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, unknown> = {};
  const booleanFlags = new Set(['json', 'help', 'detach']);
  const repeatableFlags = new Set(['target-list', 'configure-arg', 'qemu-arg']);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    if (repeatableFlags.has(key)) {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new CliError('missing_flag', `Missing required value for --${key}`);
      }
      const current = Array.isArray(flags[key]) ? flags[key] as string[] : [];
      flags[key] = [...current, next];
      index += 1;
      continue;
    }
    const next = argv[index + 1];
    if (!booleanFlags.has(key) && next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return {
    command: positionals[0] || null,
    topic: positionals[1] || null,
    help: Boolean(flags.help) || positionals[0] === 'help',
    json: Boolean(flags.json),
    flags,
  };
}

function helpJson(topic?: string) {
  const command = topic ? getHelp(topic) : undefined;
  return {
    command: 'help',
    status: 'success',
    exit_code: 0,
    summary: topic ? `help for ${topic}` : 'qemu CLI help',
    details: command
      ? { command }
      : { commands: COMMANDS, global_flags: ['--json', '--help'] },
  };
}

function inspectExecutable(flags: Record<string, unknown>) {
  const inputPath = String(flags.path || '');
  if (!inputPath) {
    throw new CliError('missing_flag', 'Missing required flag: --path');
  }
  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new CliError('missing_executable', `Missing QEMU executable: ${resolvedPath}`);
  }
  try {
    fs.accessSync(resolvedPath, fs.constants.X_OK);
  } catch {
    throw new CliError('not_executable', `QEMU is not executable: ${resolvedPath}`);
  }
  const result = spawnSync(resolvedPath, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new CliError('inspect_failed', result.stderr || result.stdout || 'Failed to inspect QEMU executable');
  }
  const versionLine = (result.stdout || '').trim().split(/\r?\n/)[0] || null;
  return {
    command: 'inspect',
    status: 'success',
    exit_code: 0,
    summary: 'inspected local QEMU executable',
    details: {
      executable: {
        path: resolvedPath,
        version: versionLine,
      },
      artifact: {
        path: 'qemu-system-aarch64',
        location: resolvedPath,
      },
    },
  };
}

function detectParallelism() {
  return Math.max(
    1,
    typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : ((os.cpus() || []).length || 1),
  );
}

function requirePathFlag(flags: Record<string, unknown>, name: string) {
  const value = String(flags[name] || '');
  if (!value) {
    throw new CliError('missing_flag', `Missing required flag: --${name}`);
  }
  return path.resolve(process.cwd(), value);
}

function optionalPathFlag(flags: Record<string, unknown>, name: string) {
  const value = String(flags[name] || '');
  if (!value) {
    return null;
  }
  return path.resolve(process.cwd(), value);
}

function optionalStringFlag(flags: Record<string, unknown>, name: string) {
  const value = String(flags[name] || '').trim();
  return value || null;
}

function buildVersionFlag(flags: Record<string, unknown>) {
  return optionalStringFlag(flags, 'build-version') || optionalStringFlag(flags, 'qemu-version');
}

function runCommand(command: string, args: string[], cwd?: string) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function runCommandStreaming(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    onStdoutChunk?: (chunk: string) => void;
    onStderrChunk?: (chunk: string) => void;
  } = {},
) {
  return await new Promise<{ status: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      options.onStdoutChunk?.(chunk);
    });

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
      options.onStderrChunk?.(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        status: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function removeDirectory(targetPath: string) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureSourceTree(source: string) {
  const configureScript = path.join(source, 'configure');
  if (!fs.existsSync(configureScript)) {
    throw new CliError('missing_configure', `Missing QEMU configure script: ${configureScript}`);
  }
  return configureScript;
}

function stageSourceTree(source: string, stageDir: string) {
  if (!fs.existsSync(source)) {
    throw new CliError('missing_source', `Missing QEMU source tree: ${source}`);
  }
  const configurePath = path.join(source, 'configure');
  const versionPath = path.join(source, 'VERSION');
  const stampPath = path.join(stageDir, '.morpheus-source-state.json');
  const nextState = JSON.stringify({
    source,
    sourceMtimeMs: fs.statSync(source).mtimeMs,
    configureMtimeMs: fs.existsSync(configurePath) ? fs.statSync(configurePath).mtimeMs : null,
    versionMtimeMs: fs.existsSync(versionPath) ? fs.statSync(versionPath).mtimeMs : null,
  });
  const currentState = fs.existsSync(stampPath)
    ? fs.readFileSync(stampPath, 'utf8')
    : null;

  if (currentState !== nextState || !fs.existsSync(path.join(stageDir, 'configure'))) {
    removeDirectory(stageDir);
    fs.mkdirSync(path.dirname(stageDir), { recursive: true });
    fs.cpSync(source, stageDir, { recursive: true });
    fs.writeFileSync(stampPath, nextState, 'utf8');
    return { path: stageDir, refreshed: true };
  }

  return { path: stageDir, refreshed: false };
}

function toolRootFromSource(source: string) {
  return path.resolve(path.dirname(source), '..');
}

function resolveOptionalPath(flags: Record<string, unknown>, name: string) {
  const value = String(flags[name] || '').trim();
  if (!value) {
    return null;
  }
  return path.resolve(process.cwd(), value);
}

function resolveDownloadsDir(flags: Record<string, unknown>, source: string) {
  const explicit = resolveOptionalPath(flags, 'downloads-dir');
  if (explicit) {
    return explicit;
  }
  return path.join(toolRootFromSource(source), 'downloads');
}

function archiveNameForVersion(version: string) {
  return `qemu-${version}.tar.xz`;
}

function defaultArchiveUrl(version: string) {
  return `https://download.qemu.org/${archiveNameForVersion(version)}`;
}

async function fetchFile(sourceUrl: string, destination: string) {
  if (sourceUrl.startsWith('file://')) {
    fs.copyFileSync(fileURLToPath(sourceUrl), destination);
    return;
  }

  const transport = sourceUrl.startsWith('https://') ? https : http;
  await new Promise<void>((resolve, reject) => {
    const request = transport.get(sourceUrl, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fetchFile(new URL(response.headers.location, sourceUrl).toString(), destination)
          .then(resolve)
          .catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new CliError('download_failed', `Failed to download ${sourceUrl}: HTTP ${response.statusCode || 'unknown'}`));
        return;
      }
      const file = fs.createWriteStream(destination);
      pipeline(response, file).then(resolve).catch(reject);
    });
    request.on('error', reject);
  });
}

function extractArchive(archivePath: string, destination: string) {
  fs.mkdirSync(destination, { recursive: true });
  const extracted = runCommand('tar', ['-xJf', archivePath, '-C', destination], undefined);
  if (extracted.status !== 0) {
    throw new CliError('extract_failed', extracted.stderr || extracted.stdout || `Failed to extract ${archivePath}`);
  }
}

function listPatchFiles(patchDir: string) {
  const results: string[] = [];
  const stack: string[] = [patchDir];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (entry.isFile() && (entry.name.endsWith('.patch') || entry.name.endsWith('.diff'))) {
        results.push(nextPath);
      }
    }
  }

  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function patchFingerprint(patchDir: string, patchFiles: string[]) {
  const hash = crypto.createHash('sha256');
  for (const filePath of patchFiles) {
    hash.update(path.relative(patchDir, filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function patchStatePath(source: string) {
  return path.join(source, '.morpheus-patches.json');
}

function readPatchState(source: string) {
  const statePath = patchStatePath(source);
  if (!fs.existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function writePatchState(source: string, state: unknown) {
  fs.writeFileSync(patchStatePath(source), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function applyPatches(source: string, patchDir: string, patchFiles: string[], logFile: string) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '', 'utf8');

  for (const patchFile of patchFiles) {
    fs.appendFileSync(logFile, `>>> ${path.relative(patchDir, patchFile)}\n`, 'utf8');
    const result = runCommand('patch', ['-d', source, '-p1', '-N', '-i', patchFile], undefined);
    fs.appendFileSync(logFile, result.stdout || '', 'utf8');
    fs.appendFileSync(logFile, result.stderr || '', 'utf8');
    if (result.status !== 0) {
      const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
      if (
        combined.includes('Reversed (or previously applied) patch detected!') &&
        !combined.includes('FAILED')
      ) {
        fs.appendFileSync(logFile, 'already applied; skipping\n', 'utf8');
        continue;
      }
      throw new CliError('patch_failed', `Failed to apply patch ${path.relative(patchDir, patchFile)} (see ${logFile})`);
    }
  }
}

async function ensureFetchedSourceTree(
  source: string,
  qemuVersion: string | null,
  archiveUrl: string | null,
  downloadsDir: string,
) {
  if (fs.existsSync(path.join(source, 'configure'))) {
    return {
      source,
      fetched: false,
      archive: null,
      archive_url: archiveUrl,
    };
  }

  if (!qemuVersion && !archiveUrl) {
    throw new CliError('missing_source', `Missing QEMU source tree: ${source}`);
  }

  const archiveUrlValue = archiveUrl || defaultArchiveUrl(qemuVersion as string);
  const archiveName = qemuVersion
    ? archiveNameForVersion(qemuVersion)
    : path.basename(new URL(archiveUrlValue).pathname);
  const archivePath = path.join(downloadsDir, archiveName);
  const extractRoot = path.join(downloadsDir, '.extract');

  fs.mkdirSync(downloadsDir, { recursive: true });
  if (!fs.existsSync(archivePath)) {
    await fetchFile(archiveUrlValue, archivePath);
  }

  removeDirectory(extractRoot);
  extractArchive(archivePath, extractRoot);

  const entries = fs.readdirSync(extractRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());
  if (entries.length !== 1) {
    throw new CliError('extract_failed', `Expected one extracted source directory in ${extractRoot}`);
  }

  removeDirectory(source);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.renameSync(path.join(extractRoot, entries[0].name), source);
  removeDirectory(extractRoot);
  ensureSourceTree(source);
  appendToolLog(source, `fetch archive=${archivePath} version=${qemuVersion || ''}`);

  return {
    source,
    fetched: true,
    archive: archivePath,
    archive_url: archiveUrlValue,
  };
}

function appendLog(logFile: string, result: { stdout?: string; stderr?: string }) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, result.stdout || '', 'utf8');
  fs.appendFileSync(logFile, result.stderr || '', 'utf8');
}

function writeRunManifest(runDir: string, value: unknown) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'manifest.json'), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function toolLogPath(source: string) {
  return path.join(source, '.morpheus-tool.log');
}

function appendToolLog(source: string, message: string) {
  const logFile = toolLogPath(source);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${message}\n`, 'utf8');
}

function createBuildLogStreamer(command: string, jsonMode: boolean, logFile: string) {
  const writeChunk = (stream: 'stdout' | 'stderr', chunk: string) => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, chunk, 'utf8');

    if (jsonMode) {
      emitJsonEvent('build', 'log', { command, stream, chunk });
      return;
    }

    if (stream === 'stdout') {
      process.stdout.write(chunk);
    } else {
      process.stderr.write(chunk);
    }
  };

  return {
    writeStdout(chunk: string) {
      writeChunk('stdout', chunk);
    },
    writeStderr(chunk: string) {
      writeChunk('stderr', chunk);
    },
    flush() {},
  };
}

async function buildQemu(flags: Record<string, unknown>, jsonMode: boolean) {
  const source = requirePathFlag(flags, 'source');
  const buildDir = requirePathFlag(flags, 'build-dir');
  const installDir = requirePathFlag(flags, 'install-dir');
  const qemuVersion = buildVersionFlag(flags);
  const archiveUrl = optionalStringFlag(flags, 'archive-url');
  const downloadsDir = resolveDownloadsDir(flags, source);

  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  const logFile = path.join(buildDir, 'build.log');
  const buildStatePath = path.join(buildDir, '.morpheus-build-state.json');
  const targetList = Array.isArray(flags['target-list']) ? flags['target-list'] as string[] : [];
  const configureArgs = Array.isArray(flags['configure-arg']) ? flags['configure-arg'] as string[] : [];
  const sourceState = await ensureFetchedSourceTree(source, qemuVersion, archiveUrl, downloadsDir);
  appendToolLog(source, `build build_dir=${buildDir} install_dir=${installDir}`);
  const stagedSourceState = stageSourceTree(source, path.join(path.dirname(buildDir), 'source'));
  const nextBuildState = JSON.stringify({
    source,
    qemuVersion,
    targetList,
    configureArgs,
  });
  const currentBuildState = fs.existsSync(buildStatePath)
    ? fs.readFileSync(buildStatePath, 'utf8')
    : null;
  if (stagedSourceState.refreshed || currentBuildState !== nextBuildState) {
    removeDirectory(buildDir);
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(buildStatePath, nextBuildState, 'utf8');
  }
  const configureScript = ensureSourceTree(stagedSourceState.path);
  const configureStream = createBuildLogStreamer('configure', jsonMode, logFile);

  const configure = await runCommandStreaming(
    configureScript,
    [
      `--prefix=${installDir}`,
      ...(targetList.length > 0 ? [`--target-list=${targetList.join(',')}`] : []),
      ...configureArgs,
    ],
    {
      cwd: buildDir,
      onStdoutChunk: (chunk) => configureStream.writeStdout(chunk),
      onStderrChunk: (chunk) => configureStream.writeStderr(chunk),
    },
  );
  configureStream.flush();
  if (configure.status !== 0) {
    throw new CliError('configure_failed', configure.stderr || configure.stdout || 'QEMU configure failed');
  }

  const makeStream = createBuildLogStreamer('make', jsonMode, logFile);
  const make = await runCommandStreaming('make', [`-j${detectParallelism()}`], {
    cwd: buildDir,
    onStdoutChunk: (chunk) => makeStream.writeStdout(chunk),
    onStderrChunk: (chunk) => makeStream.writeStderr(chunk),
  });
  makeStream.flush();
  if (make.status !== 0) {
    throw new CliError('build_failed', make.stderr || make.stdout || 'QEMU build failed');
  }

  const installStream = createBuildLogStreamer('install', jsonMode, logFile);
  const install = await runCommandStreaming('make', ['install'], {
    cwd: buildDir,
    onStdoutChunk: (chunk) => installStream.writeStdout(chunk),
    onStderrChunk: (chunk) => installStream.writeStderr(chunk),
  });
  installStream.flush();
  if (install.status !== 0) {
    throw new CliError('install_failed', install.stderr || install.stdout || 'QEMU install failed');
  }

  const executable = path.join(installDir, 'bin', 'qemu-system-aarch64');
  const inspected = inspectExecutable({ path: executable });
  return {
    command: 'build',
    status: 'success',
    exit_code: 0,
    summary: 'built local QEMU executable',
    details: {
      source,
      fetched_source: sourceState.fetched,
      archive: sourceState.archive,
      archive_url: sourceState.archive_url,
      qemu_version: qemuVersion,
      staged_source: stagedSourceState.path,
      build_dir: buildDir,
      install_dir: installDir,
      log_file: logFile,
      executable: inspected.details.executable,
      artifact: inspected.details.artifact,
      target_list: targetList,
      configure_args: configureArgs,
    },
  };
}

async function fetchQemu(flags: Record<string, unknown>) {
  const source = requirePathFlag(flags, 'source');
  const qemuVersion = buildVersionFlag(flags);
  const archiveUrl = optionalStringFlag(flags, 'archive-url');
  const downloadsDir = resolveDownloadsDir(flags, source);
  const sourceState = await ensureFetchedSourceTree(source, qemuVersion, archiveUrl, downloadsDir);
  return {
    command: 'fetch',
    status: 'success',
    exit_code: 0,
    summary: sourceState.fetched ? 'fetched managed QEMU source tree' : 'reused managed QEMU source tree',
    details: {
      source,
      fetched_source: sourceState.fetched,
      downloads_dir: downloadsDir,
      archive: sourceState.archive,
      archive_url: sourceState.archive_url,
      build_version: qemuVersion,
    },
  };
}

async function patchQemu(flags: Record<string, unknown>) {
  const source = requirePathFlag(flags, 'source');
  const patchDir = requirePathFlag(flags, 'patch-dir');
  if (!fs.existsSync(source)) {
    throw new CliError('missing_source', `Missing QEMU source tree: ${source}`);
  }
  if (!fs.existsSync(patchDir)) {
    throw new CliError('missing_patch_dir', `Missing patch directory: ${patchDir}`);
  }
  const patchFiles = listPatchFiles(patchDir);
  const fingerprint = patchFingerprint(patchDir, patchFiles);
  const patchLogFile = path.join(source, '.morpheus-patches.log');
  const state = readPatchState(source);
  if (state && state.fingerprint === fingerprint) {
    return {
      command: 'patch',
      status: 'success',
      exit_code: 0,
      summary: 'reused patched managed QEMU source tree',
      details: {
        source,
        patches: {
          dir: patchDir,
          files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
          fingerprint,
          applied: true,
          log_file: patchLogFile,
        },
      },
    };
  }
  applyPatches(source, patchDir, patchFiles, patchLogFile);
  appendToolLog(source, `patch patch_dir=${patchDir} patch_log=${patchLogFile}`);
  writePatchState(source, {
    appliedAt: new Date().toISOString(),
    dir: patchDir,
    files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
    fingerprint,
  });
  return {
    command: 'patch',
    status: 'success',
    exit_code: 0,
    summary: 'patched managed QEMU source tree',
    details: {
      source,
      patches: {
        dir: patchDir,
        files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
        fingerprint,
        applied: true,
        log_file: patchLogFile,
      },
    },
  };
}

function qemuRunArgs(
  kernel: string,
  initrd: string,
  append: string,
  qemuArgs: string[],
) {
  return [
    '-machine',
    'virt,virtualization=on,gic-version=3',
    '-cpu',
    'cortex-a57',
    '-m',
    '1024',
    '-nographic',
    '-kernel',
    kernel,
    '-initrd',
    initrd,
    '-append',
    append,
    ...qemuArgs,
  ];
}

async function runQemu(flags: Record<string, unknown>, jsonMode: boolean) {
  if (jsonMode && !flags.detach) {
    throw new CliError('incompatible_flags', 'qemu run --json requires --detach');
  }

  const inspected = inspectExecutable(flags);
  const kernel = requirePathFlag(flags, 'kernel');
  const initrd = requirePathFlag(flags, 'initrd');
  const runDir = optionalPathFlag(flags, 'run-dir') || path.resolve(process.cwd(), '.qemu-run');
  const append = optionalStringFlag(flags, 'append') || 'console=ttyAMA0';
  const qemuArgs = Array.isArray(flags['qemu-arg']) ? flags['qemu-arg'] as string[] : [];
  const detached = Boolean(flags.detach);
  const logFile = path.join(runDir, 'stdout.log');
  const args = qemuRunArgs(kernel, initrd, append, qemuArgs);

  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(logFile, '', 'utf8');

  if (!detached) {
    const child = spawn(inspected.details.executable.path, args, {
      cwd: runDir,
      stdio: 'inherit',
    });
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 1));
    });
    const status = exitCode === 0 ? 'success' : 'error';
    const manifest = {
      schemaVersion: 1,
      tool: 'qemu',
      command: 'run',
      status,
      executable: inspected.details.executable.path,
      kernel,
      initrd,
      append,
      qemu_args: qemuArgs,
      run_dir: runDir,
      log_file: logFile,
      pid: null,
      detached: false,
      exitCode,
    };
    writeRunManifest(runDir, manifest);
    return {
      command: 'run',
      status,
      exit_code: exitCode,
      summary: status === 'success' ? 'completed local QEMU run' : 'local QEMU run failed',
      details: {
        manifest,
        run_dir: runDir,
        log_file: logFile,
      },
    };
  }

  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(inspected.details.executable.path, args, {
    cwd: runDir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  const manifest = {
    schemaVersion: 1,
    tool: 'qemu',
    command: 'run',
    status: 'running',
    executable: inspected.details.executable.path,
    kernel,
    initrd,
    append,
    qemu_args: qemuArgs,
    run_dir: runDir,
    log_file: logFile,
    pid: child.pid || null,
    detached: true,
    exitCode: 0,
  };
  writeRunManifest(runDir, manifest);
  return {
    command: 'run',
    status: 'success',
    exit_code: 0,
    summary: 'started local QEMU run',
    details: {
      manifest,
      run_dir: runDir,
      log_file: logFile,
    },
  };
}

function readLogs(flags: Record<string, unknown>) {
  const buildDir = resolveOptionalPath(flags, 'build-dir');
  const runDir = resolveOptionalPath(flags, 'run-dir');
  const source = resolveOptionalPath(flags, 'source');
  const logFile = buildDir
    ? path.join(buildDir, 'build.log')
    : runDir
      ? path.join(runDir, 'stdout.log')
      : source
        ? (fs.existsSync(toolLogPath(source)) ? toolLogPath(source) : path.join(source, '.morpheus-patches.log'))
        : null;
  if (!logFile) {
    throw new CliError('missing_flag', 'qemu logs requires --build-dir DIR, --run-dir DIR, or --source DIR');
  }
  if (!fs.existsSync(logFile)) {
    throw new CliError('missing_log', `Missing QEMU log file: ${logFile}`);
  }
  return {
    command: 'logs',
    status: 'success',
    exit_code: 0,
    summary: 'read local QEMU log',
    details: {
      log_file: logFile,
      text: fs.readFileSync(logFile, 'utf8'),
    },
  };
}

async function main(argv: string[]) {
  const parsed = parseArgv(argv);
  if (parsed.help) {
    const topic = parsed.command === 'help' ? parsed.topic : parsed.command || undefined;
    if (parsed.json) {
      emitJson(helpJson(topic));
    } else {
      emitText(renderHelp(topic));
    }
    return 0;
  }

  switch (parsed.command) {
    case 'version':
      if (parsed.json) {
        emitJson({ command: 'version', status: 'success', exit_code: 0, summary: 'qemu CLI version', details: { version: VERSION } });
      } else {
        emitText(VERSION);
      }
      return 0;
    case 'inspect': {
      const result = inspectExecutable(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.executable.path);
      }
      return 0;
    }
    case 'build': {
      const result = await buildQemu(parsed.flags, parsed.json);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.executable.path);
      }
      return 0;
    }
    case 'fetch': {
      const result = await fetchQemu(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.source);
      }
      return 0;
    }
    case 'patch': {
      const result = await patchQemu(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.source);
      }
      return 0;
    }
    case 'run': {
      const result = await runQemu(parsed.flags, parsed.json);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.summary);
      }
      return 0;
    }
    case 'logs': {
      const result = readLogs(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.text);
      }
      return 0;
    }
    default:
      throw new CliError('unknown_command', `Unknown command: ${String(parsed.command)}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const cliError = error instanceof CliError
    ? error
    : new CliError('unexpected_error', error instanceof Error ? error.message : 'Unexpected error');
  if (process.argv.includes('--json')) {
    emitJson({
      command: process.argv[2] ?? 'help',
      status: 'error',
      exit_code: cliError.exitCode,
      summary: cliError.message,
      error: {
        code: cliError.code,
        message: cliError.message,
      },
    });
  } else {
    process.stderr.write(`${cliError.code}: ${cliError.message}\n`);
  }
  process.exitCode = cliError.exitCode;
});
