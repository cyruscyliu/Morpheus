import fs from 'node:fs/promises';
import path from 'node:path';
import { CliError } from './errors.js';
import type { BuildManifest } from './types.js';

export async function writeManifest(file: string, manifest: BuildManifest): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function readManifest(file: string): Promise<BuildManifest> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as BuildManifest;
  } catch (error) {
    throw new CliError('manifest_read_failed', `Failed to read manifest: ${file}`, 1, error instanceof Error ? error.message : error);
  }
}
