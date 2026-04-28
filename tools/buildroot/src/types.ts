export type CommandName =
  | 'help'
  | 'version'
  | 'fetch'
  | 'patch'
  | 'build'
  | 'inspect'
  | 'logs'
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
  patchDir?: string;
  configFragments: string[];
  makeArgs: string[];
  env: Record<string, string>;
  forwarded: string[];
}

export interface FetchOptions {
  source: string;
  downloadsDir?: string;
  buildVersion?: string;
  archiveUrl?: string;
}

export interface PatchOptions {
  source: string;
  patchDir: string;
}

export interface InspectOptions {
  output?: string;
  manifest?: string;
}

export interface LogsOptions {
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
  logFile?: string;
  defconfig?: string;
  patchDir?: string;
  configFragments: string[];
  makeArgs: string[];
  env: Record<string, string>;
  forwarded: string[];
  exitCode?: number;
  errorMessage?: string;
}
