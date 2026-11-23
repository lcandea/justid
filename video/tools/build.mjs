// @ts-check
// Builds one HyperFrames project for a (flow, lang, aspect) combination into video/.build/<flow>-<lang>-<aspect>/.
// The sources in video/src/ are HTML templates; this script fills in the on-screen copy (video/strings/<lang>.json),
// the scenario data (video/config.json), the canvas size and the captured app assets (video/.cache/captures/<lang>/).
// Nothing here touches the app or its deploy: the output folder is git-ignored and disposable.
//
// Usage: node video/tools/build.mjs --flow send --lang es --aspect 9x16
//
// Template syntax (in .html and .css files under video/src/):
//   {{t:send.hook_a}}         string, HTML-escaped; *word* becomes <span class="hl">word</span> (accent colour)
//   {{words:send.hook_a}}     same, but every word wrapped in <span class="w"> (for per-word kinetic type)
//   {{cfg:send.purpose}}      value from config.json (objects keyed by language resolve to the current language)
//   {{W}} {{H}} {{ASPECT}} {{LANG}} {{FLOW}} {{FPS}}
//   {{patch:<prefix>:<side>:<field>:<image>}}  one <div class="patch"> per zone rect of <field> on <side>, each
//                             showing that rect of assets/cap/<image>.png, ids <prefix>-<field>-<n>. Put it inside a
//                             positioned card box (position: relative) whose aspect ratio is the card's.
//   {{ring:<prefix>:<side>:<field>}}  lime dashed .zone-ring outlines over the field's rects, ids <prefix>-<field>-<n>
//   <!--if:9x16--> … <!--endif-->   kept only for that aspect (also if:16x9, if:es, if:en)
// Strings may contain {purpose} / {from}, filled from the flow's config.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(VIDEO, '..');

/** @param {string} p */
const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

/** @param {string} s */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Escape, then turn *word* into an accent span. @param {string} s */
const rich = s => esc(s).replace(/\*([^*]+)\*/g, '<span class="hl">$1</span>');

/** Per-word spans; accent words keep the .hl class. @param {string} s */
function words(s) {
  const out = [];
  let accent = false;
  for (const token of s.split(/\s+/).filter(Boolean)) {
    const opens = token.startsWith('*'), closes = token.endsWith('*') && token.length > 1;
    if (opens) accent = true;
    const text = esc(token.replace(/\*/g, ''));
    out.push(`<span class="w${accent ? ' hl' : ''}">${text}</span>`);
    if (closes || (opens && token.length > 1 && token.slice(1).includes('*'))) accent = false;
  }
  return out.join(' ');
}

/** @param {any} obj @param {string} path */
function dig(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Build one project and return its folder.
 * @param {{ flow: string, lang: string, aspect: string }} o
 */
export function build({ flow, lang, aspect }) {
  const config = readJson(join(VIDEO, 'config.json'));
  if (!config.flows.includes(flow)) throw new Error(`unknown flow "${flow}" (${config.flows.join(', ')})`);
  if (!config.langs.includes(lang)) throw new Error(`unknown lang "${lang}" (${config.langs.join(', ')})`);
  const size = config.aspects[aspect];
  if (!size) throw new Error(`unknown aspect "${aspect}" (${Object.keys(config.aspects).join(', ')})`);

  const strings = readJson(join(VIDEO, 'strings', `${lang}.json`));
  const capDir = join(VIDEO, '.cache', 'captures', lang);
  const zonesFile = join(VIDEO, '.cache', 'captures', 'zones.json');
  if (!existsSync(join(capDir, 'manifest.json')) || !existsSync(zonesFile)) {
    throw new Error(`no captures for "${lang}": run  npm run video:capture -- --lang ${lang}`);
  }
  const manifest = readJson(join(capDir, 'manifest.json'));
  const zones = readJson(zonesFile);

  /** Config value, with { es, en } objects resolved to the current language. @param {string} path */
  const cfg = path => {
    const v = dig(config, path);
    if (v && typeof v === 'object' && !Array.isArray(v) && lang in v) return v[lang];
    return v;
  };
  const fill = (/** @type {string} */ s) => s.replace(/\{(purpose|from)\}/g, (_, k) => cfg(`${flow}.${k}`) ?? `{${k}}`);
  /** @param {string} key */
  const str = key => {
    const v = dig(strings, key);
    if (typeof v !== 'string') throw new Error(`strings/${lang}.json: missing "${key}"`);
    return fill(v);
  };

  /** Zone rects (card fractions) of a field on one side. @param {string} side @param {string} field @returns {{x:number,y:number,w:number,h:number}[]} */
  const zoneRects = (side, field) => {
    const rects = zones?.sides?.[side]?.[field]?.rects ?? zones?.[side]?.[field]?.rects ?? zones?.[side]?.[field];
    if (!Array.isArray(rects) || !rects.length) throw new Error(`zones.json: no rects for ${side}.${field}`);
    return rects;
  };
  const pct = (/** @type {number} */ n) => `${(n * 100).toFixed(3)}%`;

  /** @param {string} prefix @param {string} side @param {string} field @param {string} image */
  const patches = (prefix, side, field, image) => {
    return zoneRects(side, field).map((r, i) => {
      const inner = `width:${pct(1 / r.w)};height:${pct(1 / r.h)};left:${pct(-r.x / r.w)};top:${pct(-r.y / r.h)}`;
      return `<div class="patch" id="${prefix}-${field}-${i}" data-field="${field}" data-side="${side}" ` +
        `style="left:${pct(r.x)};top:${pct(r.y)};width:${pct(r.w)};height:${pct(r.h)}">` +
        `<img src="assets/cap/${image}.png" alt="" style="${inner}"></div>`;
    }).join('\n');
  };

  /** Lime dashed outlines (.zone-ring) over each rect of a field, ids <prefix>-<field>-<n>. @param {string} prefix @param {string} side @param {string} field */
  const rings = (prefix, side, field) => zoneRects(side, field).map((r, i) =>
    `<div class="zone-ring" id="${prefix}-${field}-${i}" data-field="${field}" style="left:${pct(r.x)};top:${pct(r.y)};width:${pct(r.w)};height:${pct(r.h)}"></div>`).join('\n');

  /** @param {string} text */
  const render = text => text
    .replace(/<!--if:([\w-]+)-->([\s\S]*?)<!--endif-->/g, (_, cond, body) => (cond === aspect || cond === lang ? body : ''))
    .replace(/\{\{(\w+)(?::([^}]+))?\}\}/g, (m, kind, arg) => {
      switch (kind) {
        case 'W': return String(size.width);
        case 'H': return String(size.height);
        case 'ASPECT': return aspect;
        case 'LANG': return lang;
        case 'FLOW': return flow;
        case 'FPS': return String(config.fps);
        case 't': return rich(str(arg));
        case 'words': return words(str(arg));
        case 'cfg': { const v = cfg(arg); if (v == null) throw new Error(`config.json: missing "${arg}"`); return esc(String(v)); }
        case 'patch': { const [prefix, side, field, image] = arg.split(':'); return patches(prefix, side, field, image); }
        case 'ring': { const [prefix, side, field] = arg.split(':'); return rings(prefix, side, field); }
        default: throw new Error(`unknown template tag ${m}`);
      }
    });

  const out = join(VIDEO, '.build', `${flow}-${lang}-${aspect}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'assets'), { recursive: true });

  // Templates: the flow's own folder (index.html + compositions/) and the shared partials.
  const srcFlow = join(VIDEO, 'src', flow);
  /** @param {string} from @param {string} to */
  const copyTemplated = (from, to) => {
    for (const name of readdirSync(from)) {
      const src = join(from, name), dst = join(to, name);
      if (statSync(src).isDirectory()) { mkdirSync(dst, { recursive: true }); copyTemplated(src, dst); continue; }
      if (['.html', '.css', '.js'].includes(extname(name))) {
        try { writeFileSync(dst, render(readFileSync(src, 'utf8'))); }
        catch (e) { throw new Error(`${relative(ROOT, src)}: ${/** @type {Error} */ (e).message}`); }
      } else cpSync(src, dst);
    }
  };
  copyTemplated(srcFlow, out);
  mkdirSync(join(out, 'assets', 'shared'), { recursive: true });
  copyTemplated(join(VIDEO, 'src', 'shared'), join(out, 'assets', 'shared'));

  // The app's real design: tokens, fonts and component styles, copied as they are.
  mkdirSync(join(out, 'assets', 'app'), { recursive: true });
  // theme.css as-is except the system-font fallbacks after Archivo / JetBrains Mono: the video ships both fonts, and
  // HyperFrames' lint rejects font names it cannot supply (SFMono-Regular, Segoe UI…).
  const theme = readFileSync(join(ROOT, 'shared', 'theme.css'), 'utf8')
    .replace(/(--sans:\s*'Archivo')[^;]*;/, '$1, sans-serif;')
    .replace(/(--mono:\s*'JetBrains Mono')[^;]*;/, '$1, monospace;');
  writeFileSync(join(out, 'assets', 'app', 'theme.css'), theme);
  cpSync(join(ROOT, 'shared', 'fonts'), join(out, 'assets', 'app', 'fonts'), { recursive: true });
  for (const css of ['common.css', 'flow.css', 'request.css']) cpSync(join(ROOT, 'app', 'css', css), join(out, 'assets', 'app', css));
  // Fonts again at assets/fonts/ so @font-face rules in the scene files resolve (HyperFrames checks per file).
  cpSync(join(ROOT, 'shared', 'fonts'), join(out, 'assets', 'fonts'), { recursive: true });

  // GSAP vendored from node_modules (no CDN: the render works offline).
  mkdirSync(join(out, 'assets', 'vendor'), { recursive: true });
  cpSync(join(ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js'), join(out, 'assets', 'vendor', 'gsap.min.js'));

  // Captured screens and card renders for this language, plus the zones.
  cpSync(capDir, join(out, 'assets', 'cap'), { recursive: true });
  cpSync(zonesFile, join(out, 'assets', 'cap', 'zones.json'));

  // Data for scripts that need numbers (bounding boxes for push-ins, card sizes).
  writeFileSync(join(out, 'assets', 'data.js'),
    `window.JV_DATA = ${JSON.stringify({ flow, lang, aspect, size, fps: config.fps, manifest, zones })};\n`);

  const name = `justid-${flow}-${lang}-${aspect}`;
  writeFileSync(join(out, 'hyperframes.json'), JSON.stringify({
    paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' }, media: { autoProxy: true },
  }, null, 2) + '\n');
  writeFileSync(join(out, 'meta.json'), JSON.stringify({ id: name, name }, null, 2) + '\n');
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const out = build({ flow: args.flow, lang: args.lang, aspect: args.aspect });
  console.log(relative(process.cwd(), out));
}
