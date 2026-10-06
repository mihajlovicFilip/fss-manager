/**
 * The club entry form, with the federation's list of competitors in it.
 *
 * form/FSS-Entry-Form.xlsx has a hidden sheet, Spisak, that its Prijava
 * sheet looks FSS IDs up in: a coach types an ID and the first name,
 * surname, year, sex and belt fill themselves. The file as built carries
 * no list; this writes the current one into a copy, so one file goes to
 * every club. Only values are written — the formulas are the template's,
 * made by form/build-entry-form.py, and the file has a history of Excel
 * "repairing" what it did not expect.
 *
 * No library, like the rest: the copy is unpacked with
 * DecompressionStream, two sheets are rewritten, and the zip is packed
 * again with CompressionStream.
 */

const TEMPLATE = 'form/FSS-Entry-Form.xlsx';
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** As far as the template's ranges reach (SPISAK and KLUBOVI in build-entry-form.py). */
const LIST_ROWS = 5000;
const CLUB_ROWS = 500;

// === Zip =============================================

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (bytes) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

const through = async (bytes, stream) => new Uint8Array(
  await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

/** The zip's entries, each with its content as stored — still compressed. */
function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 66_000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Šablon formulara nije .xlsx — nema zip zaglavlja.');

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const csize = view.getUint32(at + 20, true);
    const usize = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    // The local header may carry other extra-field lengths than the
    // central one, so the data offset is read from it.
    const start = localAt + 30 + view.getUint16(localAt + 26, true)
      + view.getUint16(localAt + 28, true);
    entries.push({ name, method, crc, usize, comp: bytes.subarray(start, start + csize) });
  }
  return entries;
}

/** Packs entries into a zip; names go as UTF-8. */
function writeZip(entries) {
  const UTF8 = 0x0800;
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8, true);
    local.setUint16(8, e.method, true);
    local.setUint32(14, e.crc, true);
    local.setUint32(18, e.comp.length, true);
    local.setUint32(22, e.usize, true);
    local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, e.comp);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, UTF8, true);
    c.setUint16(10, e.method, true);
    c.setUint32(16, e.crc, true);
    c.setUint32(20, e.comp.length, true);
    c.setUint32(24, e.usize, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + e.comp.length;
  }

  const directory = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directory, true);
  end.setUint32(16, offset, true);

  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let cursor = 0;
  parts.forEach((p) => { out.set(p, cursor); cursor += p.length; });
  return out;
}

// === Sheets =============================================

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (v) => v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** A sheet's file in the zip, by sheet name — through workbook.xml and its rels, as in xlsx.js. */
function sheetPath(workbook, rels, name) {
  const sheet = new RegExp(`<sheet[^>]*name="${name}"[^>]*r:id="(rId\\d+)"`).exec(workbook)
    || new RegExp(`<sheet[^>]*r:id="(rId\\d+)"[^>]*name="${name}"`).exec(workbook);
  if (!sheet) throw new Error(`U šablonu formulara nema lista „${name}" — šablon je stariji od aplikacije.`);
  const rel = new RegExp(`<Relationship[^>]*Id="${sheet[1]}"[^>]*Target="([^"]+)"`).exec(rels)
    || new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${sheet[1]}"`).exec(rels);
  return `xl/${rel[1].replace(/^\/?xl\//, '')}`;
}

const cell = (ref, value) => (typeof value === 'number'
  ? `<c r="${ref}"><v>${value}</v></c>`
  : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`);

/** The Spisak sheet with the list written in: IDs and their people in A–G, clubs in I. */
function listSheet(xml, rows, clubs) {
  const height = Math.max(rows.length, clubs.length) + 1;
  const lines = [];
  for (let r = 1; r <= height; r++) {
    const values = r === 1
      ? ['FSS ID', 'Ime', 'Prezime', 'Godište', 'Pol', 'Pojas', 'Klub']
      : (rows[r - 2] && [rows[r - 2].id, rows[r - 2].firstName, rows[r - 2].lastName,
        Number(rows[r - 2].year) || '', rows[r - 2].sex, rows[r - 2].belt, rows[r - 2].club]) || [];
    // An empty value gets no cell: looked up, it reads as "", not 0.
    const cells = values.map((v, k) => (v === '' ? '' : cell(`${'ABCDEFG'[k]}${r}`, v)));
    const club = r === 1 ? 'Klubovi' : clubs[r - 2];
    if (club) cells.push(cell(`I${r}`, club));
    lines.push(`<row r="${r}">${cells.join('')}</row>`);
  }
  return xml
    .replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:I${height}"/>`)
    .replace(/<sheetData\/>|<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${lines.join('')}</sheetData>`);
}

/** The edition line names the list's date, so a coach can tell a fresh file from an old one. */
function withListDate(xml, shared, today) {
  const at = /<c r="A2"([^>]*?) t="s"([^>]*)><v>(\d+)<\/v><\/c>/.exec(xml);
  if (!at) return xml;
  const day = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1)
    .padStart(2, '0')}.${today.getFullYear()}.`;
  const old = shared[Number(at[3])] || '';
  const stamp = `spisak takmičara od ${day}`;
  const line = /izdanje [\d.]+/.test(old) ? old.replace(/izdanje [\d.]+/, stamp) : `${old} · ${stamp}`;
  return xml.replace(at[0],
    `<c r="A2"${at[1]}${at[2]} t="inlineStr"><is><t xml:space="preserve">${esc(line)}</t></is></c>`);
}

// === The form =============================================

/**
 * A copy of the entry form with the list written in.
 *
 * @param {{rows: Array, clubs: string[]}} roster  store.entryFormRoster()
 * @param {Date} [today]
 * @returns {Promise<{blob: Blob, listed: number, left: number}>}
 *   `left` counts IDs that did not fit the template's ranges.
 */
export async function buildEntryForm(roster, today = new Date()) {
  const response = await fetch(TEMPLATE);
  if (!response.ok) throw new Error('Šablon formulara nije dostupan.');
  const entries = readZip(await response.arrayBuffer());
  const byName = new Map(entries.map((e) => [e.name, e]));
  const read = async (name) => {
    const entry = byName.get(name);
    if (!entry) throw new Error(`Šablon formulara je nepotpun (${name}).`);
    return new TextDecoder().decode(entry.method === 0
      ? entry.comp : await through(entry.comp, new DecompressionStream('deflate-raw')));
  };

  const workbook = await read('xl/workbook.xml');
  const rels = await read('xl/_rels/workbook.xml.rels');
  const listPath = sheetPath(workbook, rels, 'Spisak');
  const soloPath = sheetPath(workbook, rels, 'Prijava');
  const shared = [...(await read('xl/sharedStrings.xml')).matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => unesc(m[1].replace(/<[^>]+>/g, '')));

  const rows = roster.rows.slice(0, LIST_ROWS);
  const changed = new Map([
    [listPath, listSheet(await read(listPath), rows, roster.clubs.slice(0, CLUB_ROWS))],
    [soloPath, withListDate(await read(soloPath), shared, today)],
  ]);

  // Only the two rewritten sheets are packed again; the rest of the
  // template goes into the copy compressed as it was.
  const out = [];
  for (const entry of entries) {
    const text = changed.get(entry.name);
    if (text === undefined) { out.push(entry); continue; }
    const data = new TextEncoder().encode(text);
    out.push({
      name: entry.name, method: 8, crc: crc32(data), usize: data.length,
      comp: await through(data, new CompressionStream('deflate-raw')),
    });
  }
  return {
    blob: new Blob([writeZip(out)], { type: XLSX_TYPE }),
    listed: rows.length,
    left: roster.rows.length - rows.length,
  };
}
