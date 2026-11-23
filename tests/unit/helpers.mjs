import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** All files under `dir` (relative to ROOT) matching `ext`, as absolute paths. */
export function walk(dir, ext) {
  const out = [];
  const go = d => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) go(p);
      else if (p.endsWith(ext)) out.push(p);
    }
  };
  go(join(ROOT, dir));
  return out;
}
