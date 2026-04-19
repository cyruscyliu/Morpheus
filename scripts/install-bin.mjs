import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const descriptorRoots = [
  path.join(repoRoot, 'tools'),
  path.join(repoRoot, 'apps'),
];
const binDir = path.join(repoRoot, 'bin');
const marker = '# managed-by-install-bin';

function listToolDescriptors() {
  return descriptorRoots
    .filter((root) => fs.existsSync(root))
    .flatMap((root) => fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, 'tool.json')))
    .filter((descriptorPath) => fs.existsSync(descriptorPath))
    .map((descriptorPath) => {
      const toolRoot = path.dirname(descriptorPath);
      const raw = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'));
      return {
        descriptorPath,
        toolRoot,
        name: raw.name,
        runtime: raw.runtime,
        entry: raw.entry,
      };
    });
}

function validateDescriptor(descriptor) {
  if (!descriptor.name || !descriptor.runtime || !descriptor.entry) {
    throw new Error(`Invalid tool descriptor: ${path.relative(repoRoot, descriptor.descriptorPath)}`);
  }

  if (!['node', 'exec'].includes(descriptor.runtime)) {
    throw new Error(`Unsupported runtime '${descriptor.runtime}' in ${path.relative(repoRoot, descriptor.descriptorPath)}`);
  }

  const resolvedEntry = path.join(descriptor.toolRoot, descriptor.entry);
  if (!fs.existsSync(resolvedEntry)) {
    throw new Error(`Missing tool entry '${descriptor.entry}' in ${path.relative(repoRoot, descriptor.descriptorPath)}`);
  }

  return {
    ...descriptor,
    resolvedEntry,
    repoRelativeEntry: path.relative(repoRoot, resolvedEntry),
  };
}

function wrapperContent(tool) {
  const entry = `$ROOT/${tool.repoRelativeEntry}`;
  if (tool.runtime === 'node') {
    return `#!/usr/bin/env sh
${marker}
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec node "${entry}" "$@"
`;
  }

  return `#!/usr/bin/env sh
${marker}
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec "${entry}" "$@"
`;
}

function cleanupManagedWrappers(expectedNames) {
  if (!fs.existsSync(binDir)) {
    return;
  }

  for (const name of fs.readdirSync(binDir)) {
    const target = path.join(binDir, name);
    if (!fs.statSync(target).isFile()) {
      continue;
    }
    const content = fs.readFileSync(target, 'utf8');
    if (content.includes(marker) && !expectedNames.has(name)) {
      fs.rmSync(target, { force: true });
    }
  }
}

const tools = listToolDescriptors().map(validateDescriptor);
const expectedNames = new Set(tools.map((tool) => tool.name));

fs.mkdirSync(binDir, { recursive: true });
cleanupManagedWrappers(expectedNames);

for (const tool of tools) {
  const target = path.join(binDir, tool.name);
  fs.writeFileSync(target, wrapperContent(tool), 'utf8');
  fs.chmodSync(target, 0o755);
}

process.stdout.write(`installed ${tools.length} wrappers in ${path.relative(repoRoot, binDir) || 'bin'}\n`);
