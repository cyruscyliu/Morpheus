#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
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

  const env = {
    ...process.env,
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

function buildDirectory(flags: Record<string, unknown>) {
  const source = requirePathFlag(flags, 'source');
  const gitUrl = optionalStringFlag(flags, 'git-url') || 'https://github.com/au-ts/libvmm';
  const gitRef = optionalStringFlag(flags, 'git-ref') || 'main';
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

  const cloned = ensureGitRepo(source, gitUrl);
  checkoutRef(source, gitRef);
  updateSubmodules(source);

  const patchFiles = patchDir ? listPatchFiles(patchDir) : [];
  const fingerprint = patchDir ? patchFingerprint(patchDir, patchFiles) : null;
  const patchLogFile = patchDir ? path.join(source, '.morpheus-patches.log') : null;
  if (patchDir && fingerprint) {
    const state = readPatchState(source);
    if (!state || state.fingerprint !== fingerprint) {
      applyPatches(source, patchDir, patchFiles, patchLogFile as string);
      writePatchState(source, {
        appliedAt: new Date().toISOString(),
        dir: patchDir,
        files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
        fingerprint,
      });
    }
  }

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
    makeArgs,
  });

  const inspected = inspectDirectory({ path: source });
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
      },
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
    case 'build': {
      const result = buildDirectory(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      } else {
        emitText(result.details.directory.path);
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
