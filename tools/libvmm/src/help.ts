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
    name: 'fetch',
    summary: 'Fetch or update a managed libvmm source directory',
    usage: [
      'libvmm fetch --source DIR [--git-url URL] [--build-version REF] [--git-ref REF] [--json]',
    ],
    flags: [
      '--source DIR',
      '--git-url URL (default: https://github.com/au-ts/libvmm)',
      '--build-version REF (alias of --git-ref)',
      '--git-ref REF (default: main)',
      '--json',
    ],
  },
  {
    name: 'patch',
    summary: 'Apply a patch tree to a managed libvmm source directory',
    usage: [
      'libvmm patch --source DIR --patch-dir DIR [--json]',
    ],
    flags: [
      '--source DIR',
      '--patch-dir DIR',
      '--json',
    ],
  },
  {
    name: 'build',
    summary: 'Fetch/update libvmm source and build an example',
    usage: [
      'libvmm build --source DIR --microkit-sdk DIR --board NAME [--example NAME] [--patch-dir DIR] [--linux PATH] [--initrd PATH] [--qemu PATH] [--toolchain-bin-dir DIR] [--git-url URL] [--build-version REF] [--git-ref REF] [--make-target TARGET] [--make-arg ARG ...] [--json]',
    ],
    flags: [
      '--source DIR',
      '--microkit-sdk DIR',
      '--board NAME',
      '--example NAME (default: virtio)',
      '--patch-dir DIR (optional; applies *.patch/*.diff after fetch/update)',
      '--linux PATH (optional; passed as LINUX=... to make)',
      '--initrd PATH (optional; passed as INITRD=... to make)',
      '--qemu PATH (optional; passed as QEMU=... to make)',
      '--toolchain-bin-dir DIR (optional; prepended to PATH)',
      '--git-url URL (default: https://github.com/au-ts/libvmm)',
      '--build-version REF (alias of --git-ref)',
      '--git-ref REF (default: main)',
      '--make-target TARGET (default: empty; uses Makefile default)',
      '--make-arg ARG (repeatable)',
      '--json',
    ],
  },
  {
    name: 'run',
    summary: 'Launch a libvmm example runtime action',
    usage: [
      'libvmm run --contract PATH [--action qemu] --libvmm-dir DIR --microkit-sdk DIR --board NAME --kernel PATH --initrd PATH --qemu PATH [--microkit-config debug|release] [--toolchain-bin-dir DIR] [--run-dir DIR] [--detach] [--json]',
    ],
    flags: [
      '--contract PATH',
      '--action NAME (default: qemu)',
      '--libvmm-dir DIR',
      '--microkit-sdk DIR',
      '--board NAME',
      '--kernel PATH',
      '--initrd PATH',
      '--qemu PATH',
      '--microkit-config NAME (default: debug)',
      '--toolchain-bin-dir DIR (optional; prepended to PATH)',
      '--run-dir DIR (optional; defaults under the libvmm directory)',
      '--detach',
      '--json',
    ],
  },
  {
    name: 'logs',
    summary: 'Read stable local libvmm logs',
    usage: [
      'libvmm logs --source DIR [--json]',
      'libvmm logs --run-dir DIR [--json]',
    ],
    flags: [
      '--source DIR',
      '--run-dir DIR',
      '--json',
    ],
  },
  {
    name: 'stop',
    summary: 'Stop a recorded libvmm runtime action',
    usage: [
      'libvmm stop --run-dir DIR [--json]',
    ],
    flags: [
      '--run-dir DIR',
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
