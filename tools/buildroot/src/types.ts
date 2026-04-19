export type CommandName =
  | 'help'
  | 'version'
  | 'build'
  | 'inspect'
  | 'clean';

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

export interface LocalBuildOptions {
  source: string;
  output: string;
  defconfig?: string;
  makeArgs: string[];
  env: Record<string, string>;
  forwarded: string[];
}

export interface InspectOptions {
  output?: string;
  manifest?: string;
}

export interface CleanOptions {
  output?: string;
  path?: string;
}

export interface BuildManifest {
  id: string;
  mode: 'local';
  createdAt: string;
  updatedAt: string;
  status: 'queued' | 'running' | 'success' | 'error' | 'submitted';
  command: string;
  source?: string;
  output?: string;
  defconfig?: string;
  makeArgs: string[];
  env: Record<string, string>;
  forwarded: string[];
  exitCode?: number;
  errorMessage?: string;
}
