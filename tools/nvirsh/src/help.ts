export const COMMANDS = [
  {
    name: 'doctor',
    summary: 'Validate target prerequisites for a Morpheus-managed invocation',
    usage: [
      'nvirsh doctor [Morpheus-internal]',
      '',
      'Notes:',
      '  - Invoke this command only through morpheus workflow execution.',
    ],
  },
  {
    name: 'exec',
    summary: 'Launch from explicit runtime artifacts as a Morpheus-managed step',
    usage: [
      'nvirsh exec [Morpheus-internal]',
      '',
      'Notes:',
      '  - Invoke this command only through morpheus workflow execution.',
      '  - Morpheus prepares the managed run directory and explicit artifacts.',
    ],
  },
  {
    name: 'inspect',
    summary: 'Inspect Morpheus-managed prepared or running state',
    usage: ['nvirsh inspect [Morpheus-internal]'],
  },
  {
    name: 'stop',
    summary: 'Stop a Morpheus-managed running instance',
    usage: ['nvirsh stop [Morpheus-internal]'],
  },
  {
    name: 'logs',
    summary: 'Print Morpheus-managed logs for an instance',
    usage: ['nvirsh logs [Morpheus-internal]'],
  },
  {
    name: 'remove',
    summary: 'Remove Morpheus-managed prepared state and logs after stop',
    usage: ['nvirsh remove [Morpheus-internal]'],
  },
  {
    name: 'help',
    summary: 'Print help for the CLI or a command',
    usage: ['nvirsh help [command]', 'nvirsh --help', 'nvirsh <command> --help'],
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
      'nvirsh — Unix-like CLI for local nested virtualization lifecycle control',
      '',
      'Usage:',
      '  nvirsh <command> [options]',
      '',
      'Commands:',
      ...COMMANDS.map((item) => `  ${item.name.padEnd(14)} ${item.summary}`),
      '',
      'Global flags:',
      '  --json          Emit machine-readable output',
      '  --help, -h      Print help',
      '',
      'Execution policy:',
      '  Invoke nvirsh only through morpheus workflow commands.',
    ].join('\n');
  }

  return [
    `nvirsh ${entry.name} — ${entry.summary}`,
    '',
    'Usage:',
    ...entry.usage.map((line) => `  ${line}`),
    '',
    'Global flags:',
    '  --json          Emit machine-readable output',
    '  --help, -h      Print help',
  ].join('\n');
}
