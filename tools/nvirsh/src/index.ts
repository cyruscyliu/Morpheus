#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { COMMANDS, getHelp, renderHelp } from './help.js';

const VERSION = '0.3.0';
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

function findConfigPath(startDir: string) {
  let current = path.resolve(startDir || process.cwd());
  while (true) {
    const candidate = path.join(current, 'morpheus.yaml');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function configuredWorkspaceRoot() {
  const configPath = findConfigPath(process.cwd());
  if (!configPath) {
    return null;
  }
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    const match = text.match(/^\s*workspace:\s*\n(?:[^\n]*\n)*?\s*root:\s*(.+)\s*$/m);
    const root = match && match[1] ? String(match[1]).trim().replace(/^['"]|['"]$/g, '') : '';
    if (!root) {
      return null;
    }
    return path.resolve(path.dirname(configPath), root);
  } catch {
    return null;
  }
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
  const override = resolvePathValue(String(process.env.MORPHEUS_RUN_DIR_OVERRIDE || '').trim());
  if (override) {
    return override;
  }
  const name = String(flags.name || 'default');
  const workspaceRoot = configuredWorkspaceRoot();
  if (workspaceRoot) {
    return path.join(workspaceRoot, 'tmp', 'nvirsh', name);
  }
  return path.resolve(process.cwd(), 'tmp', 'nvirsh', name);
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDetachedLaunch(flags: Record<string, unknown>, launcherPid: number | undefined) {
  const deadline = Date.now() + 60000;
  let runningSince = 0;
  while (Date.now() < deadline) {
    const manifest = readManifestOrThrow(flags);
    if (manifest.status === 'error' || manifest.status === 'stopped' || manifest.status === 'success') {
      return manifest;
    }
    if (manifest.status === 'running' && manifest.pid && isRunning(manifest.pid)) {
      if (!runningSince) {
        runningSince = Date.now();
      }
      if (Date.now() - runningSince >= 1000) {
        return manifest;
      }
    } else {
      runningSince = 0;
    }
    if (launcherPid && !isRunning(launcherPid) && (!manifest.pid || !isRunning(manifest.pid))) {
      return manifest;
    }
    await sleep(100);
  }
  return readManifestOrThrow(flags);
}

function findManifestFiles(rootDir: string) {
  const results: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || !fs.existsSync(current)) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
      } else if (entry.isFile() && entry.name === 'manifest.json') {
        results.push(nextPath);
      }
    }
  }
  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function ensureNoWorkspaceRunConflict(flags: Record<string, unknown>) {
  const workspaceRoot = configuredWorkspaceRoot();
  if (!workspaceRoot) {
    return;
  }
  const guardKey = `${normalizeTarget(flags)}:${String(flags['runtime-action'] || 'qemu')}`;
  const currentStateDir = stateDir(flags);
  for (const rootDir of [path.join(workspaceRoot, 'tmp'), path.join(workspaceRoot, 'runs')]) {
    for (const filePath of findManifestFiles(rootDir)) {
      if (path.resolve(filePath) === path.resolve(manifestPath(flags))) {
        continue;
      }
      let manifest = null;
      try {
        manifest = readJson(filePath);
      } catch {
        continue;
      }
      if (!manifest || manifest.status !== 'running') {
        continue;
      }
      const guard = manifest.runGuard;
      if (!guard || guard.tool !== 'nvirsh' || guard.key !== guardKey) {
        continue;
      }
      const otherStateDir = manifest.stateDir ? String(manifest.stateDir) : null;
      if (otherStateDir && path.resolve(otherStateDir) === path.resolve(currentStateDir)) {
        continue;
      }
      const pid = Number(manifest.pid || manifest.launcherPid || manifest.runnerPid || 0);
      if (!isRunning(pid)) {
        continue;
      }
      const providerManifestPath = manifest.runtime?.providerRun?.manifest;
      if (providerManifestPath && fs.existsSync(providerManifestPath)) {
        try {
          const providerManifest = readJson(providerManifestPath);
          const providerPid = Number(providerManifest.pid || providerManifest.launcherPid || providerManifest.runnerPid || 0);
          if (isRunning(providerPid)) {
            try {
              process.kill(providerPid, 'SIGTERM');
            } catch {}
          }
        } catch {}
      }
      for (const runningPid of [
        Number(manifest.pid || 0),
        Number(manifest.launcherPid || 0),
        Number(manifest.runnerPid || 0),
      ]) {
        if (!isRunning(runningPid)) {
          continue;
        }
        try {
          process.kill(runningPid, 'SIGTERM');
        } catch {}
      }
      const waited = spawnSync(
        'bash',
        ['-lc', `for i in $(seq 1 30); do if ! kill -0 ${pid} 2>/dev/null; then exit 0; fi; sleep 0.1; done; exit 1`],
        { stdio: 'ignore' },
      );
      if (waited.status !== 0) {
        for (const runningPid of [
          Number(manifest.pid || 0),
          Number(manifest.launcherPid || 0),
          Number(manifest.runnerPid || 0),
        ]) {
          if (!isRunning(runningPid)) {
            continue;
          }
          try {
            process.kill(runningPid, 'SIGKILL');
          } catch {}
        }
      }
      for (const cleanupRoot of [
        typeof manifest.stateDir === 'string' ? manifest.stateDir : null,
      ].filter(Boolean)) {
        fs.rmSync(String(cleanupRoot), { recursive: true, force: true });
      }
      return;
    }
  }
}

async function sendMonitorCommand(socketPath: string, command: string, timeoutMs = 2000) {
  return await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`timed out sending monitor command: ${command}`));
    }, timeoutMs);

    socket.on('connect', () => {
      socket.write(`${command}\n`);
      socket.end();
    });
    socket.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
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
    tool: 'nvirsh',
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
    runGuard: {
      scope: 'workspace',
      tool: 'nvirsh',
      key: `${normalizeTarget(flags)}:${provider && provider.action ? provider.action : 'qemu'}`,
    },
    prerequisites,
    runtime: {
      provider,
      providerRun: null,
      control: {
        type: 'none',
        endpoint: null,
        graceful_methods: [],
      },
      kernel: null,
      initrd: null,
      qemuArgs: [],
      append: '',
      command: null,
      runner: provider && provider.tool === 'libvmm' ? 'libvmm-runner.js' : null,
      launcher: provider ? provider.tool : null,
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

function ensurePreparedManifest(flags: Record<string, unknown>) {
  const filePath = manifestPath(flags);
  if (fs.existsSync(filePath)) {
    return readManifestOrThrow(flags);
  }
  runPrepare(flags);
  return readManifestOrThrow(flags);
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
  if (!(provider && provider.tool === 'libvmm')) {
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
    runner: provider && provider.tool === 'libvmm' ? 'libvmm-runner.js' : 'runner.js',
    launcher: provider ? provider.tool : null,
  };
  manifest.errorMessage = null;
  manifest.exitCode = null;
  writeJson(manifestPath(flags), manifest);
  return manifest;
}

async function runLaunch(flags: Record<string, unknown>): Promise<any> {
  ensureNoWorkspaceRunConflict(flags);
  const manifest = ensurePreparedManifest(flags);
  if (manifest.target !== 'sel4') {
    throw new CliError('unsupported_target', `Unsupported target: ${manifest.target}`);
  }

  const nextManifest = runCommandForManifest(manifest, flags);
  const runnerName = nextManifest.runtime?.runner || 'runner.js';
  const detach = Boolean(flags.detach);
  if (flags.json && !detach) {
    throw new CliError('incompatible_flags', 'nvirsh run --json requires --detach');
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
    const launchedManifest = await waitForDetachedLaunch(flags, child.pid);
    if (launchedManifest.status === 'error') {
      return {
        command: 'run',
        status: 'error',
        exit_code: typeof launchedManifest.exitCode === 'number' ? launchedManifest.exitCode : 1,
        summary: launchedManifest.errorMessage || 'failed to start local target instance',
        details: {
          manifest: launchedManifest,
          detach: true,
        },
      };
    }
    if (launchedManifest.status === 'stopped') {
      return {
        command: 'run',
        status: 'error',
        exit_code: typeof launchedManifest.exitCode === 'number' ? launchedManifest.exitCode : 1,
        summary: 'local target instance stopped during startup',
        details: {
          manifest: launchedManifest,
          detach: true,
        },
      };
    }
    if (
      launchedManifest.status !== 'running'
      && launchedManifest.status !== 'success'
      && (!launchedManifest.pid || !isRunning(launchedManifest.pid))
    ) {
      return {
        command: 'run',
        status: 'error',
        exit_code: 1,
        summary: 'local target instance exited before entering running state',
        details: {
          manifest: launchedManifest,
          detach: true,
        },
      };
    }

    return {
      command: 'run',
      status: 'success',
      exit_code: 0,
      summary: 'started local target instance',
      details: {
        manifest: launchedManifest,
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

function resultExitCode(result: any) {
  if (result && result.status === 'error') {
    return typeof result.exit_code === 'number' ? result.exit_code : 1;
  }
  return 0;
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

async function runStop(flags: Record<string, unknown>) {
  const manifest = readManifestOrThrow(flags);
  const providerManifestPath = manifest.runtime?.providerRun?.manifest;
  if (providerManifestPath && fs.existsSync(providerManifestPath)) {
    const providerManifest = readJson(providerManifestPath);
    const control = providerManifest.control;
    if (control && control.type === 'monitor' && control.endpoint && fs.existsSync(control.endpoint)) {
      try {
        await sendMonitorCommand(String(control.endpoint), 'system_powerdown');
      } catch {
        // fall through to process signals
      }
    }
    if (providerManifest.pid && isRunning(providerManifest.pid)) {
      process.kill(providerManifest.pid, 'SIGTERM');
    }
  }
  if (!manifest.pid || !isRunning(manifest.pid)) {
    manifest.status = 'stopped';
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

function runRemove(flags: Record<string, unknown>) {
  const manifest = fs.existsSync(manifestPath(flags)) ? readJson(manifestPath(flags)) : null;
  if (!manifest) {
    throw new CliError('missing_state', `Missing prepared state: ${path.relative(process.cwd(), manifestPath(flags))}`);
  }
  if (manifest.status !== 'stopped') {
    throw new CliError('stop_required', 'Refusing to remove instance state before a successful stop');
  }
  if (manifest.pid && isRunning(manifest.pid)) {
    throw new CliError('instance_running', 'Refusing to remove a running instance');
  }
  fs.rmSync(stateDir(flags), { recursive: true, force: true });
  return {
    command: 'remove',
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
      return resultExitCode(result);
    }
    case 'run': {
      const result = await runLaunch(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return resultExitCode(result);
    }
    case 'inspect': {
      const result = runInspect(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return resultExitCode(result);
    }
    case 'stop': {
      const result = await runStop(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return resultExitCode(result);
    }
    case 'logs': {
      const result = await runLogs(parsed.flags);
      if (parsed.json) {
        emitJson(result);
      }
      return 0;
    }
    case 'remove': {
      const result = runRemove(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return resultExitCode(result);
    }
    case 'clean': {
      const result = runRemove(parsed.flags);
      parsed.json ? emitJson(result) : emitText(result.summary);
      return resultExitCode(result);
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
