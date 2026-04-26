#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { COMMANDS, getHelp, renderHelp } from './help.js';

const VERSION = '0.1.0';
const MICROKIT_SEL4_VERSION = '15.0.0';

class CliError extends Error {
  code: string;
  exitCode: number;
  details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, exitCode = 1, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

function emitJson(value: unknown) {
  fs.writeSync(1, `${JSON.stringify(value)}\n`);
}

function emitText(value: string) {
  fs.writeSync(1, `${value}\n`);
}

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fileExists(filePath: string | null | undefined) {
  return Boolean(filePath && fs.existsSync(filePath));
}

function isExecutable(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
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

function isRunning(pid: number | null | undefined) {
  if (!pid || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function resolvePathValue(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(process.cwd(), value);
}

function parseArgv(argv: string[]) {
  const repeatable = new Set(['qemu-arg']);
  const booleanFlags = new Set(['json', 'help', 'detach', 'follow', 'force']);
  const flags: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') {
      const forwarded = argv.slice(index + 1);
      flags.forwarded = [...((flags.forwarded as string[]) || []), ...forwarded];
      break;
    }
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.replace(/^--/, '');
    if (repeatable.has(key)) {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        throw new CliError('invalid_flag', `Missing value for --${key}`);
      }
      const current = Array.isArray(flags[key]) ? (flags[key] as string[]) : [];
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

function normalizeTarget(flags: Record<string, unknown>) {
  return String(flags.target || 'sel4');
}

function defaultStateDir(flags: Record<string, unknown>) {
  const name = String(flags.name || 'default');
  return path.resolve(process.cwd(), '.nvirsh', name);
}

function stateDir(flags: Record<string, unknown>) {
  return resolvePathValue(String(flags['state-dir'] || '')) || defaultStateDir(flags);
}

function manifestPath(flags: Record<string, unknown>) {
  return path.join(stateDir(flags), 'manifest.json');
}

function logPath(flags: Record<string, unknown>) {
  return path.join(stateDir(flags), 'stdout.log');
}

function instanceName(flags: Record<string, unknown>) {
  const explicit = flags.name ? String(flags.name) : null;
  if (explicit) {
    return explicit;
  }
  return path.basename(stateDir(flags));
}

function requireFlag(flags: Record<string, unknown>, name: string) {
  const value = flags[name];
  if (!value) {
    throw new CliError('missing_flag', `Missing required flag: --${name}`);
  }
  return String(value);
}

function readManifestOrThrow(flags: Record<string, unknown>) {
  const filePath = manifestPath(flags);
  if (!fs.existsSync(filePath)) {
    throw new CliError('missing_state', `Missing prepared state: ${path.relative(process.cwd(), filePath)}`);
  }
  const manifest = readJson(filePath);
  if (manifest.status === 'running' && manifest.pid && !isRunning(manifest.pid)) {
    manifest.status = manifest.exitCode === 0 ? 'success' : manifest.status;
    manifest.updatedAt = new Date().toISOString();
    writeJson(filePath, manifest);
  }
  return manifest;
}

function validateSel4Prerequisites(flags: Record<string, unknown>) {
  const qemu = resolvePathValue(requireFlag(flags, 'qemu'));
  const microkitSdk = resolvePathValue(requireFlag(flags, 'microkit-sdk'));
  const toolchain = resolvePathValue(requireFlag(flags, 'toolchain'));
  const libvmmDir = resolvePathValue(requireFlag(flags, 'libvmm-dir'));
  const microkitVersion = String(flags['microkit-version'] || '');
  const microkitConfigRaw = String(flags['microkit-config'] || '').trim();
  const microkitConfig = microkitConfigRaw ? microkitConfigRaw : 'debug';
  const runtimeContract = resolvePathValue(String(flags['runtime-contract'] || '')) || path.join(libvmmDir, 'runtime-contract.json');
  const allowedMicrokitConfigs = new Set(['debug', 'release']);
  if (!allowedMicrokitConfigs.has(microkitConfig)) {
    throw new CliError(
      'invalid_flag',
      `Unsupported --microkit-config: ${microkitConfig} (expected debug or release)`,
    );
  }

  const checks = [
    {
      name: 'qemu',
      path: qemu,
      exists: fileExists(qemu),
      executable: qemu ? isExecutable(qemu) : false,
      detectedVersion: qemu && fileExists(qemu)
        ? spawnSync(qemu, ['--version'], { encoding: 'utf8' }).stdout.trim().split(/\r?\n/)[0] || null
        : null,
    },
    {
      name: 'microkit-sdk',
      path: microkitSdk,
      exists: fileExists(microkitSdk),
      detectedVersion: microkitSdk && fileExists(microkitSdk) ? detectVersion(microkitSdk) : null,
      expectedVersion: microkitVersion || null,
    },
    {
      name: 'toolchain',
      path: toolchain,
      exists: fileExists(toolchain),
      detectedVersion: toolchain && fileExists(toolchain) ? detectVersion(toolchain) : null,
    },
    {
      name: 'libvmm-dir',
      path: libvmmDir,
      exists: fileExists(libvmmDir),
      detectedVersion: libvmmDir && fileExists(libvmmDir) ? detectVersion(libvmmDir) : null,
    },
  ];

  for (const check of checks) {
    if (!check.exists) {
      throw new CliError('missing_prerequisite', `Missing ${check.name}: ${check.path}`);
    }
    if (check.name === 'qemu' && !check.executable) {
      throw new CliError('invalid_prerequisite', `QEMU is not executable: ${check.path}`);
    }
    if (check.expectedVersion && !check.detectedVersion) {
      throw new CliError('missing_version', `Could not detect ${check.name} version at ${check.path}`);
    }
    if (check.expectedVersion && check.detectedVersion !== check.expectedVersion) {
      throw new CliError(
        'version_mismatch',
        `Expected ${check.name} version ${check.expectedVersion} but found ${check.detectedVersion}`,
      );
    }
  }

  return {
    qemu,
    microkitSdk,
    microkitVersion: microkitVersion || null,
    microkitConfig,
    toolchain,
    libvmmDir,
    runtimeContract,
    board: String(flags.board || 'qemu_arm_virt'),
    qemuArgs: Array.isArray(flags['qemu-arg']) ? [...(flags['qemu-arg'] as string[])] : [],
    append: String(flags.append || ''),
    checks,
  };
}

function preparedManifest(flags: Record<string, unknown>, prerequisites: Record<string, unknown>) {
  const state = stateDir(flags);
  const runtimeContract = String(prerequisites.runtimeContract || '');
  const provider = runtimeContract && fs.existsSync(runtimeContract)
    ? {
      tool: 'libvmm',
      action: 'qemu',
      contract: runtimeContract,
    }
    : null;
  return {
    schemaVersion: 1,
    id: path.basename(state),
    name: instanceName(flags),
    target: normalizeTarget(flags),
    command: 'prepare',
    status: 'prepared',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stateDir: state,
    logFile: logPath(flags),
    manifest: manifestPath(flags),
    prerequisites,
    runtime: {
      provider,
      providerRun: null,
      kernel: null,
      initrd: null,
      qemuArgs: [],
      append: '',
      command: null,
      runner: provider ? 'libvmm-run' : null,
      launcher: provider ? 'libvmm' : null,
    },
    pid: null,
    exitCode: null,
    errorMessage: null,
  };
}

function helpJson(topic?: string) {
  const command = topic ? getHelp(topic) : undefined;
  return {
    command: 'help',
    status: 'success',
    exit_code: 0,
    summary: topic ? `help for ${topic}` : 'nvirsh CLI help',
    details: command
      ? { command }
      : { commands: COMMANDS, global_flags: ['--json', '--help'] },
  };
}

function runDoctor(flags: Record<string, unknown>) {
  const target = normalizeTarget(flags);
  if (target !== 'sel4') {
    throw new CliError('unsupported_target', `Unsupported target: ${target}`);
  }
  const prerequisites = validateSel4Prerequisites(flags);
  return {
    command: 'doctor',
    status: 'success',
    exit_code: 0,
    summary: 'validated local prerequisites',
    details: {
      target,
      checks: prerequisites.checks,
      compatibility: {
        microkit_requires_sel4: MICROKIT_SEL4_VERSION,
      },
    },
  };
}

function runPrepare(flags: Record<string, unknown>) {
  const target = normalizeTarget(flags);
  if (target !== 'sel4') {
    throw new CliError('unsupported_target', `Unsupported target: ${target}`);
  }
  const prerequisites = validateSel4Prerequisites(flags);
  const state = stateDir(flags);
  fs.mkdirSync(state, { recursive: true });
  const manifest = preparedManifest(flags, prerequisites);
  writeJson(manifest.manifest, manifest);
  if (!fs.existsSync(manifest.logFile)) {
    fs.writeFileSync(manifest.logFile, '', 'utf8');
  }
  return {
    command: flags.__commandName === 'build' ? 'build' : 'prepare',
    status: 'success',
    exit_code: 0,
    summary: 'prepared local target state',
    details: {
      manifest,
    },
  };
}

function runCommandForManifest(manifest: Record<string, any>, flags: Record<string, unknown>) {
  const kernel = resolvePathValue(requireFlag(flags, 'kernel'));
  const initrd = resolvePathValue(requireFlag(flags, 'initrd'));
  if (!fileExists(kernel)) {
    throw new CliError('missing_artifact', `Missing kernel artifact: ${kernel}`);
  }
  if (!fileExists(initrd)) {
    throw new CliError('missing_artifact', `Missing initrd artifact: ${initrd}`);
  }

  const runtimeArgs = Array.isArray(flags['qemu-arg']) && (flags['qemu-arg'] as string[]).length > 0
    ? [...(flags['qemu-arg'] as string[])]
    : [...((manifest.prerequisites?.qemuArgs as string[]) || [])];

  if (!runtimeArgs.includes('-nographic')) {
    runtimeArgs.push('-nographic');
  }

  const append = String(flags.append || manifest.prerequisites?.append || '');
  const provider = manifest.runtime?.provider || null;
  let command;
  if (provider && provider.tool === 'libvmm') {
    const providerRunDir = path.join(stateDir(flags), 'provider-run');
    command = [
      process.execPath,
      path.resolve(process.cwd(), 'tools', 'libvmm', 'dist', 'index.js'),
      '--json',
      'run',
      '--contract',
      String(provider.contract),
      '--action',
      String(provider.action || 'qemu'),
      '--run-dir',
      providerRunDir,
      '--libvmm-dir',
      String(manifest.prerequisites.libvmmDir),
      '--microkit-sdk',
      String(manifest.prerequisites.microkitSdk),
      '--board',
      String(manifest.prerequisites.board),
      '--microkit-config',
      String(manifest.prerequisites.microkitConfig || 'debug'),
      '--kernel',
      kernel,
      '--initrd',
      initrd,
      '--qemu',
      String(manifest.prerequisites.qemu),
      '--toolchain-bin-dir',
      path.join(String(manifest.prerequisites.toolchain), 'bin'),
    ];
  } else {
    command = [
      String(manifest.prerequisites.qemu),
      '-kernel',
      kernel,
      '-initrd',
      initrd,
      ...runtimeArgs,
    ];
    if (append) {
      command.push('-append', append);
    }
    if (Array.isArray(flags.forwarded)) {
      command.push(...(flags.forwarded as string[]));
    }
  }

  manifest.command = 'run';
  manifest.status = 'starting';
  manifest.updatedAt = new Date().toISOString();
  manifest.logFile = logPath(flags);
  manifest.runtime = {
    ...(manifest.runtime || {}),
    kernel,
    initrd,
    append,
    qemuArgs: runtimeArgs,
    command,
    runner: provider ? 'libvmm-run' : 'runner.js',
    launcher: provider ? 'libvmm' : null,
  };
  manifest.errorMessage = null;
  manifest.exitCode = null;
  writeJson(manifestPath(flags), manifest);
  return manifest;
}

async function runLaunch(flags: Record<string, unknown>): Promise<any> {
  const manifest = readManifestOrThrow(flags);
  if (manifest.target !== 'sel4') {
    throw new CliError('unsupported_target', `Unsupported target: ${manifest.target}`);
  }

  const nextManifest = runCommandForManifest(manifest, flags);
  const runnerName = nextManifest.runtime?.runner || 'runner.js';
  const detach = Boolean(flags.detach);
  if (flags.json && !detach) {
    throw new CliError('incompatible_flags', 'nvirsh run --json requires --detach');
  }

  if (runnerName === 'libvmm-run') {
    const providerArgs = [...(nextManifest.runtime?.command || [])];
    if (detach) {
      providerArgs.push('--detach');
    }
    const provider = spawnSync(providerArgs[0], providerArgs.slice(1), {
      encoding: 'utf8',
      cwd: stateDir(flags),
      stdio: detach ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (provider.status !== 0) {
      throw new CliError('provider_failed', provider.stderr || provider.stdout || 'failed to launch libvmm runtime');
    }
    const payload = detach ? JSON.parse((provider.stdout || '').trim().split(/\r?\n/).at(-1) || '{}') : null;
    const providerManifestPath = payload?.details?.manifest || path.join(stateDir(flags), 'provider-run', 'manifest.json');
    const providerManifest = fs.existsSync(providerManifestPath) ? readJson(providerManifestPath) : null;
    nextManifest.status = detach ? 'running' : (providerManifest?.status || 'success');
    nextManifest.pid = providerManifest?.pid || nextManifest.pid;
    nextManifest.runtime.providerRun = payload?.details || {
      manifest: providerManifestPath,
      log_file: providerManifest?.logFile || path.join(stateDir(flags), 'provider-run', 'stdout.log'),
    };
    writeJson(manifestPath(flags), nextManifest);
    return {
      command: 'run',
      status: 'success',
      exit_code: 0,
      summary: detach ? 'started local target instance' : 'completed local target instance',
      details: {
        manifest: nextManifest,
        detach,
      },
    };
  }

  const runner = path.resolve(path.dirname(new URL(import.meta.url).pathname), runnerName);
  if (detach) {
    const child = spawn(process.execPath, [runner, manifestPath(flags)], {
      detached: true,
      stdio: 'ignore',
      cwd: stateDir(flags),
    });
    child.unref();

    nextManifest.runnerPid = child.pid;
    writeJson(manifestPath(flags), nextManifest);

    return {
      command: 'run',
      status: 'success',
      exit_code: 0,
      summary: 'started local target instance',
      details: {
        manifest: nextManifest,
        detach: true,
      },
    };
  }

  const child = spawn(process.execPath, [runner, manifestPath(flags)], {
    detached: false,
    stdio: 'inherit',
    cwd: stateDir(flags),
    env: {
      ...process.env,
      NVIRSH_ATTACH: '1',
    },
  });

  return await new Promise<any>((resolve) => {
    child.on('close', (code, signal) => {
      const updated = readManifestOrThrow(flags);
      resolve({
        command: 'run',
        status: code === 0 ? 'success' : signal ? 'stopped' : 'error',
        exit_code: code == null ? 1 : code,
        summary: 'completed local target instance',
        details: {
          manifest: updated,
          detach: false,
        },
      });
    });
  });
}

function runInspect(flags: Record<string, unknown>) {
  const manifest = readManifestOrThrow(flags);
  return {
    command: 'inspect',
    status: 'success',
    exit_code: 0,
    summary: 'inspected local target state',
    details: {
      manifest,
    },
  };
}

async function runLogs(flags: Record<string, unknown>) {
  const manifest = fs.existsSync(manifestPath(flags)) ? readJson(manifestPath(flags)) : null;
  const providerLogFile = manifest?.runtime?.providerRun?.log_file;
  const filePath = providerLogFile && fs.existsSync(providerLogFile)
    ? providerLogFile
    : logPath(flags);
  if (!fs.existsSync(filePath)) {
    throw new CliError('missing_log', `Missing log file: ${path.relative(process.cwd(), filePath)}`);
  }

  const emitLine = (line: string) => {
    if (flags.json) {
      emitJson({
        command: 'logs',
        status: 'stream',
        exit_code: 0,
        details: { event: 'log', id: instanceName(flags), line },
      });
      return;
    }
    fs.writeSync(1, `${line}\n`);
  };

  const initial = fs.readFileSync(filePath, 'utf8');
  for (const line of initial.split(/\r?\n/)) {
    if (line) {
      emitLine(line);
    }
  }

  if (!flags.follow) {
    return {
      command: 'logs',
      status: 'success',
      exit_code: 0,
      summary: 'printed local logs',
      details: { log_file: filePath, follow: false },
    };
  }

  await new Promise<void>((resolve) => {
    let offset = Buffer.byteLength(initial);
    const timer = setInterval(() => {
      const manifest = fs.existsSync(manifestPath(flags)) ? readJson(manifestPath(flags)) : null;
      const content = fs.readFileSync(filePath, 'utf8');
      const nextChunk = content.slice(offset);
      offset = Buffer.byteLength(content);
      for (const line of nextChunk.split(/\r?\n/)) {
        if (line) {
          emitLine(line);
        }
      }
      if (!manifest || manifest.status !== 'running') {
        clearInterval(timer);
        resolve();
      }
    }, 100);
  });

  return {
    command: 'logs',
    status: 'success',
    exit_code: 0,
    summary: 'followed local logs',
    details: { log_file: filePath, follow: true },
  };
}

function runStop(flags: Record<string, unknown>) {
  const manifest = readManifestOrThrow(flags);
  const providerManifestPath = manifest.runtime?.providerRun?.manifest;
  if (providerManifestPath && fs.existsSync(providerManifestPath)) {
    const providerManifest = readJson(providerManifestPath);
    if (providerManifest.pid && isRunning(providerManifest.pid)) {
      process.kill(providerManifest.pid, 'SIGTERM');
    }
  }
  if (!manifest.pid || !isRunning(manifest.pid)) {
    manifest.status = manifest.status === 'prepared' ? 'prepared' : 'stopped';
    manifest.updatedAt = new Date().toISOString();
    writeJson(manifestPath(flags), manifest);
    return {
      command: 'stop',
      status: 'success',
      exit_code: 0,
      summary: 'instance is not running',
      details: { manifest },
    };
  }

  process.kill(manifest.pid, 'SIGTERM');
  manifest.status = 'stopped';
  manifest.signal = 'SIGTERM';
  manifest.updatedAt = new Date().toISOString();
  writeJson(manifestPath(flags), manifest);
  return {
    command: 'stop',
    status: 'success',
    exit_code: 0,
    summary: 'stopped local target instance',
    details: { manifest },
  };
}

function runClean(flags: Record<string, unknown>) {
  const manifest = fs.existsSync(manifestPath(flags)) ? readJson(manifestPath(flags)) : null;
  if (manifest?.pid && isRunning(manifest.pid) && !flags.force) {
    throw new CliError('instance_running', 'Refusing to clean a running instance without --force');
  }
  if (manifest?.pid && isRunning(manifest.pid) && flags.force) {
    process.kill(manifest.pid, 'SIGTERM');
  }
  fs.rmSync(stateDir(flags), { recursive: true, force: true });
  return {
    command: 'clean',
    status: 'success',
    exit_code: 0,
    summary: 'removed local target state',
    details: { state_dir: stateDir(flags) },
  };
}

async function main(argv: string[]) {
  const parsed = parseArgv(argv);
  if (parsed.help) {
    const topic = parsed.command === 'help' ? parsed.topic : parsed.command || parsed.topic || undefined;
    if (parsed.json) {
      emitJson(helpJson(topic || undefined));
    } else {
      emitText(renderHelp(topic || undefined));
    }
    return 0;
  }

  switch (parsed.command) {
    case 'version':
      if (parsed.json) {
        emitJson({ command: 'version', status: 'success', exit_code: 0, summary: 'nvirsh CLI version', details: { version: VERSION } });
      } else {
        emitText(VERSION);
      }
      return 0;
    case 'doctor': {
      const result = runDoctor(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return 0;
    }
    case 'build': {
      parsed.flags.__commandName = 'build';
      const result = runPrepare(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return 0;
    }
    case 'prepare': {
      parsed.flags.__commandName = 'prepare';
      const result = runPrepare(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return 0;
    }
    case 'run': {
      const result = await runLaunch(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return 0;
    }
    case 'inspect': {
      const result = runInspect(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return 0;
    }
    case 'stop': {
      const result = runStop(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return 0;
    }
    case 'logs': {
      const result = await runLogs(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      }
      return 0;
    }
    case 'clean': {
      const result = runClean(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
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
        details: cliError.details,
      },
    });
  } else {
    process.stderr.write(`${cliError.code}: ${cliError.message}\n`);
  }
  process.exitCode = cliError.exitCode;
});
