import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const defaultProjectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function transportFileFor(projectRoot: string): string {
  const file = process.env.MEMORY_LOOP_TRANSPORT_FILE ?? join(projectRoot, '.memory-loop', 'transport.json');
  if (!isAbsolute(file)) throw new Error('Transport configuration is invalid');
  return normalize(file);
}

export function projectRootFromArgs(args: string[]): string {
  if (args.length === 0) return defaultProjectRoot;
  if (args.length !== 2 || args[0] !== '--project-root' || !isAbsolute(args[1])) throw new Error('Invalid runtime arguments');
  return args[1];
}
