export type CommandName =
  | 'help'
  | 'version'
  | 'build'
  | 'inspect'
  | 'clean'
  | 'remote-build'
  | 'remote-inspect'
  | 'remote-logs'
  | 'remote-fetch';

export interface JsonEnvelope {
  command: string;
  status: 'success' | 'error' | 'stream' | 'submitted';
  exit_code: number;
  summary?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  details?: Record<string, unknown>;
}

export interface CliContext {
  json: boolean;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface HelpCommand {
  name: CommandName;
  summary: string;
  usage: string[];
  flags?: Array<{ name: string; summary: string }>;
}

export interface ParsedSshTarget {
  original: string;
  user?: string;
  host: string;
  port?: number;
}

export interface LocalBuildOptions {
  source: string;
  output: string;
  defconfig?: string;
  makeArgs: string[];
  env: Record<string, string>;
  forwarded: string[];
}

export interface RemoteBuildOptions {
  ssh: ParsedSshTarget;
  workspace: string;
  buildrootVersion: string;
  defconfig?: string;
  makeArgs: string[];
  env: Record<string, string>;
  forwarded: string[];
  detach: boolean;
}

export interface InspectOptions {
  output?: string;
  manifest?: string;
}

export interface CleanOptions {
  output?: string;
  path?: string;
}

export interface RemoteInspectOptions {
  ssh: ParsedSshTarget;
  workspace: string;
  id: string;
}

export interface RemoteLogsOptions extends RemoteInspectOptions {
  follow: boolean;
}

export interface RemoteFetchOptions extends RemoteInspectOptions {
  paths: string[];
  dest: string;
}

export interface BuildManifest {
  id: string;
  mode: 'local' | 'remote';
  createdAt: string;
  updatedAt: string;
  status: 'queued' | 'running' | 'success' | 'error' | 'submitted';
  command: string;
  source?: string;
  output?: string;
  workspace?: string;
  buildrootVersion?: string;
  defconfig?: string;
  ssh?: ParsedSshTarget;
  makeArgs: string[];
  env: Record<string, string>;
  forwarded: string[];
  buildDir?: string;
  logFile?: string;
  pid?: number;
  exitCode?: number;
  errorMessage?: string;
}
