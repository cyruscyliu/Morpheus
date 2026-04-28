#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
  // Use a synchronous write so spawned/pipe consumers (tests, Morpheus) never
  // miss short-lived JSON output.
  fs.writeSync(1, `${JSON.stringify(value)}\n`);
}

function emitText(value: string) {
  fs.writeSync(1, `${value}\n`);
}

function parseArgv(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, unknown> = {};
  const booleanFlags = new Set(['json', 'help']);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
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
    summary: topic ? `help for ${topic}` : 'sel4 CLI help',
    details: command
      ? { command }
      : { commands: COMMANDS, global_flags: ['--json', '--help'] },
  };
}

function requirePathFlag(flags: Record<string, unknown>, name: string) {
  const value = String(flags[name] || '');
  if (!value) {
    throw new CliError('missing_flag', `Missing required flag: --${name}`);
  }
  return path.resolve(process.cwd(), value);
}

function optionalStringFlag(flags: Record<string, unknown>, name: string) {
  const value = String(flags[name] || '').trim();
  return value || null;
}

function buildVersionFlag(flags: Record<string, unknown>) {
  return optionalStringFlag(flags, 'build-version') || optionalStringFlag(flags, 'sel4-version');
}

function fileExists(filePath: string | null | undefined) {
  return Boolean(filePath && fs.existsSync(filePath));
}

function firstVersionLine(dirPath: string) {
  const candidates = ['VERSION', 'version.txt', '.morpheus-version'];
  for (const name of candidates) {
    const candidate = path.join(dirPath, name);
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8').trim().split(/\r?\n/)[0] || null;
    }
  }
  return null;
}

function gitVersion(dirPath: string) {
  if (!fs.existsSync(path.join(dirPath, '.git'))) {
    return null;
  }
  const result = spawnSync('git', ['-C', dirPath, 'describe', '--tags', '--exact-match'], {
    encoding: 'utf8',
  });
  if (result.status === 0) {
    return result.stdout.trim() || null;
  }
  return null;
}

function detectVersion(dirPath: string) {
  return firstVersionLine(dirPath) || gitVersion(dirPath);
}

function inspectDirectory(flags: Record<string, unknown>) {
  const inputPath = String(flags.path || '');
  if (!inputPath) {
    throw new CliError('missing_flag', 'Missing required flag: --path');
  }
  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fileExists(resolvedPath)) {
    throw new CliError('missing_directory', `Missing seL4 source directory: ${resolvedPath}`);
  }
  if (!fs.statSync(resolvedPath).isDirectory()) {
    throw new CliError('invalid_directory', `seL4 source is not a directory: ${resolvedPath}`);
  }
  return {
    command: 'inspect',
    status: 'success',
    exit_code: 0,
    summary: 'inspected local seL4 source directory',
    details: {
      directory: {
        path: resolvedPath,
        version: detectVersion(resolvedPath),
      },
      artifact: {
        path: 'source-dir',
        location: resolvedPath,
      },
    },
  };
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
  const extracted = runCommand('tar', ['-xf', archivePath, '-C', destination], undefined);
  if (extracted.status !== 0) {
    throw new CliError('extract_failed', extracted.stderr || extracted.stdout || `Failed to extract ${archivePath}`);
  }
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

function toolLogPath(source: string) {
  return path.join(source, '.morpheus-tool.log');
}

function buildLogPath(source: string) {
  return path.join(source, '.morpheus-build.log');
}

function appendToolLog(source: string, message: string) {
  const logFile = toolLogPath(source);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${message}\n`, 'utf8');
}

function writeBuildLog(source: string, ...messages: string[]) {
  const logFile = buildLogPath(source);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(
    logFile,
    messages.filter(Boolean).map((item) => item.endsWith('\n') ? item : `${item}\n`).join(''),
    'utf8',
  );
  return logFile;
}

function applyPatches(source: string, patchDir: string, patchFiles: string[], logFile: string) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '', 'utf8');

  const isGit = fs.existsSync(path.join(source, '.git'));

  for (const patchFile of patchFiles) {
    fs.appendFileSync(logFile, `>>> ${path.relative(patchDir, patchFile)}\n`, 'utf8');
    let result;

    if (isGit) {
      const check = runCommand('git', ['-C', source, 'apply', '--check', patchFile], undefined);
      fs.appendFileSync(logFile, check.stdout || '', 'utf8');
      fs.appendFileSync(logFile, check.stderr || '', 'utf8');

      if (check.status === 0) {
        result = runCommand('git', ['-C', source, 'apply', patchFile], undefined);
      } else {
        const reverseCheck = runCommand('git', ['-C', source, 'apply', '--reverse', '--check', patchFile], undefined);
        fs.appendFileSync(logFile, reverseCheck.stdout || '', 'utf8');
        fs.appendFileSync(logFile, reverseCheck.stderr || '', 'utf8');
        if (reverseCheck.status === 0) {
          fs.appendFileSync(logFile, 'already applied; skipping\n', 'utf8');
          continue;
        }
        throw new CliError(
          'patch_failed',
          `Failed to apply patch ${path.relative(patchDir, patchFile)} (see ${logFile})`
        );
      }
    } else {
      result = runCommand('patch', ['-d', source, '-p1', '-N', '-i', patchFile], undefined);
    }

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
      throw new CliError(
        'patch_failed',
        `Failed to apply patch ${path.relative(patchDir, patchFile)} (see ${logFile})`
      );
    }
  }
}

async function buildDirectory(flags: Record<string, unknown>) {
  if (typeof flags['git-url'] === 'string' || typeof flags['git-ref'] === 'string') {
    throw new CliError('unsupported_flag', 'sel4 build no longer supports --git-url/--git-ref; use --archive-url or provide an existing --source directory');
  }
  const source = requirePathFlag(flags, 'source');
  const sel4Version = buildVersionFlag(flags);
  const archiveUrl = optionalStringFlag(flags, 'archive-url');
  const patchDir = resolveOptionalPath(flags, 'patch-dir');
  const patchFiles = patchDir ? listPatchFiles(patchDir) : [];
  const fingerprint = patchDir ? patchFingerprint(patchDir, patchFiles) : null;
  const patchLogFile = patchDir ? path.join(source, '.morpheus-patches.log') : null;

  if (patchDir && !fileExists(patchDir)) {
    throw new CliError('missing_directory', `Missing patch directory: ${patchDir}`);
  }

  if (fileExists(source)) {
    if (patchDir) {
      const state = readPatchState(source);
      if (state && state.fingerprint === fingerprint) {
        const inspected = inspectDirectory({ path: source });
        const logFile = writeBuildLog(
          source,
          'reused managed seL4 source directory',
          `source=${source}`,
          `version=${sel4Version || inspected.details.directory.version || ''}`,
          `patch_dir=${patchDir}`,
          `patches_applied=true`,
        );
        return {
          command: 'build',
          status: 'success',
          exit_code: 0,
          summary: 'reused managed seL4 source directory',
          details: {
            source,
            fetched_source: false,
            archive: null,
            archive_url: archiveUrl,
            sel4_version: sel4Version || inspected.details.directory.version,
            directory: inspected.details.directory,
            artifact: inspected.details.artifact,
            log_file: logFile,
            patches: {
              dir: patchDir,
              files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
              fingerprint,
              applied: true,
              log_file: patchLogFile,
            }
          },
        };
      }
      applyPatches(source, patchDir, patchFiles, patchLogFile as string);
      writePatchState(source, {
        appliedAt: new Date().toISOString(),
        dir: patchDir,
        files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
        fingerprint,
      });
      const inspected = inspectDirectory({ path: source });
      appendToolLog(source, 'build reused existing source directory');
      const logFile = writeBuildLog(
        source,
        'reused managed seL4 source directory',
        `source=${source}`,
        `version=${sel4Version || inspected.details.directory.version || ''}`,
        `patch_dir=${patchDir}`,
        `patches_applied=true`,
      );
      return {
        command: 'build',
        status: 'success',
        exit_code: 0,
        summary: 'reused managed seL4 source directory',
        details: {
          source,
          fetched_source: false,
          archive: null,
          archive_url: archiveUrl,
          sel4_version: sel4Version || inspected.details.directory.version,
          directory: inspected.details.directory,
          artifact: inspected.details.artifact,
          log_file: logFile,
          patches: {
            dir: patchDir,
            files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
            fingerprint,
            applied: true,
            log_file: patchLogFile,
          }
        },
      };
    }
    const inspected = inspectDirectory({ path: source });
    const logFile = writeBuildLog(
      source,
      'reused managed seL4 source directory',
      `source=${source}`,
      `version=${sel4Version || inspected.details.directory.version || ''}`,
    );
    return {
      command: 'build',
      status: 'success',
      exit_code: 0,
      summary: 'reused managed seL4 source directory',
      details: {
        source,
        fetched_source: false,
        archive: null,
        archive_url: archiveUrl,
        sel4_version: sel4Version || inspected.details.directory.version,
        directory: inspected.details.directory,
        artifact: inspected.details.artifact,
        log_file: logFile,
        patches: patchDir
          ? {
            dir: patchDir,
            files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
            fingerprint,
            applied: false,
            log_file: patchLogFile,
          }
          : null,
      },
    };
  }

  if (!archiveUrl) {
    throw new CliError('missing_source', `Missing seL4 source directory: ${source}`);
  }

  const downloadsDir = resolveDownloadsDir(flags, source);
  const archiveName = path.basename(new URL(archiveUrl as string).pathname);
  const archivePath = path.join(downloadsDir, archiveName);
  const extractRoot = path.join(downloadsDir, '.extract');

  fs.mkdirSync(downloadsDir, { recursive: true });
  if (!fs.existsSync(archivePath)) {
    await fetchFile(archiveUrl as string, archivePath);
  }

  removeDirectory(extractRoot);
  extractArchive(archivePath, extractRoot);
  const entries = fs.readdirSync(extractRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (entries.length !== 1) {
    throw new CliError('extract_failed', `Expected one extracted source directory in ${extractRoot}`);
  }

  removeDirectory(source);
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.renameSync(path.join(extractRoot, entries[0].name), source);
  removeDirectory(extractRoot);

  let patchesApplied = false;
  if (patchDir && patchLogFile) {
    applyPatches(source, patchDir, patchFiles, patchLogFile);
    writePatchState(source, {
      appliedAt: new Date().toISOString(),
      dir: patchDir,
      files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
      fingerprint,
    });
    patchesApplied = true;
  }

  if (sel4Version && !firstVersionLine(source)) {
    fs.writeFileSync(path.join(source, '.morpheus-version'), `${sel4Version}\n`, 'utf8');
  }
  appendToolLog(source, `build archive=${archivePath}`);
  const inspected = inspectDirectory({ path: source });
  const logFile = writeBuildLog(
    source,
    'built managed seL4 source directory',
    `source=${source}`,
    `archive=${archivePath}`,
    `archive_url=${archiveUrl || ''}`,
    `version=${sel4Version || inspected.details.directory.version || ''}`,
    ...(patchDir ? [`patch_dir=${patchDir}`, `patches_applied=${String(patchesApplied)}`] : []),
  );

  return {
    command: 'build',
    status: 'success',
    exit_code: 0,
    summary: 'built managed seL4 source directory',
    details: {
      source,
      fetched_source: true,
      downloads_dir: downloadsDir,
      archive: archiveUrl ? archivePath : null,
      archive_url: archiveUrl,
      sel4_version: sel4Version || inspected.details.directory.version,
      directory: inspected.details.directory,
      artifact: inspected.details.artifact,
      log_file: logFile,
      patches: patchDir
        ? {
          dir: patchDir,
          files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
          fingerprint,
          applied: patchesApplied,
          log_file: patchLogFile,
        }
        : null,
    },
  };
}

async function fetchDirectory(flags: Record<string, unknown>) {
  const nextFlags = { ...flags };
  delete nextFlags['patch-dir'];
  const result = await buildDirectory(nextFlags);
  return {
    ...result,
    command: 'fetch',
    summary: result.details.fetched_source
      ? 'fetched managed seL4 source directory'
      : 'reused managed seL4 source directory',
  };
}

async function patchDirectory(flags: Record<string, unknown>) {
  const source = requirePathFlag(flags, 'source');
  const patchDir = requirePathFlag(flags, 'patch-dir');
  if (!fileExists(source)) {
    throw new CliError('missing_source', `Missing seL4 source directory: ${source}`);
  }
  if (!fileExists(patchDir)) {
    throw new CliError('missing_directory', `Missing patch directory: ${patchDir}`);
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
      summary: 'reused patched managed seL4 source directory',
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
    summary: 'patched managed seL4 source directory',
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

function readLogs(flags: Record<string, unknown>) {
  const source = resolveOptionalPath(flags, 'source') || resolveOptionalPath(flags, 'path');
  if (!source) {
    throw new CliError('missing_flag', 'sel4 logs requires --source DIR or --path DIR');
  }
  const logFile = [
    buildLogPath(source),
    toolLogPath(source),
    path.join(source, '.morpheus-patches.log'),
  ].find((filePath) => fs.existsSync(filePath));
  if (!logFile || !fs.existsSync(logFile)) {
    throw new CliError('missing_log', `Missing seL4 log file for: ${source}`);
  }
  return {
    command: 'logs',
    status: 'success',
    exit_code: 0,
    summary: 'read local seL4 log',
    details: {
      log_file: logFile,
      text: fs.readFileSync(logFile, 'utf8'),
    },
  };
}

async function main(argv: string[]) {
  const parsed = parseArgv(argv);
  if (parsed.help) {
    const topic = parsed.command === 'help' ? (parsed.topic || undefined) : (parsed.command || undefined);
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
        emitJson({ command: 'version', status: 'success', exit_code: 0, summary: 'sel4 CLI version', details: { version: VERSION } });
      } else {
        emitText(VERSION);
      }
      return 0;
    case 'inspect': {
      const result = inspectDirectory(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.directory.path);
      }
      return 0;
    }
    case 'build': {
      const result = await buildDirectory(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.directory.path);
      }
      return 0;
    }
    case 'fetch': {
      const result = await fetchDirectory(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.directory.path);
      }
      return 0;
    }
    case 'patch': {
      const result = await patchDirectory(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.source);
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
