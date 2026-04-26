export const COMMANDS = [
  {
    name: 'inspect',
    summary: 'Inspect a local Microkit SDK directory',
    usage: ['microkit-sdk inspect --path PATH'],
    flags: [
      { name: '--path PATH', summary: 'Path to a Microkit SDK directory' },
    ],
  },
  {
    name: 'build',
    summary: 'Materialize a managed Microkit SDK directory',
    usage: [
      'microkit-sdk build --source DIR [--microkit-version VER] [--archive-url URL] [--downloads-dir DIR]',
    ],
    flags: [
      { name: '--source DIR', summary: 'Managed SDK directory' },
      { name: '--microkit-version VER', summary: 'SDK version to record in metadata' },
      { name: '--archive-url URL', summary: 'Archive URL to fetch when --source is missing' },
      { name: '--downloads-dir DIR', summary: 'Directory used to cache fetched archives' },
    ],
  },
  {
    name: 'version',
    summary: 'Print microkit-sdk tool CLI version',
    usage: ['microkit-sdk version'],
  },
  {
    name: 'help',
    summary: 'Print help for the CLI or a command',
    usage: ['microkit-sdk help [command]', 'microkit-sdk --help', 'microkit-sdk <command> --help'],
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
      'microkit-sdk — Unix-like CLI for managed Microkit SDK directories',
      '',
      'Usage:',
      '  microkit-sdk <command> [options]',
      '',
      'Commands:',
      ...COMMANDS.map((item) => `  ${item.name.padEnd(14)} ${item.summary}`),
      '',
      'Global flags:',
      '  --json          Emit machine-readable output',
      '  --help, -h      Print help',
    ].join('\n');
  }

  const lines = [`microkit-sdk ${entry.name} — ${entry.summary}`, '', 'Usage:'];
  for (const usage of entry.usage) {
    lines.push(`  ${usage}`);
  }
  if ('flags' in entry && entry.flags && entry.flags.length > 0) {
    lines.push('', 'Flags:');
    for (const flag of entry.flags) {
      lines.push(`  ${flag.name.padEnd(24)} ${flag.summary}`);
    }
  }
  lines.push('', 'Global flags:', '  --json          Emit machine-readable output', '  --help, -h      Print help');
  return lines.join('\n');
}
