import { spawn } from 'node:child_process';
import { CliError } from './errors.js';

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; streamOutput?: boolean }): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options?.streamOutput) {
        process.stdout.write(text);
      }
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options?.streamOutput) {
        process.stderr.write(text);
      }
    });

    child.on('error', (error) => {
      reject(new CliError('spawn_failed', `Failed to execute ${command}: ${error.message}`));
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}
