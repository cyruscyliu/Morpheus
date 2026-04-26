#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { spawn } from 'node:child_process';

function readJson(filePath: string) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function updateManifest(manifestPath: string, mutator: (value: Record<string, unknown>) => Record<string, unknown>) {
  const current = readJson(manifestPath);
  const next = mutator(current);
  next.updatedAt = new Date().toISOString();
  writeJson(manifestPath, next);
}

async function main(argv: string[]) {
  const manifestPath = argv[0];
  if (!manifestPath) {
    throw new Error('runner requires a manifest path');
  }

  const manifest = readJson(manifestPath);
  const runtime = manifest.runtime || {};
  const command = runtime.command;
  if (!Array.isArray(command) || command.length === 0) {
    throw new Error('manifest is missing runtime.command');
  }

  const logFile = manifest.logFile;
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const attach = String(process.env.NVIRSH_ATTACH || '') === '1';
  const child = spawn(command[0], command.slice(1), {
    cwd: manifest.stateDir,
    detached: false,
    stdio: [attach ? 'inherit' : 'ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    log.write(chunk);
    if (attach) {
      process.stdout.write(chunk);
    }
  });
  child.stderr.on('data', (chunk) => {
    log.write(chunk);
    if (attach) {
      process.stderr.write(chunk);
    }
  });

  updateManifest(manifestPath, (current) => ({
    ...current,
    status: 'running',
    pid: child.pid,
    runnerPid: process.pid,
    startedAt: new Date().toISOString(),
  }));

  child.on('close', (code, signal) => {
    log.end();
    updateManifest(manifestPath, (current) => ({
      ...current,
      status: code === 0 ? 'success' : signal ? 'stopped' : 'error',
      exitCode: code == null ? null : code,
      signal: signal || null,
      finishedAt: new Date().toISOString(),
    }));
    process.exit(code == null ? 1 : code);
  });

  child.on('error', (error) => {
    log.write(`${String(error.message)}\n`);
    log.end();
    updateManifest(manifestPath, (current) => ({
      ...current,
      status: 'error',
      errorMessage: error.message,
      finishedAt: new Date().toISOString(),
    }));
    process.exit(1);
  });
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Unexpected runner error'}\n`);
  process.exit(1);
});
