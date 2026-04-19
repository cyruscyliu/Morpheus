import path from 'node:path';

export function resolvePath(input: string): string {
  return path.resolve(process.cwd(), input);
}

export function manifestPathForOutput(outputDir: string): string {
  return path.join(outputDir, '.buildroot-cli', 'build.json');
}

export function remoteBuildDir(workspace: string, id: string): string {
  return path.posix.join(workspace, 'builds', id);
}

export function buildrootTarballUrl(version: string): string {
  return `https://buildroot.org/downloads/buildroot-${version}.tar.gz`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
