import fs from 'node:fs/promises';
import rawFs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { CliError } from './errors.js';
import { runCommand } from './exec.js';
import { generateBuildId } from './ids.js';
import { writeManifest, readManifest } from './manifest.js';
import { emitJson, emitJsonEvent, emitText } from './io.js';
import { manifestPathForOutput, resolvePath } from './paths.js';
import type { BuildManifest, CliContext, CleanOptions, FetchOptions, InspectOptions, LocalBuildOptions, LogsOptions, PatchOptions } from './types.js';

function makeEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...extra };
}

function defaultArchiveUrl(version: string): string {
  return `https://buildroot.org/downloads/buildroot-${version}.tar.gz`;
}

function expandMakeArg(value: string): string {
  const parallelism = Math.max(
    1,
    typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : ((os.cpus() || []).length || 1),
  );
  return String(value).replace(/\$\(nproc\)/g, String(parallelism));
}

function archiveName(version: string, archiveUrl?: string): string {
  if (archiveUrl) {
    try {
      return path.basename(new URL(archiveUrl).pathname);
    } catch {
      return path.basename(archiveUrl);
    }
  }
  return `buildroot-${version}.tar.gz`;
}

function listBuildrootSourcePatchFiles(patchDir: string): string[] {
  const results: string[] = [];
  const roots = [patchDir, path.join(patchDir, 'buildroot')]
    .filter((item, index, array) => array.indexOf(item) === index)
    .filter((item) => rawFs.existsSync(item));

  for (const root of roots) {
    const stack: string[] = [root];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const entry of rawFs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) {
          continue;
        }
      const nextPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(nextPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        if (!(entry.name.endsWith('.patch') || entry.name.endsWith('.diff'))) {
          continue;
        }
        if (root === patchDir && current !== patchDir) {
          continue;
        }
        results.push(nextPath);
      }
    }
  }

  results.sort((a, b) => a.localeCompare(b));
  return results;
}

function patchFingerprint(patchDir: string, patchFiles: string[]): string {
  const hash = crypto.createHash('sha256');
  for (const filePath of patchFiles) {
    hash.update(path.relative(patchDir, filePath));
    hash.update('\0');
    hash.update(rawFs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function patchStatePath(source: string): string {
  return path.join(source, '.morpheus-patches.json');
}

function readPatchState(source: string): any {
  const statePath = patchStatePath(source);
  if (!rawFs.existsSync(statePath)) {
    return null;
  }
  try {
    return JSON.parse(rawFs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writePatchState(source: string, value: unknown): Promise<void> {
  await fs.writeFile(patchStatePath(source), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function appendLog(filePath: string, ...chunks: Array<string | undefined>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  for (const chunk of chunks) {
    if (chunk) {
      await fs.appendFile(filePath, chunk, 'utf8');
    }
  }
}

function createBuildLogStreamer(context: CliContext, stage: string, logFile: string) {
  const writeChunk = async (stream: 'stdout' | 'stderr', chunk: string) => {
    await appendLog(logFile, chunk);
    if (context.json) {
      emitJsonEvent(context, 'build', 'log', { stage, stream, chunk });
    }
  };

  return {
    writeStdout(chunk: string) {
      void writeChunk('stdout', chunk);
    },
    writeStderr(chunk: string) {
      void writeChunk('stderr', chunk);
    },
  };
}

async function applyBuildConfigInputs(
  context: CliContext,
  source: string,
  output: string,
  options: LocalBuildOptions,
  logFile: string,
): Promise<void> {
  const fragmentLines = [...options.configFragments];
  if (options.patchDir) {
    fragmentLines.push(`BR2_GLOBAL_PATCH_DIR="${options.patchDir}"`);
  }
  if (fragmentLines.length === 0) {
    return;
  }

  const configPath = path.join(output, '.config');
  const currentConfig = await fs.readFile(configPath, 'utf8').catch(() => '');
  const nextConfig = currentConfig.endsWith('\n') || currentConfig.length === 0
    ? `${currentConfig}${fragmentLines.join('\n')}\n`
    : `${currentConfig}\n${fragmentLines.join('\n')}\n`;
  await fs.writeFile(configPath, nextConfig, 'utf8');

  const olddefconfigStream = createBuildLogStreamer(context, 'olddefconfig', logFile);
  const olddefconfigResult = await runCommand('make', ['-C', source, `O=${output}`, 'olddefconfig'], {
    env: makeEnv(options.env),
    streamOutput: !context.json,
    onStdoutChunk: (chunk) => { olddefconfigStream.writeStdout(chunk); },
    onStderrChunk: (chunk) => { olddefconfigStream.writeStderr(chunk); },
  });
  if (olddefconfigResult.exitCode !== 0) {
    throw new CliError(
      'build_failed',
      `Buildroot olddefconfig failed with exit code ${olddefconfigResult.exitCode}`,
      olddefconfigResult.exitCode,
    );
  }
}

export async function runFetch(context: CliContext, options: FetchOptions): Promise<number> {
  const source = resolvePath(options.source);
  const buildVersion = options.buildVersion;
  const archiveUrl = options.archiveUrl || (buildVersion ? defaultArchiveUrl(buildVersion) : null);
  if (!archiveUrl) {
    throw new CliError('missing_version', 'fetch requires --build-version VER or --archive-url URL');
  }

  const downloadsDir = resolvePath(options.downloadsDir || path.join(path.dirname(source), '..', 'downloads'));
  const archiveFile = archiveName(buildVersion || 'buildroot', archiveUrl);
  const archivePath = path.join(downloadsDir, archiveFile);
  const extractRoot = path.join(downloadsDir, '.extract');

  await fs.mkdir(downloadsDir, { recursive: true });
  if (!(await fs.stat(archivePath).then(() => true).catch(() => false))) {
    const download = await runCommand('curl', ['-fsSL', archiveUrl, '-o', archivePath], {
      streamOutput: !context.json,
    });
    if (download.exitCode !== 0) {
      throw new CliError('fetch_failed', download.stderr || `failed to download ${archiveUrl}`, download.exitCode);
    }
  }

  await fs.rm(extractRoot, { recursive: true, force: true });
  await fs.mkdir(extractRoot, { recursive: true });
  const extract = await runCommand('tar', ['-xzf', archivePath, '-C', extractRoot], {
    streamOutput: !context.json,
  });
  if (extract.exitCode !== 0) {
    throw new CliError('extract_failed', extract.stderr || `failed to extract ${archivePath}`, extract.exitCode);
  }

  const entries = await fs.readdir(extractRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length !== 1) {
    throw new CliError('extract_failed', `Expected one extracted source directory in ${extractRoot}`);
  }

  await fs.rm(source, { recursive: true, force: true });
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.rename(path.join(extractRoot, directories[0].name), source);
  await fs.rm(extractRoot, { recursive: true, force: true });

  const payload = {
    command: 'fetch',
    status: 'success' as const,
    exit_code: 0,
    summary: 'fetched managed Buildroot source directory',
    details: {
      source,
      build_version: buildVersion || null,
      archive: archivePath,
      archive_url: archiveUrl,
      downloads_dir: downloadsDir,
    },
  };
  if (context.json) {
    emitJson(context, payload);
  } else {
    emitText(context, source);
  }
  return 0;
}

export async function runPatch(context: CliContext, options: PatchOptions): Promise<number> {
  const source = resolvePath(options.source);
  const patchDir = resolvePath(options.patchDir);
  const sourceExists = await fs.stat(source).then(() => true).catch(() => false);
  if (!sourceExists) {
    throw new CliError('missing_source', `Missing Buildroot source directory: ${source}`);
  }
  const patchExists = await fs.stat(patchDir).then(() => true).catch(() => false);
  if (!patchExists) {
    throw new CliError('missing_patch_dir', `Missing patch directory: ${patchDir}`);
  }

  const patchFiles = listBuildrootSourcePatchFiles(patchDir);
  const fingerprint = patchFingerprint(patchDir, patchFiles);
  const state = readPatchState(source);
  const logFile = path.join(source, '.morpheus-patches.log');
  if (state && state.fingerprint === fingerprint) {
    const payload = {
      command: 'patch',
      status: 'success' as const,
      exit_code: 0,
      summary: 'reused patched Buildroot source directory',
      details: {
        source,
        patches: {
          dir: patchDir,
          files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
          fingerprint,
          applied: true,
          log_file: logFile,
        },
      },
    };
    if (context.json) emitJson(context, payload);
    else emitText(context, source);
    return 0;
  }

  await fs.writeFile(logFile, '', 'utf8');
  for (const patchFile of patchFiles) {
    await fs.appendFile(logFile, `>>> ${path.relative(patchDir, patchFile)}\n`, 'utf8');
    const result = await runCommand('patch', ['-d', source, '-p1', '-N', '-i', patchFile], {
      streamOutput: !context.json,
    });
    await fs.appendFile(logFile, result.stdout || '', 'utf8');
    await fs.appendFile(logFile, result.stderr || '', 'utf8');
    if (result.exitCode !== 0) {
      const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
      if (combined.includes('Reversed (or previously applied) patch detected!') && !combined.includes('FAILED')) {
        await fs.appendFile(logFile, 'already applied; skipping\n', 'utf8');
        continue;
      }
      throw new CliError('patch_failed', `Failed to apply patch ${path.relative(patchDir, patchFile)} (see ${logFile})`, result.exitCode);
    }
  }

  await writePatchState(source, {
    appliedAt: new Date().toISOString(),
    dir: patchDir,
    files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
    fingerprint,
  });

  const payload = {
    command: 'patch',
    status: 'success' as const,
    exit_code: 0,
    summary: 'patched managed Buildroot source directory',
    details: {
      source,
      patches: {
        dir: patchDir,
        files: patchFiles.map((filePath) => path.relative(patchDir, filePath)),
        fingerprint,
        applied: true,
        log_file: logFile,
      },
    },
  };
  if (context.json) emitJson(context, payload);
  else emitText(context, source);
  return 0;
}

export async function runLocalBuild(context: CliContext, options: LocalBuildOptions): Promise<number> {
  const source = resolvePath(options.source);
  const output = resolvePath(options.output);
  const patchDir = options.patchDir ? resolvePath(options.patchDir) : undefined;
  const id = generateBuildId();
  const manifestFile = manifestPathForOutput(output);
  const logFile = path.join(output, '.buildroot-cli', 'stdout.log');
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(path.dirname(logFile), { recursive: true });
  await fs.writeFile(logFile, '', 'utf8');

  const manifest: BuildManifest = {
    id,
    mode: 'local',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    command: 'build',
    source,
    output,
    logFile,
    defconfig: options.defconfig,
    patchDir,
    configFragments: options.configFragments,
    makeArgs: options.makeArgs,
    env: options.env,
    forwarded: options.forwarded,
  };
  await writeManifest(manifestFile, manifest);

  if (options.defconfig) {
    const defconfigStream = createBuildLogStreamer(context, 'defconfig', logFile);
    const defconfigResult = await runCommand('make', ['-C', source, `O=${output}`, options.defconfig], {
      env: makeEnv(options.env),
      streamOutput: !context.json,
      onStdoutChunk: (chunk) => { defconfigStream.writeStdout(chunk); },
      onStderrChunk: (chunk) => { defconfigStream.writeStderr(chunk); },
    });
    if (defconfigResult.exitCode !== 0) {
      manifest.status = 'error';
      manifest.exitCode = defconfigResult.exitCode;
      manifest.errorMessage = defconfigResult.stderr || defconfigResult.stdout;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(manifestFile, manifest);
      throw new CliError('build_failed', `Buildroot defconfig failed with exit code ${defconfigResult.exitCode}`, defconfigResult.exitCode);
    }
  }

  try {
    await applyBuildConfigInputs(context, source, output, { ...options, patchDir }, logFile);
  } catch (error) {
    if (error instanceof CliError) {
      manifest.status = 'error';
      manifest.exitCode = error.exitCode;
      manifest.errorMessage = error.message;
      manifest.updatedAt = new Date().toISOString();
      await writeManifest(manifestFile, manifest);
    }
    throw error;
  }

  const makeStream = createBuildLogStreamer(context, 'make', logFile);
  const result = await runCommand('make', ['-C', source, `O=${output}`, ...options.makeArgs.map(expandMakeArg), ...options.forwarded], {
    env: makeEnv(options.env),
    streamOutput: !context.json,
    onStdoutChunk: (chunk) => { makeStream.writeStdout(chunk); },
    onStderrChunk: (chunk) => { makeStream.writeStderr(chunk); },
  });

  manifest.status = result.exitCode === 0 ? 'success' : 'error';
  manifest.exitCode = result.exitCode;
  manifest.updatedAt = new Date().toISOString();
  manifest.errorMessage = result.exitCode === 0 ? undefined : result.stderr || result.stdout;
  await writeManifest(manifestFile, manifest);

  if (context.json) {
    emitJson(context, {
      command: 'build',
      status: result.exitCode === 0 ? 'success' : 'error',
      exit_code: result.exitCode,
      summary: result.exitCode === 0 ? 'completed local Buildroot build' : 'local Buildroot build failed',
      details: {
        id,
        source,
        output,
        manifest: manifestFile,
        log_file: logFile,
        defconfig: options.defconfig ?? null,
        patch_dir: patchDir ?? null,
        config_fragments: options.configFragments,
        make_args: options.makeArgs,
        forwarded: options.forwarded,
      },
      error: result.exitCode === 0 ? undefined : { code: 'build_failed', message: manifest.errorMessage ?? 'Build failed' },
    });
  } else {
    emitText(context, `build ${manifest.status}: ${id}`);
    emitText(context, `manifest: ${manifestFile}`);
  }

  return result.exitCode;
}

export async function runInspect(context: CliContext, options: InspectOptions): Promise<number> {
  const manifestFile = options.manifest ? resolvePath(options.manifest) : manifestPathForOutput(resolvePath(options.output!));
  const manifest = await readManifest(manifestFile);
  if (context.json) {
    emitJson(context, {
      command: 'inspect',
      status: 'success',
      exit_code: 0,
      summary: 'inspected local build manifest',
      details: { manifest },
    });
  } else {
    emitText(context, `id: ${manifest.id}`);
    emitText(context, `status: ${manifest.status}`);
    emitText(context, `manifest: ${manifestFile}`);
  }
  return 0;
}

export async function runLogs(context: CliContext, options: LogsOptions): Promise<number> {
  const manifestFile = options.manifest ? resolvePath(options.manifest) : manifestPathForOutput(resolvePath(options.output!));
  const manifest = await readManifest(manifestFile);
  const logFile = manifest.logFile || path.join(path.dirname(manifestFile), 'stdout.log');
  const text = await fs.readFile(logFile, 'utf8');
  if (context.json) {
    emitJson(context, {
      command: 'logs',
      status: 'success',
      exit_code: 0,
      summary: 'read local build log',
      details: {
        manifest: manifestFile,
        log_file: logFile,
        text,
      },
    });
  } else {
    emitText(context, text);
  }
  return 0;
}

export async function runClean(context: CliContext, options: CleanOptions): Promise<number> {
  const target = resolvePath(options.output ?? options.path!);
  await fs.rm(target, { recursive: true, force: true });
  if (context.json) {
    emitJson(context, {
      command: 'clean',
      status: 'success',
      exit_code: 0,
      summary: 'removed local path',
      details: { path: target },
    });
  } else {
    emitText(context, `removed: ${target}`);
  }
  return 0;
}

export async function localManifestExists(output: string): Promise<boolean> {
  try {
    await fs.stat(path.dirname(manifestPathForOutput(output)));
    return true;
  } catch {
    return false;
  }
}
