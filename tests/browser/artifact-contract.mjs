import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENTRY_NAMES = Object.freeze([
  'donor-transfer.dxf', 'collision-map.json', 'preservation-report.json',
]);
export const APPROVED_MAP = Object.freeze({ LEAF: 'TRANSFER_LEAF', ASSEMBLY: 'TRANSFER_ASSEMBLY' });
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;

// Deliberately independent of the app's writer: only this tiny, bounded,
// uncompressed, three-entry artifact format is accepted by the native gate.
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function extractTransferZip(input) {
  const bytes = Buffer.from(input);
  assert(bytes.length >= 22 && bytes.length <= MAX_ARCHIVE_BYTES, 'Archive must have a bounded size');
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'A single fixed EOCD is required');
  assert.equal(bytes.readUInt16LE(end + 4), 0, 'Multi-volume ZIP is unsupported');
  assert.equal(bytes.readUInt16LE(end + 6), 0);
  assert.equal(bytes.readUInt16LE(end + 8), ENTRY_NAMES.length);
  assert.equal(bytes.readUInt16LE(end + 10), ENTRY_NAMES.length);
  assert.equal(bytes.readUInt16LE(end + 20), 0, 'ZIP comments are not part of the format');
  const centralSize = bytes.readUInt32LE(end + 12);
  const centralStart = bytes.readUInt32LE(end + 16);
  assert.equal(centralStart + centralSize, end, 'Central directory boundary must be exact');
  const result = {};
  let central = centralStart;
  let nextLocal = 0;
  for (let i = 0; i < ENTRY_NAMES.length; i++) {
    assert(central + 46 <= end, 'Central directory header must fit');
    assert.equal(bytes.readUInt32LE(central), 0x02014b50);
    const flags = bytes.readUInt16LE(central + 8);
    assert(flags === 0 || flags === 0x0800, 'Only ordinary UTF-8/ASCII stored entries are accepted');
    assert.equal(bytes.readUInt16LE(central + 10), 0, 'ZIP entries must use store');
    const checksum = bytes.readUInt32LE(central + 16);
    const size = bytes.readUInt32LE(central + 20);
    assert.equal(bytes.readUInt32LE(central + 24), size, 'Uncompressed sizes must agree');
    const nameLength = bytes.readUInt16LE(central + 28);
    const extraLength = bytes.readUInt16LE(central + 30);
    const commentLength = bytes.readUInt16LE(central + 32);
    assert.equal(extraLength, 0, 'Unexpected ZIP extras are rejected');
    assert.equal(commentLength, 0);
    assert.equal(bytes.readUInt16LE(central + 34), 0);
    const local = bytes.readUInt32LE(central + 42);
    assert.equal(local, nextLocal, 'Entries must be contiguous with no hidden prefix');
    assert(central + 46 + nameLength <= end);
    const nameBytes = bytes.subarray(central + 46, central + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    assert(ENTRY_NAMES.includes(name), 'Only constant allowlisted filenames are accepted');
    assert(!Object.hasOwn(result, name), 'Duplicate entries are rejected');
    assert(local + 30 + nameLength + size <= centralStart, 'Local data must stay before the directory');
    assert.equal(bytes.readUInt32LE(local), 0x04034b50);
    assert.equal(bytes.readUInt16LE(local + 6), flags);
    assert.equal(bytes.readUInt16LE(local + 8), 0);
    assert.equal(bytes.readUInt32LE(local + 14), checksum);
    assert.equal(bytes.readUInt32LE(local + 18), size);
    assert.equal(bytes.readUInt32LE(local + 22), size);
    assert.equal(bytes.readUInt16LE(local + 26), nameLength);
    assert.equal(bytes.readUInt16LE(local + 28), 0);
    assert.deepEqual(bytes.subarray(local + 30, local + 30 + nameLength), nameBytes);
    const dataStart = local + 30 + nameLength;
    const data = Buffer.from(bytes.subarray(dataStart, dataStart + size));
    assert.equal(crc32(data), checksum, 'ZIP checksum must match actual entry bytes');
    result[name] = data;
    nextLocal = dataStart + size;
    central += 46 + nameLength;
  }
  assert.equal(nextLocal, centralStart, 'No hidden local entry or trailing data is allowed');
  assert.equal(central, end);
  assert.deepEqual(Object.keys(result).sort(), [...ENTRY_NAMES].sort());
  return result;
}


export async function fixtureBytes() {
  const base = resolve('fixtures/owner-complete');
  const [target, donor, expected] = await Promise.all([
    readFile(`${base}/target.dxf`), readFile(`${base}/donor.dxf`), readFile(`${base}/expected-prepared-donor.dxf`),
  ]);
  return { target, donor, expected };
}

// Independently verify the public contract without importing the product parser,
// planner, exporter, hashing code, or browser state.
export function validateExportEntries(entries, inputs) {
  assert.deepEqual(Object.keys(entries).sort(), [...ENTRY_NAMES].sort());
  assert.deepEqual(entries['donor-transfer.dxf'], inputs.expected, 'Browser output must equal the independently tag-authored expected donor byte for byte');
  const map = JSON.parse(entries['collision-map.json'].toString('utf8'));
  const report = JSON.parse(entries['preservation-report.json'].toString('utf8'));
  const targetSha256 = sha256(inputs.target), donorSha256 = sha256(inputs.donor);
  const outputSha256 = sha256(entries['donor-transfer.dxf']);
  const sortedMap = Object.fromEntries(Object.entries(APPROVED_MAP).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  const approvedMapHash = sha256(JSON.stringify(sortedMap));
  const profile = 'BlockBridge/ASCII-AC1015-2D-quarter-turn/v1';
  const expectedImpacts = { original: { target: 0, donor: 0 }, keep: { target: 0, donor: 2 }, overwrite: { target: 1, donor: 0 }, prepared: { target: 0, donor: 0 } };
  for (const document of [map, report]) {
    assert.equal(document.profile, profile);
    assert.deepEqual(document.inputHashes, { target: targetSha256, donor: donorSha256 });
    assert.equal(document.outputHash, outputSha256);
    assert.equal(document.approvedMapHash, approvedMapHash);
    assert.match(document.planHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(document.impactCounts, expectedImpacts);
  }
  assert.equal(map.planHash, report.planHash);
  assert.deepEqual(map.renameMap, sortedMap);
  assert.equal(map.units, 'mm');
  assert.deepEqual(map.collisions.map(({ name, equivalent, reason }) => ({ name, equivalent, reason })).sort((a, b) => a.name.localeCompare(b.name)), [
    { name: 'ASSEMBLY', equivalent: false, reason: 'dependency' },
    { name: 'LEAF', equivalent: false, reason: 'direct' },
    { name: 'SAME', equivalent: true, reason: 'same' },
  ]);
  assert.equal(report.changedTokenCount, 9);
  assert.equal(report.changedTokens.length, 9);
  for (const key of ['unapprovedSourceBytesUnchanged', 'destinationUnmodified', 'handlesAndOwnersPreserved', 'originalGeometryAndStylePreserved']) assert.equal(report[key], true);
  assert.deepEqual(map.dependencyChains, report.dependencyChains);
  const manifest = report.approvalManifest;
  assert(manifest && typeof manifest === 'object');
  assert.deepEqual(Object.keys(manifest), ['profile', 'targetHash', 'donorHash', 'renameMap', 'dxf', 'patches', 'geometry']);
  assert.equal(manifest.profile, profile);
  assert.equal(manifest.targetHash, targetSha256);
  assert.equal(manifest.donorHash, donorSha256);
  assert.equal(manifest.dxf, outputSha256);
  assert.deepEqual(manifest.renameMap, sortedMap);
  assert.deepEqual(manifest.patches, report.changedTokens);
  assert.equal(sha256(JSON.stringify(manifest)), report.planHash, 'Approval hash must cover the exact input bytes, map, patches, output and displayed geometry');
  let previous = 0;
  const chunks = [];
  for (const patch of report.changedTokens) {
    assert(Number.isSafeInteger(patch.start) && Number.isSafeInteger(patch.end));
    assert(patch.start >= previous && patch.end > patch.start && patch.end <= inputs.donor.length);
    assert(Object.hasOwn(APPROVED_MAP, patch.before), 'Only reviewed original block names may change');
    assert.equal(patch.after, APPROVED_MAP[patch.before]);
    assert.equal(patch.blockName, patch.before);
    assert(['BLOCK_RECORD', 'BLOCK', 'INSERT'].includes(patch.recordType));
    assert(patch.code === 2 || (patch.code === 3 && patch.recordType === 'BLOCK'));
    assert.match(patch.recordHandle, /^[a-fA-F0-9]+$/);
    assert.equal(inputs.donor.subarray(patch.start, patch.end).toString('ascii'), patch.before);
    chunks.push(inputs.donor.subarray(previous, patch.start), Buffer.from(patch.after, 'ascii'));
    previous = patch.end;
  }
  chunks.push(inputs.donor.subarray(previous));
  assert.deepEqual(Buffer.concat(chunks), entries['donor-transfer.dxf'], 'No byte outside the approved token spans may change');
  const geometry = manifest.geometry;
  assert.equal(geometry.length, 5);
  for (const shape of geometry) {
    assert.equal(shape.changed, false);
    assert.equal(shape.layer, '0');
    assert.equal(shape.color, shape.kind === 'LINE' ? 1 : 5, 'Explicit original fixture ACI color must be preserved');
    assert(['target', 'donor'].includes(shape.source));
  }
  const numericShapes = geometry.map(shape => shape.kind === 'LINE'
    ? [shape.source, 'LINE', shape.x1, shape.y1, shape.x2, shape.y2]
    : [shape.source, shape.kind, shape.cx, shape.cy, shape.r]);
  const expectedShapes = [
    ['target', 'LINE', 105, 5, 105, 25], ['target', 'CIRCLE', 202, 2, 3],
    ['donor', 'LINE', 5, 105, -35, 105], ['donor', 'LINE', 50, 50, 50, 40], ['donor', 'CIRCLE', 2, 2, 3],
  ];
  const sortShapes = shapes => shapes.map(value => JSON.stringify(value)).sort();
  assert.deepEqual(sortShapes(numericShapes), sortShapes(expectedShapes));
  return { map, report, targetSha256, donorSha256, outputSha256, approvedMapHash, planHash: report.planHash };
}

export async function writeBrowserExport(entries, details) {
  const directory = resolve('artifacts/browser/export');
  await mkdir(directory, { recursive: true });
  for (const name of ENTRY_NAMES) await writeFile(`${directory}/${name}`, entries[name]);
  const files = Object.fromEntries(ENTRY_NAMES.map(name => [name, { bytes: entries[name].length, sha256: sha256(entries[name]) }]));
  const evidence = {
    schema: 'blockbridge.browser-export-evidence.v1',
    origin: 'actual-playwright-download',
    syntheticFixtureSet: 'owner-complete',
    commit: process.env.GITHUB_SHA || null,
    browser: 'chromium',
    sandboxEnabled: true,
    originalTargetUnchanged: true,
    deterministicRepeatedExport: true,
    nativeGatePassed: false,
    manualVisualReviewPending: true,
    targetSha256: details.targetSha256,
    donorSha256: details.donorSha256,
    outputSha256: details.outputSha256,
    approvedMapHash: details.approvedMapHash,
    planHash: details.planHash,
    files,
  };
  await writeFile(`${directory}/browser-evidence.json`, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

export async function verifyExportDirectory(directory) {
  const files = {};
  for (const name of ENTRY_NAMES) files[name] = await readFile(resolve(directory, name));
  const evidence = JSON.parse(await readFile(resolve(directory, 'browser-evidence.json'), 'utf8'));
  assert.equal(evidence.schema, 'blockbridge.browser-export-evidence.v1');
  assert.equal(evidence.origin, 'actual-playwright-download');
  assert.equal(evidence.syntheticFixtureSet, 'owner-complete');
  assert.equal(evidence.sandboxEnabled, true);
  assert.equal(evidence.originalTargetUnchanged, true);
  assert.equal(evidence.deterministicRepeatedExport, true);
  if (process.env.GITHUB_SHA) assert.equal(evidence.commit, process.env.GITHUB_SHA, 'Browser artifact must belong to this exact commit');
  const details = validateExportEntries(files, await fixtureBytes());
  for (const name of ENTRY_NAMES) {
    assert.equal(evidence.files[name].sha256, sha256(files[name]), `${name}: artifact hash mismatch`);
    assert.equal(evidence.files[name].bytes, files[name].length);
  }
  for (const key of ['targetSha256', 'donorSha256', 'outputSha256', 'approvedMapHash', 'planHash']) assert.equal(evidence[key], details[key]);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv[2], '--verify-directory');
  assert(process.argv[3], 'A browser-export artifact directory is required');
  await verifyExportDirectory(process.argv[3]);
  console.log('Browser export artifact hashes, original inputs, and expected donor verified');
}
