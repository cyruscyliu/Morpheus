import { CliError } from './errors.js';
import { parseSshTarget } from './ssh.js';
import type { CleanOptions, InspectOptions, LocalBuildOptions, ParsedSshTarget, RemoteBuildOptions, RemoteFetchOptions, RemoteInspectOptions, RemoteLogsOptions } from './types.js';

export interface ParsedCli {
  json: boolean;
  help: boolean;
  command: string;
  topic?: string;
  options:
    | LocalBuildOptions
    | InspectOptions
    | CleanOptions
    | RemoteBuildOptions
    | RemoteInspectOptions
    | RemoteLogsOptions
    | RemoteFetchOptions
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

function parseRemoteCommon(args: string[]): { ssh?: ParsedSshTarget; workspace?: string; id?: string; rest: string[] } {
  let ssh: ParsedSshTarget | undefined;
  let workspace: string | undefined;
  let id: string | undefined;
  const rest: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--ssh') {
      ssh = parseSshTarget(requireValue(args, i, arg));
      i += 1;
    } else if (arg === '--workspace') {
      workspace = requireValue(args, i, arg);
      i += 1;
    } else if (arg === '--id') {
      id = requireValue(args, i, arg);
      i += 1;
    } else {
      rest.push(arg);
    }
  }
  return { ssh, workspace, id, rest };
}

function parseRemoteBuild(args: string[]): RemoteBuildOptions {
  const common = parseRemoteCommon(args);
  let buildrootVersion = '';
  let defconfig: string | undefined;
  let detach = false;
  const makeArgs: string[] = [];
  const envArgs: string[] = [];
  const forwarded: string[] = [];
  let passthrough = false;

  for (let i = 0; i < common.rest.length; i += 1) {
    const arg = common.rest[i];
    if (passthrough) {
      forwarded.push(arg);
      continue;
    }
    switch (arg) {
      case '--':
        passthrough = true;
        break;
      case '--buildroot-version':
        buildrootVersion = requireValue(common.rest, i, arg);
        i += 1;
        break;
      case '--defconfig':
        defconfig = requireValue(common.rest, i, arg);
        i += 1;
        break;
      case '--detach':
        detach = true;
        break;
      case '--make-arg':
        makeArgs.push(requireValue(common.rest, i, arg));
        i += 1;
        break;
      case '--env':
        envArgs.push(requireValue(common.rest, i, arg));
        i += 1;
        break;
      default:
        throw new CliError('unknown_flag', `Unknown flag for remote-build: ${arg}`);
    }
  }

  if (!common.ssh) throw new CliError('missing_ssh', 'remote-build requires --ssh TARGET');
  if (!common.workspace) throw new CliError('missing_workspace', 'remote-build requires --workspace DIR');
  if (!buildrootVersion) throw new CliError('missing_buildroot_version', 'remote-build requires --buildroot-version VER');

  return {
    ssh: common.ssh,
    workspace: common.workspace,
    buildrootVersion,
    defconfig,
    makeArgs,
    env: parseKeyValues(envArgs),
    forwarded,
    detach,
  };
}

function parseRemoteInspect(args: string[]): RemoteInspectOptions {
  const common = parseRemoteCommon(args);
  if (!common.ssh) throw new CliError('missing_ssh', 'remote-inspect requires --ssh TARGET');
  if (!common.workspace) throw new CliError('missing_workspace', 'remote-inspect requires --workspace DIR');
  if (!common.id) throw new CliError('missing_id', 'remote-inspect requires --id BUILD_ID');
  if (common.rest.length > 0) throw new CliError('unknown_flag', `Unknown flag for remote-inspect: ${common.rest[0]}`);
  return { ssh: common.ssh, workspace: common.workspace, id: common.id };
}

function parseRemoteLogs(args: string[]): RemoteLogsOptions {
  const common = parseRemoteCommon(args);
  let follow = false;
  for (const arg of common.rest) {
    if (arg === '--follow') {
      follow = true;
    } else {
      throw new CliError('unknown_flag', `Unknown flag for remote-logs: ${arg}`);
    }
  }
  if (!common.ssh) throw new CliError('missing_ssh', 'remote-logs requires --ssh TARGET');
  if (!common.workspace) throw new CliError('missing_workspace', 'remote-logs requires --workspace DIR');
  if (!common.id) throw new CliError('missing_id', 'remote-logs requires --id BUILD_ID');
  return { ssh: common.ssh, workspace: common.workspace, id: common.id, follow };
}

function parseRemoteFetch(args: string[]): RemoteFetchOptions {
  const common = parseRemoteCommon(args);
  const paths: string[] = [];
  let dest = '';
  for (let i = 0; i < common.rest.length; i += 1) {
    const arg = common.rest[i];
    switch (arg) {
      case '--path':
        paths.push(requireValue(common.rest, i, arg));
        i += 1;
        break;
      case '--dest':
        dest = requireValue(common.rest, i, arg);
        i += 1;
        break;
      default:
        throw new CliError('unknown_flag', `Unknown flag for remote-fetch: ${arg}`);
    }
  }
  if (!common.ssh) throw new CliError('missing_ssh', 'remote-fetch requires --ssh TARGET');
  if (!common.workspace) throw new CliError('missing_workspace', 'remote-fetch requires --workspace DIR');
  if (!common.id) throw new CliError('missing_id', 'remote-fetch requires --id BUILD_ID');
  if (paths.length === 0) throw new CliError('missing_paths', 'remote-fetch requires at least one --path REMOTE_PATH');
  if (!dest) throw new CliError('missing_dest', 'remote-fetch requires --dest DIR');
  return { ssh: common.ssh, workspace: common.workspace, id: common.id, paths, dest };
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
    case 'remote-build':
      return { json: globalJson, help, command: head, options: parseRemoteBuild(filteredTail) };
    case 'remote-inspect':
      return { json: globalJson, help, command: head, options: parseRemoteInspect(filteredTail) };
    case 'remote-logs':
      return { json: globalJson, help, command: head, options: parseRemoteLogs(filteredTail) };
    case 'remote-fetch':
      return { json: globalJson, help, command: head, options: parseRemoteFetch(filteredTail) };
    default:
      throw new CliError('unknown_command', `Unknown command: ${head}`);
  }
}
