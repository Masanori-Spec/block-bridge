/**
 * BlockBridge's original, dependency-free conservative ASCII DXF transfer core.
 * This is a deliberately bounded AC1015 profile, not a general DXF parser.
 * Inputs and every unapproved byte are immutable. No destination is exported.
 * Exact rational arithmetic is used for transforms, equality and impact checks;
 * Number conversion happens only in the public preview shapes.
 */
export class DxfError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DxfError';
    this.code = code;
    this.details = freeze(details);
  }
}

const PROFILE = 'BlockBridge/ASCII-AC1015-2D-quarter-turn/v1';
const LIMITS = Object.freeze({ bytes: 2_000_000, tags: 100_000, blocks: 1024,
  entities: 20_000, depth: 32, shapes: 30_000, expansions: 100_000, dependencyLookups: 5_000_000, rationalBits: 2048 });
const REVIEWS = new WeakMap();
const PLANS = new WeakMap();
const key = value => value.toUpperCase();
const fail = (code, message, details) => { throw new DxfError(code, message, details); };
function check(ok, code, message, details) { if (!ok) fail(code, message, details); }
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
async function hash(text) {
  check(globalThis.crypto?.subtle, 'CRYPTO_UNAVAILABLE', 'WebCrypto is required to bind approval to the reviewed bytes.');
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function gcd(a, b) { a = a < 0n ? -a : a; while (b) [a, b] = [b, a % b]; return a; }
class Q {
  constructor(n, d = 1n) {
    check(d !== 0n, 'INVALID_NUMBER', 'A zero denominator is not supported.');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d); this.n = n / g; this.d = d / g;
    check(this.n.toString(2).length <= LIMITS.rationalBits && this.d.toString(2).length <= LIMITS.rationalBits,
      'LIMIT_RATIONAL', 'Exact arithmetic exceeded the bounded precision budget.');
  }
  add(b) { return new Q(this.n * b.d + b.n * this.d, this.d * b.d); }
  sub(b) { return new Q(this.n * b.d - b.n * this.d, this.d * b.d); }
  mul(b) { return new Q(this.n * b.n, this.d * b.d); }
  neg() { return new Q(-this.n, this.d); }
  eq(b) { return this.n === b.n && this.d === b.d; }
  text() { return `${this.n}/${this.d}`; }
  number() {
    const result = Number(this.n) / Number(this.d);
    check(Number.isFinite(result) && Math.abs(result) <= 1e15 && (result !== 0 || this.n === 0n),
      'LIMIT_COORDINATE', 'Expanded geometry cannot be represented safely in the preview.');
    return Object.is(result, -0) ? 0 : result;
  }
}
const ZERO = new Q(0n), ONE = new Q(1n);
function number(text, context = '') {
  check(typeof text === 'string' && text.length <= 80 && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text),
    'INVALID_NUMBER', `Invalid finite decimal number: ${context}.`);
  const [mantissa, exponentText = '0'] = text.toLowerCase().split('e');
  const exponent = Number(exponentText);
  check(Number.isSafeInteger(exponent) && Math.abs(exponent) <= 40, 'LIMIT_NUMBER', 'Numeric exponents must be between -40 and 40.');
  const sign = mantissa[0] === '-' ? -1n : 1n;
  const unsigned = mantissa.replace(/^[+-]/, '');
  const [whole, fraction = ''] = unsigned.split('.');
  const digits = BigInt((whole || '0') + fraction) * sign;
  const power = exponent - fraction.length;
  const value = power >= 0 ? new Q(digits * 10n ** BigInt(power)) : new Q(digits, 10n ** BigInt(-power));
  check(value.n <= 1_000_000_000_000n * value.d && value.n >= -1_000_000_000_000n * value.d,
    'LIMIT_NUMBER', 'Input numbers must have absolute value at most 10^12.');
  return value;
}
function integer(text, context) {
  check(/^[+-]?\d+$/.test(text), 'INVALID_INTEGER', `Expected an integer: ${context}.`);
  const n = Number(text);
  check(Number.isSafeInteger(n), 'INVALID_INTEGER', `Integer is outside the safe range: ${context}.`);
  return n;
}
function handle(text) {
  check(/^[0-9a-fA-F]{1,16}$/.test(text), 'INVALID_HANDLE', 'Handles must be 1–16 hexadecimal digits.');
  return BigInt('0x' + text).toString(16).toUpperCase();
}
function ordinaryName(name) {
  return name.length <= 127 && /^[A-Za-z0-9_$][A-Za-z0-9 _.$-]*$/.test(name) && name === name.trim();
}
function blockName(name) {
  check(ordinaryName(name) || ['*MODEL_SPACE', '*PAPER_SPACE'].includes(key(name)),
    'UNSUPPORTED_BLOCK_NAME', 'Only ordinary named blocks and the two empty structural space blocks are supported.', { name });
  return key(name);
}
function tokens(text) {
  check(typeof text === 'string', 'INVALID_INPUT', 'DXF input must be a string.');
  check(text.length <= LIMITS.bytes, 'LIMIT_SIZE', `Each DXF must be at most ${LIMITS.bytes} ASCII bytes.`);
  check(text.length > 0 && !/[^\x09\x0A\x0D\x20-\x7E]/.test(text), 'ASCII_ONLY', 'Only printable ASCII, tabs, LF and CRLF are supported.');
  check(!/\r(?!\n)/.test(text), 'MALFORMED_LINES', 'Bare carriage returns are not supported.');
  const lines = []; let start = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start); if (end < 0) end = text.length;
    const valueEnd = end > start && text[end - 1] === '\r' ? end - 1 : end;
    lines.push({ raw: text.slice(start, valueEnd), start, end: valueEnd });
    start = end + 1;
  }
  check(lines.length % 2 === 0, 'MALFORMED_PAIRS', 'Every group-code line must have a value line.');
  check(lines.length / 2 <= LIMITS.tags, 'LIMIT_TAGS', 'DXF contains too many tags.');
  const out = [];
  for (let i = 0; i < lines.length; i += 2) {
    const codeText = lines[i].raw.trim(), v = lines[i + 1];
    check(/^\d{1,4}$/.test(codeText), 'MALFORMED_CODE', 'Group codes must be nonnegative integers.', { line: i + 1 });
    const code = Number(codeText);
    check(code <= 1071, 'MALFORMED_CODE', 'Group code is outside the DXF range.', { line: i + 1 });
    const leading = v.raw.length - v.raw.trimStart().length;
    out.push({ code, value: v.raw.trim(), start: v.start + leading,
      end: v.end - (v.raw.length - v.raw.trimEnd().length), line: i + 2 });
  }
  return out;
}
function parseRecords(tags) {
  const records = []; let current;
  for (const token of tags) {
    if (token.code === 0) { current = { type: token.value, tags: [token] }; records.push(current); }
    else { check(current, 'MALFORMED_RECORD', 'A record must start with group code 0.'); current.tags.push(token); }
  }
  return records;
}
const vals = (r, code) => r.tags.filter(t => t.code === code);
function field(r, code, fallback) {
  const found = vals(r, code);
  check(found.length <= 1, 'DUPLICATE_TAG', 'A singleton DXF tag is repeated.', { record: r.type, code });
  if (!found.length) {
    check(fallback !== undefined, 'MISSING_TAG', 'A required DXF tag is missing.', { record: r.type, code });
    return fallback;
  }
  return found[0].value;
}
const num = (r, code, fallback) => number(field(r, code, fallback), `${r.type}/${code}`);
const int = (r, code, fallback) => integer(field(r, code, fallback), `${r.type}/${code}`);
function allowed(r, codes, subclasses) {
  const accepted = new Set([0, ...codes]);
  for (const tag of r.tags) check(accepted.has(tag.code), 'UNSUPPORTED_TAG',
    'An unsupported or potentially semantic DXF tag was found.', { record: r.type, code: tag.code, line: tag.line });
  for (const code of accepted) if (code !== 100) field(r, code, '');
  if (subclasses) {
    check(JSON.stringify(vals(r, 100).map(t => t.value)) === JSON.stringify(subclasses),
      'UNSUPPORTED_SUBCLASS', 'DXF subclass markers do not match the supported record profile.', { record: r.type });
    let subclass = -1;
    const commonEntityCodes = new Set([8, 62, 6, 67, 410, 60]);
    for (const tag of r.tags) {
      if (tag.code === 100) { subclass++; continue; }
      if (tag.code === 0) continue;
      const expected = tag.code === 5 || tag.code === 330 ? -1
        : r.type === 'TABLE' ? (tag.code === 2 ? -1 : 0)
        : subclasses[0] === 'AcDbEntity' && commonEntityCodes.has(tag.code) ? 0 : 1;
      check(subclass === expected, 'MALFORMED_SUBCLASS', 'A tag is outside its required DXF subclass.',
        { record: r.type, code: tag.code, line: tag.line });
    }
  }
}
function emptyRecord(r, type) {
  check(r?.type === type && r.tags.length === 1, 'MALFORMED_STRUCTURE', `Expected an empty ${type} record.`);
}
function sameOwner(r, expected) {
  check(handle(field(r, 330)) === expected, 'INVALID_OWNER', 'Record owner does not match its containing table or block.',
    { record: r.type, handle: field(r, 5, ''), expectedOwner: expected });
}
function zero(r, codes) {
  for (const code of codes) check(num(r, code, '0').eq(ZERO), 'UNSUPPORTED_3D', 'Only flat zero-thickness 2D geometry is supported.', { record: r.type, code });
}
const COMMON = [5, 330, 100, 8, 62, 6, 67, 410, 60, 210, 220, 230];
function common(r, drawing, owner, subclass, extra) {
  allowed(r, [...COMMON, ...extra], ['AcDbEntity', subclass]);
  sameOwner(r, owner);
  check(int(r, 67, '0') === 0 && ['MODEL', ''].includes(key(field(r, 410, ''))),
    'PAPER_SPACE', 'Paper-space entity content is not supported.');
  check(int(r, 60, '0') === 0, 'UNSUPPORTED_VISIBILITY', 'Hidden entities are not supported.');
  check(num(r, 210, '0').eq(ZERO) && num(r, 220, '0').eq(ZERO) && num(r, 230, '1').eq(ONE),
    'UNSUPPORTED_EXTRUSION', 'Only the standard +Z extrusion direction is supported.');
  const layer = key(field(r, 8));
  check(drawing.layers.has(layer), 'MISSING_LAYER', 'An entity references an undefined layer.', { layer });
  const ltype = key(field(r, 6, 'BYLAYER'));
  check(['CONTINUOUS', 'BYLAYER', 'BYBLOCK'].includes(ltype), 'UNSUPPORTED_LINETYPE', 'Only continuous linetypes are supported.');
  const color = int(r, 62, '256');
  check(color >= 0 && color <= 256, 'UNSUPPORTED_COLOR', 'Only ordinary ACI colors, BYLAYER and BYBLOCK are supported.');
  return { layer, color, ltype: 'CONTINUOUS' };
}
function parseEntity(r, drawing, owner) {
  const extra = r.type === 'LINE' ? [10, 20, 30, 11, 21, 31, 39]
    : r.type === 'CIRCLE' ? [10, 20, 30, 40, 39]
    : r.type === 'INSERT' ? [2, 10, 20, 30, 41, 42, 43, 50, 66, 70, 71, 44, 45] : null;
  check(extra, 'UNSUPPORTED_ENTITY', 'Only LINE, CIRCLE and ordinary INSERT entities are supported.', { entity: r.type });
  const style = common(r, drawing, owner, { LINE: 'AcDbLine', CIRCLE: 'AcDbCircle', INSERT: 'AcDbBlockReference' }[r.type], extra);
  zero(r, [30, 31, 39]);
  const entity = { type: r.type, record: r, handle: handle(field(r, 5)), style, x: num(r, 10), y: num(r, 20) };
  if (r.type === 'LINE') { entity.x2 = num(r, 11); entity.y2 = num(r, 21); }
  if (r.type === 'CIRCLE') {
    entity.r = num(r, 40); check(entity.r.n > 0n, 'INVALID_RADIUS', 'Circle radius must be positive.');
  }
  if (r.type === 'INSERT') {
    entity.name = field(r, 2); entity.key = blockName(entity.name);
    check(!entity.key.startsWith('*'), 'UNSUPPORTED_BLOCK_REFERENCE', 'Space and anonymous blocks cannot be inserted.');
    const sx = num(r, 41, '1'), sy = num(r, 42, '1'), sz = num(r, 43, '1');
    check(sx.n > 0n && sy.n > 0n && sz.n > 0n && sx.eq(sy), 'UNSUPPORTED_SCALE', 'INSERT requires positive uniform XY scale and a positive Z scale.');
    entity.scale = sx;
    const rotation = num(r, 50, '0');
    check(rotation.n % (90n * rotation.d) === 0n, 'UNSUPPORTED_ROTATION', 'Only exact quarter-turn INSERT rotations are supported.');
    entity.turn = Number((rotation.n / (90n * rotation.d) % 4n + 4n) % 4n);
    check(int(r, 66, '0') === 0, 'ATTRIBUTES', 'INSERT attributes are not supported.');
    check(int(r, 70, '1') === 1 && int(r, 71, '1') === 1 && num(r, 44, '0').eq(ZERO) && num(r, 45, '0').eq(ZERO),
      'ARRAY_INSERT', 'Array INSERTs are not supported.');
  }
  drawing.entityCount++;
  check(drawing.entityCount <= LIMITS.entities, 'LIMIT_ENTITIES', 'Too many entities in this drawing.');
  return entity;
}
function parseHeader(tags) {
  const variables = new Map(); let current;
  for (const tag of tags) {
    if (tag.code === 9) {
      check(!variables.has(tag.value), 'DUPLICATE_HEADER', 'A header variable is repeated.');
      current = []; variables.set(tag.value, current);
    } else { check(current, 'MALFORMED_HEADER', 'Header data must follow a variable name.'); current.push(tag); }
  }
  const specs = { $ACADVER: [1], $INSUNITS: [70], $INSBASE: [10, 20, 30], $HANDSEED: [5], $MEASUREMENT: [70] };
  for (const [name, values] of variables) check(specs[name] && JSON.stringify(values.map(x => x.code)) === JSON.stringify(specs[name]),
    'UNSUPPORTED_HEADER', 'Unsupported header variable or tags.', { variable: name });
  check(variables.get('$ACADVER')?.[0].value === 'AC1015', 'UNSUPPORTED_VERSION', 'Only ASCII AC1015 (R2000) DXF is supported.');
  check(variables.has('$INSUNITS'), 'MISSING_UNITS', 'Both drawings must explicitly declare units.');
  const units = integer(variables.get('$INSUNITS')[0].value, '$INSUNITS');
  check(units >= 1 && units <= 20, 'UNSUPPORTED_UNITS', 'Unitless or unknown units are not supported.');
  if (variables.has('$INSBASE')) check(variables.get('$INSBASE').every(t => number(t.value).eq(ZERO)),
    'UNSUPPORTED_INSERTION_BASE', 'The drawing-level insertion base must be zero. Named block bases may be nonzero.');
  if (variables.has('$HANDSEED')) handle(variables.get('$HANDSEED')[0].value);
  if (variables.has('$MEASUREMENT')) check([0, 1].includes(integer(variables.get('$MEASUREMENT')[0].value)), 'UNSUPPORTED_HEADER', 'Invalid $MEASUREMENT.');
  return { units, handseed: variables.has('$HANDSEED') ? handle(variables.get('$HANDSEED')[0].value) : null };
}
function parseTables(records, drawing) {
  let index = 0; const tables = new Map();
  while (index < records.length) {
    const table = records[index++];
    check(table.type === 'TABLE', 'MALFORMED_TABLE', 'Expected TABLE.');
    allowed(table, [2, 5, 330, 100, 70], ['AcDbSymbolTable']); sameOwner(table, '0');
    const name = field(table, 2), tableHandle = handle(field(table, 5));
    check(['LAYER', 'BLOCK_RECORD', 'VPORT', 'LTYPE', 'APPID', 'STYLE', 'VIEW', 'UCS', 'DIMSTYLE'].includes(name), 'UNSUPPORTED_TABLE', 'Unknown symbol table.', { table: name });
    check(!tables.has(name), 'DUPLICATE_TABLE', 'Duplicate symbol table.');
    const entries = [];
    while (index < records.length && records[index].type !== 'ENDTAB') entries.push(records[index++]);
    emptyRecord(records[index++], 'ENDTAB');
    check(int(table, 70) === entries.length, 'TABLE_COUNT', 'Table entry count is inconsistent.');
    tables.set(name, entries);
    const names = new Set();
    for (const r of entries) {
      check(r.type === name, 'MALFORMED_TABLE', 'Unexpected record type in a symbol table.', { table: name, record: r.type });
      sameOwner(r, tableHandle);
      const entryName = field(r, 2), k = key(entryName);
      check(!names.has(k), 'DUPLICATE_NAME', 'Case-insensitive duplicate symbol name.', { table: name, name: entryName }); names.add(k);
      if (name === 'LAYER') {
        allowed(r, [2, 5, 330, 100, 70, 62, 6, 290, 370], ['AcDbSymbolTableRecord', 'AcDbLayerTableRecord']);
        check(ordinaryName(entryName), 'UNSUPPORTED_LAYER', 'Unsupported layer name.');
        check(int(r, 70) === 0 && int(r, 62) >= 1 && int(r, 62) <= 255, 'UNSUPPORTED_LAYER', 'Only ordinary visible, unlocked layers are supported.');
        check(key(field(r, 6)) === 'CONTINUOUS', 'UNSUPPORTED_LINETYPE', 'Layer linetype must be CONTINUOUS.');
        check(int(r, 290, '1') === 1 && int(r, 370, '-3') === -3, 'UNSUPPORTED_LAYER', 'Only the default plotted layer lineweight is supported.');
        drawing.layers.set(k, { name: entryName, color: int(r, 62), signature: `0/${int(r, 62)}/CONTINUOUS/1/-3` });
      } else if (name === 'BLOCK_RECORD') {
        allowed(r, [2, 5, 330, 100, 70, 280, 281], ['AcDbSymbolTableRecord', 'AcDbBlockTableRecord']);
        blockName(entryName);
        check(int(r, 70, '0') === 0 && int(r, 280, '1') === 1 && int(r, 281, '0') === 0,
          'UNSUPPORTED_BLOCK_RECORD', 'Per-block units or nonstandard block-record behavior is not supported.');
        drawing.blockRecords.set(k, { name: entryName, handle: handle(field(r, 5)), record: r });
      } else if (name === 'LTYPE') {
        allowed(r, [2, 5, 330, 100, 70, 3, 72, 73, 40], ['AcDbSymbolTableRecord', 'AcDbLinetypeTableRecord']);
        check(['CONTINUOUS', 'BYLAYER', 'BYBLOCK'].includes(k) && int(r, 70) === 0 && int(r, 72, '65') === 65 && int(r, 73) === 0 && num(r, 40).eq(ZERO),
          'UNSUPPORTED_LINETYPE', 'Only standard empty continuous linetype definitions are supported.');
      } else if (name === 'APPID') {
        allowed(r, [2, 5, 330, 100, 70], ['AcDbSymbolTableRecord', 'AcDbRegAppTableRecord']);
        check(k === 'ACAD' && int(r, 70) === 0, 'UNSUPPORTED_APPID', 'Custom application registrations are not supported.');
      } else if (name === 'VPORT') {
        // Whitelist the single ordinary model viewport. No viewport references,
        // clipping objects, UCS handles or extension data are accepted.
        allowed(r, [2, 5, 330, 100, 70, 10, 20, 11, 21, 12, 22, 13, 23, 14, 24,
          15, 25, 16, 26, 36, 17, 27, 37, 40, 41, 42, 43, 44, 50, 51,
          71, 72, 73, 74, 75, 76, 77, 78], ['AcDbSymbolTableRecord', 'AcDbViewportTableRecord']);
        check(k === '*ACTIVE' && int(r, 70) === 0, 'UNSUPPORTED_VPORT', 'Only the standard *Active viewport is supported.');
        for (const t of r.tags) if ((t.code >= 10 && t.code <= 59)) number(t.value, `VPORT/${t.code}`);
        for (const t of r.tags) if (t.code >= 71 && t.code <= 78) integer(t.value, `VPORT/${t.code}`);
        check(num(r, 16, '0').eq(ZERO) && num(r, 26, '0').eq(ZERO) && num(r, 36, '1').eq(ONE)
          && num(r, 17, '0').eq(ZERO) && num(r, 27, '0').eq(ZERO) && num(r, 37, '0').eq(ZERO)
          && num(r, 50, '0').eq(ZERO) && num(r, 51, '0').eq(ZERO) && int(r, 71, '0') === 0,
          'UNSUPPORTED_VPORT', 'Only an untwisted standard 2D viewport is supported.');
        const left = num(r, 10, '0'), bottom = num(r, 20, '0'), right = num(r, 11, '1'), top = num(r, 21, '1');
        check(left.n >= 0n && bottom.n >= 0n && right.sub(ONE).n <= 0n && top.sub(ONE).n <= 0n
          && right.sub(left).n > 0n && top.sub(bottom).n > 0n
          && num(r, 40, '1').n > 0n && num(r, 41, '1').n > 0n && num(r, 42, '50').n > 0n,
          'UNSUPPORTED_VPORT', 'The standard viewport requires a valid normalized rectangle and positive dimensions.');
        for (const code of [14, 24, 15, 25]) check(num(r, code, '0').n >= 0n, 'UNSUPPORTED_VPORT', 'Viewport snap/grid spacing must be nonnegative.');
        for (const [code, min, max] of [[72, 1, 20000], [73, 0, 1], [74, 0, 3], [75, 0, 1], [76, 0, 1], [77, 0, 1], [78, 0, 2]]) {
          const v = int(r, code, code === 72 ? '100' : '0');
          check(v >= min && v <= max, 'UNSUPPORTED_VPORT', 'A viewport setting is outside the supported range.', { code });
        }
      } else fail('UNSUPPORTED_TABLE_RECORD', 'Only empty structural tables are allowed for this table type.', { table: name });
    }
  }
  check(tables.has('LAYER') && drawing.layers.has('0') && tables.has('BLOCK_RECORD'), 'MISSING_TABLE', 'LAYER 0 and BLOCK_RECORD tables are required.');
}
function parse(text) {
  const ts = tokens(text), sections = new Map(); let i = 0; let previous = -1;
  const order = ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS'];
  while (i < ts.length && !(ts[i].code === 0 && ts[i].value === 'EOF')) {
    check(ts[i]?.code === 0 && ts[i++].value === 'SECTION' && ts[i]?.code === 2, 'MALFORMED_SECTION', 'Expected a SECTION header.');
    const name = ts[i++].value, rank = order.indexOf(name);
    check(rank >= 0 && rank > previous && !sections.has(name), 'UNSUPPORTED_SECTION', 'Unknown, duplicate or out-of-order section.', { section: name });
    previous = rank; const content = [];
    while (i < ts.length && !(ts[i].code === 0 && ts[i].value === 'ENDSEC')) content.push(ts[i++]);
    check(i < ts.length, 'MALFORMED_SECTION', 'Missing ENDSEC.'); i++; sections.set(name, content);
  }
  check(i === ts.length - 1 && ts[i]?.code === 0 && ts[i]?.value === 'EOF', 'MALFORMED_EOF', 'Exactly one final EOF record is required.');
  for (const name of ['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']) check(sections.has(name), 'MISSING_SECTION', 'A required section is missing.', { section: name });
  for (const name of ['CLASSES', 'OBJECTS']) check(!sections.get(name)?.length, 'UNSUPPORTED_SECTION_CONTENT', 'Custom classes and object dictionaries are not supported.', { section: name });
  const header = parseHeader(sections.get('HEADER'));
  const d = { text, tokens: ts, units: header.units, layers: new Map(), blockRecords: new Map(), blocks: new Map(), entities: [], entityCount: 0 };
  const tableRecords = parseRecords(sections.get('TABLES'));
  const blockRecords = parseRecords(sections.get('BLOCKS'));
  const entities = parseRecords(sections.get('ENTITIES'));
  // Every actual record handle must be nonzero and globally unique, including unused records.
  const handles = new Map();
  for (const r of [...tableRecords, ...blockRecords, ...entities]) {
    if (['ENDTAB'].includes(r.type)) continue;
    const h = handle(field(r, 5));
    check(h !== '0' && !handles.has(h), 'DUPLICATE_HANDLE', 'Record handles must be nonzero and globally unique.', { handle: h }); handles.set(h, r);
  }
  if (header.handseed !== null) {
    const seed = BigInt('0x' + header.handseed);
    check([...handles.keys()].every(h => BigInt('0x' + h) < seed), 'INVALID_HANDSEED', '$HANDSEED must be higher than every existing handle.');
  }
  parseTables(tableRecords, d);
  let b = 0;
  while (b < blockRecords.length) {
    const r = blockRecords[b++]; check(r.type === 'BLOCK', 'MALFORMED_BLOCK', 'Expected BLOCK.');
    const name = field(r, 2), k = blockName(name), br = d.blockRecords.get(k);
    check(br && !d.blocks.has(k), br ? 'DUPLICATE_NAME' : 'MISSING_BLOCK_RECORD', 'Each named block must have exactly one block record and definition.', { name });
    const style = common(r, d, br.handle, 'AcDbBlockBegin', [2, 3, 70, 10, 20, 30, 1]);
    check(key(field(r, 3)) === k, 'BLOCK_NAME_MISMATCH', 'BLOCK names in group codes 2 and 3 disagree.');
    check(int(r, 70) === 0 && field(r, 1, '') === '', 'UNSUPPORTED_BLOCK', 'XREF, anonymous, attributed and dependent block flags or paths are not supported.');
    zero(r, [30]);
    const block = { name, key: k, record: r, blockRecord: br, x: num(r, 10), y: num(r, 20), style, entities: [] };
    while (b < blockRecords.length && blockRecords[b].type !== 'ENDBLK') block.entities.push(parseEntity(blockRecords[b++], d, br.handle));
    const end = blockRecords[b++]; check(end?.type === 'ENDBLK', 'MALFORMED_BLOCK', 'BLOCK must end with ENDBLK.');
    common(end, d, br.handle, 'AcDbBlockEnd', []);
    check(!k.startsWith('*') || block.entities.length === 0, 'PAPER_SPACE', 'Structural model/paper-space BLOCK definitions must be empty.');
    d.blocks.set(k, block);
    check(d.blocks.size <= LIMITS.blocks, 'LIMIT_BLOCKS', 'Too many block definitions.');
  }
  check(d.blocks.size === d.blockRecords.size && d.blocks.has('*MODEL_SPACE') && d.blocks.has('*PAPER_SPACE'),
    'MISSING_BLOCK', 'All block records need definitions, including the two empty space blocks.');
  const modelOwner = d.blockRecords.get('*MODEL_SPACE').handle;
  d.entities = entities.map(r => parseEntity(r, d, modelOwner));
  const state = new Map(), depths = new Map();
  function visit(k) {
    check(d.blocks.has(k), 'MISSING_REFERENCE', 'INSERT references an undefined block.', { name: k });
    check(state.get(k) !== 1, 'CYCLIC_BLOCKS', 'Cyclic block dependencies are not supported.', { name: k });
    if (state.get(k) === 2) return depths.get(k);
    state.set(k, 1); const block = d.blocks.get(k);
    block.dependencies = [...new Set(block.entities.filter(e => e.type === 'INSERT').map(e => e.key))];
    let depth = 1;
    // Stack bound is checked before descent as well as longest-path memoization.
    check([...state.values()].filter(x => x === 1).length <= LIMITS.depth, 'LIMIT_DEPTH', 'Block nesting exceeds the supported depth.');
    for (const dep of block.dependencies) depth = Math.max(depth, visit(dep) + 1);
    check(depth <= LIMITS.depth, 'LIMIT_DEPTH', 'Block nesting exceeds the supported depth.');
    state.set(k, 2); depths.set(k, depth); return depth;
  }
  for (const k of d.blocks.keys()) visit(k);
  for (const e of d.entities) if (e.type === 'INSERT') check(d.blocks.has(e.key), 'MISSING_REFERENCE', 'Top-level INSERT references an undefined block.', { name: e.name });
  return d;
}

function entityDirect(e) {
  const base = [e.type, e.style.layer, e.style.color, e.style.ltype, e.x.text(), e.y.text()];
  if (e.type === 'LINE') return [...base, e.x2.text(), e.y2.text()];
  if (e.type === 'CIRCLE') return [...base, e.r.text()];
  return [...base, e.key, e.scale.text(), e.turn];
}
async function fingerprints(d) {
  const memo = new Map();
  async function compute(k) {
    if (memo.has(k)) return memo.get(k);
    const b = d.blocks.get(k);
    b.direct = JSON.stringify([b.x.text(), b.y.text(), b.style, b.entities.map(entityDirect)]);
    const deps = [];
    for (const child of b.dependencies) deps.push([child, await compute(child)]);
    const fp = await hash(JSON.stringify([b.direct, deps])); b.fingerprint = fp; memo.set(k, fp); return fp;
  }
  for (const k of d.blocks.keys()) await compute(k);
}
function rotate(x, y, turn) {
  if (turn === 0) return [x, y];
  if (turn === 1) return [y.neg(), x];
  if (turn === 2) return [x.neg(), y.neg()];
  return [y, x.neg()];
}
function point(t, x, y) { const [rx, ry] = rotate(x, y, t.turn); return [t.x.add(rx.mul(t.scale)), t.y.add(ry.mul(t.scale))]; }
function transform(parent, insert, block) {
  const [rx, ry] = rotate(block.x, block.y, insert.turn);
  const lx = insert.x.sub(rx.mul(insert.scale)), ly = insert.y.sub(ry.mul(insert.scale));
  const [x, y] = point(parent, lx, ly);
  return { x, y, scale: parent.scale.mul(insert.scale), turn: (parent.turn + insert.turn) % 4 };
}
function effectiveStyle(entity, inherited, layers) {
  const layer = entity.style.layer === '0' && inherited ? inherited.layer : entity.style.layer;
  const color = entity.style.color === 0 ? (inherited?.color ?? 7)
    : entity.style.color === 256 ? layers.get(layer).color : entity.style.color;
  return { layer, color };
}
function expand(d, registry, layers, source, budget) {
  const result = [], roots = new Map();
  const identity = { x: ZERO, y: ZERO, scale: ONE, turn: 0 };
  function walk(entity, t, instanceId, path, inherited, depth, lineage) {
    check(++budget.steps <= LIMITS.expansions && depth <= LIMITS.depth, 'LIMIT_EXPANSION', 'Expanded INSERT work exceeds the safe limit.');
    const style = effectiveStyle(entity, inherited, layers);
    if (entity.type === 'INSERT') {
      const block = registry.get(entity.key);
      check(block, 'MISSING_REFERENCE', 'Transfer policy leaves an undefined block.', { name: entity.name });
      check(!lineage.has(entity.key), 'CYCLIC_POLICY', 'Combining the drawings creates a cyclic block dependency.', { name: entity.name });
      const nextLineage = new Set(lineage); nextLineage.add(entity.key);
      const nt = transform(t, entity, block);
      for (const child of block.entities) walk(child, nt, instanceId, [...path, block.name], style, depth + 1, nextLineage);
      return;
    }
    check(++budget.shapes <= LIMITS.shapes, 'LIMIT_GEOMETRY', 'Expanded geometry exceeds the supported shape limit.');
    const [x, y] = point(t, entity.x, entity.y);
    let coords, shape;
    if (entity.type === 'LINE') {
      const [x2, y2] = point(t, entity.x2, entity.y2); coords = [x, y, x2, y2];
      shape = { kind: 'LINE', x1: x.number(), y1: y.number(), x2: x2.number(), y2: y2.number() };
    } else {
      const r = entity.r.mul(t.scale); coords = [x, y, r];
      shape = { kind: 'CIRCLE', cx: x.number(), cy: y.number(), r: r.number() };
    }
    const exact = JSON.stringify([shape.kind, coords.map(v => v.text()), style.layer, style.color]);
    const item = { shape: { ...shape, source, instanceId, changed: false, blockPath: path, ...style }, exact };
    result.push(item); roots.get(instanceId).push(exact);
  }
  for (const entity of d.entities) {
    const id = `${source}:${entity.handle}`; roots.set(id, []);
    walk(entity, identity, id, [], null, 0, new Set());
  }
  return { result, roots };
}
function combine(target, donor, choice) {
  const registry = choice === 'overwrite' ? new Map([...target.blocks, ...donor.blocks]) : new Map([...donor.blocks, ...target.blocks]);
  const layers = choice === 'overwrite' ? new Map([...target.layers, ...donor.layers]) : new Map([...donor.layers, ...target.layers]);
  return { registry, layers };
}
function policy(target, donor, name, original) {
  const budget = { steps: 0, shapes: 0 };
  const merged = name === 'original' ? null : combine(target, donor, name);
  const t = expand(target, merged?.registry ?? target.blocks, merged?.layers ?? target.layers, 'target', budget);
  const d = expand(donor, merged?.registry ?? donor.blocks, merged?.layers ?? donor.layers, 'donor', budget);
  const changed = (now, before) => [...now.roots].filter(([id, signatures]) => JSON.stringify(signatures) !== JSON.stringify(before.roots.get(id))).map(([id]) => id);
  const changedTargetInstances = original ? changed(t, original.t) : [];
  const changedDonorInstances = original ? changed(d, original.d) : [];
  const changedIds = new Set([...changedTargetInstances, ...changedDonorInstances]);
  const shapes = [...t.result, ...d.result].map(x => ({ ...x.shape, changed: changedIds.has(x.shape.instanceId) }));
  return { t, d, public: { shapes, changedTargetInstances, changedDonorInstances } };
}
function referencedBy(d, collisionKey, source, budget) {
  const result = [];
  const memo = new Map();
  function uses(k) {
    check(++budget.steps <= LIMITS.dependencyLookups, 'LIMIT_DEPENDENCIES', 'Collision dependency lookup exceeds the safe budget.');
    if (!memo.has(k)) memo.set(k, k === collisionKey || d.blocks.get(k).dependencies.some(uses));
    return memo.get(k);
  }
  for (const e of d.entities) if (e.type === 'INSERT' && uses(e.key)) result.push(`${source}:${e.handle}`);
  return result;
}
function allChains(d, source, budget) {
  const chains = [];
  function walk(k, path, id) {
    check(++budget.steps <= LIMITS.expansions, 'LIMIT_DEPENDENCIES', 'Too many expanded dependency chains.');
    const b = d.blocks.get(k), next = [...path, b.name];
    chains.push({ source, instanceId: id, blocks: next });
    for (const dep of b.dependencies) walk(dep, next, id);
  }
  for (const e of d.entities) if (e.type === 'INSERT') walk(e.key, [], `${source}:${e.handle}`);
  return chains;
}
function suggest(target, donor, collisions) {
  const occupied = new Set([...target.blocks.keys(), ...donor.blocks.keys()]);
  const entries = [];
  for (const c of collisions) if (!c.equivalent) {
    let base = `TRANSFER_${c.name}`.slice(0, 120), candidate = base, suffix = 2;
    while (occupied.has(key(candidate))) candidate = `${base}_${suffix++}`;
    occupied.add(key(candidate)); entries.push([c.name, candidate]);
  }
  return Object.fromEntries(entries);
}
const UNIT_NAMES = ['', 'inches', 'feet', 'miles', 'mm', 'cm', 'm', 'km', 'microinches', 'mils', 'yards', 'angstroms', 'nm', 'microns', 'dm', 'dam', 'hm', 'Gm', 'AU', 'light years', 'parsecs'];

/** Analyze two source byte strings without changing either drawing. */
export async function reviewPair(targetText, donorText) {
  const target = parse(targetText), donor = parse(donorText);
  check(target.units === donor.units, 'UNIT_MISMATCH', 'Both drawings must explicitly declare equal units.', { target: target.units, donor: donor.units });
  // Layer property conflicts are rejected at review, so no unsafe export plan is possible.
  for (const [k, layer] of donor.layers) if (target.layers.has(k)) check(layer.signature === target.layers.get(k).signature,
    'LAYER_CONFLICT', 'Same-named layers have different properties; export is blocked.', { layer: layer.name });
  await Promise.all([fingerprints(target), fingerprints(donor)]);
  const original = policy(target, donor, 'original');
  const keep = policy(target, donor, 'keep', original), overwrite = policy(target, donor, 'overwrite', original);
  const collisions = [], lookupBudget = { steps: 0 };
  const changedTargetIds = new Set(overwrite.public.changedTargetInstances), changedDonorIds = new Set(keep.public.changedDonorInstances);
  for (const [k, block] of donor.blocks) {
    if (k.startsWith('*') || !target.blocks.has(k)) continue;
    const other = target.blocks.get(k), equivalent = block.fingerprint === other.fingerprint;
    collisions.push({ name: block.name, key: k, equivalent,
      reason: equivalent ? 'same' : block.direct === other.direct ? 'dependency' : 'direct',
      dependencies: block.dependencies.map(dep => donor.blocks.get(dep).name),
      targetInstances: equivalent ? [] : referencedBy(target, k, 'target', lookupBudget).filter(id => changedTargetIds.has(id)),
      donorInstances: equivalent ? [] : referencedBy(donor, k, 'donor', lookupBudget).filter(id => changedDonorIds.has(id)) });
  }
  const [targetHash, donorHash] = await Promise.all([hash(targetText), hash(donorText)]);
  const review = freeze({ targetHash, donorHash, units: UNIT_NAMES[target.units], unitCode: target.units, collisions,
    suggestedRenames: suggest(target, donor, collisions),
    policies: { original: original.public, keep: keep.public, overwrite: overwrite.public },
    counts: { targetInstances: target.entities.filter(e => e.type === 'INSERT').length,
      donorInstances: donor.entities.filter(e => e.type === 'INSERT').length,
      targetBlocks: [...target.blocks.keys()].filter(k => !k.startsWith('*')).length,
      donorBlocks: [...donor.blocks.keys()].filter(k => !k.startsWith('*')).length } });
  REVIEWS.set(review, { target, donor, original }); return review;
}
function validateMap(review, data, renameMap) {
  check(renameMap && typeof renameMap === 'object' && !Array.isArray(renameMap) && [Object.prototype, null].includes(Object.getPrototypeOf(renameMap)),
    'INVALID_RENAME_MAP', 'Renames must be a plain name-to-name object.');
  check(Object.getOwnPropertySymbols(renameMap).length === 0, 'INVALID_RENAME_MAP', 'Symbol keys are not supported.');
  const occupied = new Set([...data.target.blocks.keys(), ...data.donor.blocks.keys()]);
  const required = new Set(review.collisions.filter(c => !c.equivalent).map(c => c.key));
  const map = new Map();
  for (const [from, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(renameMap))) {
    check('value' in descriptor && descriptor.enumerable, 'INVALID_RENAME_MAP', 'Rename entries must be ordinary enumerable values.');
    const to = descriptor.value, k = key(from), b = data.donor.blocks.get(k);
    check(b && !k.startsWith('*'), 'UNKNOWN_RENAME', 'Only donor ordinary blocks may be renamed.', { name: from });
    check(required.has(k), 'UNNECESSARY_RENAME', 'Only differing collisions may be renamed; equivalent and noncolliding blocks must be reused unchanged.', { name: from });
    check(!map.has(k), 'DUPLICATE_RENAME', 'A block is listed more than once using case aliases.');
    check(typeof to === 'string' && ordinaryName(to), 'UNSAFE_NAME', 'Replacement names must be ordinary 1–127 character ASCII names without reserved characters.', { name: to });
    check(!occupied.has(key(to)), 'NAME_COLLISION', 'A replacement name collides with an existing or newly assigned name.', { name: to });
    occupied.add(key(to)); map.set(k, { from: b.name, to });
  }
  for (const c of review.collisions) check(c.equivalent || map.has(c.key), 'UNRESOLVED_COLLISION',
    'Every differing block, including inherited conflicts, must receive an unused donor name.', { name: c.name, reason: c.reason });
  return map;
}
function makePatches(data, map) {
  const patches = [];
  function add(record, codes, k) {
    if (!map.has(k)) return;
    for (const code of codes) for (const token of vals(record, code)) patches.push({
      start: token.start, end: token.end, before: data.donor.text.slice(token.start, token.end), after: map.get(k).to,
      code, recordType: record.type, recordHandle: field(record, 5), blockName: map.get(k).from });
  }
  for (const [k, b] of data.donor.blocks) {
    add(b.blockRecord.record, [2], k); add(b.record, [2, 3], k);
    for (const e of b.entities) if (e.type === 'INSERT') add(e.record, [2], e.key);
  }
  for (const e of data.donor.entities) if (e.type === 'INSERT') add(e.record, [2], e.key);
  patches.sort((a, b) => a.start - b.start); return patches;
}
function patchBytes(source, patches) {
  let previous = 0, output = '';
  for (const patch of patches) {
    check(patch.start >= previous && source.slice(patch.start, patch.end) === patch.before, 'PATCH_MISMATCH', 'A patch does not match its approved source token.');
    output += source.slice(previous, patch.start) + patch.after; previous = patch.end;
  }
  return output + source.slice(previous);
}
function preservation(source, output, patches) {
  let inputAt = 0, outputAt = 0;
  for (const patch of patches) {
    const untouched = source.slice(inputAt, patch.start);
    check(output.slice(outputAt, outputAt + untouched.length) === untouched, 'PRESERVATION_FAILED', 'An unapproved source byte changed.');
    outputAt += untouched.length;
    check(output.slice(outputAt, outputAt + patch.after.length) === patch.after, 'PRESERVATION_FAILED', 'An approved output token does not match.');
    outputAt += patch.after.length; inputAt = patch.end;
  }
  check(source.slice(inputAt) === output.slice(outputAt), 'PRESERVATION_FAILED', 'Unapproved trailing source bytes changed.');
  return true;
}
async function approvalManifest(plan) {
  return { profile: PROFILE, targetHash: plan.targetHash, donorHash: plan.donorHash,
    renameMap: plan.renameMap, dxf: await hash(plan.dxf), patches: plan.patches, geometry: plan.geometry };
}
async function planHash(plan) { return hash(JSON.stringify(await approvalManifest(plan))); }

/** Build a reviewable donor-only patch plan; no source or destination is mutated. */
export async function createPlan(review, renameMap = review?.suggestedRenames) {
  const data = REVIEWS.get(review);
  check(data, 'STALE_REVIEW', 'This review is stale, copied or was not created by this runtime. Re-review the current files.');
  check(await hash(data.target.text) === review.targetHash && await hash(data.donor.text) === review.donorHash,
    'STALE_SOURCE', 'Source hashes no longer match the review.');
  const map = validateMap(review, data, renameMap), patches = makePatches(data, map);
  const dxf = patchBytes(data.donor.text, patches); preservation(data.donor.text, dxf, patches);
  const prepared = parse(dxf);
  const combined = policy(data.target, prepared, 'keep', data.original);
  check(combined.public.changedTargetInstances.length === 0 && combined.public.changedDonorInstances.length === 0,
    'GEOMETRY_NOT_PRESERVED', 'This rename plan does not preserve all original geometry and style.');
  const orderedMap = Object.fromEntries([...map.values()].sort((a, b) => key(a.from) < key(b.from) ? -1 : key(a.from) > key(b.from) ? 1 : 0).map(x => [x.from, x.to]));
  const plan = { hash: '', renameMap: orderedMap, dxf, patches, geometry: combined.public.shapes,
    targetHash: review.targetHash, donorHash: review.donorHash, review };
  plan.hash = await planHash(plan); freeze(plan);
  PLANS.set(plan, { data, review, outputHash: await hash(dxf) }); return plan;
}
/** Export only after the caller passes the exact displayed immutable plan hash. */
export async function exportPlan(plan, approvalHash) {
  const saved = PLANS.get(plan);
  check(saved, 'STALE_PLAN', 'This plan is stale, copied or tampered with. Create a fresh plan.');
  check(typeof approvalHash === 'string' && approvalHash === plan.hash, 'APPROVAL_MISMATCH', 'Explicit approval must match this exact plan hash.');
  check(plan.review === saved.review && REVIEWS.get(plan.review) === saved.data && await planHash(plan) === plan.hash,
    'TAMPERED_PLAN', 'Plan integrity verification failed.');
  const { data } = saved;
  check(await hash(data.target.text) === plan.targetHash && await hash(data.donor.text) === plan.donorHash,
    'STALE_SOURCE', 'Source integrity verification failed.');
  check(await hash(plan.dxf) === saved.outputHash && preservation(data.donor.text, plan.dxf, plan.patches),
    'PRESERVATION_FAILED', 'Output byte preservation verification failed.');
  const chainBudget = { steps: 0 };
  const dependencyChains = [...allChains(data.target, 'target', chainBudget), ...allChains(data.donor, 'donor', chainBudget)];
  const impactCounts = Object.fromEntries(['original', 'keep', 'overwrite'].map(name => [name, {
    target: plan.review.policies[name].changedTargetInstances.length, donor: plan.review.policies[name].changedDonorInstances.length }]));
  impactCounts.prepared = { target: 0, donor: 0 };
  const inputHashes = { target: plan.targetHash, donor: plan.donorHash };
  const approvedMapHash = await hash(JSON.stringify(plan.renameMap));
  const collisionMap = { profile: PROFILE, planHash: plan.hash, approvedMapHash, inputHashes, outputHash: saved.outputHash,
    units: plan.review.units, renameMap: plan.renameMap, collisions: plan.review.collisions, dependencyChains, impactCounts };
  const preservationReport = { profile: PROFILE, planHash: plan.hash, approvedMapHash, inputHashes, outputHash: saved.outputHash,
    approvalManifest: await approvalManifest(plan),
    changedTokenCount: plan.patches.length, changedTokens: plan.patches,
    unapprovedSourceBytesUnchanged: true, destinationUnmodified: true,
    handlesAndOwnersPreserved: true, originalGeometryAndStylePreserved: true,
    dependencyChains, impactCounts, scope: 'Donor-only approved block-name token substitutions; no target output or native import guarantee.' };
  return freeze({ dxf: plan.dxf, collisionMap, preservationReport });
}
