import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTransferZip } from '../../src/zip.mjs';
import { reviewPair, createPlan, exportPlan } from '../../src/core.mjs';
import { extractTransferZip, crc32, ENTRY_NAMES, fixtureBytes, validateExportEntries, sha256 } from './artifact-contract.mjs';

async function zip(files = Object.fromEntries(ENTRY_NAMES.map(name => [name, `original ${name}`])) ) {
  return Buffer.from(await makeTransferZip(files).arrayBuffer());
}

test('independent ZIP reader checks CRC32 and exact three-entry writer output', async () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const entries = extractTransferZip(await zip());
  assert.deepEqual(Object.keys(entries).sort(), [...ENTRY_NAMES].sort());
  for (const name of ENTRY_NAMES) assert.equal(entries[name].toString(), `original ${name}`);
});

test('reader rejects corrupt payload, truncation, unexpected entries and ZIP features', async () => {
  const good = await zip();
  const corrupt = Buffer.from(good); corrupt[30 + ENTRY_NAMES[0].length] ^= 1;
  assert.throws(() => extractTransferZip(corrupt));
  assert.throws(() => extractTransferZip(good.subarray(0, -1)));
  assert.throws(() => extractTransferZip(Buffer.concat([good, Buffer.from('tail')])));
  assert.throws(() => extractTransferZip(Buffer.alloc(4 * 1024 * 1024 + 1)));
  assert.throws(() => extractTransferZip(Buffer.alloc(0)));
  const unknown = await zip({ 'other.dxf': '0', 'collision-map.json': '{}', 'preservation-report.json': '{}' });
  assert.throws(() => extractTransferZip(unknown));
  const central = good.readUInt32LE(good.length - 6);
  for (const [offset, value] of [[central + 8, 1], [central + 10, 8], [central + 30, 1], [central + 32, 1], [central + 34, 1]]) {
    const changed = Buffer.from(good); changed.writeUInt16LE(value, offset);
    assert.throws(() => extractTransferZip(changed));
  }
  const mismatch = Buffer.from(good); mismatch.writeUInt32LE(1234, 14);
  assert.throws(() => extractTransferZip(mismatch));
});

async function productFixtureExport() {
  const inputs = await fixtureBytes();
  const review = await reviewPair(inputs.target.toString('ascii'), inputs.donor.toString('ascii'));
  const plan = await createPlan(review);
  const output = await exportPlan(plan, plan.hash);
  const entries = extractTransferZip(await zip({
    'donor-transfer.dxf': output.dxf,
    'collision-map.json': JSON.stringify(output.collisionMap, null, 2) + '\n',
    'preservation-report.json': JSON.stringify(output.preservationReport, null, 2) + '\n',
  }));
  return { entries, inputs };
}

test('independent manifest verifier checks actual bytes, expected geometry and approval binding', async () => {
  const { entries, inputs } = await productFixtureExport();
  const details = validateExportEntries(entries, inputs);
  assert.equal(details.targetSha256.length, 64);
  assert.equal(details.planHash.length, 64);
});

test('manifest verifier rejects modified hashes, approvals, token spans and claimed geometry', async () => {
  const { entries, inputs } = await productFixtureExport();
  const attacks = [
    ['collision-map.json', doc => { doc.inputHashes.target = '0'.repeat(64); }],
    ['collision-map.json', doc => { doc.inputHashes.donor = '0'.repeat(64); }],
    ['collision-map.json', doc => { doc.outputHash = '0'.repeat(64); }],
    ['collision-map.json', doc => { doc.approvedMapHash = '0'.repeat(64); }],
    ['collision-map.json', doc => { doc.renameMap.LEAF = 'ATTACKER'; }],
    ['preservation-report.json', doc => { doc.changedTokens[0].start += 1; }],
    ['preservation-report.json', doc => { doc.approvalManifest.geometry[0].x1 += 1; }],
    ['preservation-report.json', doc => { doc.destinationUnmodified = false; }],
    ['preservation-report.json', doc => { doc.changedTokenCount = 8; }],
    ['preservation-report.json', doc => { doc.planHash = '0'.repeat(64); }],
  ];
  for (const [name, mutate] of attacks) {
    const changed = { ...entries };
    const doc = JSON.parse(entries[name].toString()); mutate(doc);
    changed[name] = Buffer.from(JSON.stringify(doc));
    assert.throws(() => validateExportEntries(changed, inputs), name);
  }
  const wrongDonor = { ...entries, 'donor-transfer.dxf': inputs.donor };
  assert.throws(() => validateExportEntries(wrongDonor, inputs));
});


test('independent checks reject coherently rehashed forged geometry or token evidence', async () => {
  const { entries, inputs } = await productFixtureExport();
  for (const corrupt of [
    report => { report.approvalManifest.geometry[0].x1 += 1; },
    report => { report.changedTokens[0].start += 1; report.approvalManifest.patches = report.changedTokens; },
  ]) {
    const map = JSON.parse(entries['collision-map.json'].toString());
    const report = JSON.parse(entries['preservation-report.json'].toString());
    corrupt(report);
    map.planHash = report.planHash = sha256(JSON.stringify(report.approvalManifest));
    const forged = { ...entries,
      'collision-map.json': Buffer.from(JSON.stringify(map)),
      'preservation-report.json': Buffer.from(JSON.stringify(report)),
    };
    assert.throws(() => validateExportEntries(forged, inputs));
  }
});
