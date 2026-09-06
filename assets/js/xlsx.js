/**
 * Reading an .xlsx file — no library, no network.
 *
 * An .xlsx is a zip full of XML, so two steps cover it:
 *
 *   1. The zip is unpacked with DecompressionStream('deflate-raw'),
 *      which the browser already has.
 *   2. The XML is read with DOMParser. All we need is sharedStrings
 *      and the sheets — styles and themes are ignored.
 *
 * The result is the simplest possible shape: a sheet is an array of rows,
 * a row an array of values by column. An empty cell is null, in place —
 * column F stays column F even when E and G are empty.
 *
 * Formulas are deliberately not evaluated. Only the cached values Excel
 * stored are read; everything derived is recomputed by the app anyway.
 */

// === Zip =============================================

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * Unpacks a zip into a name → Uint8Array map. Only requested entries are
 * read — an .xlsx can carry a hundred files we do not need.
 *
 * @param {ArrayBuffer} buffer
 * @param {(name: string) => boolean} wanted
 */
async function unzip(buffer, wanted = () => true) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // The end-of-directory record has a variable-length comment, so it is
  // found by scanning backwards, not computed.
  let eocd = -1;
  const from = Math.max(0, buffer.byteLength - 66_000);
  for (let i = buffer.byteLength - 22; i >= from; i--) {
    if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Fajl nije .xlsx — nedostaje zip zaglavlje.');

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const files = new Map();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;

    if (!wanted(name)) continue;
    if (view.getUint32(localAt, true) !== LOCAL) continue;

    // The local header can carry different extra-field lengths than the
    // central one, so the data offset is computed from here.
    const start = localAt + 30 + view.getUint16(localAt + 26, true)
      + view.getUint16(localAt + 28, true);
    const raw = bytes.subarray(start, start + size);
    files.set(name, method === 0 ? raw : await inflate(raw));
  }
  return files;
}

async function inflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// === XML =============================================

const text = (bytes) => new TextDecoder().decode(bytes);

const parse = (xml) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fajl je oštećen — XML se ne čita.');
  return doc;
};

/** "BC7" → 54. Column letters are a base-26 number without a zero. */
export function columnIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const code = ch.charCodeAt(0);
    if (code < 65 || code > 90) break;
    n = n * 26 + (code - 64);
  }
  return n - 1;
}

/**
 * One cell's value. `t` says what is inside: `s` an index into shared
 * strings, `inlineStr` text in place, `b` a boolean, `e` a formula error,
 * and no attribute means a number.
 */
function cellValue(cell, shared) {
  const t = cell.getAttribute('t');
  if (t === 'inlineStr') {
    const is = cell.getElementsByTagName('is')[0];
    return is ? is.textContent : null;
  }
  const v = cell.getElementsByTagName('v')[0];
  if (!v) return null;
  const raw = v.textContent;
  if (t === 's') return shared[Number(raw)] ?? null;
  if (t === 'str') return raw;
  if (t === 'b') return raw === '1';
  if (t === 'e') return null;
  const num = Number(raw);
  return Number.isNaN(num) ? raw : num;
}

function sheetRows(xml, shared) {
  const doc = parse(xml);
  const rows = [];
  for (const row of doc.getElementsByTagName('row')) {
    // `r` is the Excel row number; empty rows are not written to the
    // file, so gaps must be restored for row 11 to stay row 11.
    const at = Number(row.getAttribute('r') || rows.length + 1) - 1;
    const values = [];
    for (const cell of row.getElementsByTagName('c')) {
      const ref = cell.getAttribute('r');
      const col = ref ? columnIndex(ref) : values.length;
      while (values.length < col) values.push(null);
      values[col] = cellValue(cell, shared);
    }
    while (rows.length < at) rows.push([]);
    rows[at] = values;
  }
  return rows;
}

// === Workbook =============================================

/**
 * Opens an .xlsx and returns its sheets.
 *
 * @param {File|Blob|ArrayBuffer} input
 * @returns {Promise<{names: string[], sheet(name: string): (string|number|null)[][]}>}
 */
export async function readWorkbook(input) {
  const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  const files = await unzip(buffer, (name) => (
    name === 'xl/workbook.xml'
    || name === 'xl/_rels/workbook.xml.rels'
    || name === 'xl/sharedStrings.xml'
    || name.startsWith('xl/worksheets/')
  ));

  const book = files.get('xl/workbook.xml');
  if (!book) throw new Error('Fajl nije Excel radna sveska.');

  const shared = [];
  const strings = files.get('xl/sharedStrings.xml');
  if (strings) {
    for (const si of parse(text(strings)).getElementsByTagName('si')) {
      shared.push(si.textContent);
    }
  }

  // A sheet name maps to its file through r:id — the order in
  // workbook.xml does not match the zip, so it must not be assumed.
  const targets = new Map();
  const rels = files.get('xl/_rels/workbook.xml.rels');
  if (rels) {
    for (const rel of parse(text(rels)).getElementsByTagName('Relationship')) {
      targets.set(rel.getAttribute('Id'), rel.getAttribute('Target').replace(/^\/?xl\//, ''));
    }
  }

  const names = [];
  const paths = new Map();
  let n = 0;
  for (const sheet of parse(text(book)).getElementsByTagName('sheet')) {
    n += 1;
    const name = sheet.getAttribute('name');
    const rid = sheet.getAttribute('r:id') || sheet.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    names.push(name);
    paths.set(name, `xl/${targets.get(rid) || `worksheets/sheet${n}.xml`}`);
  }

  const cache = new Map();
  return {
    names,
    sheet(name) {
      if (cache.has(name)) return cache.get(name);
      const file = files.get(paths.get(name));
      const rows = file ? sheetRows(text(file), shared) : [];
      cache.set(name, rows);
      return rows;
    },
  };
}
