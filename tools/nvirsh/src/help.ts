export const COMMANDS = [
  {
    name: 'doctor',
    summary: 'Validate target prerequisites without writing state',
    usage: ['nvirsh doctor --target sel4 --qemu PATH --microkit-sdk DIR --toolchain DIR --libvmm-dir DIR --sel4-dir DIR'],
  },
  {
    name: 'prepare',
    summary: 'Validate and materialize target-local prepared state',
    usage: ['nvirsh prepare --target sel4 --state-dir DIR --qemu PATH --microkit-sdk DIR --toolchain DIR --libvmm-dir DIR --sel4-dir DIR'],
  },
  {
    name: 'run',
    summary: 'Launch a prepared target from explicit runtime artifacts',
    usage: ['nvirsh run --target sel4 --state-dir DIR --kernel PATH --initrd PATH [--detach] [--qemu-arg ARG ...]'],
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
    name: 'clean',
    summary: 'Remove local prepared state and logs',
    usage: ['nvirsh clean --state-dir DIR [--force]'],
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
