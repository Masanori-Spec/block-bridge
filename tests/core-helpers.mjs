// Original minimal test-data authoring utilities. These are not runtime imports.
export const tags = pairs => pairs.map(([code, value]) => `${code}\n${value}\n`).join('');
export function drawing({ blocks = [], entities = [], units = 4, layers = [{ name: '0', color: 7 }], vport = true } = {}) {
  let entityHandle = 0x10000;
  const definitions = [{ name: '*Model_Space', entities: [] }, { name: '*Paper_Space', entities: [] }, ...blocks];
  const handles = definitions.map((_, i) => (0x10 + i).toString(16).toUpperCase());
  const out = [[0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1015'], [9, '$INSUNITS'], [70, units],
    [9, '$INSBASE'], [10, 0], [20, 0], [30, 0], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'TABLES']];
  const table = (name, h, count) => [[0, 'TABLE'], [2, name], [5, h], [330, 0], [100, 'AcDbSymbolTable'], [70, count]];
  out.push(...table('LAYER', '2', layers.length));
  layers.forEach((l, i) => out.push([0, 'LAYER'], [5, (0x2000 + i).toString(16)], [330, '2'], [100, 'AcDbSymbolTableRecord'],
    [100, 'AcDbLayerTableRecord'], [2, l.name], [70, l.flags ?? 0], [62, l.color ?? 7], [6, l.linetype ?? 'CONTINUOUS']));
  out.push([0, 'ENDTAB']);
  if (vport) out.push(...table('VPORT', '6', 1), [0, 'VPORT'], [5, '7'], [330, '6'], [100, 'AcDbSymbolTableRecord'],
    [100, 'AcDbViewportTableRecord'], [2, '*Active'], [70, 0], [10, 0], [20, 0], [11, 1], [21, 1], [12, 0], [22, 0],
    [13, 0], [23, 0], [14, 10], [24, 10], [15, 10], [25, 10], [16, 0], [26, 0], [36, 1], [17, 0], [27, 0], [37, 0],
    [40, 200], [41, 1.5], [42, 50], [43, 0], [44, 0], [50, 0], [51, 0], [71, 0], [72, 100], [73, 1], [74, 3],
    [75, 0], [76, 0], [77, 0], [78, 0], [0, 'ENDTAB']);
  out.push(...table('BLOCK_RECORD', '3', definitions.length));
  definitions.forEach((b, i) => out.push([0, 'BLOCK_RECORD'], [5, handles[i]], [330, '3'], [100, 'AcDbSymbolTableRecord'],
    [100, 'AcDbBlockTableRecord'], [2, b.name]));
  out.push([0, 'ENDTAB'], [0, 'ENDSEC'], [0, 'SECTION'], [2, 'BLOCKS']);
  const common = (kind, owner, layer = '0') => [[0, kind], [5, (++entityHandle).toString(16).toUpperCase()],
    [330, owner], [100, 'AcDbEntity'], [8, layer]];
  function entity(e, owner) {
    const k = e.kind ?? 'LINE', result = common(k, owner, e.layer ?? '0');
    if (e.color !== undefined) result.push([62, e.color]);
    result.push([100, { LINE: 'AcDbLine', CIRCLE: 'AcDbCircle', INSERT: 'AcDbBlockReference' }[k] ?? 'AcDbUnknown']);
    if (k === 'INSERT') result.push([2, e.block]);
    result.push([10, e.x ?? 0], [20, e.y ?? 0], [30, e.z ?? 0]);
    if (k === 'LINE') result.push([11, e.x2 ?? 10], [21, e.y2 ?? 0], [31, e.z2 ?? 0]);
    if (k === 'CIRCLE') result.push([40, e.r ?? 1]);
    if (k === 'INSERT') result.push([41, e.scale ?? 1], [42, e.sy ?? e.scale ?? 1], [43, e.sz ?? e.scale ?? 1], [50, e.rotation ?? 0]);
    result.push(...(e.extra ?? [])); return result;
  }
  definitions.forEach((b, i) => {
    out.push(...common('BLOCK', handles[i]), [100, 'AcDbBlockBegin'], [2, b.name], [70, 0],
      [10, b.base?.[0] ?? 0], [20, b.base?.[1] ?? 0], [30, 0], [3, b.name], [1, '']);
    for (const e of b.entities ?? []) out.push(...entity(e, handles[i]));
    out.push(...common('ENDBLK', handles[i]), [100, 'AcDbBlockEnd']);
  });
  out.push([0, 'ENDSEC'], [0, 'SECTION'], [2, 'ENTITIES']);
  for (const e of entities) out.push(...entity(e, handles[0]));
  out.push([0, 'ENDSEC'], [0, 'EOF']); return tags(out);
}
export function records(text) {
  const lines = text.trimEnd().split(/\r?\n/); const out = []; let current;
  for (let i = 0; i < lines.length; i += 2) {
    const pair = [Number(lines[i].trim()), lines[i + 1]?.trim() ?? ''];
    if (pair[0] === 0) { current = []; out.push(current); }
    current.push(pair);
  }
  return out;
}
export const field = (record, code) => record.find(p => p[0] === code)?.[1];
export function mutate(text, selector, edit, all = false) {
  const rs = records(text); let count = 0;
  for (const r of rs) if (selector(r) && (all || count === 0)) { edit(r); count++; }
  if (!count) throw new Error('Test mutation selected no record');
  return tags(rs.flat());
}
export const set = (r, code, value) => { const p = r.find(x => x[0] === code); if (p) p[1] = value; else r.push([code, value]); };
export const remove = (r, code) => { for (let i = r.length - 1; i >= 0; i--) if (r[i][0] === code) r.splice(i, 1); };
export const type = kind => r => field(r, 0) === kind;
export const named = (kind, name) => r => field(r, 0) === kind && field(r, 2) === name;
export const byHandle = id => r => field(r, 5) === id;
