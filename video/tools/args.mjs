// @ts-check
// Tiny CLI parser shared by the video scripts: --flow send --lang es --aspect 9x16 (also --flow=send).
// Defaults: flow send, lang es, aspect 9x16. "all" expands to every value in config.json where a script supports it.

/** @param {string[]} argv @returns {{ flow: string, lang: string, aspect: string, [k: string]: string }} */
export function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = { flow: 'send', lang: 'es', aspect: '9x16' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  return /** @type {any} */ (out);
}
