import fs from 'node:fs/promises';
import path from 'node:path';
import { CliError } from './errors.js';
import { runCommand } from './exec.js';
import { generateBuildId } from './ids.js';
import { writeManifest, readManifest } from './manifest.js';
import { emitJson, emitText } from './io.js';
import { manifestPathForOutput, resolvePath } from './paths.js';
import type { BuildManifest, CliContext, CleanOptions, InspectOptions, LocalBuildOptions } from './types.js';

function makeEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  return { ...process.env, ...extra };
}

export async function runLocalBuild(context: CliContext, options: LocalBuildOptions): Promise<number> {
  const source = resolvePath(options.source);
  const output = resolvePath(options.output);
  const id = generateBuildId();
  const manifestFile = manifestPathForOutput(output);
  await fs.mkdir(output, { recursive: true });

  const manifest: BuildManifest = {
    id,
    mode: 'local',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    command: 'build',
    source,
    output,
    defconfig: options.defconfig,
    makeArgs: options.makeArgs,
    env: options.env,
    forwarded: options.forwarded,
  };
  await writeManifest(manifestFile, manifest);

  if (options.defconfig) {
    const defconfigResult = await runCommand('make', ['-C', source, `O=${output}`, options.defconfig], {
      env: makeEnv(options.env),
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

  const result = await runCommand('make', ['-C', source, `O=${output}`, ...options.makeArgs, ...options.forwarded], {
    env: makeEnv(options.env),
    streamOutput: !context.json,
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
        defconfig: options.defconfig ?? null,
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
