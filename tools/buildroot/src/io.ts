import fs from 'node:fs';
import type { CliContext, JsonEnvelope } from './types.js';

function writeLine(stream: NodeJS.WritableStream, text: string): void {
  const line = `${text}\n`;
  if ('fd' in stream && typeof stream.fd === 'number') {
    fs.writeSync(stream.fd, line);
    return;
  }
  stream.write(line);
}

export function emitJson(context: CliContext, payload: JsonEnvelope): void {
  writeLine(context.stdout, JSON.stringify(payload));
}

export function emitJsonEvent(context: CliContext, command: string, event: string, details: Record<string, unknown>): void {
  emitJson(context, {
    command,
    status: 'stream',
    exit_code: 0,
    details: { event, ...details },
  });
}

export function emitText(context: CliContext, message: string): void {
  writeLine(context.stdout, message);
}

export function emitErrorText(context: CliContext, message: string): void {
  writeLine(context.stderr, message);
}
