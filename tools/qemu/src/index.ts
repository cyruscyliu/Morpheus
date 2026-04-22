#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { COMMANDS, getHelp, renderHelp } from './help.js';

const VERSION = '0.1.0';

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

function parseArgv(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, unknown> = {};
  const booleanFlags = new Set(['json', 'help']);
  const repeatableFlags = new Set(['target-list', 'configure-arg']);

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

function runCommand(command: string, args: string[], cwd?: string) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
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

async function ensureFetchedSourceTree(
  source: string,
  qemuVersion: string | null,
  archiveUrl: string | null,
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

  const toolRoot = toolRootFromSource(source);
  const downloadsDir = path.join(toolRoot, 'downloads');
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

async function buildQemu(flags: Record<string, unknown>) {
  const source = requirePathFlag(flags, 'source');
  const buildDir = requirePathFlag(flags, 'build-dir');
  const installDir = requirePathFlag(flags, 'install-dir');
  const qemuVersion = optionalStringFlag(flags, 'qemu-version');
  const archiveUrl = optionalStringFlag(flags, 'archive-url');

  fs.mkdirSync(buildDir, { recursive: true });
  fs.mkdirSync(installDir, { recursive: true });
  const logFile = path.join(buildDir, 'build.log');
  const buildStatePath = path.join(buildDir, '.morpheus-build-state.json');
  const targetList = Array.isArray(flags['target-list']) ? flags['target-list'] as string[] : [];
  const configureArgs = Array.isArray(flags['configure-arg']) ? flags['configure-arg'] as string[] : [];
  const sourceState = await ensureFetchedSourceTree(source, qemuVersion, archiveUrl);
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

  const configure = runCommand(
    configureScript,
    [
      `--prefix=${installDir}`,
      ...(targetList.length > 0 ? [`--target-list=${targetList.join(',')}`] : []),
      ...configureArgs,
    ],
    buildDir,
  );
  appendLog(logFile, configure);
  if (configure.status !== 0) {
    throw new CliError('configure_failed', configure.stderr || configure.stdout || 'QEMU configure failed');
  }

  const make = runCommand('make', [`-j${detectParallelism()}`], buildDir);
  appendLog(logFile, make);
  if (make.status !== 0) {
    throw new CliError('build_failed', make.stderr || make.stdout || 'QEMU build failed');
  }

  const install = runCommand('make', ['install'], buildDir);
  appendLog(logFile, install);
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
      const result = await buildQemu(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.executable.path);
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
