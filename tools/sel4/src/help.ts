export const COMMANDS = [
  {
    name: 'inspect',
    summary: 'Inspect a local seL4 source directory',
    usage: ['sel4 inspect --path PATH'],
    flags: [
      { name: '--path PATH', summary: 'Path to a seL4 source directory' },
    ],
  },
  {
    name: 'build',
    summary: 'Materialize a managed seL4 source directory',
    usage: [
      'sel4 build --source DIR [--sel4-version VER] [--archive-url URL] [--patch-dir DIR]',
    ],
    flags: [
      { name: '--source DIR', summary: 'Managed seL4 source directory' },
      { name: '--sel4-version VER', summary: 'seL4 version to record in metadata' },
      { name: '--archive-url URL', summary: 'Archive URL to fetch when --source is missing' },
      { name: '--patch-dir DIR', summary: 'Directory containing patches to apply after fetch' },
    ],
  },
  {
    name: 'version',
    summary: 'Print sel4 tool CLI version',
    usage: ['sel4 version'],
  },
  {
    name: 'help',
    summary: 'Print help for the CLI or a command',
    usage: ['sel4 help [command]', 'sel4 --help', 'sel4 <command> --help'],
  },
] as const;

export function getHelp(command?: string) {
  if (!command) {
    return undefined;
  }
  return COMMANDS.find((entry) => entry.name === command);
}

export function renderHelp(command?: string): string {
  const entry = getHelp(command);
  if (!entry) {
    return [
      'sel4 — Unix-like CLI for managed seL4 source directories',
      '',
      'Usage:',
      '  sel4 <command> [options]',
      '',
      'Commands:',
      ...COMMANDS.map((item) => `  ${item.name.padEnd(14)} ${item.summary}`),
      '',
      'Global flags:',
      '  --json          Emit machine-readable output',
      '  --help, -h      Print help',
    ].join('\n');
  }

  const lines = [`sel4 ${entry.name} — ${entry.summary}`, '', 'Usage:'];
  for (const usage of entry.usage) {
    lines.push(`  ${usage}`);
  }
  if ('flags' in entry && entry.flags && entry.flags.length > 0) {
    lines.push('', 'Flags:');
    for (const flag of entry.flags) {
      lines.push(`  ${flag.name.padEnd(20)} ${flag.summary}`);
    }
  }
  lines.push('', 'Global flags:', '  --json          Emit machine-readable output', '  --help, -h      Print help');
  return lines.join('\n');
}
