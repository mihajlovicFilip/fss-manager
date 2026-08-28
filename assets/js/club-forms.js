/**
 * Unapred popunjeni formulari prijave, po klubu — i sve u jednom zipu.
 *
 * Savez šalje **jedan mejl svima**: u prilogu je zip u kome svaki klub ima
 * svoj formular sa već upisanim poznatim takmičarima (ime, godište, pol,
 * poslednji poznati pojas). Trener ništa ne prekucava — štiklira discipline
 * i dopiše na dno samo decu kojih još nema u registru. U zipu stoji i
 * prazan formular, za klub koji se prijavljuje prvi put.
 *
 * Radi bez ijedne biblioteke, kao i sve ostalo: .xlsx je zip pun XML-a, pa
 * se šablon (`form/FSS-Entry-Form.xlsx`) raspakuje ugrađenim
 * `DecompressionStream`-om, vrednosti se upišu **u postojeće ćelije** lista
 * „Prijava" — bez ijedne nove formule, jer je ovaj fajl već pokazao da
 * Excel ume da „popravlja" i briše pravila unosa — i sve se ponovo spakuje
 * `CompressionStream`-om. Izvedene kolone i menije ne diramo; uvoz ionako
 * ništa od toga ne čita.
 */

// ── CRC i zip ──────────────────────────────────────────────────────────

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

const inflate = async (bytes) => new Uint8Array(await new Response(
  new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')),
).arrayBuffer());

const deflate = async (bytes) => new Uint8Array(await new Response(
  new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw')),
).arrayBuffer());

/** Raspakuje zip u spisak stavki, sa **komprimovanim** sadržajem kakav jeste. */
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
    const start = localAt + 30 + view.getUint16(localAt + 26, true)
      + view.getUint16(localAt + 28, true);
    entries.push({ name, method, crc, usize, comp: bytes.subarray(start, start + csize) });
  }
  return entries;
}

/** Sastavlja zip; imena stavki idu kao UTF-8, da „KK Niš" ostane „KK Niš". */
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

  const dirLength = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirLength, true);
  end.setUint32(16, offset, true);

  const parts = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
  let cursor = 0;
  parts.forEach((p) => { out.set(p, cursor); cursor += p.length; });
  return out;
}

// ── Upis ćelija u list ─────────────────────────────────────────────────

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const colLetter = (i) => {
  let s = '';
  i += 1;
  while (i) { const q = Math.floor((i - 1) / 26); s = String.fromCharCode(65 + ((i - 1) % 26)) + s; i = q; }
  return s;
};

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

const numCell = (ref, value) => ({ col: colIndex(ref), xml: `<c r="${ref}"><v>${value}</v></c>` });
const strCell = (ref, value) => ({
  col: colIndex(ref),
  xml: `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`,
});

/**
 * Umeće ćelije u postojeći red, po redosledu kolona. Prazna zatečena ćelija
 * (okvir polja za unos) se zamenjuje uz zadržan stil; ćelija sa sadržajem se
 * ne gazi — to bi značilo da se raspored formulara promenio.
 */
function withCells(xml, rowNum, newCells) {
  if (!newCells.length) return xml;
  const full = new RegExp(`<row r="${rowNum}"([^>]*)>([\\s\\S]*?)</row>`);
  const empty = new RegExp(`<row r="${rowNum}"([^>]*)/>`);
  const m = xml.match(full) || xml.match(empty);
  if (!m) throw new Error(`U šablonu formulara nema reda ${rowNum}.`);
  const inner = m[2] || '';
  const cells = (inner.match(/<c [^>]*?\/>|<c [^>]*?>[\s\S]*?<\/c>/g) || [])
    .map((c) => ({ col: colIndex(/r="([A-Z]+)\d+"/.exec(c)[1]), xml: c }));
  for (const c of newCells) {
    const at = cells.findIndex((x) => x.col === c.col);
    if (at >= 0) {
      const old = cells[at].xml;
      if (/<[vf][ >]|<is[ >]/.test(old)) {
        throw new Error(`Ćelija ${colLetter(c.col)}${rowNum} u šablonu nije prazna.`);
      }
      const style = /\ss="\d+"/.exec(old);
      cells[at] = { col: c.col, xml: style ? c.xml.replace(/^<c r="[A-Z]+\d+"/, `$&${style[0]}`) : c.xml };
    } else cells.push(c);
  }
  cells.sort((a, b) => a.col - b.col);
  return xml.replace(m[0], `<row r="${rowNum}"${m[1]}>${cells.map((c) => c.xml).join('')}</row>`);
}

// ── Formulari ──────────────────────────────────────────────────────────

/** Formular nudi 120 redova (form/build-entry-form.py, ROWS) — više ne staje. */
const FORM_ROWS = 120;
const FIRST_ROW = 11;

/** Ime fajla bez znakova koje neki od sistema ne prima u imenu. */
const safeName = (name) => name.replace(/[\\/:*?"<>|]/g, '-').trim();

/** Putanja lista po imenu, preko workbook.xml i rels — kao u xlsx.js. */
function sheetPath(workbook, rels, sheetName) {
  const sheet = new RegExp(`<sheet[^>]*name="${sheetName}"[^>]*r:id="(rId\\d+)"`).exec(workbook)
    || new RegExp(`<sheet[^>]*r:id="(rId\\d+)"[^>]*name="${sheetName}"`).exec(workbook);
  if (!sheet) throw new Error(`U šablonu formulara nema lista „${sheetName}".`);
  const rel = new RegExp(`<Relationship[^>]*Id="${sheet[1]}"[^>]*Target="([^"]+)"`).exec(rels)
    || new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${sheet[1]}"`).exec(rels);
  return `xl/${rel[1].replace(/^\/?xl\//, '')}`;
}

/** Raspakovan šablon: stavke zipa, putanja lista „Prijava" i njegov XML. */
async function templateParts() {
  const template = await (await fetch('form/FSS-Entry-Form.xlsx')).arrayBuffer();
  const entries = readZip(template);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const workbook = new TextDecoder().decode(await inflate(byName.get('xl/workbook.xml').comp));
  const rels = new TextDecoder().decode(await inflate(byName.get('xl/_rels/workbook.xml.rels').comp));
  const soloPath = sheetPath(workbook, rels, 'Prijava');
  const blankSheet = new TextDecoder().decode(await inflate(byName.get(soloPath).comp));
  return { template, entries, soloPath, blankSheet };
}

/** Popunjen .xlsx jednog kluba: zaglavlje i po red za svakog iz registra. */
async function fillForm(parts, entry, skipped = []) {
  let sheet = withCells(parts.blankSheet, 4, [strCell('B4', entry.club)]);
  if (entry.city) sheet = withCells(sheet, 5, [strCell('B5', entry.city)]);
  if (entry.coach) sheet = withCells(sheet, 6, [strCell('B6', entry.coach)]);

  if (entry.people.length > FORM_ROWS) skipped.push(entry.club);
  entry.people.slice(0, FORM_ROWS).forEach((p, i) => {
    const r = FIRST_ROW + i;
    const cells = [numCell(`A${r}`, p.year), strCell(`B${r}`, p.name)];
    if (p.sex) cells.push(strCell(`C${r}`, p.sex));
    if (p.belt) cells.push(strCell(`D${r}`, p.belt));
    sheet = withCells(sheet, r, cells);
  });

  // Izmenjen je samo list „Prijava" — on se spakuje iznova, ostatak šablona
  // ide u novi .xlsx komprimovan kakav je i bio.
  const data = new TextEncoder().encode(sheet);
  const comp = await deflate(data);
  return writeZip(parts.entries.map((e) => (e.name === parts.soloPath
    ? { name: e.name, method: 8, crc: crc32(data), usize: data.length, comp }
    : e)));
}

/**
 * Gradi zip sa po jednim popunjenim formularom za svaki klub iz registra,
 * plus prazan šablon za nov klub.
 *
 * @param {Array<{club: string, city: string, coach: string,
 *                people: Array<{name, year, sex, belt}>}>} roster
 * @returns {Promise<{blob: Blob, files: number, skipped: string[]}>}
 *   `skipped` imenuje klubove sa više od 120 lica — višak se ne upisuje.
 */
export async function buildClubForms(roster) {
  const parts = await templateParts();
  const skipped = [];
  const files = [];
  for (const entry of roster) {
    files.push({
      name: `Prijava-${safeName(entry.club)}.xlsx`,
      bytes: await fillForm(parts, entry, skipped),
    });
  }
  files.push({ name: 'Prazan-formular.xlsx', bytes: new Uint8Array(parts.template) });

  const zip = writeZip(files.map((f) => ({
    // Gotov .xlsx je već komprimovan, pa u spoljni zip ide kakav jeste.
    name: f.name, method: 0, crc: crc32(f.bytes), usize: f.bytes.length, comp: f.bytes,
  })));

  return { blob: new Blob([zip], { type: 'application/zip' }), files: files.length, skipped };
}

/** Jedan popunjen formular kao samostalan .xlsx — za probu ili pojedinačno slanje. */
export async function buildClubForm(entry) {
  const parts = await templateParts();
  return new Blob([await fillForm(parts, entry)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
