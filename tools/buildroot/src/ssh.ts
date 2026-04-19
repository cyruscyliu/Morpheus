import { CliError } from './errors.js';
import type { ParsedSshTarget } from './types.js';

export function parseSshTarget(input: string): ParsedSshTarget {
  if (input.startsWith('ssh://')) {
    const url = new URL(input);
    if (!url.hostname) {
      throw new CliError('invalid_ssh_target', `Invalid SSH target: ${input}`);
    }
    return {
      original: input,
      user: url.username || undefined,
      host: url.hostname,
      port: url.port ? Number(url.port) : undefined,
    };
  }

  const match = /^(?:(?<user>[^@]+)@)?(?<host>[^:]+)(?::(?<port>\d+))?$/.exec(input);
  if (!match?.groups?.host) {
    throw new CliError('invalid_ssh_target', `Invalid SSH target: ${input}`);
  }

  return {
    original: input,
    user: match.groups.user,
    host: match.groups.host,
    port: match.groups.port ? Number(match.groups.port) : undefined,
  };
}

export function sshDestination(target: ParsedSshTarget): string {
  return target.user ? `${target.user}@${target.host}` : target.host;
}

export function sshArgs(target: ParsedSshTarget): string[] {
  const args: string[] = [];
  if (target.port !== undefined) {
    args.push('-p', String(target.port));
  }
  args.push(sshDestination(target));
  return args;
}

export function scpArgs(target: ParsedSshTarget): string[] {
  const args: string[] = [];
  if (target.port !== undefined) {
    args.push('-P', String(target.port));
  }
  return args;
}
