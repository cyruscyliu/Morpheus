import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const toolRoot = process.cwd();
const bin = path.join(toolRoot, 'dist', 'index.js');
const fixture = path.join(toolRoot, 'test', 'fixtures', 'minimal-buildroot');
const outDir = path.join(toolRoot, '.tmp-smoke-out');

fs.rmSync(outDir, { recursive: true, force: true });

const build = spawnSync(process.execPath, [
  bin,
  '--json',
  'build',
  '--source',
  fixture,
  '--output',
  outDir,
  '--defconfig',
  'qemu_x86_64_defconfig',
], { encoding: 'utf8', cwd: toolRoot });

if (build.status !== 0) {
  process.stderr.write(build.stdout || build.stderr);
  process.exit(build.status ?? 1);
}

const buildPayload = JSON.parse(build.stdout.trim());
const artifact = path.join(outDir, 'images', 'smoke-rootfs.tar');
if (!fs.existsSync(artifact)) {
  process.stderr.write(`missing smoke artifact: ${path.relative(toolRoot, artifact)}\n`);
  process.exit(1);
}

const inspect = spawnSync(process.execPath, [
  bin,
  '--json',
  'inspect',
  '--output',
  outDir,
], { encoding: 'utf8', cwd: toolRoot });

if (inspect.status !== 0) {
  process.stderr.write(inspect.stdout || inspect.stderr);
  process.exit(inspect.status ?? 1);
}

const inspectPayload = JSON.parse(inspect.stdout.trim());
process.stdout.write(JSON.stringify({
  build: buildPayload.details,
  inspect: inspectPayload.details,
  artifact: path.relative(toolRoot, artifact),
}) + '\n');
