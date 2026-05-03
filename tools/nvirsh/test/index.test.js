import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const bin = path.resolve(process.cwd(), 'dist/index.js');

function run(args, options = {}) {
  const env = {
    ...process.env,
    ...(options.env || {}),
  };
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    cwd: process.cwd(),
    env,
    ...options,
  });
}

function makeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, { mode: 0o755 });
}

test('help supports json', () => {
  const result = run(['--json', '--help']);
  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.command, 'help');
  assert.equal(payload.status, 'success');
});

test('direct run is rejected outside Morpheus-managed execution', () => {
  const result = run(['--json', 'run']);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout.trim());
  assert.equal(payload.status, 'error');
  assert.equal(payload.error.code, 'managed_only');
});

test('run manages local sel4 state', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvirsh-test-'));
  const stateDir = path.join(root, 'state');
  const depsDir = path.join(root, 'deps');
  fs.mkdirSync(depsDir, { recursive: true });

  const qemu = path.join(depsDir, 'qemu-system-aarch64');
  const microkitSdk = path.join(depsDir, 'microkit-sdk');
  const toolchain = path.join(depsDir, 'arm-toolchain');
  const libvmmDir = path.join(depsDir, 'libvmm');
  const kernel = path.join(root, 'Image');
  const initrd = path.join(root, 'rootfs.cpio.gz');

  makeExecutable(
    qemu,
    [
      '#!/usr/bin/env sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "qemu stub 1.0"',
      '  exit 0',
      'fi',
      'echo "qemu launch: $*"',
      'echo "inject virq: ${MORPHEUS_QEMU_INJECT_VIRQ:-unset} period: ${MORPHEUS_QEMU_INJECT_VIRQ_PERIOD_MS:-unset}"',
      'exit 0',
      '',
    ].join('\n'),
  );
  for (const dir of [microkitSdk, toolchain, libvmmDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(libvmmDir, 'examples', 'virtio'), { recursive: true });
  fs.writeFileSync(
    path.join(libvmmDir, 'examples', 'virtio', 'Makefile'),
    [
      '.PHONY: qemu',
      'qemu:',
      '\t$(QEMU) -machine virt',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(microkitSdk, 'VERSION'), '1.4.1\n');
  fs.writeFileSync(path.join(toolchain, 'VERSION'), 'arm-toolchain\n');
  fs.writeFileSync(path.join(libvmmDir, 'VERSION'), 'libvmm-dev\n');
  fs.writeFileSync(kernel, 'kernel');
  fs.writeFileSync(initrd, 'initrd');

  const launch = run([
    '--json',
    'run',
    '--state-dir',
    stateDir,
    '--name',
    'sel4-dev',
    '--target',
    'sel4',
    '--qemu',
    qemu,
    '--microkit-sdk',
    microkitSdk,
    '--microkit-version',
    '1.4.1',
    '--toolchain',
    toolchain,
    '--libvmm-dir',
    libvmmDir,
    '--kernel',
    kernel,
    '--initrd',
    initrd,
    '--detach',
    '--env',
    'MORPHEUS_QEMU_INJECT_VIRQ=42',
    '--env',
    'MORPHEUS_QEMU_INJECT_VIRQ_PERIOD_MS=1000',
    '--qemu-arg',
    '-machine',
    '--qemu-arg',
    'virt',
  ], {
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: stateDir,
    },
  });
  assert.equal(launch.status, 0, launch.stdout || launch.stderr);

  const inspect = run(['--json', 'inspect', '--state-dir', stateDir], {
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: stateDir,
    },
  });
  assert.equal(inspect.status, 0, inspect.stdout || inspect.stderr);
  const inspectPayload = JSON.parse(inspect.stdout.trim());
  assert.equal(
    ['starting', 'running', 'success'].includes(inspectPayload.details.manifest.status),
    true,
  );
  assert.equal(inspectPayload.details.manifest.prerequisites.env.MORPHEUS_QEMU_INJECT_VIRQ, '42');
  assert.equal(inspectPayload.details.manifest.prerequisites.env.MORPHEUS_QEMU_INJECT_VIRQ_PERIOD_MS, '1000');

  const logs = run(['--json', 'logs', '--state-dir', stateDir], {
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: stateDir,
    },
  });
  assert.equal(logs.status, 0, logs.stdout || logs.stderr);
  assert.match(logs.stdout, /qemu launch/);
  assert.match(logs.stdout, /inject virq: 42 period: 1000/);

  const stop = run(['--json', 'stop', '--state-dir', stateDir], {
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: stateDir,
    },
  });
  assert.equal(stop.status, 0, stop.stdout || stop.stderr);

  const remove = run(['--json', 'remove', '--state-dir', stateDir], {
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: stateDir,
    },
  });
  assert.equal(remove.status, 0, remove.stdout || remove.stderr);
  assert.equal(fs.existsSync(stateDir), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('nvirsh stop delegates provider shutdown to libvmm stop', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvirsh-stop-delegate-'));
  const stateDir = path.join(root, 'state');
  const providerRunDir = path.join(root, 'provider-run');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(providerRunDir, { recursive: true });

  const providerPid = spawnSync('sh', ['-c', 'sleep 30 & echo $!'], { encoding: 'utf8' });
  const pid = Number.parseInt(String(providerPid.stdout || '').trim(), 10);
  assert.equal(Number.isFinite(pid), true);

  const providerManifestPath = path.join(providerRunDir, 'manifest.json');
  fs.writeFileSync(
    providerManifestPath,
    `${JSON.stringify({
      tool: 'libvmm',
      status: 'running',
      runDir: providerRunDir,
      logFile: path.join(providerRunDir, 'stdout.log'),
      manifest: providerManifestPath,
      pid,
      launcherPid: null,
      runnerPid: null,
      control: {
        type: 'monitor',
        endpoint: path.join(providerRunDir, 'missing-monitor.sock'),
        graceful_methods: ['system_powerdown', 'quit'],
      },
    }, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(stateDir, 'manifest.json'),
    `${JSON.stringify({
      tool: 'nvirsh',
      status: 'running',
      stateDir,
      logFile: path.join(stateDir, 'stdout.log'),
      manifest: path.join(stateDir, 'manifest.json'),
      pid: null,
      runtime: {
        providerRun: {
          provider: 'libvmm',
          run_dir: providerRunDir,
          manifest: providerManifestPath,
          log_file: path.join(providerRunDir, 'stdout.log'),
        },
      },
    }, null, 2)}\n`,
    'utf8',
  );

  const result = run(['--json', 'stop', '--state-dir', stateDir], {
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: stateDir,
    },
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);

  const providerUpdated = JSON.parse(fs.readFileSync(providerManifestPath, 'utf8'));
  assert.equal(providerUpdated.status, 'stopped');
  assert.equal(providerUpdated.signal, 'SIGTERM');

  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
  fs.rmSync(root, { recursive: true, force: true });
});

test('run defaults state under workspace tmp when morpheus.yaml is present', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvirsh-workspace-'));
  const workspaceRoot = path.join(root, 'workspace');
  const depsDir = path.join(root, 'deps');
  fs.mkdirSync(depsDir, { recursive: true });
  fs.writeFileSync(
    path.join(root, 'morpheus.yaml'),
    ['workspace:', '  root: ./workspace', ''].join('\n'),
    'utf8',
  );

  const qemu = path.join(depsDir, 'qemu-system-aarch64');
  const microkitSdk = path.join(depsDir, 'microkit-sdk');
  const toolchain = path.join(depsDir, 'arm-toolchain');
  const libvmmDir = path.join(depsDir, 'libvmm');
  const kernel = path.join(root, 'Image');
  const initrd = path.join(root, 'rootfs.cpio.gz');

  makeExecutable(
    qemu,
    [
      '#!/usr/bin/env sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "qemu stub 1.0"',
      '  exit 0',
      'fi',
      'echo "qemu launch: $*"',
      'echo "inject virq: ${MORPHEUS_QEMU_INJECT_VIRQ:-unset} period: ${MORPHEUS_QEMU_INJECT_VIRQ_PERIOD_MS:-unset}"',
      'exit 0',
      '',
    ].join('\n'),
  );
  for (const dir of [microkitSdk, toolchain, libvmmDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(libvmmDir, 'examples', 'virtio'), { recursive: true });
  fs.writeFileSync(
    path.join(libvmmDir, 'examples', 'virtio', 'Makefile'),
    ['.PHONY: clean qemu', 'clean:', '\t@true', 'qemu:', '\t$(QEMU) -machine virt', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(microkitSdk, 'VERSION'), '1.4.1\n');
  fs.writeFileSync(path.join(toolchain, 'VERSION'), 'arm-toolchain\n');
  fs.writeFileSync(path.join(libvmmDir, 'VERSION'), 'libvmm-dev\n');
  fs.writeFileSync(kernel, 'kernel');
  fs.writeFileSync(initrd, 'initrd');

  const launch = run(
    [
      '--json',
      'run',
      '--name',
      'sel4-dev',
      '--target',
      'sel4',
      '--qemu',
      qemu,
      '--microkit-sdk',
      microkitSdk,
      '--microkit-version',
      '1.4.1',
      '--toolchain',
      toolchain,
      '--libvmm-dir',
      libvmmDir,
      '--kernel',
      kernel,
      '--initrd',
      initrd,
      '--detach',
    ],
    {
      cwd: root,
      env: {
        MORPHEUS_RUN_DIR_OVERRIDE: path.join(workspaceRoot, 'tmp', 'nvirsh', 'sel4-dev'),
      },
    },
  );
  assert.equal(launch.status, 0, launch.stdout || launch.stderr);

  const payload = JSON.parse(launch.stdout.trim());
  const expectedStateDir = path.join(workspaceRoot, 'tmp', 'nvirsh', 'sel4-dev');
  assert.equal(payload.details.manifest.stateDir, expectedStateDir);
  assert.equal(fs.existsSync(path.join(expectedStateDir, 'manifest.json')), true);

  run(['--json', 'stop', '--state-dir', expectedStateDir], {
    cwd: root,
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: expectedStateDir,
    },
  });
  run(['--json', 'remove', '--state-dir', expectedStateDir], {
    cwd: root,
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: expectedStateDir,
    },
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('detached run fails when libvmm qemu launch exits immediately', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nvirsh-run-fails-fast-'));
  const stateDir = path.join(root, 'state');
  const depsDir = path.join(root, 'deps');
  fs.mkdirSync(depsDir, { recursive: true });

  const qemu = path.join(depsDir, 'qemu-system-aarch64');
  const microkitSdk = path.join(depsDir, 'microkit-sdk');
  const toolchain = path.join(depsDir, 'arm-toolchain');
  const libvmmDir = path.join(depsDir, 'libvmm');
  const kernel = path.join(root, 'Image');
  const initrd = path.join(root, 'rootfs.cpio.gz');

  makeExecutable(
    qemu,
    [
      '#!/usr/bin/env sh',
      'if [ "$1" = "--version" ]; then',
      '  echo "qemu stub 1.0"',
      '  exit 0',
      'fi',
      'echo "qemu launch failed" >&2',
      'exit 2',
      '',
    ].join('\n'),
  );
  for (const dir of [microkitSdk, toolchain, libvmmDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.join(libvmmDir, 'examples', 'virtio'), { recursive: true });
  fs.writeFileSync(
    path.join(libvmmDir, 'examples', 'virtio', 'Makefile'),
    [
      '.PHONY: clean qemu',
      'clean:',
      '\t@true',
      'qemu:',
      '\t$(QEMU) -machine virt',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(path.join(microkitSdk, 'VERSION'), '1.4.1\n');
  fs.writeFileSync(path.join(toolchain, 'VERSION'), 'arm-toolchain\n');
  fs.writeFileSync(path.join(libvmmDir, 'VERSION'), 'libvmm-dev\n');
  fs.writeFileSync(kernel, 'kernel');
  fs.writeFileSync(initrd, 'initrd');

  const launch = run([
    '--json',
    'run',
    '--state-dir',
    stateDir,
    '--name',
    'sel4-dev',
    '--target',
    'sel4',
    '--qemu',
    qemu,
    '--microkit-sdk',
    microkitSdk,
    '--microkit-version',
    '1.4.1',
    '--toolchain',
    toolchain,
    '--libvmm-dir',
    libvmmDir,
    '--kernel',
    kernel,
    '--initrd',
    initrd,
    '--detach',
  ], {
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: stateDir,
    },
  });
  assert.equal(launch.status, 0, launch.stdout || launch.stderr);
  const payload = JSON.parse(launch.stdout.trim());
  assert.equal(payload.status, 'error');
  assert.equal(payload.exit_code, 2);
  assert.match(payload.summary, /failed to start local target instance|qemu launch failed/i);

  const inspect = run(['--json', 'inspect', '--state-dir', stateDir], {
    env: {
      MORPHEUS_RUN_DIR_OVERRIDE: stateDir,
    },
  });
  assert.equal(inspect.status, 0, inspect.stdout || inspect.stderr);
  const inspectPayload = JSON.parse(inspect.stdout.trim());
  assert.equal(inspectPayload.details.manifest.status, 'error');

  fs.rmSync(root, { recursive: true, force: true });
});
