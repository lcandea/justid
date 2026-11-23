// Template data checks: purity (data only, no code), registry completeness and geometry sanity.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './helpers.mjs';

const DIR = join(ROOT, 'templates');
const dataFiles = readdirSync(DIR).filter(f => f.endsWith('.js') && f !== 'index.js');

/** A template file may only contain comment lines and one `export default <JSON>;`. */
function parseTemplateFile(file) {
  const src = readFileSync(join(DIR, file), 'utf8');
  const m = src.match(/^export default (\{[\s\S]*\});\s*$/m);
  assert.ok(m, `${file}: must contain exactly "export default {...};" at the end`);
  const before = src.slice(0, m.index);
  for (const line of before.split('\n')) {
    assert.ok(line.trim() === '' || line.trim().startsWith('//'), `${file}: only comments allowed before the data, found: ${line}`);
  }
  return JSON.parse(m[1]); // throws if it's not plain JSON (no functions, no expressions)
}

const parsed = Object.fromEntries(dataFiles.map(f => [f, parseTemplateFile(f)]));
const families = Object.values(parsed).filter(t => t.kind === 'family');
const versions = Object.values(parsed).filter(t => t.kind === 'version');

test('every template file is pure JSON data with a known kind and a matching file name', () => {
  for (const [file, t] of Object.entries(parsed)) {
    assert.ok(['family', 'version'].includes(t.kind), `${file}: kind must be family or version`);
    assert.equal(`${t.id}.js`, file, `${file}: id must match the file name`);
  }
});

test('templates/index.js registers every data file, and the modules match the parsed data', async () => {
  const index = readFileSync(join(DIR, 'index.js'), 'utf8');
  for (const f of dataFiles) assert.ok(index.includes(`'./${f}'`), `${f} is not imported in templates/index.js`);
  const { FAMILIES, VERSIONS } = await import(join(DIR, 'index.js'));
  assert.equal(FAMILIES.length, families.length);
  assert.equal(VERSIONS.length, versions.length);
  for (const v of VERSIONS) assert.deepEqual(v, parsed[`${v.id}.js`]);
});

test('family field ids are unique and snake_case', () => {
  for (const fam of families) {
    const ids = fam.fields.map(f => f.id);
    assert.equal(new Set(ids).size, ids.length, `${fam.id}: duplicate field ids`);
    for (const f of fam.fields) {
      assert.match(f.id, /^[a-z][a-z0-9_]*$/, `${fam.id}: bad field id ${f.id}`);
      assert.equal(typeof f.show, 'boolean', `${fam.id}.${f.id}: show must be boolean`);
    }
  }
});

test('versions only use fields of their family, with zones inside the card', () => {
  for (const v of versions) {
    const fam = families.find(f => f.id === v.family);
    assert.ok(fam, `${v.id}: unknown family ${v.family}`);
    const known = new Set(fam.fields.map(f => f.id));
    for (const [id, zones] of Object.entries(v.zones)) {
      assert.ok(known.has(id), `${v.id}: field "${id}" is not in family ${fam.id}`);
      assert.ok(zones.length > 0, `${v.id}.${id}: no zones`);
      for (const z of zones) {
        assert.ok(['front', 'back'].includes(z.side), `${v.id}.${id}: bad side`);
        for (const k of ['x', 'y', 'w', 'h']) assert.equal(typeof z[k], 'number', `${v.id}.${id}: ${k} must be a number`);
        assert.ok(z.x >= 0 && z.y >= 0 && z.w > 0 && z.h > 0 && z.x + z.w <= 1.001 && z.y + z.h <= 1.001,
          `${v.id}.${id}: zone outside the card ${JSON.stringify(z)}`);
      }
    }
    for (const id of Object.keys(v.overrides || {})) assert.ok(known.has(id), `${v.id}: override for unknown field ${id}`);
  }
});

test('reference pictures exist and exactly one version is the default', () => {
  for (const v of versions) {
    for (const side of ['front', 'back']) {
      const p = v.sample?.[side];
      if (p) assert.ok(existsSync(join(ROOT, p)), `${v.id}: missing ${p}`);
    }
  }
  assert.equal(versions.filter(v => v.default).length, 1, 'exactly one version must have "default": true');
});
