#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseArgs(argv) {
  const flags = {};
  const booleanFlags = new Set(['json', 'copy', 'force', 'help']);

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!booleanFlags.has(key) && next && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return flags;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/nvirsh/prepare-sel4-deps.mjs [options]',
    '',
    'Options:',
    '  --config PATH           Morpheus config path, default: morpheus.yaml',
    '  --qemu PATH             Existing qemu-system-aarch64 binary',
    '  --microkit-sdk DIR      Existing Microkit SDK directory',
    '  --toolchain DIR         Existing ARM toolchain directory',
    '  --libvmm-dir DIR        Existing libvmm directory',
    '  --sel4-dir DIR          Existing seL4 directory',
    '  --copy                  Copy instead of symlink',
    '  --force                 Replace existing targets',
    '  --json                  Emit machine-readable output',
    '  --help                  Print help',
  ].join('\n');
}

function emitJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function resolveLocalPath(baseDir, inputPath) {
  if (!inputPath) {
    return null;
  }
  if (path.isAbsolute(inputPath)) {
    return inputPath;
  }
  return path.resolve(baseDir, inputPath);
}

function countIndent(line) {
  const match = /^(\s*)/.exec(line);
  return match ? match[1].length : 0;
}

function parseToolSection(raw, toolName) {
  const lines = raw.split(/\r?\n/);
  const toolsIndex = lines.findIndex((line) => /^\s*tools:\s*$/.test(line));
  if (toolsIndex < 0) {
    return null;
  }

  const toolsIndent = countIndent(lines[toolsIndex]);
  let toolIndent = null;
  let toolStart = -1;

  for (let index = toolsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }
    const indent = countIndent(line);
    if (indent <= toolsIndent) {
      break;
    }
    if (new RegExp(`^\\s*${toolName}:\\s*$`).test(line)) {
      toolIndent = indent;
      toolStart = index;
      break;
    }
  }

  if (toolStart < 0 || toolIndent == null) {
    return null;
  }

  const value = {};
  for (let index = toolStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    const indent = countIndent(line);
    if (indent <= toolIndent) {
      break;
    }
    const match = /^\s*([A-Za-z0-9_-]+):\s*(.+?)\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (rawValue === '' || rawValue === '|' || rawValue === '>') {
      continue;
    }
    value[key] = rawValue.replace(/^["']|["']$/g, '');
  }
  return value;
}

function pathType(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isSymbolicLink()) {
      return 'symlink';
    }
    if (stat.isDirectory()) {
      return 'directory';
    }
    if (stat.isFile()) {
      return 'file';
    }
    return 'other';
  } catch {
    return 'missing';
  }
}

function removeExisting(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function linkTypeForSource(sourcePath) {
  const stat = fs.statSync(sourcePath);
  if (stat.isDirectory()) {
    return 'dir';
  }
  return 'file';
}

function ensureParent(targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
}

function stageDependency({ name, source, target, copyMode, force }) {
  if (!source) {
    throw new Error(`missing source for ${name}`);
  }

  const resolvedSource = path.resolve(source);
  if (!fs.existsSync(resolvedSource)) {
    throw new Error(`source for ${name} does not exist: ${resolvedSource}`);
  }

  const existingType = pathType(target);
  if (existingType !== 'missing') {
    const alreadyLinked = existingType === 'symlink'
      && path.resolve(path.dirname(target), fs.readlinkSync(target)) === resolvedSource;
    if (alreadyLinked) {
      return {
        name,
        source: resolvedSource,
        target,
        mode: 'symlink',
        status: 'unchanged',
      };
    }
    if (!force) {
      throw new Error(`target already exists for ${name}: ${target}`);
    }
    removeExisting(target);
  }

  ensureParent(target);
  if (copyMode) {
    const stat = fs.statSync(resolvedSource);
    if (stat.isDirectory()) {
      fs.cpSync(resolvedSource, target, { recursive: true });
    } else {
      fs.copyFileSync(resolvedSource, target);
      fs.chmodSync(target, stat.mode);
    }
    return {
      name,
      source: resolvedSource,
      target,
      mode: 'copy',
      status: 'staged',
    };
  }

  const relativeSource = path.relative(path.dirname(target), resolvedSource) || '.';
  fs.symlinkSync(relativeSource, target, linkTypeForSource(resolvedSource));
  return {
    name,
    source: resolvedSource,
    target,
    mode: 'symlink',
    status: 'staged',
  };
}

function main(argv) {
  const flags = parseArgs(argv);
  if (flags.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const configPath = path.resolve(String(flags.config || 'morpheus.yaml'));
  if (!fs.existsSync(configPath)) {
    throw new Error(`config does not exist: ${configPath}`);
  }

  const configDir = path.dirname(configPath);
  const rawConfig = fs.readFileSync(configPath, 'utf8');
  const qemuConfig = parseToolSection(rawConfig, 'qemu');
  const microkitConfig = parseToolSection(rawConfig, 'microkit-sdk');
  const nvirshConfig = parseToolSection(rawConfig, 'nvirsh');
  const sel4Config = parseToolSection(rawConfig, 'sel4');
  if (!qemuConfig) {
    throw new Error('morpheus.yaml is missing tools.qemu');
  }
  if (!nvirshConfig) {
    throw new Error('morpheus.yaml is missing tools.nvirsh');
  }

  const targets = {
    qemu: resolveLocalPath(configDir, qemuConfig.path || qemuConfig.executable),
    'microkit-sdk': resolveLocalPath(
      configDir,
      (microkitConfig && (microkitConfig.path || microkitConfig.source))
        || nvirshConfig['microkit-sdk']
        || nvirshConfig.microkitSdk
    ),
    toolchain: resolveLocalPath(configDir, nvirshConfig.toolchain),
    'libvmm-dir': resolveLocalPath(configDir, nvirshConfig['libvmm-dir'] || nvirshConfig.libvmmDir),
    'sel4-dir': resolveLocalPath(
      configDir,
      (sel4Config && (sel4Config.path || sel4Config.source))
        || nvirshConfig['sel4-dir']
        || nvirshConfig.sel4Dir
    ),
  };

  const sources = {
    qemu: flags.qemu,
    'microkit-sdk': flags['microkit-sdk'],
    toolchain: flags.toolchain,
    'libvmm-dir': flags['libvmm-dir'],
    'sel4-dir': flags['sel4-dir'],
  };

  const staged = Object.entries(targets).map(([name, target]) => stageDependency({
    name,
    source: sources[name],
    target,
    copyMode: Boolean(flags.copy),
    force: Boolean(flags.force),
  }));

  const payload = {
    command: 'prepare-sel4-deps',
    status: 'success',
    exit_code: 0,
    summary: `staged ${staged.length} sel4 dependencies`,
    details: {
      config: path.relative(process.cwd(), configPath),
      mode: flags.copy ? 'copy' : 'symlink',
      staged,
    },
  };

  if (flags.json) {
    emitJson(payload);
  } else {
    for (const item of staged) {
      process.stdout.write(`${item.name}\t${item.mode}\t${path.relative(process.cwd(), item.target)}\n`);
    }
  }
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  if (process.argv.includes('--json')) {
    emitJson({
      command: 'prepare-sel4-deps',
      status: 'error',
      exit_code: 1,
      summary: message,
      error: {
        code: 'prepare_sel4_deps_error',
        message,
      },
    });
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exitCode = 1;
}
