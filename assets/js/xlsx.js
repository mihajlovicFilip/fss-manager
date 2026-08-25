/**
 * Čitanje .xlsx fajla — bez ijedne biblioteke i bez mreže.
 *
 * Klubovi prijave popunjavaju u Excelu, pa aplikacija mora da otvori tuđi
 * fajl. Cela stvar staje u dva koraka, jer je .xlsx u suštini zip pun XML-a:
 *
 *   1. **Zip** se raspakuje `DecompressionStream('deflate-raw')`-om, koji
 *      pregledač već ima. To je jedini razlog zašto ovde nema biblioteke od
 *      sto kilobajta — inflate je ionako ugrađen, samo mu treba pročitati
 *      zaglavlja.
 *   2. **XML** se čita `DOMParser`-om. Sve što nam treba je `sharedStrings`
 *      i po jedan `sheet` — ostalo (stilovi, teme, tabele) nas ne zanima.
 *
 * Vraća se najprostiji mogući oblik: list je niz redova, red je niz vrednosti
 * po kolonama. Prazna ćelija je `null`, i to na svom mestu — kolona F ostaje
 * kolona F i kad su E i G prazne.
 *
 * Šta se namerno **ne** radi: ne računaju se formule. Čitaju se zapamćene
 * vrednosti koje je Excel upisao uz njih, a sve što je iz nečega izvedeno
 * (uzrasna grupa, na primer) aplikacija ionako izvodi sama iz pravilnika —
 * tuđem fajlu se ne veruje na reč.
 */

// ── Zip ────────────────────────────────────────────────────────────────

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * Raspakuje zip u mapu `ime → Uint8Array`. Traži se samo ono što je zvano,
 * jer .xlsx ume da nosi i stotinu fajlova koji nam ne trebaju.
 *
 * @param {ArrayBuffer} buffer
 * @param {(name: string) => boolean} wanted
 */
async function unzip(buffer, wanted = () => true) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Rep zip-a je zapis o sadržaju, a njegova dužina zavisi od komentara na
  // kraju — zato se traži unazad, a ne računa.
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

    // Lokalno zaglavlje ume da ima drugačiju dužinu dodataka od centralnog,
    // pa se početak podataka računa odavde, ne odande.
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

// ── XML ────────────────────────────────────────────────────────────────

const text = (bytes) => new TextDecoder().decode(bytes);

const parse = (xml) => {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Fajl je oštećen — XML se ne čita.');
  return doc;
};

/** "BC7" → 54. Slova su broj u osnovi 26, samo bez nule. */
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
 * Vrednost jedne ćelije. `t` kaže šta je unutra: `s` je broj u spisku
 * zajedničkih niski, `inlineStr` tekst na licu mesta, `b` logička vrednost,
 * `e` greška u formuli, a bez oznake je broj.
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
    // `r` je broj reda u Excelu; prazni redovi se u fajlu ne zapisuju, pa se
    // razmak mora namestiti da bi red 11 ostao red 11.
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

// ── Radna sveska ───────────────────────────────────────────────────────

/**
 * Otvara .xlsx i vraća njegove listove.
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

  // Ime lista vodi do njegovog fajla preko r:id — redosled u workbook.xml
  // nije isti kao redosled fajlova u zipu, pa se ne sme pretpostaviti.
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
