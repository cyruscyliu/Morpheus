export const COMMANDS = [
  {
    name: 'inspect',
    summary: 'Inspect a local QEMU executable',
    usage: ['qemu inspect --path PATH'],
    flags: [
      { name: '--path PATH', summary: 'Path to a QEMU executable' },
    ],
  },
  {
    name: 'build',
    summary: 'Fetch, unpack, build, and install QEMU',
    usage: [
      'qemu build --source DIR [--qemu-version VER] [--archive-url URL] --build-dir DIR --install-dir DIR [--target-list NAME ...] [--configure-arg ARG ...]',
    ],
    flags: [
      { name: '--source DIR', summary: 'Managed QEMU source tree' },
      { name: '--qemu-version VER', summary: 'QEMU version to fetch when --source is missing' },
      { name: '--archive-url URL', summary: 'Override archive URL for fetches or tests' },
      { name: '--build-dir DIR', summary: 'Build directory' },
      { name: '--install-dir DIR', summary: 'Install prefix' },
      { name: '--target-list NAME', summary: 'Repeatable QEMU target to build' },
      { name: '--configure-arg ARG', summary: 'Repeatable configure argument' },
    ],
  },
  {
    name: 'version',
    summary: 'Print qemu tool CLI version',
    usage: ['qemu version'],
  },
  {
    name: 'help',
    summary: 'Print help for the CLI or a command',
    usage: ['qemu help [command]', 'qemu --help', 'qemu <command> --help'],
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
      'qemu — Unix-like CLI for local QEMU executable inspection',
      '',
      'Usage:',
      '  qemu <command> [options]',
      '',
      'Commands:',
      ...COMMANDS.map((item) => `  ${item.name.padEnd(14)} ${item.summary}`),
      '',
      'Global flags:',
      '  --json          Emit machine-readable output',
      '  --help, -h      Print help',
    ].join('\n');
  }

  const lines = [`qemu ${entry.name} — ${entry.summary}`, '', 'Usage:'];
  for (const usage of entry.usage) {
    lines.push(`  ${usage}`);
  }
  if ('flags' in entry && entry.flags && entry.flags.length > 0) {
    lines.push('', 'Flags:');
    for (const flag of entry.flags) {
      lines.push(`  ${flag.name.padEnd(18)} ${flag.summary}`);
    }
  }
  lines.push('', 'Global flags:', '  --json          Emit machine-readable output', '  --help, -h      Print help');
  return lines.join('\n');
}
