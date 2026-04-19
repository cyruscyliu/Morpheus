#!/usr/bin/env node
import process from 'node:process';
import { CliError } from './errors.js';
import { renderHelp, COMMANDS, getHelp } from './help.js';
import { emitErrorText, emitJson, emitText } from './io.js';
import { runLocalBuild, runInspect, runClean } from './local.js';
import { parseArgv } from './parser.js';
import { runRemoteBuild, runRemoteFetch, runRemoteInspect, runRemoteLogs } from './remote.js';
import type { CleanOptions, CliContext, InspectOptions, LocalBuildOptions, RemoteBuildOptions, RemoteFetchOptions, RemoteInspectOptions, RemoteLogsOptions } from './types.js';

const VERSION = '0.1.0';

function helpJson(topic?: string) {
  const command = topic ? getHelp(topic) : undefined;
  return {
    command: 'help',
    status: 'success' as const,
    exit_code: 0,
    summary: topic ? `help for ${topic}` : 'buildroot CLI help',
    details: command
      ? { command }
      : { commands: COMMANDS, global_flags: ['--json', '--help'] },
  };
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgv(argv);
  const context: CliContext = { json: parsed.json, stdout: process.stdout, stderr: process.stderr };

  if (parsed.help) {
    const topic = parsed.command === 'help' ? parsed.topic : parsed.command;
    if (context.json) emitJson(context, helpJson(topic));
    else emitText(context, renderHelp(topic));
    return 0;
  }

  switch (parsed.command) {
    case 'version':
      if (context.json) {
        emitJson(context, { command: 'version', status: 'success', exit_code: 0, summary: 'buildroot CLI version', details: { version: VERSION } });
      } else {
        emitText(context, VERSION);
      }
      return 0;
    case 'build':
      return runLocalBuild(context, parsed.options as LocalBuildOptions);
    case 'inspect':
      return runInspect(context, parsed.options as InspectOptions);
    case 'clean':
      return runClean(context, parsed.options as CleanOptions);
    case 'remote-build':
      return runRemoteBuild(context, parsed.options as RemoteBuildOptions);
    case 'remote-inspect':
      return runRemoteInspect(context, parsed.options as RemoteInspectOptions);
    case 'remote-logs':
      return runRemoteLogs(context, parsed.options as RemoteLogsOptions);
    case 'remote-fetch':
      return runRemoteFetch(context, parsed.options as RemoteFetchOptions);
    default:
      throw new CliError('unknown_command', `Unknown command: ${String(parsed.command)}`);
  }
}

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error: unknown) => {
  const cliError = error instanceof CliError ? error : new CliError('unexpected_error', error instanceof Error ? error.message : 'Unexpected error');
  const context: CliContext = { json: process.argv.includes('--json'), stdout: process.stdout, stderr: process.stderr };
  if (context.json) {
    emitJson(context, {
      command: process.argv[2] ?? 'help',
      status: 'error',
      exit_code: cliError.exitCode,
      summary: cliError.message,
      error: { code: cliError.code, message: cliError.message, details: cliError.details },
    });
  } else {
    emitErrorText(context, `${cliError.code}: ${cliError.message}`);
  }
  process.exitCode = cliError.exitCode;
});
