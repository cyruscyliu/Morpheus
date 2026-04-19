import fs from 'node:fs/promises';
import path from 'node:path';
import { CliError } from './errors.js';
import { runCommand } from './exec.js';
import { generateBuildId } from './ids.js';
import { emitJson, emitJsonEvent, emitText } from './io.js';
import { buildrootTarballUrl, remoteBuildDir, shellQuote } from './paths.js';
import { sshArgs } from './ssh.js';
import type { BuildManifest, CliContext, RemoteBuildOptions, RemoteFetchOptions, RemoteInspectOptions, RemoteLogsOptions } from './types.js';

function remoteManifestPath(workspace: string, id: string): string {
  return path.posix.join(remoteBuildDir(workspace, id), 'manifest.json');
}

function remoteLogPath(workspace: string, id: string): string {
  return path.posix.join(remoteBuildDir(workspace, id), 'stdout.log');
}

function buildRemoteManifest(options: RemoteBuildOptions, id: string, buildDir: string, manifest: string, logFile: string): Partial<BuildManifest> {
  return {
    id,
    mode: 'remote',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: options.detach ? 'submitted' : 'running',
    command: 'remote-build',
    workspace: options.workspace,
    buildrootVersion: options.buildrootVersion,
    defconfig: options.defconfig,
    ssh: options.ssh,
    makeArgs: options.makeArgs,
    env: options.env,
    forwarded: options.forwarded,
    buildDir,
    logFile,
  };
}

function remoteProvisionScript(options: RemoteBuildOptions, id: string): string {
  const buildDir = remoteBuildDir(options.workspace, id);
  const cacheDir = path.posix.join(options.workspace, 'cache');
  const srcRoot = path.posix.join(options.workspace, 'src');
  const tarball = path.posix.join(cacheDir, `buildroot-${options.buildrootVersion}.tar.gz`);
  const sourceDir = path.posix.join(srcRoot, `buildroot-${options.buildrootVersion}`);
  const outputDir = path.posix.join(buildDir, 'output');
  const manifest = remoteManifestPath(options.workspace, id);
  const logFile = remoteLogPath(options.workspace, id);
  const defconfigCommand = options.defconfig ? `make O=${shellQuote(outputDir)} ${options.defconfig}` : ':';
  const envPrefix = Object.entries(options.env)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ');
  const makeCommand = [envPrefix, 'make', `O=${shellQuote(outputDir)}`, ...options.makeArgs.map(shellQuote), ...options.forwarded.map(shellQuote)]
    .filter(Boolean)
    .join(' ');
  const url = buildrootTarballUrl(options.buildrootVersion);
  const manifestJson = JSON.stringify(buildRemoteManifest(options, id, buildDir, manifest, logFile), null, 2);

  return `
set -euo pipefail
mkdir -p ${shellQuote(cacheDir)} ${shellQuote(srcRoot)} ${shellQuote(buildDir)} ${shellQuote(outputDir)}
: > ${shellQuote(logFile)}
if [ ! -f ${shellQuote(tarball)} ]; then
  curl -fsSL ${shellQuote(url)} -o ${shellQuote(tarball)}
fi
if [ ! -d ${shellQuote(sourceDir)} ]; then
  tar -xzf ${shellQuote(tarball)} -C ${shellQuote(srcRoot)}
fi
cat > ${shellQuote(manifest)} <<'JSON'
${manifestJson}
JSON
cd ${shellQuote(sourceDir)}
set +e
{
  ${defconfigCommand}
  ${makeCommand}
} 2>&1 | tee -a ${shellQuote(logFile)}
exit_code=\${PIPESTATUS[0]}
set -e
status=success
if [ "\${exit_code}" -ne 0 ]; then
  status=error
fi
python3 - <<'PY'
import json
from pathlib import Path
from datetime import datetime, timezone
file = Path(${shellQuote(manifest)})
data = json.loads(file.read_text())
data['status'] = '${'${status}'}'
data['exitCode'] = int('${'${exit_code}'}')
data['updatedAt'] = datetime.now(timezone.utc).isoformat()
if data['status'] == 'error':
    data['errorMessage'] = 'remote build failed'
file.write_text(json.dumps(data, indent=2) + '\n')
PY
exit "\${exit_code}"
`;
}

async function runSsh(targetArgs: string[], script: string, streamOutput = false): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return runCommand('ssh', [...targetArgs, 'bash', '-lc', script], { streamOutput });
}

export async function runRemoteBuild(context: CliContext, options: RemoteBuildOptions): Promise<number> {
  const id = generateBuildId();
  const script = remoteProvisionScript(options, id);
  const args = sshArgs(options.ssh);
  const manifest = remoteManifestPath(options.workspace, id);
  const buildDir = remoteBuildDir(options.workspace, id);
  const logFile = remoteLogPath(options.workspace, id);

  if (options.detach) {
    const detachedScript = `nohup bash -lc ${shellQuote(script)} > /dev/null 2>&1 < /dev/null & echo $!`;
    const result = await runSsh(args, detachedScript, false);
    if (result.exitCode !== 0) {
      throw new CliError('remote_build_failed', result.stderr || 'Failed to start detached remote build', result.exitCode);
    }
    const pid = Number.parseInt(result.stdout.trim(), 10);
    if (context.json) {
      emitJson(context, {
        command: 'remote-build',
        status: 'submitted',
        exit_code: 0,
        summary: 'submitted remote Buildroot build',
        details: { id, workspace: options.workspace, build_dir: buildDir, manifest, log_file: logFile, pid },
      });
    } else {
      emitText(context, `submitted: ${id}`);
      emitText(context, `manifest: ${manifest}`);
    }
    return 0;
  }

  const result = await runSsh(args, script, !context.json);
  if (context.json) {
    for (const line of result.stdout.split(/\r?\n/)) {
      if (!line) continue;
      emitJsonEvent(context, 'remote-build', 'log', { id, line });
    }
    emitJson(context, {
      command: 'remote-build',
      status: result.exitCode === 0 ? 'success' : 'error',
      exit_code: result.exitCode,
      summary: result.exitCode === 0 ? 'completed remote Buildroot build' : 'remote Buildroot build failed',
      details: { id, workspace: options.workspace, build_dir: buildDir, manifest, log_file: logFile },
      error: result.exitCode === 0 ? undefined : { code: 'remote_build_failed', message: result.stderr || 'remote build failed' },
    });
  }
  return result.exitCode;
}

export async function runRemoteInspect(context: CliContext, options: RemoteInspectOptions): Promise<number> {
  const manifest = remoteManifestPath(options.workspace, options.id);
  const result = await runSsh(sshArgs(options.ssh), `cat ${shellQuote(manifest)}`, false);
  if (result.exitCode !== 0) {
    throw new CliError('remote_manifest_missing', `Failed to read remote manifest: ${manifest}`, result.exitCode, result.stderr);
  }
  const details = JSON.parse(result.stdout) as BuildManifest;
  if (context.json) {
    emitJson(context, {
      command: 'remote-inspect',
      status: 'success',
      exit_code: 0,
      summary: 'inspected remote build',
      details: { manifest: details },
    });
  } else {
    emitText(context, `id: ${details.id}`);
    emitText(context, `status: ${details.status}`);
    emitText(context, `build_dir: ${details.buildDir ?? ''}`);
  }
  return 0;
}

export async function runRemoteLogs(context: CliContext, options: RemoteLogsOptions): Promise<number> {
  const logFile = remoteLogPath(options.workspace, options.id);
  const command = options.follow ? `tail -n +1 -f ${shellQuote(logFile)}` : `cat ${shellQuote(logFile)}`;
  const result = await runSsh(sshArgs(options.ssh), command, !context.json);
  if (result.exitCode !== 0) {
    throw new CliError('remote_logs_failed', `Failed to read remote logs: ${logFile}`, result.exitCode, result.stderr);
  }
  if (context.json) {
    for (const line of result.stdout.split(/\r?\n/)) {
      if (!line) continue;
      emitJsonEvent(context, 'remote-logs', 'log', { id: options.id, line });
    }
    emitJson(context, {
      command: 'remote-logs',
      status: 'success',
      exit_code: 0,
      summary: 'streamed remote logs',
      details: { id: options.id, follow: options.follow, log_file: logFile },
    });
  }
  return 0;
}

export async function runRemoteFetch(context: CliContext, options: RemoteFetchOptions): Promise<number> {
  await fs.mkdir(options.dest, { recursive: true });
  const remoteBase = remoteBuildDir(options.workspace, options.id);
  const destination = path.resolve(process.cwd(), options.dest);
  const remotePaths = options.paths.map((entry) => (
    entry.startsWith('/') ? entry : path.posix.join(remoteBase, entry)
  ));
  const pipeline = `ssh ${sshArgs(options.ssh).map(shellQuote).join(' ')} bash -lc ${shellQuote(`tar -cf - ${remotePaths.map(shellQuote).join(' ')}`)} | tar -xf - -C ${shellQuote(destination)}`;
  const result = await runCommand('bash', ['-lc', pipeline]);
  if (result.exitCode !== 0) {
    throw new CliError('remote_fetch_failed', 'Failed to fetch remote paths', result.exitCode, result.stderr);
  }
  if (context.json) {
    emitJson(context, {
      command: 'remote-fetch',
      status: 'success',
      exit_code: 0,
      summary: 'fetched explicit remote paths',
      details: { id: options.id, dest: destination, paths: options.paths },
    });
  } else {
    emitText(context, `fetched: ${options.paths.join(', ')}`);
    emitText(context, `dest: ${destination}`);
  }
  return 0;
}
