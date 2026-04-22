export type HelpTopic = {
  name: string;
  summary: string;
  usage: string[];
  flags: string[];
};

export const COMMANDS: HelpTopic[] = [
  {
    name: 'inspect',
    summary: 'Inspect a local libvmm source directory',
    usage: [
      'libvmm inspect --path PATH [--json]',
    ],
    flags: [
      '--path PATH',
      '--json',
    ],
  },
  {
    name: 'build',
    summary: 'Fetch/update libvmm source and build an example',
    usage: [
      'libvmm build --source DIR --microkit-sdk DIR --board NAME [--example NAME] [--linux PATH] [--initrd PATH] [--qemu PATH] [--toolchain-bin-dir DIR] [--git-url URL] [--git-ref REF] [--make-target TARGET] [--make-arg ARG ...] [--json]',
    ],
    flags: [
      '--source DIR',
      '--microkit-sdk DIR',
      '--board NAME',
      '--example NAME (default: virtio)',
      '--linux PATH (optional; passed as LINUX=... to make)',
      '--initrd PATH (optional; passed as INITRD=... to make)',
      '--qemu PATH (optional; passed as QEMU=... to make)',
      '--toolchain-bin-dir DIR (optional; prepended to PATH)',
      '--git-url URL (default: https://github.com/au-ts/libvmm)',
      '--git-ref REF (default: main)',
      '--make-target TARGET (default: empty; uses Makefile default)',
      '--make-arg ARG (repeatable)',
      '--json',
    ],
  },
  {
    name: 'version',
    summary: 'Print libvmm CLI version',
    usage: [
      'libvmm version [--json]',
    ],
    flags: [
      '--json',
    ],
  },
  {
    name: 'help',
    summary: 'Show help for a topic',
    usage: [
      'libvmm help [topic] [--json]',
    ],
    flags: [
      '--json',
    ],
  },
];

export function getHelp(topic?: string) {
  if (!topic) {
    return null;
  }
  return COMMANDS.find((command) => command.name === topic) || null;
}

export function renderHelp(topic?: string) {
  if (!topic) {
    const lines = [
      'libvmm',
      '',
      'Commands:',
      ...COMMANDS.map((command) => `  ${command.name}\t${command.summary}`),
      '',
      'Global flags:',
      '  --json',
      '  --help',
      '',
      'Use `libvmm help <command>` for per-command help.',
    ];
    return lines.join('\n');
  }
  const command = getHelp(topic);
  if (!command) {
    return `Unknown help topic: ${topic}`;
  }
  const lines = [
    `libvmm ${command.name}`,
    '',
    command.summary,
    '',
    'Usage:',
    ...command.usage.map((line) => `  ${line}`),
    '',
    'Flags:',
    ...command.flags.map((line) => `  ${line}`),
  ];
  return lines.join('\n');
}
