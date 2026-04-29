#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { COMMANDS, getHelp, renderHelp } from './help.js';

const VERSION = '0.3.0';

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

function formatFields(fields?: Record<string, unknown> | null) {
  if (!fields || Object.keys(fields).length === 0) {
    return '';
  }
  return ` ${JSON.stringify(fields)}`;
}

function relPath(value: string | null | undefined) {
  if (!value) {
    return value;
  }
  if (!path.isAbsolute(value)) {
    return value;
  }
  return path.relative(process.cwd(), value) || value;
}

function logInfo(message: string, fields?: Record<string, unknown> | null) {
  fs.writeSync(2, `[libvmm] ${message}${formatFields(fields)}\n`);
}

function parseArgv(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, unknown> = {};
  const booleanFlags = new Set(['json', 'help', 'detach']);
  const repeatableFlags = new Set(['make-arg']);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (repeatableFlags.has(key)) {
      if (!next || next.startsWith('--')) {
        throw new CliError('missing_flag_value', `Missing value for --${key}`);
      }
      const existing = Array.isArray(flags[key]) ? (flags[key] as string[]) : [];
      flags[key] = [...existing, next];
      index += 1;
      continue;
    }
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
    summary: topic ? `help for ${topic}` : 'libvmm CLI help',
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
  return optionalStringFlag(flags, 'build-version') || optionalStringFlag(flags, 'git-ref');
}

function stringListFlag(flags: Record<string, unknown>, name: string) {
  const raw = flags[name];
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item));
  }
  return [String(raw)];
}

function fileExists(filePath: string | null | undefined) {
  return Boolean(filePath && fs.existsSync(filePath));
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

function appendToolLog(source: string, ...chunks: Array<string | null | undefined>) {
  const logFile = toolLogPath(source);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  for (const chunk of chunks) {
    if (chunk) {
      fs.appendFileSync(logFile, chunk.endsWith('\n') ? chunk : `${chunk}\n`, 'utf8');
    }
  }
}

function writeBuildLog(source: string, ...chunks: Array<string | null | undefined>) {
  const logFile = buildLogPath(source);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(
    logFile,
    chunks
      .filter((chunk): chunk is string => Boolean(chunk))
      .map((chunk) => chunk.endsWith('\n') ? chunk : `${chunk}\n`)
      .join(''),
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
        throw new CliError('patch_failed', `Failed to apply patch ${path.relative(patchDir, patchFile)} (see ${logFile})`);
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
      throw new CliError('patch_failed', `Failed to apply patch ${path.relative(patchDir, patchFile)} (see ${logFile})`);
    }
  }
}

function runCommand(
  command: string,
  args: string[],
  cwd?: string,
  options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv },
) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    cwd,
    env: options?.env,
    timeout: options?.timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
  };
}

function isSpawnTimeout(result: ReturnType<typeof spawnSync>) {
  const error = result.error as NodeJS.ErrnoException | null | undefined;
  return Boolean(error && (error.code === 'ETIMEDOUT' || error.code === 'ESRCH'));
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
  const result = runCommand('git', ['-C', dirPath, 'describe', '--tags', '--always', '--dirty'], undefined);
  if (result.status === 0) {
    return result.stdout.trim() || null;
  }
  return null;
}

function detectVersion(dirPath: string) {
  return firstVersionLine(dirPath) || gitVersion(dirPath);
}

function toolRootFromSource(sourceDir: string) {
  return path.resolve(sourceDir, '..', '..', '..');
}

function sha256String(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function ensurePythonVenv(toolRoot: string) {
  const venvDir = path.join(toolRoot, 'pyvenv');
  const python = path.join(venvDir, 'bin', 'python');
  const pip = path.join(venvDir, 'bin', 'pip');
  if (!fs.existsSync(python)) {
    fs.mkdirSync(venvDir, { recursive: true });
    const created = runCommand('python3', ['-m', 'venv', venvDir], undefined);
    if (created.status !== 0) {
      throw new CliError('venv_failed', created.stderr || created.stdout || `Failed to create venv at ${venvDir}`);
    }
  }
  if (!fs.existsSync(pip)) {
    const ensured = runCommand(python, ['-m', 'pip', '--version'], undefined);
    if (ensured.status !== 0) {
      throw new CliError('pip_missing', ensured.stderr || ensured.stdout || `Missing pip in venv at ${venvDir}`);
    }
  }
  return { venvDir, python };
}

function ensurePythonRequirements(python: string, requirementsPath: string, statePath: string) {
  if (!fs.existsSync(requirementsPath)) {
    return { installed: false, fingerprint: null };
  }
  const requirements = fs.readFileSync(requirementsPath, 'utf8');
  const fingerprint = sha256String(requirements);

  let currentFingerprint: string | null = null;
  if (fs.existsSync(statePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      currentFingerprint = typeof parsed?.fingerprint === 'string' ? parsed.fingerprint : null;
    } catch {
      currentFingerprint = null;
    }
  }

  if (currentFingerprint === fingerprint) {
    return { installed: true, fingerprint };
  }

  const pip = runCommand(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], undefined);
  if (pip.status !== 0) {
    throw new CliError('pip_failed', pip.stderr || pip.stdout || 'Failed to upgrade pip');
  }

  const install = runCommand(python, ['-m', 'pip', 'install', '-r', requirementsPath], undefined);
  if (install.status !== 0) {
    throw new CliError(
      'pip_failed',
      install.stderr || install.stdout || `Failed to install python deps from ${requirementsPath}`,
    );
  }

  fs.writeFileSync(statePath, `${JSON.stringify({ fingerprint, requirements: requirementsPath }, null, 2)}\n`, 'utf8');
  return { installed: true, fingerprint };
}

function inspectDirectory(flags: Record<string, unknown>) {
  const inputPath = String(flags.path || '');
  if (!inputPath) {
    throw new CliError('missing_flag', 'Missing required flag: --path');
  }
  const resolvedPath = path.resolve(process.cwd(), inputPath);
  if (!fileExists(resolvedPath)) {
    throw new CliError('missing_directory', `Missing libvmm directory: ${resolvedPath}`);
  }
  if (!fs.statSync(resolvedPath).isDirectory()) {
    throw new CliError('invalid_directory', `libvmm path is not a directory: ${resolvedPath}`);
  }
  return {
    command: 'inspect',
    status: 'success',
    exit_code: 0,
    summary: 'inspected local libvmm directory',
    details: {
      directory: {
        path: resolvedPath,
        version: detectVersion(resolvedPath),
      },
      artifact: {
        path: 'libvmm-dir',
        location: resolvedPath,
      },
    },
  };
}

function ensureGitRepo(source: string, gitUrl: string) {
  if (fs.existsSync(source)) {
    if (!fs.existsSync(path.join(source, '.git'))) {
      throw new CliError('invalid_source', `Expected libvmm source to be a git checkout: ${source}`);
    }
    return { cloned: false };
  }

  fs.mkdirSync(path.dirname(source), { recursive: true });
  const clone = runCommand('git', ['clone', gitUrl, source], undefined, {
    timeoutMs: 10 * 60 * 1000,
    env: gitEnv(),
  });
  if (isSpawnTimeout(clone)) {
    throw new CliError('clone_timeout', `Timed out cloning ${gitUrl}`);
  }
  if (clone.status !== 0) {
    throw new CliError('clone_failed', clone.stderr || clone.stdout || `Failed to clone ${gitUrl}`);
  }
  return { cloned: true };
}

function checkoutRef(source: string, gitRef: string) {
  const fetch = runCommand('git', ['-C', source, 'fetch', '--all', '--tags', '--prune'], undefined, {
    timeoutMs: 10 * 60 * 1000,
    env: gitEnv(),
  });
  if (isSpawnTimeout(fetch)) {
    throw new CliError('fetch_timeout', 'Timed out fetching libvmm updates');
  }
  if (fetch.status !== 0) {
    throw new CliError('fetch_failed', fetch.stderr || fetch.stdout || 'Failed to fetch libvmm updates');
  }
  const checkout = runCommand('git', ['-C', source, 'checkout', gitRef], undefined, { env: gitEnv() });
  if (checkout.status !== 0) {
    throw new CliError('checkout_failed', checkout.stderr || checkout.stdout || `Failed to checkout ${gitRef}`);
  }
}

function updateSubmodules(source: string) {
  if (!fs.existsSync(path.join(source, '.gitmodules'))) {
    return;
  }
  const submodule = runCommand('git', ['-C', source, 'submodule', 'update', '--init', '--recursive'], undefined, {
    timeoutMs: 10 * 60 * 1000,
    env: gitEnv(),
  });
  if (isSpawnTimeout(submodule)) {
    throw new CliError('submodule_timeout', 'Timed out initializing libvmm submodules');
  }
  if (submodule.status !== 0) {
    throw new CliError('submodule_failed', submodule.stderr || submodule.stdout || 'Failed to init libvmm submodules');
  }
}

function resetGitWorktree(source: string) {
  const reset = runCommand('git', ['-C', source, 'reset', '--hard'], undefined, { env: gitEnv() });
  if (reset.status !== 0) {
    throw new CliError('git_reset_failed', reset.stderr || reset.stdout || 'Failed to reset libvmm checkout');
  }
  const clean = runCommand('git', ['-C', source, 'clean', '-fd'], undefined, { env: gitEnv() });
  if (clean.status !== 0) {
    throw new CliError('git_clean_failed', clean.stderr || clean.stdout || 'Failed to clean libvmm checkout');
  }
}

function buildExample(opts: {
  source: string;
  example: string;
  microkitSdk: string;
  board: string;
  linux: string | null;
  initrd: string | null;
  qemu: string | null;
  toolchainBinDir: string | null;
  makeTarget: string | null;
  makeArgs: string[];
}) {
  const exampleDir = path.join(opts.source, 'examples', opts.example);
  if (!fs.existsSync(exampleDir)) {
    throw new CliError('missing_example', `Missing libvmm example directory: ${exampleDir}`);
  }

  const envOverrides: Record<string, string> = {};
  for (const item of opts.makeArgs) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(item);
    if (!match) {
      continue;
    }
    const [, key, value] = match;
    envOverrides[key] = value;
  }

  const env = {
    ...process.env,
    ...envOverrides,
    PATH: opts.toolchainBinDir
      ? `${opts.toolchainBinDir}${path.delimiter}${process.env.PATH || ''}`
      : (process.env.PATH || ''),
  };

  const args = [
    `MICROKIT_SDK=${opts.microkitSdk}`,
    `MICROKIT_BOARD=${opts.board}`,
    ...(opts.linux ? [`LINUX=${opts.linux}`] : []),
    ...(opts.initrd ? [`INITRD=${opts.initrd}`] : []),
    ...(opts.qemu ? [`QEMU=${opts.qemu}`] : []),
    ...opts.makeArgs,
  ];
  if (opts.makeTarget) {
    args.push(opts.makeTarget);
  }
  const result = spawnSync('make', args, {
    encoding: 'utf8',
    cwd: exampleDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new CliError('build_failed', result.stderr || result.stdout || 'Failed to build libvmm example');
  }

  const buildDirCandidate = path.join(exampleDir, 'build');
  return {
    exampleDir,
    buildDir: fs.existsSync(buildDirCandidate) ? buildDirCandidate : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runtimeContractPath(source: string) {
  return path.join(source, 'runtime-contract.json');
}

function buildRuntimeContract(opts: {
  source: string;
  example: string;
  board: string;
}) {
  const exampleDir = path.join(opts.source, 'examples', opts.example);
  return {
    schemaVersion: 1,
    kind: 'libvmm-runtime-contract',
    provider: 'libvmm',
    version: VERSION,
    example: opts.example,
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
      board: opts.board,
      microkitConfig: 'debug',
    },
  };
}

function writeRuntimeContract(source: string, contract: unknown) {
  const filePath = runtimeContractPath(source);
  fs.writeFileSync(filePath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  return filePath;
}

function validateRuntimeContract(contract: any, action: string) {
  if (!contract || contract.kind !== 'libvmm-runtime-contract') {
    throw new CliError('invalid_contract', 'Invalid libvmm runtime contract');
  }
  if (!contract.actions || !contract.actions[action]) {
    throw new CliError('invalid_contract', `Runtime contract does not support action: ${action}`);
  }
}

function fetchDirectory(flags: Record<string, unknown>) {
  const source = requirePathFlag(flags, 'source');
  const gitUrl = optionalStringFlag(flags, 'git-url') || 'https://github.com/au-ts/libvmm';
  const gitRef = buildVersionFlag(flags) || 'main';

  logInfo('starting fetch', {
    source: relPath(source),
    git_url: gitUrl,
    git_ref: gitRef,
  });

  const cloned = ensureGitRepo(source, gitUrl);
  checkoutRef(source, gitRef);
  updateSubmodules(source);
  appendToolLog(source, `fetch git_url=${gitUrl} git_ref=${gitRef}`);
  const inspected = inspectDirectory({ path: source });
  return {
    command: 'fetch',
    status: 'success',
    exit_code: 0,
    summary: cloned.cloned ? 'fetched managed libvmm directory' : 'updated managed libvmm directory',
    details: {
      source,
      git_url: gitUrl,
      git_ref: gitRef,
      directory: inspected.details.directory,
      artifact: inspected.details.artifact,
    },
  };
}

function patchDirectory(flags: Record<string, unknown>) {
  const source = requirePathFlag(flags, 'source');
  const patchDir = requirePathFlag(flags, 'patch-dir');
  if (!fileExists(source)) {
    throw new CliError('missing_source', `Missing libvmm directory: ${source}`);
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
      summary: 'reused patched managed libvmm directory',
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
  resetGitWorktree(source);
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
    summary: 'patched managed libvmm directory',
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

function buildDirectory(flags: Record<string, unknown>) {
  const source = requirePathFlag(flags, 'source');
  const gitUrl = optionalStringFlag(flags, 'git-url') || 'https://github.com/au-ts/libvmm';
  const gitRef = buildVersionFlag(flags) || 'main';
  const example = optionalStringFlag(flags, 'example') || 'virtio';
  const patchDir = optionalStringFlag(flags, 'patch-dir');
  const microkitSdk = requirePathFlag(flags, 'microkit-sdk');
  const board = optionalStringFlag(flags, 'board');
  const linux = optionalStringFlag(flags, 'linux');
  const initrd = optionalStringFlag(flags, 'initrd');
  const qemu = optionalStringFlag(flags, 'qemu');
  const toolchainBinDir = optionalStringFlag(flags, 'toolchain-bin-dir');
  const makeTarget = optionalStringFlag(flags, 'make-target');
  const makeArgs = stringListFlag(flags, 'make-arg');

  logInfo('starting build', {
    source: relPath(source),
    git_url: gitUrl,
    git_ref: gitRef,
    example,
    microkit_sdk: relPath(microkitSdk),
    board,
    patch_dir: patchDir ? relPath(path.resolve(process.cwd(), patchDir)) : null,
  });

  if (!fileExists(microkitSdk)) {
    throw new CliError('missing_directory', `Missing Microkit SDK directory: ${microkitSdk}`);
  }
  if (!board) {
    throw new CliError('missing_flag', 'Missing required flag: --board');
  }

  if (linux && !fileExists(linux)) {
    throw new CliError('missing_file', `Missing linux Image: ${linux}`);
  }
  if (initrd && !fileExists(initrd)) {
    throw new CliError('missing_file', `Missing initrd: ${initrd}`);
  }
  if (qemu && !fileExists(qemu)) {
    throw new CliError('missing_file', `Missing qemu binary: ${qemu}`);
  }
  if (toolchainBinDir && !fileExists(toolchainBinDir)) {
    throw new CliError('missing_directory', `Missing toolchain bin directory: ${toolchainBinDir}`);
  }
  if (patchDir && !fileExists(patchDir)) {
    throw new CliError('missing_directory', `Missing patch directory: ${patchDir}`);
  }

  logInfo('ensuring git checkout', { source: relPath(source) });
  const cloned = ensureGitRepo(source, gitUrl);
  logInfo(cloned.cloned ? 'cloned libvmm repo' : 'reusing libvmm repo', { source: relPath(source) });

  logInfo('checking out git ref', { ref: gitRef });
  checkoutRef(source, gitRef);

  logInfo('updating git submodules', {});
  updateSubmodules(source);

  const patchFiles = patchDir ? listPatchFiles(patchDir) : [];
  const fingerprint = patchDir ? patchFingerprint(patchDir, patchFiles) : null;
  const patchLogFile = patchDir ? path.join(source, '.morpheus-patches.log') : null;
  if (patchDir && fingerprint) {
    logInfo('evaluating patch set', { files: patchFiles.length, fingerprint });
    const state = readPatchState(source);
    if (!state || state.fingerprint !== fingerprint) {
      logInfo('resetting worktree before patching', {});
      resetGitWorktree(source);
      logInfo('applying patches', { files: patchFiles.length });
      applyPatches(source, patchDir, patchFiles, patchLogFile as string);
      writePatchState(source, {
        appliedAt: new Date().toISOString(),
        dir: patchDir,
        files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
        fingerprint,
      });
      logInfo('applied patches', { log_file: relPath(patchLogFile as string) });
    } else {
      logInfo('patches already applied', { files: patchFiles.length });
    }
  }

  const toolRoot = toolRootFromSource(source);
  const requirementsPath = path.join(source, 'requirements.txt');
  const { python: venvPython, venvDir } = ensurePythonVenv(toolRoot);
  const depsStatePath = path.join(venvDir, '.morpheus-requirements.json');
  const deps = ensurePythonRequirements(venvPython, requirementsPath, depsStatePath);
  if (deps.installed) {
    logInfo('ensured python deps', {
      requirements: relPath(requirementsPath),
      fingerprint: deps.fingerprint,
      python: relPath(venvPython),
    });
  }

  const hasPythonOverride = makeArgs.some((item) => String(item).startsWith('PYTHON='));
  const makeArgsWithPython = !hasPythonOverride && deps.installed
    ? [...makeArgs, `PYTHON=${venvPython}`]
    : makeArgs;

  logInfo('building example via make', {
    example,
    microkit_sdk: relPath(microkitSdk),
    microkit_board: board,
    toolchain_bin_dir: toolchainBinDir ? relPath(toolchainBinDir) : null,
  });
  const built = buildExample({
    source,
    example,
    microkitSdk,
    board,
    linux,
    initrd,
    qemu,
    toolchainBinDir,
    makeTarget,
    makeArgs: makeArgsWithPython,
  });
  appendToolLog(source, built.stdout, built.stderr);
  logInfo('built example', {
    example_dir: relPath(built.exampleDir),
    build_dir: built.buildDir ? relPath(built.buildDir) : null,
  });
  const buildLogFile = writeBuildLog(
    source,
    `git_url=${gitUrl}`,
    `git_ref=${gitRef}`,
    `example=${example}`,
    `microkit_sdk=${microkitSdk}`,
    `board=${board}`,
    ...(toolchainBinDir ? [`toolchain_bin_dir=${toolchainBinDir}`] : []),
    ...(linux ? [`linux=${linux}`] : []),
    ...(initrd ? [`initrd=${initrd}`] : []),
    ...(qemu ? [`qemu=${qemu}`] : []),
    built.stdout || '',
    built.stderr || '',
  );

  const runtimeContract = buildRuntimeContract({
    source,
    example,
    board,
  });
  const runtimeContractFile = writeRuntimeContract(source, runtimeContract);
  logInfo('wrote runtime contract', {
    contract: relPath(runtimeContractFile),
  });

  const inspected = inspectDirectory({ path: source });
  logInfo('build complete', { directory: relPath(inspected.details.directory.path) });
  appendToolLog(source, `build example=${example} runtime_contract=${runtimeContractFile}`);
  return {
    command: 'build',
    status: 'success',
    exit_code: 0,
    summary: cloned.cloned ? 'built managed libvmm directory' : 'rebuilt managed libvmm directory',
    details: {
      source,
      git_url: gitUrl,
      git_ref: gitRef,
      example,
      microkit_sdk: microkitSdk,
      microkit_board: board,
      linux,
      initrd,
      qemu,
      toolchain_bin_dir: toolchainBinDir,
      directory: inspected.details.directory,
      artifacts: [
        inspected.details.artifact,
        {
          path: 'example-dir',
          location: built.exampleDir,
        },
        ...(built.buildDir
          ? [{
            path: 'example-build-dir',
            location: built.buildDir,
          }]
          : []),
        {
          path: 'runtime-contract',
          location: runtimeContractFile,
        },
      ],
      patches: patchDir
        ? {
          dir: patchDir,
          files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
          fingerprint,
          applied: true,
          log_file: patchLogFile,
        }
        : null,
      build: {
        cwd: built.exampleDir,
        log_file: buildLogFile,
      },
      log_file: buildLogFile,
    },
  };
}

function readLogs(flags: Record<string, unknown>) {
  const runDir = optionalStringFlag(flags, 'run-dir');
  const source = optionalStringFlag(flags, 'source');
  const logFile = runDir
    ? path.resolve(process.cwd(), runDir, 'stdout.log')
    : source
      ? [
        buildLogPath(path.resolve(process.cwd(), source)),
        toolLogPath(path.resolve(process.cwd(), source)),
        path.join(path.resolve(process.cwd(), source), '.morpheus-patches.log'),
      ].find((filePath) => fs.existsSync(filePath)) || null
      : null;
  if (!logFile) {
    throw new CliError('missing_flag', 'libvmm logs requires --source DIR or --run-dir DIR');
  }
  if (!fs.existsSync(logFile)) {
    throw new CliError('missing_log', `Missing libvmm log file: ${logFile}`);
  }
  return {
    command: 'logs',
    status: 'success',
    exit_code: 0,
    summary: 'read local libvmm log',
    details: {
      log_file: logFile,
      text: fs.readFileSync(logFile, 'utf8'),
    },
  };
}

function defaultRunDir(libvmmDir: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return path.join(libvmmDir, '.morpheus-runs', `libvmm-run-${stamp}-${Math.random().toString(16).slice(2, 10)}`);
}

function runAction(flags: Record<string, unknown>) {
  const contractPath = requirePathFlag(flags, 'contract');
  const action = optionalStringFlag(flags, 'action') || 'qemu';
  const libvmmDir = requirePathFlag(flags, 'libvmm-dir');
  const microkitSdk = requirePathFlag(flags, 'microkit-sdk');
  const board = optionalStringFlag(flags, 'board');
  const kernel = requirePathFlag(flags, 'kernel');
  const initrd = requirePathFlag(flags, 'initrd');
  const qemu = requirePathFlag(flags, 'qemu');
  const microkitConfig = optionalStringFlag(flags, 'microkit-config') || 'debug';
  const toolchainBinDir = optionalStringFlag(flags, 'toolchain-bin-dir');
  const runDir = flags['run-dir']
    ? requirePathFlag(flags, 'run-dir')
    : defaultRunDir(libvmmDir);
  const detach = Boolean(flags.detach);

  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  validateRuntimeContract(contract, action);
  if (!board) {
    throw new CliError('missing_flag', 'Missing required flag: --board');
  }

  const manifestPath = path.join(runDir, 'manifest.json');
  const logFile = path.join(runDir, 'stdout.log');
  const provider = contract.actions[action];
  const manifest = {
    schemaVersion: 1,
    kind: 'libvmm-runtime-run',
    id: path.basename(runDir),
    provider: {
      name: 'libvmm',
      contract: contractPath,
      action,
      example: contract.example,
      exampleDir: provider.cwd,
    },
    status: 'starting',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runDir,
    logFile,
    manifest: manifestPath,
    inputs: {
      libvmmDir,
      microkitSdk,
      board,
      microkitConfig,
      kernel,
      initrd,
      qemu,
      toolchainBinDir,
    },
    pid: null,
    launcherPid: null,
    runnerPid: null,
    monitorSock: null,
    consoleLog: null,
    control: {
      type: 'monitor',
      endpoint: null,
      graceful_methods: ['system_powerdown', 'quit'],
    },
    exitCode: null,
    errorMessage: null,
  };
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(logFile, '', 'utf8');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const runner = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'runtime-runner.js');
  if (detach) {
    const child = spawn(process.execPath, [runner, manifestPath], {
      cwd: runDir,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        LIBVMM_ATTACH: '0',
      },
    });
    child.unref();
    return {
      command: 'run',
      status: 'success',
      exit_code: 0,
      summary: 'started libvmm runtime action',
      details: {
        action,
        provider: 'libvmm',
        run_dir: runDir,
        manifest: manifestPath,
        log_file: logFile,
      },
    };
  }

  const result = spawnSync(process.execPath, [runner, manifestPath], {
    encoding: 'utf8',
    cwd: runDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      LIBVMM_ATTACH: '1',
    },
  });
  const updated = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    command: 'run',
    status: result.status === 0 ? 'success' : 'error',
    exit_code: result.status == null ? 1 : result.status,
    summary: result.status === 0 ? 'completed libvmm runtime action' : 'libvmm runtime action failed',
    details: {
      action,
      provider: 'libvmm',
      run_dir: runDir,
      manifest: manifestPath,
      log_file: logFile,
      pid: updated.pid,
      monitor_sock: updated.monitorSock,
      console_log: updated.consoleLog,
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
        emitJson({ command: 'version', status: 'success', exit_code: 0, summary: 'libvmm CLI version', details: { version: VERSION } });
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
    case 'fetch': {
      const result = fetchDirectory(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.directory.path);
      }
      return 0;
    }
    case 'patch': {
      const result = patchDirectory(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.source);
      }
      return 0;
    }
    case 'build': {
      const result = buildDirectory(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.directory.path);
      }
      return 0;
    }
    case 'run': {
      const result = runAction(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.manifest);
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
