import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { reviewPair, createPlan, exportPlan, DxfError } from '../src/core.mjs';
import { drawing, tags, records, field, mutate, set, remove, type, named, byHandle } from './core-helpers.mjs';

const fixture = name => readFile(new URL(`../fixtures/owner-complete/${name}`, import.meta.url), 'utf8');
const [target, donor, prepared, outerOnly, expected] = await Promise.all([
  fixture('target.dxf'), fixture('donor.dxf'), fixture('expected-prepared-donor.dxf'), fixture('outer-only-donor.dxf'),
  readFile(new URL('../fixtures/expected.json', import.meta.url), 'utf8').then(JSON.parse),
]);
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const line = { kind: 'LINE', x: 0, y: 0, x2: 10, y2: 0 };
const circle = { kind: 'CIRCLE', x: 2, y: 2, r: 3 };
const insert = (block, options = {}) => ({ kind: 'INSERT', block, ...options });
const basic = options => drawing({ blocks: [{ name: 'A', entities: [line] }], entities: [insert('A')], ...options });
const lines = (shapes, source) => shapes.filter(s => s.kind === 'LINE' && (!source || s.source === source)).map(s => [s.x1, s.y1, s.x2, s.y2]);
const circles = shapes => shapes.filter(s => s.kind === 'CIRCLE').map(s => [s.cx, s.cy, s.r]);
const rejects = (promise, code) => assert.rejects(promise, error => {
  assert.ok(error instanceof DxfError, String(error));
  if (code) assert.equal(error.code, code, `${error.code}: ${error.message}`);
  assert.ok(Object.isFrozen(error.details)); return true;
});
function assertFrozen(value) {
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const item of Object.values(value)) assertFrozen(item); }
}
function independentlyPatch(source, patches) {
  let out = ''; let offset = 0;
  for (const p of patches) {
    assert.ok(p.start >= offset); assert.equal(source.slice(p.start, p.end), p.before);
    assert.ok((p.recordType === 'BLOCK' && [2, 3].includes(p.code)) || (['BLOCK_RECORD', 'INSERT'].includes(p.recordType) && p.code === 2));
    out += source.slice(offset, p.start) + p.after; offset = p.end;
  }
  return out + source.slice(offset);
}

test('owner-complete original fixture reports direct, inherited and equivalent conflicts', async () => {
  const review = await reviewPair(target, donor);
  assert.equal(review.targetHash, sha(target)); assert.equal(review.donorHash, sha(donor)); assert.equal(review.units, 'mm');
  assert.deepEqual(review.counts, { targetInstances: 2, donorInstances: 3, targetBlocks: 3, donorBlocks: 3 });
  assert.deepEqual(review.suggestedRenames, expected.rename_map);
  assert.deepEqual(review.collisions.map(c => [c.name, c.equivalent, c.reason, c.dependencies]), [
    ['LEAF', false, 'direct', []], ['ASSEMBLY', false, 'dependency', ['LEAF']], ['SAME', true, 'same', []],
  ]);
  assert.deepEqual(review.collisions[0].targetInstances, ['target:2E']);
  assert.deepEqual(review.collisions[0].donorInstances, ['donor:2E', 'donor:2F']);
  assert.deepEqual(review.collisions[1].donorInstances, ['donor:2E']);
  assertFrozen(review);
});

test('handwritten geometry matches original, keep and overwrite policies exactly', async () => {
  const { policies } = await reviewPair(target, donor);
  assert.deepEqual(lines(policies.original.shapes, 'target'), expected.target_original_lines);
  assert.deepEqual(lines(policies.original.shapes, 'donor'), expected.donor_intended_lines);
  assert.deepEqual(lines(policies.keep.shapes, 'donor'), expected.unprepared_keep_target_donor_lines);
  assert.deepEqual(lines(policies.overwrite.shapes, 'target'), expected.unprepared_overwrite_changed_target_lines);
  assert.deepEqual(circles(policies.original.shapes), expected.merged_circles);
  assert.deepEqual(policies.keep.changedTargetInstances, []);
  assert.deepEqual(policies.keep.changedDonorInstances, ['donor:2E', 'donor:2F']);
  assert.deepEqual(policies.overwrite.changedTargetInstances, ['target:2E']);
  assert.deepEqual(policies.overwrite.changedDonorInstances, []);
  assert.deepEqual(policies.keep.shapes.filter(s => s.changed).map(s => s.instanceId), ['donor:2E', 'donor:2F']);
});

test('prepared export is exactly the independent nine-token expected donor, with stable reports', async () => {
  const review = await reviewPair(target, donor), plan = await createPlan(review);
  assert.equal(plan.dxf, prepared); assert.equal(plan.patches.length, 9);
  assert.equal(independentlyPatch(donor, plan.patches), prepared);
  assert.deepEqual(lines(plan.geometry), [...expected.target_original_lines, ...expected.donor_intended_lines]);
  assert.deepEqual(circles(plan.geometry), expected.merged_circles);
  assert.ok(plan.geometry.every(s => !s.changed));
  const out = await exportPlan(plan, plan.hash); assertFrozen(plan); assertFrozen(out);
  assert.equal(out.dxf, prepared);
  assert.deepEqual(out.collisionMap.inputHashes, { target: sha(target), donor: sha(donor) });
  assert.equal(out.collisionMap.outputHash, sha(prepared)); assert.equal(out.collisionMap.planHash, plan.hash);
  assert.equal(out.collisionMap.approvedMapHash, sha(JSON.stringify(plan.renameMap)));
  assert.equal(out.preservationReport.approvedMapHash, out.collisionMap.approvedMapHash);
  assert.equal(sha(JSON.stringify(out.preservationReport.approvalManifest)), plan.hash);
  assert.equal(out.preservationReport.changedTokenCount, 9);
  assert.equal(out.preservationReport.unapprovedSourceBytesUnchanged, true);
  assert.equal(out.preservationReport.destinationUnmodified, true);
  assert.equal(out.preservationReport.handlesAndOwnersPreserved, true);
  assert.equal(out.preservationReport.originalGeometryAndStylePreserved, true);
  assert.deepEqual(out.collisionMap.impactCounts, { original: { target: 0, donor: 0 }, keep: { target: 0, donor: 2 }, overwrite: { target: 1, donor: 0 }, prepared: { target: 0, donor: 0 } });
  assert.ok(out.collisionMap.dependencyChains.some(x => x.instanceId === 'donor:2E' && x.blocks.join('/') === 'ASSEMBLY/LEAF'));
  assert.deepEqual(await exportPlan(plan, plan.hash), out);
  const second = await createPlan(await reviewPair(target, donor)); assert.equal(second.hash, plan.hash);
  assert.deepEqual(await exportPlan(second, second.hash), out);
});

test('prepared fixture needs zero patches, while outer-only rename still corrupts nested geometry', async () => {
  const clean = await reviewPair(target, prepared), plan = await createPlan(clean);
  assert.deepEqual(clean.suggestedRenames, {}); assert.deepEqual(plan.patches, []); assert.equal(plan.dxf, prepared);
  assert.deepEqual(clean.collisions.map(c => [c.name, c.equivalent]), [['SAME', true]]);
  const incomplete = await reviewPair(target, outerOnly);
  assert.deepEqual(incomplete.collisions.filter(c => !c.equivalent).map(c => c.name), ['LEAF']);
  assert.equal(incomplete.policies.keep.changedDonorInstances.length, 2);
  assert.deepEqual(lines(incomplete.policies.keep.shapes, 'donor'), expected.unprepared_keep_target_donor_lines);
  const repaired = await createPlan(incomplete); assert.equal(repaired.dxf, prepared);
});

test('all four historical incomplete-owner fixtures reject without normalization', async () => {
  for (const name of ['target.dxf', 'donor.dxf', 'expected-prepared-donor.dxf', 'outer-only-donor.dxf']) {
    const old = await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
    await rejects(reviewPair(old, donor), 'MISSING_TAG');
  }
});

test('CRLF, whitespace, numeric lexemes, handle spellings and no final newline survive untouched', async () => {
  let decorated = donor.replace(/\n/g, '\r\n').replace('11\r\n0\r\n21\r\n20\r\n', ' 011\r\n+0.000e+00\r\n 21\r\n2.000E+01\r\n');
  decorated = decorated.replace(/\r\nLEAF\r\n/g, '\r\n\tLEAF  \r\n').replace('5\r\n29\r\n', '5\r\n00029\r\n').replace(/\r\n$/, '');
  const r = await reviewPair(target, decorated), p = await createPlan(r), out = await exportPlan(p, p.hash);
  assert.equal(p.patches.length, 9); assert.equal(out.dxf, independentlyPatch(decorated, p.patches));
  assert.ok(out.dxf.includes(' 011\r\n+0.000e+00\r\n 21\r\n2.000E+01\r\n'));
  assert.ok(out.dxf.includes('\r\n\tTRANSFER_LEAF  \r\n')); assert.ok(out.dxf.includes('5\r\n00029\r\n'));
  assert.ok(out.dxf.endsWith('EOF')); assert.ok(!/(?<!\r)\n/.test(out.dxf));
});

test('nonzero block bases, nested composition, circle centers and radii are transformed', async () => {
  const d = drawing({ blocks: [
    { name: 'INNER', base: [10, 20], entities: [{ ...line, x: 10, y: 20, x2: 14, y2: 20 }, { ...circle, x: 12, y: 22, r: 2 }] },
    { name: 'OUTER', base: [2, 3], entities: [insert('INNER', { x: 5, y: 6, scale: '0.5', rotation: 90 })] },
  ], entities: [insert('OUTER', { x: 100, y: 200, scale: 2, rotation: 270 })] });
  const r = await reviewPair(d, d);
  assert.deepEqual(lines(r.policies.original.shapes, 'target'), [[106, 194, 110, 194]]);
  assert.deepEqual(circles(r.policies.original.shapes), [[108, 196, 2], [108, 196, 2]]);
  assert.ok(r.collisions.every(c => c.equivalent));
});

test('all quarter turns, wrapped/negative angles and rational decimal scales use exact arithmetic', async t => {
  const rotations = [[0, 1, 2], [90, -2, 1], [180, -1, -2], [270, 2, -1], [-90, 2, -1], [450, -2, 1]];
  for (const [rotation, rx, ry] of rotations) for (const scale of ['0.1', '0.25', '1.5', '2']) await t.test(`${rotation} degrees / ${scale}`, async () => {
    const d = drawing({ blocks: [{ name: 'A', base: [2, 3], entities: [{ ...line, x: 2, y: 3, x2: 3, y2: 5 }] }],
      entities: [insert('A', { x: 10, y: -20, scale, rotation })] });
    const r = await reviewPair(d, d); const s = Number(scale);
    assert.deepEqual(lines(r.policies.original.shapes, 'target'), [[10, -20, 10 + rx * s, -20 + ry * s]]);
  });
});

test('different decimals rounded to the same JavaScript Number never become equivalent', async () => {
  const a = basic({ blocks: [{ name: 'A', entities: [{ ...line, x2: '1' }] }] });
  const b = basic({ blocks: [{ name: 'A', entities: [{ ...line, x2: '1.000000000000000000000001' }] }] });
  const r = await reviewPair(a, b);
  assert.equal(r.collisions[0].equivalent, false); assert.equal(r.collisions[0].reason, 'direct');
  assert.equal(r.policies.keep.changedDonorInstances.length, 1); assert.equal(r.policies.overwrite.changedTargetInstances.length, 1);
  const lexical = basic({ blocks: [{ name: 'A', entities: [{ ...line, x2: '+1.000e0' }] }] });
  assert.equal((await reviewPair(a, lexical)).collisions[0].equivalent, true);
});

test('namespace aliases are case-insensitive and every reference is rewritten', async () => {
  const mixed = donor.replace(/\nLEAF\n/g, '\nleaf\n').replace('2\nleaf\n10\n50', '2\nLeAf\n10\n50');
  const r = await reviewPair(target, mixed); assert.equal(r.collisions[0].key, 'LEAF'); assert.equal(r.collisions[0].name, 'leaf');
  const p = await createPlan(r, { LEAF: 'CleanLeaf', assembly: 'CleanAssembly' });
  assert.equal(p.patches.length, 9); assert.ok(!p.dxf.includes('\nleaf\n')); assert.ok(!p.dxf.includes('\nLeAf\n'));
  assert.equal((await reviewPair(target, p.dxf)).policies.keep.changedDonorInstances.length, 0);
});

test('generated names avoid all used/unused donor and destination block names', async () => {
  const a = drawing({ blocks: [{ name: 'A', entities: [line] }, { name: 'TRANSFER_A', entities: [] }, { name: 'transfer_a_2', entities: [] }], entities: [insert('A')] });
  const b = drawing({ blocks: [{ name: 'A', entities: [{ ...line, y2: 1 }] }, { name: 'TRANSFER_A_3', entities: [] }], entities: [insert('A')] });
  const r = await reviewPair(a, b); assert.deepEqual(r.suggestedRenames, { A: 'TRANSFER_A_4' });
  assert.equal((await createPlan(r)).renameMap.A, 'TRANSFER_A_4');
  await rejects(createPlan(r, { A: 'TRANSFER_A_3' }), 'NAME_COLLISION');
  await rejects(createPlan(r, { ...r.suggestedRenames, TRANSFER_A_3: 'OtherUnused' }), 'UNNECESSARY_RENAME');
});

test('rename validation rejects unresolved dependencies, reserved names, alias duplicates and existing names', async t => {
  const r = await reviewPair(target, donor);
  for (const [name, map, code] of [
    ['equivalent extra', { ...r.suggestedRenames, SAME: 'EXTRA_SAME' }, 'UNNECESSARY_RENAME'],
    ['outer only', { ASSEMBLY: 'Safe' }, 'UNRESOLVED_COLLISION'],
    ['inner only', { LEAF: 'Safe' }, 'UNRESOLVED_COLLISION'],
    ['existing target', { ...r.suggestedRenames, LEAF: 'SAME' }, 'NAME_COLLISION'],
    ['self name', { ...r.suggestedRenames, LEAF: 'leaf' }, 'NAME_COLLISION'],
    ['same replacement twice', { LEAF: 'Safe', ASSEMBLY: 'safe' }, 'NAME_COLLISION'],
    ['star reserved', { ...r.suggestedRenames, LEAF: '*U123' }, 'UNSAFE_NAME'],
    ['space block', { ...r.suggestedRenames, LEAF: '*Model_Space' }, 'UNSAFE_NAME'],
    ['unknown source', { ...r.suggestedRenames, OTHER: 'Safe' }, 'UNKNOWN_RENAME'],
    ['space source', { ...r.suggestedRenames, '*Paper_Space': 'Safe' }, 'UNKNOWN_RENAME'],
    ['duplicate case alias', { ...r.suggestedRenames, leaf: 'Safe' }, 'DUPLICATE_RENAME'],
    ['nonascii', { ...r.suggestedRenames, LEAF: '部品' }, 'UNSAFE_NAME'],
    ['too long', { ...r.suggestedRenames, LEAF: 'X'.repeat(128) }, 'UNSAFE_NAME'],
    ['leading space', { ...r.suggestedRenames, LEAF: ' Safe' }, 'UNSAFE_NAME'],
    ['newline', { ...r.suggestedRenames, LEAF: 'Safe\nBLOCK' }, 'UNSAFE_NAME'],
    ['array', [], 'INVALID_RENAME_MAP'],
  ]) await t.test(name, () => rejects(createPlan(r, map), code));
  const getter = {}; Object.defineProperty(getter, 'LEAF', { enumerable: true, get() { throw new Error('must not execute'); } });
  await rejects(createPlan(r, getter), 'INVALID_RENAME_MAP');
});

test('ordinary prototype-like block names are handled without object pollution', async () => {
  const a = drawing({ blocks: [{ name: '__proto__', entities: [line] }], entities: [insert('__proto__')] });
  const b = drawing({ blocks: [{ name: '__proto__', entities: [{ ...line, x2: 11 }] }], entities: [insert('__proto__')] });
  const r = await reviewPair(a, b); assert.equal(Object.hasOwn(r.suggestedRenames, '__proto__'), true);
  const p = await createPlan(r); assert.equal(p.renameMap.__proto__, 'TRANSFER___proto__'); assert.equal({}.polluted, undefined);
});

test('color/layer inheritance participates in actual impact and preservation', async () => {
  const layers = [{ name: '0', color: 7 }, { name: 'BLUE', color: 5 }];
  const a = drawing({ layers, blocks: [{ name: 'A', entities: [{ ...line, color: 0 }, { ...circle, color: 256 }] }], entities: [insert('A', { layer: 'BLUE', color: 2 })] });
  const b = drawing({ layers, blocks: [{ name: 'A', entities: [{ ...line, color: 3 }, { ...circle, color: 256 }] }], entities: [insert('A', { layer: 'BLUE', color: 2 })] });
  const r = await reviewPair(a, b);
  assert.deepEqual(r.policies.original.shapes.map(s => [s.layer, s.color]), [['BLUE', 2], ['BLUE', 5], ['BLUE', 3], ['BLUE', 5]]);
  assert.equal(r.policies.keep.changedDonorInstances.length, 1); assert.equal(r.policies.overwrite.changedTargetInstances.length, 1);
  assert.equal((await createPlan(r)).geometry.length, 4);
});

test('layer property differences block review/export; unused equal layers are harmless', async () => {
  await rejects(reviewPair(target, mutate(donor, type('LAYER'), r => set(r, 62, 2))), 'LAYER_CONFLICT');
  const a = basic({ layers: [{ name: '0', color: 7 }, { name: 'Unused', color: 2 }] });
  const b = basic({ layers: [{ name: '0', color: 7 }, { name: 'UNUSED', color: 2 }] });
  assert.ok((await reviewPair(a, b)).collisions[0].equivalent);
  const c = basic({ layers: [{ name: '0', color: 7 }, { name: 'UNUSED', color: 3 }] });
  await rejects(reviewPair(a, c), 'LAYER_CONFLICT');
});

test('unit declarations are mandatory, nonzero, recognized and equal', async () => {
  await rejects(reviewPair(target, donor.replace('9\n$INSUNITS\n70\n4\n', '')), 'MISSING_UNITS');
  for (const units of [0, 21, -1]) await rejects(reviewPair(target, basic({ units })), 'UNSUPPORTED_UNITS');
  await rejects(reviewPair(target, basic({ units: 1 })), 'UNIT_MISMATCH');
  assert.equal((await reviewPair(basic({ units: 1 }), basic({ units: 1 }))).units, 'inches');
});

test('nonuniform/nonpositive scales, arbitrary rotations, arrays and attributes reject', async t => {
  for (const [name, options, code] of [
    ['nonuniform', { sy: 2 }, 'UNSUPPORTED_SCALE'], ['zero', { scale: 0 }, 'UNSUPPORTED_SCALE'],
    ['negative', { scale: -1 }, 'UNSUPPORTED_SCALE'], ['negative Z', { sz: -1 }, 'UNSUPPORTED_SCALE'],
    ['general rotation', { rotation: 45 }, 'UNSUPPORTED_ROTATION'], ['near quarter', { rotation: '90.00000000000000001' }, 'UNSUPPORTED_ROTATION'],
    ['attributes', { extra: [[66, 1]] }, 'ATTRIBUTES'], ['array columns', { extra: [[70, 2]] }, 'ARRAY_INSERT'],
    ['array rows', { extra: [[71, 2]] }, 'ARRAY_INSERT'], ['array spacing', { extra: [[44, 1]] }, 'ARRAY_INSERT'],
  ]) await t.test(name, () => rejects(reviewPair(target, basic({ entities: [insert('A', options)] })), code));
});

test('cycles, undefined references and unsupported anonymous space references reject', async () => {
  await rejects(reviewPair(target, drawing({ blocks: [{ name: 'A', entities: [insert('A')] }], entities: [] })), 'CYCLIC_BLOCKS');
  await rejects(reviewPair(target, drawing({ blocks: [{ name: 'A', entities: [insert('B')] }, { name: 'B', entities: [insert('A')] }] })), 'CYCLIC_BLOCKS');
  await rejects(reviewPair(target, basic({ entities: [insert('MISSING')] })), 'MISSING_REFERENCE');
  await rejects(reviewPair(target, drawing({ blocks: [{ name: 'A', entities: [insert('MISSING')] }] })), 'MISSING_REFERENCE');
  await rejects(reviewPair(target, basic({ entities: [insert('*Model_Space')] })), 'UNSUPPORTED_BLOCK_REFERENCE');
  await rejects(reviewPair(target, drawing({ blocks: [{ name: '*U1', entities: [] }] })), 'UNSUPPORTED_BLOCK_NAME');
});

test('closed source graphs remain acyclic when policy selects one complete namespace', async () => {
  const a = drawing({ blocks: [{ name: 'A', entities: [line] }, { name: 'B', entities: [insert('A')] }], entities: [insert('B')] });
  const b = drawing({ blocks: [{ name: 'A', entities: [insert('C')] }, { name: 'C', entities: [insert('B')] }, { name: 'B', entities: [circle] }], entities: [insert('A')] });
  const r = await reviewPair(a, b);
  assert.deepEqual(r.policies.original.shapes.map(s => s.kind), ['LINE', 'CIRCLE']);
  assert.deepEqual(r.policies.keep.shapes.map(s => s.kind), ['LINE', 'LINE']);
  assert.deepEqual(r.policies.overwrite.shapes.map(s => s.kind), ['CIRCLE', 'CIRCLE']);
  assert.equal((await createPlan(r)).geometry.length, 2);
});

test('unsupported/custom records, external references, XDATA, dictionaries and dangerous fields reject', async t => {
  const cases = [
    ['ARC', mutate(donor, type('LINE'), r => set(r, 0, 'ARC')), 'UNSUPPORTED_ENTITY'],
    ['LWPOLYLINE', mutate(donor, type('LINE'), r => set(r, 0, 'LWPOLYLINE')), 'UNSUPPORTED_ENTITY'],
    ['TEXT', mutate(donor, type('LINE'), r => set(r, 0, 'TEXT')), 'UNSUPPORTED_ENTITY'],
    ['DIMENSION', mutate(donor, type('LINE'), r => set(r, 0, 'DIMENSION')), 'UNSUPPORTED_ENTITY'],
    ['custom', mutate(donor, type('LINE'), r => set(r, 0, 'MY_ENTITY')), 'UNSUPPORTED_ENTITY'],
    ['XDATA', mutate(donor, type('LINE'), r => r.push([1001, 'APP'], [1000, 'hello'])), 'UNSUPPORTED_TAG'],
    ['dictionary', mutate(donor, type('LINE'), r => r.push([102, '{ACAD_XDICTIONARY'], [360, 'FF'], [102, '}'])), 'UNSUPPORTED_TAG'],
    ['reactor', mutate(donor, type('LINE'), r => r.push([102, '{ACAD_REACTORS'], [330, 'FF'], [102, '}'])), 'UNSUPPORTED_TAG'],
    ['truecolor unknown', mutate(donor, type('LINE'), r => r.push([420, 16711680])), 'UNSUPPORTED_TAG'],
    ['unknown tag', mutate(donor, type('LINE'), r => r.push([999, 'comment'])), 'UNSUPPORTED_TAG'],
    ['xref flag', mutate(donor, named('BLOCK', 'LEAF'), r => set(r, 70, 4)), 'UNSUPPORTED_BLOCK'],
    ['xref path', mutate(donor, named('BLOCK', 'LEAF'), r => set(r, 1, 'remote.dwg')), 'UNSUPPORTED_BLOCK'],
    ['attributed block', mutate(donor, named('BLOCK', 'LEAF'), r => set(r, 70, 2)), 'UNSUPPORTED_BLOCK'],
    ['dynamic code', mutate(donor, named('BLOCK_RECORD', 'LEAF'), r => r.push([310, 'ABCD'])), 'UNSUPPORTED_TAG'],
    ['per block units', mutate(donor, named('BLOCK_RECORD', 'LEAF'), r => r.push([70, 1])), 'UNSUPPORTED_BLOCK_RECORD'],
    ['nonstandard extrusion', mutate(donor, type('LINE'), r => r.push([210, 0], [220, 0], [230, -1])), 'UNSUPPORTED_EXTRUSION'],
    ['Z endpoint', mutate(donor, type('LINE'), r => set(r, 31, 1)), 'UNSUPPORTED_3D'],
    ['Z insert', mutate(donor, type('INSERT'), r => set(r, 30, 1)), 'UNSUPPORTED_3D'],
    ['thickness', mutate(donor, type('CIRCLE'), r => r.push([39, 1])), 'UNSUPPORTED_3D'],
    ['linetype', mutate(donor, type('LINE'), r => r.splice(r.findIndex(p => p[0] === 8) + 1, 0, [6, 'DASHED'])), 'UNSUPPORTED_LINETYPE'],
    ['hidden', mutate(donor, type('LINE'), r => r.splice(r.findIndex(p => p[0] === 8) + 1, 0, [60, 1])), 'UNSUPPORTED_VISIBILITY'],
    ['undefined layer', mutate(donor, type('LINE'), r => set(r, 8, 'MISSING')), 'MISSING_LAYER'],
    ['subclass spoof', mutate(donor, type('LINE'), r => r.filter(p => p[0] === 100).at(-1)[1] = 'AcDbArc'), 'UNSUPPORTED_SUBCLASS'],
  ];
  for (const [name, d, code] of cases) await t.test(name, () => rejects(reviewPair(target, d), code));
});

test('paper-space content and nonempty structural blocks reject', async () => {
  await rejects(reviewPair(target, mutate(donor, byHandle('2E'), r => r.splice(r.findIndex(p => p[0] === 8) + 1, 0, [67, 1]))), 'PAPER_SPACE');
  await rejects(reviewPair(target, mutate(donor, byHandle('2E'), r => r.splice(r.findIndex(p => p[0] === 8) + 1, 0, [410, 'Layout1']))), 'PAPER_SPACE');
  await rejects(reviewPair(target, mutate(donor, byHandle('2E'), r => set(r, 330, '11'))), 'INVALID_OWNER');
  const rs = records(donor), lineRecord = structuredClone(rs.find(type('LINE')));
  set(lineRecord, 5, 'ABC'); set(lineRecord, 330, '11');
  const paper = rs.findIndex(named('BLOCK', '*Paper_Space')); rs.splice(paper + 1, 0, lineRecord);
  await rejects(reviewPair(target, tags(rs.flat())), 'PAPER_SPACE');
});

test('malformed files, unknown sections, duplicates and broken ownership reject', async t => {
  const cases = [
    ['empty', '', 'ASCII_ONLY'], ['nonascii', donor + 'é', 'ASCII_ONLY'], ['binary', 'AutoCAD Binary DXF\r\n\x1a\0', 'ASCII_ONLY'],
    ['truncated', donor.slice(0, -6), null], ['odd lines', donor + '5\n', 'MALFORMED_PAIRS'], ['extra EOF', donor + '0\nEOF\n', 'MALFORMED_EOF'],
    ['bare CR', donor.replace('0\nSECTION', '0\rSECTION'), 'MALFORMED_LINES'], ['bad group', donor.replace(/^0\n/, '-1\n'), 'MALFORMED_CODE'],
    ['unknown section', donor.replace('2\nBLOCKS\n', '2\nMYSTERY\n'), 'UNSUPPORTED_SECTION'],
    ['bad version', donor.replace('AC1015', 'AC1032'), 'UNSUPPORTED_VERSION'],
    ['unknown header', donor.replace('9\n$INSBASE', '9\n$UNSAFE'), 'UNSUPPORTED_HEADER'],
    ['nonzero global base', donor.replace('$INSBASE\n10\n0', '$INSBASE\n10\n1'), 'UNSUPPORTED_INSERTION_BASE'],
    ['duplicate singleton', mutate(donor, type('LINE'), r => r.push([11, 50])), 'DUPLICATE_TAG'],
    ['missing required field', mutate(donor, type('LINE'), r => remove(r, 11)), 'MISSING_TAG'],
    ['duplicate handles', mutate(donor, type('LINE'), r => set(r, 5, '025')), 'DUPLICATE_HANDLE'],
    ['zero handle', mutate(donor, type('LINE'), r => set(r, 5, '0')), 'DUPLICATE_HANDLE'],
    ['invalid handle', mutate(donor, type('LINE'), r => set(r, 5, 'XYZ')), 'INVALID_HANDLE'],
    ['entity wrong owner', mutate(donor, type('LINE'), r => set(r, 330, '13')), 'INVALID_OWNER'],
    ['entity owner missing', mutate(donor, type('LINE'), r => remove(r, 330)), 'MISSING_TAG'],
    ['table owner missing', mutate(donor, named('TABLE', 'LAYER'), r => remove(r, 330)), 'MISSING_TAG'],
    ['table owner nonzero', mutate(donor, named('TABLE', 'LAYER'), r => set(r, 330, '2')), 'INVALID_OWNER'],
    ['symbol owner wrong', mutate(donor, type('LAYER'), r => set(r, 330, '3')), 'INVALID_OWNER'],
    ['block names mismatch', mutate(donor, named('BLOCK', 'LEAF'), r => set(r, 3, 'OTHER')), 'BLOCK_NAME_MISMATCH'],
    ['table count wrong', mutate(donor, named('TABLE', 'BLOCK_RECORD'), r => set(r, 70, 100)), 'TABLE_COUNT'],
    ['duplicate block name', mutate(donor, named('BLOCK_RECORD', 'SAME'), r => set(r, 2, 'leaf')), 'DUPLICATE_NAME'],
    ['unknown block record', mutate(donor, named('BLOCK', 'SAME'), r => { set(r, 2, 'OTHER'); set(r, 3, 'OTHER'); }), 'MISSING_BLOCK_RECORD'],
  ];
  for (const [name, d, code] of cases) await t.test(name, () => rejects(reviewPair(target, d), code));
});

test('malformed, nonfinite, oversized and zero radius numbers reject', async t => {
  for (const value of ['NaN', 'Infinity', '-Infinity', '0x10', '1,5', '1 2', '.', '--1', '1e9999', '1'.repeat(81), '1000000000001']) {
    await t.test(value.slice(0, 20), () => rejects(reviewPair(target, mutate(donor, type('LINE'), r => set(r, 10, value)))));
  }
  await rejects(reviewPair(target, mutate(donor, type('CIRCLE'), r => set(r, 40, 0))), 'INVALID_RADIUS');
  await rejects(reviewPair(target, mutate(donor, type('CIRCLE'), r => set(r, 40, -3))), 'INVALID_RADIUS');
});

test('explicit harmless structural records are accepted, custom/object/font records are not', async () => {
  const rs = records(donor), at = rs.findIndex(named('TABLE', 'BLOCK_RECORD'));
  const additions = [
    [[0, 'TABLE'], [2, 'LTYPE'], [5, 'A00'], [330, '0'], [100, 'AcDbSymbolTable'], [70, '1']],
    [[0, 'LTYPE'], [5, 'A01'], [330, 'A00'], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbLinetypeTableRecord'], [2, 'CONTINUOUS'], [70, '0'], [3, 'Solid line'], [72, '65'], [73, '0'], [40, '0']],
    [[0, 'ENDTAB']],
    [[0, 'TABLE'], [2, 'APPID'], [5, 'A02'], [330, '0'], [100, 'AcDbSymbolTable'], [70, '1']],
    [[0, 'APPID'], [5, 'A03'], [330, 'A02'], [100, 'AcDbSymbolTableRecord'], [100, 'AcDbRegAppTableRecord'], [2, 'ACAD'], [70, '0']],
    [[0, 'ENDTAB']],
    [[0, 'TABLE'], [2, 'STYLE'], [5, 'A04'], [330, '0'], [100, 'AcDbSymbolTable'], [70, '0']], [[0, 'ENDTAB']],
  ];
  rs.splice(at, 0, ...additions); const d = tags(rs.flat());
  const r = await reviewPair(target, d); assert.equal((await createPlan(r)).patches.length, 9);
  await rejects(reviewPair(target, mutate(d, type('APPID'), r => set(r, 2, 'CUSTOM_APP'))), 'UNSUPPORTED_APPID');
  await rejects(reviewPair(target, mutate(d, type('LTYPE'), r => { set(r, 2, 'DASHED'); set(r, 73, 1); })), 'UNSUPPORTED_LINETYPE');
  const font = d.replace('2\nSTYLE\n5\nA04\n330\n0\n100\nAcDbSymbolTable\n70\n0\n0\nENDTAB',
    '2\nSTYLE\n5\nA04\n330\n0\n100\nAcDbSymbolTable\n70\n1\n' + tags([[0, 'STYLE'], [5, 'A05'], [330, 'A04'], [2, 'STANDARD'], [3, 'font.ttf']]) + '0\nENDTAB');
  await rejects(reviewPair(target, font), 'UNSUPPORTED_TABLE_RECORD');
  const emptyObjects = donor.replace('0\nEOF\n', '0\nSECTION\n2\nOBJECTS\n0\nENDSEC\n0\nEOF\n');
  assert.ok(await reviewPair(target, emptyObjects));
  await rejects(reviewPair(target, emptyObjects.replace('2\nOBJECTS\n', '2\nOBJECTS\n0\nDICTIONARY\n5\nABC\n')), 'UNSUPPORTED_SECTION_CONTENT');
});

test('size, tag, block-depth and expanded-geometry budgets fail closed', async () => {
  await rejects(reviewPair(target, ' '.repeat(2_000_001)), 'LIMIT_SIZE');
  await rejects(reviewPair(target, '0\nEOF\n'.repeat(100_001)), 'LIMIT_TAGS');
  const chain = Array.from({ length: 33 }, (_, i) => ({ name: `B${i}`, entities: i === 32 ? [line] : [insert(`B${i + 1}`)] }));
  await rejects(reviewPair(target, drawing({ blocks: chain, entities: [insert('B0')] })), 'LIMIT_DEPTH');
  const width = drawing({ blocks: [{ name: 'A', entities: Array.from({ length: 200 }, () => line) }], entities: Array.from({ length: 200 }, () => insert('A')) });
  await rejects(reviewPair(target, width), 'LIMIT_GEOMETRY');
  const emptyExplosion = Array.from({ length: 18 }, (_, i) => ({ name: `B${i}`, entities: i === 17 ? [] : [insert(`B${i + 1}`), insert(`B${i + 1}`)] }));
  await rejects(reviewPair(target, drawing({ blocks: emptyExplosion, entities: [insert('B0')] })), 'LIMIT_EXPANSION');
  const overflow = drawing({ blocks: [{ name: 'A', entities: [line] }], entities: [insert('A', { scale: '1000000000000', x: '1000000000000' })] });
  // 1.1e13 is within preview range; nested scale increases exceed it.
  assert.ok(await reviewPair(target, overflow));
  const huge = drawing({ blocks: [{ name: 'A', entities: [line] }, { name: 'B', entities: [insert('A', { scale: '1000000000000' })] }], entities: [insert('B', { scale: '1000000000000' })] });
  await rejects(reviewPair(target, huge), 'LIMIT_COORDINATE');
});

test('plan approval is source-bound, immutable, rejects stale hashes and tampered/copied objects', async () => {
  const review = await reviewPair(target, donor), plan = await createPlan(review);
  await rejects(exportPlan(plan, undefined), 'APPROVAL_MISMATCH');
  await rejects(exportPlan(plan, '0'.repeat(64)), 'APPROVAL_MISMATCH');
  assert.throws(() => { plan.dxf += 'x'; }, TypeError);
  assert.throws(() => { plan.renameMap.LEAF = 'Other'; }, TypeError);
  assert.throws(() => { plan.patches[0].after = 'Other'; }, TypeError);
  assert.throws(() => { review.collisions[0].equivalent = true; }, TypeError);
  await rejects(createPlan({ ...review }), 'STALE_REVIEW');
  await rejects(exportPlan({ ...plan }, plan.hash), 'STALE_PLAN');
  await rejects(exportPlan({ ...plan, dxf: plan.dxf + 'x' }, plan.hash), 'STALE_PLAN');
  const second = await createPlan(review, { LEAF: 'OtherLeaf', ASSEMBLY: 'OtherAssembly' });
  assert.notEqual(second.hash, plan.hash); await rejects(exportPlan(second, plan.hash), 'APPROVAL_MISMATCH');
  const changedSource = donor.replace('21\n20\n31', '21\n21\n31');
  const third = await createPlan(await reviewPair(target, changedSource));
  assert.notEqual(third.donorHash, plan.donorHash); assert.notEqual(third.hash, plan.hash);
  await rejects(exportPlan(third, plan.hash), 'APPROVAL_MISMATCH');
  assert.equal((await exportPlan(plan, plan.hash)).dxf, prepared);
});


test('empty drawings and standalone model-space primitives are supported without artificial blocks', async () => {
  const empty = drawing();
  const standalone = drawing({ entities: [line, circle] });
  const r = await reviewPair(empty, standalone), p = await createPlan(r);
  assert.deepEqual(r.collisions, []); assert.equal(r.counts.donorInstances, 0);
  assert.equal(r.counts.targetBlocks, 0); assert.equal(p.geometry.length, 2);
  assert.ok(p.geometry.every(s => s.blockPath.length === 0 && s.source === 'donor'));
  assert.equal(p.dxf, standalone); assert.equal(p.patches.length, 0);
});

test('VPORT dimensions, header handle seeds and required subclass field locations are validated', async () => {
  for (const [code, value] of [[11, -1], [40, 0], [41, -1], [42, 0], [15, -1], [73, 3], [78, 3], [71, 1], [51, 90]]) {
    await rejects(reviewPair(target, mutate(donor, type('VPORT'), r => set(r, code, value))), 'UNSUPPORTED_VPORT');
  }
  const withSeed = value => donor.replace('9\n$INSBASE', `9\n$HANDSEED\n5\n${value}\n9\n$INSBASE`);
  assert.ok(await reviewPair(target, withSeed('FF')));
  await rejects(reviewPair(target, withSeed('1')), 'INVALID_HANDSEED');
  const misplaced = mutate(donor, type('LINE'), r => {
    const x = r.find(p => p[0] === 10); remove(r, 10); r.splice(r.findIndex(p => p[0] === 100), 0, x);
  });
  await rejects(reviewPair(target, misplaced), 'MALFORMED_SUBCLASS');
  const excessiveBlocks = Array.from({ length: 1023 }, (_, i) => ({ name: `B${i}`, entities: [] }));
  await rejects(reviewPair(target, drawing({ blocks: excessiveBlocks })), 'LIMIT_BLOCKS');
});

test('large unused layered DAGs are fingerprinted without expanding their exponentially many paths', { timeout: 10000 }, async () => {
  const makeBlocks = endpoint => Array.from({ length: 30 }, (_, level) => Array.from({ length: 3 }, (_, branch) => ({
    name: `L${level}_${branch}`,
    entities: level === 29 ? [{ ...line, x2: endpoint }] : Array.from({ length: 3 }, (_, child) => insert(`L${level + 1}_${child}`)),
  }))).flat();
  const r = await reviewPair(drawing({ blocks: makeBlocks(1) }), drawing({ blocks: makeBlocks(2) }));
  assert.equal(r.collisions.length, 90);
  assert.equal(r.collisions.filter(c => c.reason === 'dependency').length, 87);
  assert.ok(r.collisions.every(c => !c.equivalent && c.targetInstances.length === 0 && c.donorInstances.length === 0));
  const p = await createPlan(r); assert.equal(p.geometry.length, 0); assert.equal(Object.keys(p.renameMap).length, 90);
  assert.equal((await exportPlan(p, p.hash)).collisionMap.dependencyChains.length, 0);
});

test('cumulative collision reachability has a shared budget even with many unused colliding blocks', { timeout: 15000 }, async () => {
  const makeBlocks = endpoint => Array.from({ length: 1000 }, (_, i) => ({ name: `B${i}`, entities: [{ ...line, x2: endpoint }] }));
  const entities = Array.from({ length: 3000 }, () => insert('B0'));
  const a = drawing({ blocks: makeBlocks(1), entities }), b = drawing({ blocks: makeBlocks(2), entities });
  await rejects(reviewPair(a, b), 'LIMIT_DEPENDENCIES');
});
