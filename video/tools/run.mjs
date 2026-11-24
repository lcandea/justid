// @ts-check
// Entry point for the npm video scripts. Builds the HyperFrames project for one combination and previews,
// snapshots or renders it. HyperFrames telemetry is always off.
//
//   node video/tools/run.mjs build    --flow send --lang es --aspect 9x16
//   node video/tools/run.mjs preview  --flow send --lang es --aspect 9x16   (Studio preview in the browser)
//   node video/tools/run.mjs check    --flow send --lang es --aspect 9x16   (HyperFrames lint + layout audit)
//   node video/tools/run.mjs snapshot --flow send --lang es --aspect 9x16 --at 1,3.5,8
//   node video/tools/run.mjs render   --flow send --lang es --aspect 9x16   -> video/out/justid-send-es-9x16.mp4
//   node video/tools/run.mjs render-all                                       -> all flows × langs × aspects
//   node video/tools/run.mjs compress [--flow …]   web copies of the renders -> landing/video/ (shipped with the site):
//                                                   short side 720 px, H.264 CRF 24, faststart, no audio, plus a poster
//                                                   JPG taken at config.json posterAt[flow][aspect] (default 0 s)
// --flow / --lang / --aspect also accept "all".
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { parseArgs } from './args.mjs';

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(VIDEO, '..');
const OUT = join(VIDEO, 'out');
const config = JSON.parse(readFileSync(join(VIDEO, 'config.json'), 'utf8'));
const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' };
const HF = join(ROOT, 'node_modules', '.bin', 'hyperframes');

/** @param {string} cmd @param {string[]} args @param {object} [opts] */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, cwd: ROOT, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
  return r;
}

/** @param {string} value @param {string[]} all */
const expand = (value, all) => (value === 'all' ? all : value.split(','));

/** Confirm the encode matches the delivery spec: H.264, yuv420p, size, fps, no audio stream. @param {string} file */
function verify(file, size) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt,width,height,r_frame_rate:format=duration',
    '-of', 'json', file], { encoding: 'utf8' });
  const info = JSON.parse(r.stdout);
  const v = info.streams.find((/** @type {any} */ s) => s.codec_type === 'video');
  const problems = [];
  if (v?.codec_name !== 'h264') problems.push(`codec ${v?.codec_name}`);
  if (v?.pix_fmt !== 'yuv420p') problems.push(`pix_fmt ${v?.pix_fmt}`);
  if (v?.width !== size.width || v?.height !== size.height) problems.push(`size ${v?.width}x${v?.height}`);
  if (v?.r_frame_rate !== `${config.fps}/1`) problems.push(`fps ${v?.r_frame_rate}`);
  return { problems, hasAudio: info.streams.some((/** @type {any} */ s) => s.codec_type === 'audio'), duration: Number(info.format.duration) };
}

/** @param {{ flow: string, lang: string, aspect: string }} c */
function render(c) {
  const dir = build(c);
  const name = `justid-${c.flow}-${c.lang}-${c.aspect}.mp4`;
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name);
  run(HF, ['render', dir, '-o', file, '--fps', String(config.fps), '--crf', '18', '--strict', '--quiet']);
  const size = config.aspects[c.aspect];
  let res = verify(file, size);
  if (res.hasAudio) { // silent film: drop any audio track the encoder added
    const tmp = file.replace(/\.mp4$/, '.tmp.mp4');
    run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-map', '0:v', '-c', 'copy', '-movflags', '+faststart', tmp]);
    rmSync(file); renameSync(tmp, file);
    res = verify(file, size);
  }
  if (res.problems.length) throw new Error(`${name}: ${res.problems.join(', ')}`);
  console.log(`✓ ${relative(ROOT, file)}  ${size.width}x${size.height} ${config.fps}fps ${res.duration.toFixed(2)}s, no audio`);
}

/** Web copy of a finished render for the landing: 720 px short side, small H.264 with faststart, and a poster. @param {{ flow: string, lang: string, aspect: string }} c */
function compress(c) {
  const name = `justid-${c.flow}-${c.lang}-${c.aspect}`;
  const src = join(OUT, `${name}.mp4`);
  if (!existsSync(src)) { console.warn(`skip ${name}: not rendered`); return; }
  const web = join(ROOT, 'landing', 'video');
  mkdirSync(web, { recursive: true });
  const scale = c.aspect === '9x16' ? '720:-2' : '-2:720';
  run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', `scale=${scale}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow',
    '-crf', '24', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', join(web, `${name}.mp4`)]);
  const at = String(config.posterAt?.[c.flow]?.[c.aspect] ?? 0);
  run('ffmpeg', ['-y', '-v', 'error', '-ss', at, '-i', src, '-frames:v', '1', '-vf', `scale=${scale}:flags=lanczos`, '-q:v', '4', join(web, `${name}.jpg`)]);
  const kb = (/** @type {string} */ f) => Math.round(statSync(f).size / 1024);
  console.log(`✓ ${relative(ROOT, join(web, name))}.mp4  ${kb(src)} KB -> ${kb(join(web, `${name}.mp4`))} KB (+ poster ${kb(join(web, `${name}.jpg`))} KB)`);
}

const [command = 'build', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);
const combos = [];
const all = command === 'render-all' || (command === 'compress' && !rest.length);
for (const flow of expand(all ? 'all' : args.flow, config.flows))
  for (const lang of expand(all ? 'all' : args.lang, config.langs))
    for (const aspect of expand(all ? 'all' : args.aspect, Object.keys(config.aspects))) combos.push({ flow, lang, aspect });

for (const c of combos) {
  switch (command) {
    case 'build': console.log(relative(ROOT, build(c))); break;
    case 'check': run(HF, ['check', build(c)]); break;
    case 'snapshot': {
      const dir = build(c);
      run(HF, ['snapshot', dir, ...(args.at ? ['--at', args.at] : [])]);
      console.log(`snapshots in ${relative(ROOT, join(dir, '.hyperframes', 'artifacts', 'snapshots'))}`);
      break;
    }
    case 'preview': {
      const dir = build(c);
      run(HF, ['preview', dir, ...(args.port ? ['--port', args.port] : [])]);
      break;
    }
    case 'render': case 'render-all': render(c); break;
    case 'compress': compress(c); break;
    default: throw new Error(`unknown command "${command}"`);
  }
}
if (!existsSync(OUT) && command.startsWith('render')) process.exitCode = 1;
