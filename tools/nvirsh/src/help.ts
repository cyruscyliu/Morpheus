export const COMMANDS = [
  {
    name: 'doctor',
    summary: 'Validate target prerequisites without writing state',
    usage: [
      'nvirsh doctor --target sel4 --qemu PATH --microkit-sdk DIR --toolchain DIR --libvmm-dir DIR',
      '             [--microkit-config debug|release]',
    ],
  },
  {
    name: 'run',
    summary: 'Validate prerequisites, materialize local state, and launch from explicit runtime artifacts',
    usage: [
      'nvirsh run --target sel4 --state-dir DIR --qemu PATH --microkit-sdk DIR --toolchain DIR --libvmm-dir DIR --kernel PATH --initrd PATH [--detach] [--runtime-contract PATH] [--qemu-arg ARG ...]',
      '',
      'Notes:',
      '  - nvirsh run prepares local state automatically when it is missing.',
      '  - Without --detach, nvirsh runs in the foreground and attaches to the VM console.',
      '  - --json output requires --detach (otherwise console output is not machine-readable).',
    ],
  },
  {
    name: 'inspect',
    summary: 'Inspect local prepared or running state',
    usage: ['nvirsh inspect --state-dir DIR'],
  },
  {
    name: 'stop',
    summary: 'Stop a local running instance',
    usage: ['nvirsh stop --state-dir DIR'],
  },
  {
    name: 'logs',
    summary: 'Print local logs for an instance',
    usage: ['nvirsh logs --state-dir DIR [--follow]'],
  },
  {
    name: 'remove',
    summary: 'Remove local prepared state and logs after stop',
    usage: ['nvirsh remove --state-dir DIR'],
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
