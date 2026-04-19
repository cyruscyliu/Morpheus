import { randomUUID } from 'node:crypto';

export function generateBuildId(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `br-${stamp}-${randomUUID().slice(0, 8)}`;
}
