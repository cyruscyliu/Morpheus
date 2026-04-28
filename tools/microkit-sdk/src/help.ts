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
    name: 'fetch',
    summary: 'Fetch a managed Microkit SDK directory',
    usage: [
      'microkit-sdk fetch --source DIR [--build-version VER] [--archive-url URL] [--downloads-dir DIR]',
    ],
    flags: [
      { name: '--source DIR', summary: 'Managed SDK directory' },
      { name: '--build-version VER', summary: 'SDK version to record in metadata' },
      { name: '--archive-url URL', summary: 'Archive URL to fetch when --source is missing' },
      { name: '--downloads-dir DIR', summary: 'Directory used to cache fetched archives' },
    ],
  },
  {
    name: 'patch',
    summary: 'Apply a patch tree to a managed Microkit SDK directory',
    usage: [
      'microkit-sdk patch --source DIR --patch-dir DIR',
    ],
    flags: [
      { name: '--source DIR', summary: 'Managed SDK directory' },
      { name: '--patch-dir DIR', summary: 'Directory containing patches to apply' },
    ],
  },
  {
    name: 'build',
    summary: 'Materialize a managed Microkit SDK directory',
    usage: [
      'microkit-sdk build --source DIR [--build-version VER] [--archive-url URL] [--downloads-dir DIR]',
    ],
    flags: [
      { name: '--source DIR', summary: 'Managed SDK directory' },
      { name: '--build-version VER', summary: 'SDK version to record in metadata' },
      { name: '--archive-url URL', summary: 'Archive URL to fetch when --source is missing' },
      { name: '--downloads-dir DIR', summary: 'Directory used to cache fetched archives' },
    ],
  },
  {
    name: 'logs',
    summary: 'Read stable local Microkit SDK logs',
    usage: ['microkit-sdk logs --source DIR', 'microkit-sdk logs --path DIR'],
    flags: [
      { name: '--source DIR', summary: 'Managed SDK directory' },
      { name: '--path DIR', summary: 'Alias of --source' },
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
