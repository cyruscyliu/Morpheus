import type { HelpCommand } from './types.js';

export const COMMANDS: HelpCommand[] = [
  {
    name: 'build',
    summary: 'Run a local Buildroot build',
    usage: ['buildroot build --source DIR --output DIR [--defconfig NAME] [--make-arg ARG ...] [--env KEY=VALUE ...] [-- ...]'],
    flags: [
      { name: '--source DIR', summary: 'Buildroot source directory' },
      { name: '--output DIR', summary: 'Buildroot output directory' },
      { name: '--defconfig NAME', summary: 'Optional Buildroot defconfig target' },
      { name: '--make-arg ARG', summary: 'Additional make argument (repeatable)' },
      { name: '--env KEY=VALUE', summary: 'Environment variable for build commands (repeatable)' },
    ],
  },
  {
    name: 'inspect',
    summary: 'Inspect a local build manifest',
    usage: ['buildroot inspect --output DIR', 'buildroot inspect --manifest FILE'],
  },
  {
    name: 'clean',
    summary: 'Remove a local build output or explicit path',
    usage: ['buildroot clean --output DIR', 'buildroot clean --path DIR'],
  },
  {
    name: 'remote-build',
    summary: 'Provision and run a Buildroot build over SSH',
    usage: ['buildroot remote-build --ssh TARGET --workspace DIR --buildroot-version VER [--defconfig NAME] [--detach] [--make-arg ARG ...] [--env KEY=VALUE ...] [-- ...]'],
  },
  {
    name: 'remote-inspect',
    summary: 'Inspect a remote build by generated id',
    usage: ['buildroot remote-inspect --ssh TARGET --workspace DIR --id BUILD_ID'],
  },
  {
    name: 'remote-logs',
    summary: 'Read remote build logs by generated id',
    usage: ['buildroot remote-logs --ssh TARGET --workspace DIR --id BUILD_ID [--follow]'],
  },
  {
    name: 'remote-fetch',
    summary: 'Copy explicit remote paths for a build id',
    usage: ['buildroot remote-fetch --ssh TARGET --workspace DIR --id BUILD_ID --dest DIR --path REMOTE_PATH [--path REMOTE_GLOB ...]'],
  },
  {
    name: 'version',
    summary: 'Print buildroot CLI version',
    usage: ['buildroot version'],
  },
  {
    name: 'help',
    summary: 'Print help for the CLI or a command',
    usage: ['buildroot help [command]', 'buildroot --help', 'buildroot <command> --help'],
  },
];

export function getHelp(command?: string): HelpCommand | undefined {
  if (!command) {
    return undefined;
  }
  return COMMANDS.find((entry) => entry.name === command);
}

export function renderHelp(command?: string): string {
  const entry = getHelp(command);
  if (!entry) {
    const lines = [
      'buildroot — Unix-like CLI for local and remote Buildroot workflows',
      '',
      'Usage:',
      '  buildroot <command> [options]',
      '',
      'Commands:',
      ...COMMANDS.map((item) => `  ${item.name.padEnd(14)} ${item.summary}`),
      '',
      'Global flags:',
      '  --json          Emit machine-readable output',
      '  --help, -h      Print help',
    ];
    return lines.join('\n');
  }

  const lines = [`buildroot ${entry.name} — ${entry.summary}`, '', 'Usage:'];
  for (const usage of entry.usage) {
    lines.push(`  ${usage}`);
  }
  if (entry.flags && entry.flags.length > 0) {
    lines.push('', 'Flags:');
    for (const flag of entry.flags) {
      lines.push(`  ${flag.name.padEnd(18)} ${flag.summary}`);
    }
  }
  lines.push('', 'Global flags:', '  --json          Emit machine-readable output', '  --help, -h      Print help');
  return lines.join('\n');
}
