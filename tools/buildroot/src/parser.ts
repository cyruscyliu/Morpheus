import { CliError } from './errors.js';
import type { CleanOptions, InspectOptions, LocalBuildOptions } from './types.js';

export interface ParsedCli {
  json: boolean;
  help: boolean;
  command: string;
  topic?: string;
  options:
    | LocalBuildOptions
    | InspectOptions
    | CleanOptions
    | Record<string, never>;
}

function consumeCommon(argv: string[]): { globalJson: boolean; rest: string[] } {
  let globalJson = false;
  const rest: string[] = [];
  for (const arg of argv) {
    if (arg === '--json') {
      globalJson = true;
    } else {
      rest.push(arg);
    }
  }
  return { globalJson, rest };
}

function parseKeyValues(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of values) {
    const eq = item.indexOf('=');
    if (eq <= 0) {
      throw new CliError('invalid_env', `Expected KEY=VALUE but received: ${item}`);
    }
    out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('missing_flag_value', `Missing value for ${flag}`);
  }
  return value;
}

function parseBuild(args: string[]): LocalBuildOptions {
  let source = '';
  let output = '';
  let defconfig: string | undefined;
  const makeArgs: string[] = [];
  const envArgs: string[] = [];
  const forwarded: string[] = [];
  let passthrough = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (passthrough) {
      forwarded.push(arg);
      continue;
    }
    switch (arg) {
      case '--':
        passthrough = true;
        break;
      case '--source':
        source = requireValue(args, i, arg);
        i += 1;
        break;
      case '--output':
        output = requireValue(args, i, arg);
        i += 1;
        break;
      case '--defconfig':
        defconfig = requireValue(args, i, arg);
        i += 1;
        break;
      case '--make-arg':
        makeArgs.push(requireValue(args, i, arg));
        i += 1;
        break;
      case '--env':
        envArgs.push(requireValue(args, i, arg));
        i += 1;
        break;
      case '--help':
      case '-h':
        break;
      default:
        throw new CliError('unknown_flag', `Unknown flag for build: ${arg}`);
    }
  }

  if (!source) throw new CliError('missing_source', 'build requires --source DIR');
  if (!output) throw new CliError('missing_output', 'build requires --output DIR');

  return { source, output, defconfig, makeArgs, env: parseKeyValues(envArgs), forwarded };
}

function parseInspect(args: string[]): InspectOptions {
  const options: InspectOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--output':
        options.output = requireValue(args, i, arg);
        i += 1;
        break;
      case '--manifest':
        options.manifest = requireValue(args, i, arg);
        i += 1;
        break;
      default:
        throw new CliError('unknown_flag', `Unknown flag for inspect: ${arg}`);
    }
  }
  if (!options.output && !options.manifest) {
    throw new CliError('missing_target', 'inspect requires --output DIR or --manifest FILE');
  }
  return options;
}

function parseClean(args: string[]): CleanOptions {
  const options: CleanOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--output':
        options.output = requireValue(args, i, arg);
        i += 1;
        break;
      case '--path':
        options.path = requireValue(args, i, arg);
        i += 1;
        break;
      default:
        throw new CliError('unknown_flag', `Unknown flag for clean: ${arg}`);
    }
  }
  if (!options.output && !options.path) {
    throw new CliError('missing_target', 'clean requires --output DIR or --path DIR');
  }
  return options;
}

export function parseArgv(argv: string[]): ParsedCli {
  const { globalJson, rest } = consumeCommon(argv);
  const [head, ...tail] = rest;

  if (!head || head === 'help' || head === '--help' || head === '-h') {
    return { json: globalJson, help: true, command: 'help', topic: tail[0], options: {} };
  }

  if (head === 'version' || head === '--version' || head === '-v') {
    return { json: globalJson, help: false, command: 'version', options: {} };
  }

  const help = tail.includes('--help') || tail.includes('-h');
  const filteredTail = tail.filter((arg) => arg !== '--help' && arg !== '-h');

  switch (head) {
    case 'build':
      return { json: globalJson, help, command: head, options: parseBuild(filteredTail) };
    case 'inspect':
      return { json: globalJson, help, command: head, options: parseInspect(filteredTail) };
    case 'clean':
      return { json: globalJson, help, command: head, options: parseClean(filteredTail) };
    default:
      throw new CliError('unknown_command', `Unknown command: ${head}`);
  }
}
