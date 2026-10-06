#!/usr/bin/env node
/**
 * offline-check.js — the standing check of the whole app, dependency-free.
 *
 *     node offline-check.js          # the whole check
 *     node offline-check.js --keep   # keep the working folder with PDFs
 *
 * What it checks, in order:
 *
 *   1. Import from the real form. The fixture is written into the same
 *      form/FSS-Entry-Form.xlsx the clubs receive — which also verifies
 *      the sheets and headers are where the reader expects. Birth years
 *      are computed from the age table for the current season, so the
 *      fixture cannot drift into another group over time.
 *   2. Every screen opens in headless Chrome with no console error and
 *      no request leaving the local server.
 *   3. The numbers agree: dashboard equals database equals fixture.
 *   4. Importing the same file twice changes nothing.
 *   5. FSS IDs: numbering from 1 without gaps, IDs on the form (own,
 *      somebody else's, malformed, unknown), a transfer, the turn of the
 *      year, deletion, merging, the database refusing a duplicate, a form
 *      from before the ID column, and the ID on screen.
 *   6. Every document type prints to PDF with nothing clipped.
 *
 * Needs Node 22+ (built-in WebSocket for CDP), python3 and Chrome.
 * Nothing is installed: the zip goes through zlib, Chrome is driven
 * over the raw DevTools protocol.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.FSS_CHECK_PORT || 8791);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const KEEP = process.argv.includes('--keep');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Points for one placement — from the rulebook, not a private scale. */
const placementValue = (d, key) => d.PLACEMENTS.find((p) => p.key === key)?.points || 0;

let passed = 0;
const pass = (msg) => { passed += 1; console.log(`  ✓ ${msg}`); };
const fail = (msg) => { throw new Error(msg); };

// === Zip: reading and writing through zlib =============================================
//
// The same job assets/js/xlsx.js does in the app, in Node and in both
// directions: unchanged files are copied compressed as they are, the
// modified sheet is deflated again.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

const crc32 = (buf) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) fail('Formular nije .xlsx — nema zip zaglavlja.');

  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) break;
    const method = buf.readUInt16LE(at + 10);
    const crc = buf.readUInt32LE(at + 16);
    const csize = buf.readUInt32LE(at + 20);
    const usize = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    entries.push({ name, method, crc, usize, comp: buf.subarray(start, start + csize) });
  }
  return entries;
}

const inflate = (entry) => (entry.method === 0
  ? Buffer.from(entry.comp) : zlib.inflateRawSync(entry.comp));

function writeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.method, 8);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.comp.length, 18);
    local.writeUInt32LE(e.usize, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, e.comp);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(e.method, 10);
    c.writeUInt32LE(e.crc, 16);
    c.writeUInt32LE(e.comp.length, 20);
    c.writeUInt32LE(e.usize, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + e.comp.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}

// === Writing cells into the form sheet =============================================
//
// The form's rows already exist (formulas and borders), so new cells are
// inserted among them in column order — Excel and the reader expect a
// row's cells left to right.

const colLetter = (i) => {
  let s = '';
  i += 1;
  while (i) { const [q, r] = [Math.floor((i - 1) / 26), (i - 1) % 26]; s = String.fromCharCode(65 + r) + s; i = q; }
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

function withCells(xml, rowNum, newCells) {
  if (!newCells.length) return xml;
  const full = new RegExp(`<row r="${rowNum}"([^>]*)>([\\s\\S]*?)</row>`);
  const empty = new RegExp(`<row r="${rowNum}"([^>]*)/>`);
  const m = xml.match(full) || xml.match(empty);
  if (!m) fail(`U formularu nema reda ${rowNum} — raspored listova se promenio.`);
  const inner = m[2] || '';
  const cells = (inner.match(/<c [^>]*?\/>|<c [^>]*?>[\s\S]*?<\/c>/g) || [])
    .map((c) => ({ col: colIndex(/r="([A-Z]+)\d+"/.exec(c)[1]), xml: c }));
  for (const c of newCells) {
    // Input fields exist as empty styled cells (border, unlocked) —
    // those are replaced, keeping the style. A cell with content is not
    // overwritten: that would mean the form's layout changed.
    const at = cells.findIndex((x) => x.col === c.col);
    if (at >= 0) {
      const old = cells[at].xml;
      if (/<[vf][ >]|<is[ >]/.test(old)) {
        fail(`Ćelija ${colLetter(c.col)}${rowNum} u formularu nije prazna — fikstura bi je pregazila.`);
      }
      const style = /\ss="\d+"/.exec(old);
      cells[at] = { col: c.col, xml: style ? c.xml.replace(/^<c r="[A-Z]+\d+"/, `$&${style[0]}`) : c.xml };
    } else cells.push(c);
  }
  cells.sort((a, b) => a.col - b.col);
  return xml.replace(m[0], `<row r="${rowNum}"${m[1]}>${cells.map((c) => c.xml).join('')}</row>`);
}

// === Fixture from the rulebook =============================================

const CLUB = { name: 'KK Provera', city: 'Proverovac', coach: 'Trener Proverić' };
const SURNAMES = ['Petrović', 'Jovanović', 'Nikolić', 'Marković', 'Đorđević', 'Stojanović',
  'Ilić', 'Pavlović', 'Simić', 'Kostić', 'Popović', 'Todorović', 'Ristić', 'Stanković'];

/** A birth year that surely falls in the group this season — computed. */
function yearInGroup(d, age, season) {
  for (let a = age.from; a <= age.to; a++) {
    const year = season - a;
    if (d.groupOfYear(year, season) === age.code) return year;
  }
  return null;
}

/**
 * Builds the fixture: one competitor per age group (up to two
 * disciplines, weight only where the draw splits by it) and one team.
 */
function buildFixture(d, season, competitionName) {
  const people = [];
  d.AGES.forEach((age, i) => {
    const year = yearInGroup(d, age, season);
    if (!year || people.length >= SURNAMES.length) return;
    const sex = i % 2 ? 'Ž' : 'M';
    const offered = d.DISCIPLINES.filter((x) => !x.team && x.groups.includes(age.code));
    const picked = [];
    let weight = '';
    for (const disc of offered) {
      if (picked.length >= 2) break;
      if (disc.drawBy === 'weight') {
        const w = d.WEIGHTS[age.code]?.[sex]?.[0];
        if (!w) continue;
        weight = w;
      }
      picked.push(disc.name);
    }
    if (!picked.length) return;
    const lastName = SURNAMES[people.length];
    people.push({
      year, sex, weight,
      firstName: 'Proverko', lastName, name: `Proverko ${lastName}`,
      belt: d.BELTS[i % d.BELTS.length],
      disciplines: picked,
    });
  });
  if (!people.length) fail('Iz pravilnika se ne da sastaviti nijedan takmičar — provera ne može dalje.');

  // The team: a variant-free discipline if one exists, else the first
  // variant. Members share a group; names differ from the individuals.
  let team = null;
  const teamDisc = d.DISCIPLINES.find((x) => x.team && !x.variants)
    || d.DISCIPLINES.find((x) => x.team);
  if (teamDisc) {
    const age = d.AGES.find((a) => teamDisc.groups.includes(a.code));
    const year = age && yearInGroup(d, age, season);
    if (year) {
      const variant = teamDisc.variants ? d.teamVariants(teamDisc)[0] : null;
      const sexes = variant?.pattern
        ? [...variant.pattern]
        : Array(teamDisc.team.min).fill(variant?.sex || 'M');
      team = {
        discipline: teamDisc.name,
        variant: variant?.label || '',
        members: sexes.map((sex, i) => {
          const lastName = SURNAMES[SURNAMES.length - 1 - i];
          return { year, sex, firstName: 'Ekipko', lastName, name: `Ekipko ${lastName}` };
        }),
      };
    }
  }

  return {
    people, team, season, competitionName,
    entries: people.reduce((a, p) => a + p.disciplines.length, 0),
  };
}

/** Where the fixture writes on the "Prijava" sheet — the form's own order. */
const SOLO = { fss: 'A', first: 'B', last: 'C', year: 'D', sex: 'E', belt: 'F', disc: 8, weight: 'Q' };
/** On "Ekipno" each member takes four columns from E: first name, surname, year, sex. */
const MEMBER = { from: 4, width: 4 };

/** First name and surname of a fixture row; a bare name splits at the last space. */
const partsOf = (p) => (p.firstName !== undefined
  ? [p.firstName, p.lastName]
  : [p.name.slice(0, p.name.lastIndexOf(' ')), p.name.slice(p.name.lastIndexOf(' ') + 1)]);

/** Rewrites a header cell of the form: new text, or none at all. */
function setHeader(xml, ref, text) {
  const cell = new RegExp(`<c r="${ref}"([^>]*?) t="s"([^>]*)>[\\s\\S]*?</c>`);
  if (!cell.test(xml)) fail(`U formularu nema naslova u ćeliji ${ref}.`);
  return xml.replace(cell, text
    ? `<c r="${ref}"$1$2 t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`
    : `<c r="${ref}"$1$2/>`);
}

/**
 * Writes the fixture into a copy of the real form. A fixture may name its
 * own club and give rows an FSS ID. `legacy` turns the copy into a form
 * from before the FSS ID and the split name: no ID column, and the whole
 * name in one column, "Ime i prezime" — individuals and team members alike.
 */
function fillForm(fixture, outPath, { legacy = false } = {}) {
  const club = fixture.club || CLUB;
  const entries = readZip(fs.readFileSync(path.join(ROOT, 'form', 'FSS-Entry-Form.xlsx')));
  const byName = new Map(entries.map((e) => [e.name, e]));

  // A sheet name leads to its file through workbook.xml and its rels — as in xlsx.js.
  const workbook = inflate(byName.get('xl/workbook.xml')).toString();
  const rels = inflate(byName.get('xl/_rels/workbook.xml.rels')).toString();
  const target = (sheetName) => {
    const sheet = new RegExp(`<sheet[^>]*name="${sheetName}"[^>]*r:id="(rId\\d+)"`).exec(workbook)
      || new RegExp(`<sheet[^>]*r:id="(rId\\d+)"[^>]*name="${sheetName}"`).exec(workbook);
    if (!sheet) fail(`U formularu nema lista „${sheetName}".`);
    const rel = new RegExp(`<Relationship[^>]*Id="${sheet[1]}"[^>]*Target="([^"]+)"`).exec(rels)
      || new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${sheet[1]}"`).exec(rels);
    return `xl/${rel[1].replace(/^\/?xl\//, '')}`;
  };

  // The "Prijava" sheet: header (B4–B7), then a row per competitor from row 11.
  const soloPath = target('Prijava');
  let solo = inflate(byName.get(soloPath)).toString();
  solo = withCells(solo, 4, [strCell('B4', club.name)]);
  solo = withCells(solo, 5, [strCell('B5', club.city)]);
  solo = withCells(solo, 6, [strCell('B6', club.coach)]);
  solo = withCells(solo, 7, [strCell('B7', fixture.competitionName)]);
  if (legacy) {
    solo = setHeader(solo, `${SOLO.fss}10`, '');
    solo = setHeader(solo, `${SOLO.first}10`, 'Ime i prezime');
    solo = setHeader(solo, `${SOLO.last}10`, '');
  }
  fixture.people.forEach((p, i) => {
    const r = 11 + i;
    const [first, last] = partsOf(p);
    const cells = [
      ...(legacy
        ? [strCell(`${SOLO.first}${r}`, p.name)]
        : [strCell(`${SOLO.first}${r}`, first), strCell(`${SOLO.last}${r}`, last)]),
      numCell(`${SOLO.year}${r}`, p.year),
      strCell(`${SOLO.sex}${r}`, p.sex),
      strCell(`${SOLO.belt}${r}`, p.belt),
      ...p.disciplines.map((name, n) => strCell(`${colLetter(SOLO.disc + n)}${r}`, name)),
    ];
    if (p.weight) cells.push(strCell(`${SOLO.weight}${r}`, p.weight));
    if (p.fss && !legacy) cells.push(strCell(`${SOLO.fss}${r}`, p.fss));
    solo = withCells(solo, r, cells);
  });

  // The "Ekipno" sheet: one row from row 10 — discipline, variant, and
  // the members, four columns each.
  const teamPath = target('Ekipno');
  let teamXml = inflate(byName.get(teamPath)).toString();
  const member = (i, k) => colLetter(MEMBER.from + MEMBER.width * i + k);
  const shared = [...inflate(byName.get('xl/sharedStrings.xml')).toString()
    .matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  const headerOf = (xml, ref) => {
    const m = new RegExp(`<c r="${ref}"[^>]* t="s"[^>]*><v>(\\d+)</v>`).exec(xml);
    return m ? shared[Number(m[1])] : null;
  };
  if (legacy) {
    for (let i = 0; headerOf(teamXml, `${member(i, 0)}9`) === `${i + 1}. ime`; i++) {
      teamXml = setHeader(teamXml, `${member(i, 0)}9`, `${i + 1}. ime i prezime`);
      teamXml = setHeader(teamXml, `${member(i, 1)}9`, '');
    }
  }
  if (fixture.team) {
    const cells = [strCell('A10', fixture.team.discipline)];
    if (fixture.team.variant) cells.push(strCell('B10', fixture.team.variant));
    fixture.team.members.forEach((m, i) => {
      const [first, last] = partsOf(m);
      cells.push(...(legacy
        ? [strCell(`${member(i, 0)}10`, m.name)]
        : [strCell(`${member(i, 0)}10`, first), strCell(`${member(i, 1)}10`, last)]));
      cells.push(numCell(`${member(i, 2)}10`, m.year), strCell(`${member(i, 3)}10`, m.sex));
    });
    teamXml = withCells(teamXml, 10, cells);
  }

  const out = entries.map((e) => {
    if (e.name !== soloPath && e.name !== teamPath) return e;
    const data = Buffer.from(e.name === soloPath ? solo : teamXml);
    return {
      name: e.name, method: 8, crc: crc32(data), usize: data.length,
      comp: zlib.deflateRawSync(data),
    };
  });
  fs.writeFileSync(outPath, writeZip(out));
}

// === Server and Chrome =============================================

function startServer() {
  const proc = spawn('python3', ['server.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  proc.on('error', () => {});
  return proc;
}

async function waitServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${ORIGIN}/index.html`);
      if (r.ok) return;
    } catch { /* server still starting */ }
    await sleep(200);
  }
  fail(`Server se nije javio na ${ORIGIN} — da li je port ${PORT} zauzet?`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) fail('Nema Chrome-a ni Chromium-a — postavi putanju u promenljivu CHROME.');
  return found;
}

async function startChrome(profileDir) {
  const proc = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profileDir}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: 'ignore' });

  // Chrome writes its port into the profile — read, not guessed.
  const portFile = path.join(profileDir, 'DevToolsActivePort');
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(portFile)) {
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
      if (port) return { proc, port };
    }
    await sleep(150);
  }
  fail('Chrome se nije podigao (nema DevToolsActivePort).');
  return null;
}

/** The smallest possible CDP client over the built-in WebSocket. */
function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    const handlers = new Map();
    let nextId = 0;
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => {
        nextId += 1;
        pending.set(nextId, { res, rej, method });
        ws.send(JSON.stringify({ id: nextId, method, params }));
      }),
      on: (method, fn) => handlers.set(method, fn),
      close: () => ws.close(),
    });
    ws.onerror = () => reject(new Error('CDP veza nije uspostavljena.'));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
        else p.res(msg.result);
      } else handlers.get(msg.method)?.(msg.params);
    };
  });
}

// === The check =============================================

async function main() {
  console.log('offline-check · FSS Manager\n');

  // The rulebook comes from the same data.js the app uses.
  const d = await import(pathToFileURL(path.join(ROOT, 'assets', 'js', 'data.js')).href);
  const season = d.SEASON();
  const competitionName = 'Provera aplikacije';
  const fixture = buildFixture(d, season, competitionName);
  pass(`fikstura za sezonu ${season}: ${fixture.people.length} takmičara, `
    + `${fixture.entries} prijava, ${fixture.team ? 1 : 0} ekipa`);

  // The FSS ID rules on their own, before anything runs.
  {
    const valid = ['FSS-1/26', 'FSS-357/26', ' fss-12/26 '];
    const invalid = ['FSS-0/26', 'FSS-A/26', 'FSS-10', '10/26', 'FSS-12/2026', ''];
    valid.forEach((v) => { if (!d.parseFssId(v)) fail(`„${v}" bi morao biti ispravan FSS ID.`); });
    invalid.forEach((v) => { if (d.parseFssId(v)) fail(`„${v}" ne sme biti prihvaćen kao FSS ID.`); });
    const next = (ids, year, top) => d.nextFssNumber(ids, year, top);
    if (next(['FSS-1/26', 'FSS-2/26', 'FSS-4/26'], 2026) !== 5) fail('Posle 1, 2 i 4 sledeći mora biti 5.');
    if (next(['FSS-352/26'], 2026) !== 353) fail('Posle 352 sledeći mora biti 353.');
    if (next(['FSS-199/26'], 2026, 200) !== 201) fail('Obrisani 200 se ne sme ponoviti.');
    if (next(['FSS-1/26', 'FSS-9/26'], 2027) !== 1) fail('Nova godina mora početi od 1.');
    pass('pravila FSS ID-a: oblik, 1·2·4 → 5, 352 → 353, obrisani se ne ponavlja, nova godina od 1');
  }

  // A name is the same person whichever way round it is written.
  {
    if (d.nameWords('Petar Petrović') !== d.nameWords('Petrović  Petar')) {
      fail('„Petar Petrović" i „Petrović Petar" moraju biti ista osoba.');
    }
    if (d.nameWords('Petar Petrović') === d.nameWords('Marko Petrović')) fail('Različita imena su se izjednačila.');
    if (d.nameKey('Petrovic Petar') !== d.nameKey('Petar Petrović')) {
      fail('Provera ID-a mora prihvatiti i obrnut redosled i ime bez kvačica.');
    }
    const split = d.splitName('Ana Marija Jovanović');
    if (split.first !== 'Ana Marija' || split.last !== 'Jovanović') fail('Celo ime se ne deli na ime i prezime.');
    pass('ime: isti čovek bez obzira na redosled imena i prezimena, staro celo ime se deli na poslednjem razmaku');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fss-check-'));
  const formPath = path.join(tmp, 'KK-Provera.xlsx');
  fillForm(fixture, formPath);
  pass(`formular popunjen: ${formPath}`);

  const server = startServer();
  let chrome = null;
  let cdp = null;
  const consoleErrors = [];
  const badRequests = [];

  try {
    await waitServer();
    pass(`server radi na ${ORIGIN}`);

    chrome = await startChrome(path.join(tmp, 'profile'));
    const list = await (await fetch(`http://127.0.0.1:${chrome.port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('DOM.enable');

    // Nothing may leave the local server — no font, no analytics, nothing.
    cdp.on('Network.requestWillBeSent', (p) => {
      const url = p.request.url;
      if (!url.startsWith(ORIGIN) && /^https?:/.test(url)) badRequests.push(url);
    });
    cdp.on('Runtime.exceptionThrown', (p) => {
      consoleErrors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
    });
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') {
        consoleErrors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' '));
      }
    });

    const js = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (r.exceptionDetails) {
        fail(`U strani: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      }
      return r.result.value;
    };

    const until = async (label, expression, timeout = 15_000) => {
      const t0 = Date.now();
      for (;;) {
        const v = await js(expression);
        if (v) return v;
        if (Date.now() - t0 > timeout) fail(`Čekanje isteklo: ${label}`);
        await sleep(120);
      }
    };

    const goto = async (url) => {
      await cdp.send('Page.navigate', { url });
      await until('učitavanje strane', 'document.readyState === "complete"');
    };

    // === First open =============================================
    await goto(`${ORIGIN}/index.html`);
    await until('prvo iscrtavanje', 'document.getElementById("app")?.innerHTML.length > 300', 30_000);
    const version = await js('document.querySelector(".side-version")?.textContent');
    if (version !== d.APP_VERSION) {
      fail(`Oznaka verzije na ekranu (${version}) nije APP_VERSION iz data.js (${d.APP_VERSION}).`);
    }
    pass(`aplikacija se otvara, verzija ${version}`);

    // === The test competition =============================================
    const compId = await js(`(async () => {
      const { store } = await import('./assets/js/store.js');
      const c = await store.createCompetition({
        name: ${JSON.stringify(competitionName)}, date: '${season}-05-10',
        place: 'Proverovac', level: 'Klupski turnir', calendar: 'A', description: '',
      });
      const id = c?.id ?? c;
      await store.setCompetitionStatus(id, 'Prijave otvorene');
      await store.setActiveCompetition(id);
      return id;
    })()`);
    if (!compId) fail('Takmičenje za proveru nije napravljeno.');
    pass('probno takmičenje otvoreno za prijave');

    // === Every screen =============================================
    await goto(`${ORIGIN}/index.html`);
    await until('iscrtavanje', 'document.getElementById("app")?.innerHTML.length > 300');
    const screens = await js(
      '[...document.querySelectorAll(".nav-item[data-go]")].map((b) => b.dataset.go).concat("podesavanja")',
    );
    if (screens.length < 10) fail(`Navigacija ima svega ${screens.length} ekrana — nešto nedostaje.`);
    for (const id of screens) {
      await js(`location.hash = ${JSON.stringify(id)}`);
      await until(`ekran ${id}`, `location.hash === "#${id}"
        && document.getElementById("app").innerHTML.length > 300
        && !document.querySelector(".fatal")`);
      await sleep(80);
    }
    pass(`svih ${screens.length} ekrana se otvara`);

    // === Importing the filled form =============================================
    await js('location.hash = "uvoz"');
    await until('ekran uvoza', '!!document.getElementById("import-target")');
    await js(`(() => {
      const sel = document.getElementById('import-target');
      sel.value = ${JSON.stringify(compId)};
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await until('izbor takmičenja', `document.getElementById('import-target')?.value === ${JSON.stringify(compId)}`);

    const doc = await cdp.send('DOM.getDocument');
    const input = await cdp.send('DOM.querySelector', {
      nodeId: doc.root.nodeId, selector: '#import-file',
    });
    await cdp.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [formPath] });
    await until('čitanje formulara', '!!document.querySelector("[data-import-run]:not([disabled])")');

    const runImport = async () => {
      await js('document.getElementById("toast").textContent = ""');
      await js('document.querySelector("[data-import-run]:not([disabled])").click()');
      const toast = await until('ishod uvoza', 'document.getElementById("toast").textContent || null', 20_000);
      if (!toast.startsWith('Uvezeno')) fail(`Uvoz nije prošao: ${toast}`);
      return toast;
    };

    const registry = () => js(`(async () => {
      const { store } = await import('./assets/js/store.js');
      const r = await store.registryFor(${JSON.stringify(compId)});
      return { competitors: r.competitors.length, entries: r.entries.length, teams: r.teams.length };
    })()`);

    // === FSS ID helpers =============================================
    const inStore = (body) => js(`(async () => {
      const { store } = await import('./assets/js/store.js');
      ${body}
    })()`);

    const fssPeople = () => inStore(`return (await store.listPeople()).map((p) => ({
      id: p.id, name: p.name, year: p.year, club: p.club, identity: p.identity,
      aliases: p.aliases || [], fssIds: p.fssIds || [] }));`);

    /** Every ID held once, nobody with two IDs in one year. */
    const fssInvariants = (people, label) => {
      const holder = new Map();
      people.forEach((p) => {
        const years = new Set();
        p.fssIds.forEach((id) => {
          if (holder.has(id)) fail(`${label}: ${id} imaju dvojica (${holder.get(id)} i ${p.name}).`);
          holder.set(id, p.name);
          const year = d.parseFssId(id)?.year;
          if (!year) fail(`${label}: ${p.name} nosi neispravan ID „${id}".`);
          if (years.has(year)) fail(`${label}: ${p.name} ima dva ID-a za ${year}.`);
          years.add(year);
        });
      });
      return holder.size;
    };
    const personNamed = (people, name) => {
      const found = people.filter((p) => p.name === name);
      if (found.length !== 1) fail(`U bazi ${found.length} osoba „${name}" — očekuje se jedna.`);
      return found[0];
    };
    const numbersOf = (people, year) => people
      .flatMap((p) => p.fssIds.map((id) => d.parseFssId(id)))
      .filter((x) => x && x.year === year).map((x) => x.number);

    const createCompetition = (name, date) => inStore(`
      const c = await store.createCompetition({ name: ${JSON.stringify(name)}, date: '${date}',
        place: 'Proverovac', level: 'Klupski turnir', calendar: 'B', description: '' });
      await store.setCompetitionStatus(c.id, 'Prijave otvorene');
      return c.id;`);

    /**
     * One form through the import screen, as the editor does it: pick the
     * competition, pick the file, read the preview, import. Returns the
     * preview's rejected rows, the toast and the report card.
     */
    const importForm = async (formPath, competitionId) => {
      await js('location.hash = "uvoz"');
      await until('ekran uvoza', '!!document.getElementById("import-target")');
      await js('document.querySelector("[data-import-clear]")?.click()');
      await until('prazan uvoz', '!document.querySelector("[data-import-run]:not([disabled])")');
      await js(`(() => {
        const sel = document.getElementById('import-target');
        sel.value = ${JSON.stringify(competitionId)};
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await until('izbor takmičenja',
        `document.getElementById('import-target')?.value === ${JSON.stringify(competitionId)}`);
      const root = await cdp.send('DOM.getDocument');
      const picker = await cdp.send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '#import-file' });
      await cdp.send('DOM.setFileInputFiles', { nodeId: picker.nodeId, files: [formPath] });
      await until('čitanje formulara', '!!document.querySelector("[data-import-run]:not([disabled])")');
      const bad = await js(`[...document.querySelectorAll('.import-grid tr.is-bad')]
        .map((tr) => tr.textContent.replace(/\\s+/g, ' ').trim())`);
      const toast = await runImport();
      const done = await js(`document.querySelector('.pf-card.is-done')?.textContent
        .replace(/\\s+/g, ' ').trim() || ''`);
      return { bad, toast, done };
    };

    await runImport();
    const first = await registry();
    if (first.entries !== fixture.entries) {
      fail(`Uvezeno ${first.entries} prijava, fikstura nosi ${fixture.entries}.`);
    }
    if (first.competitors < fixture.people.length) {
      fail(`Uvezeno ${first.competitors} takmičara, fikstura nosi ${fixture.people.length}.`);
    }
    if (fixture.team && first.teams !== 1) fail(`Uvezena ${first.teams} ekipa umesto jedne.`);
    pass(`uvoz iz formulara: ${first.competitors} takmičara, ${first.entries} prijava, ${first.teams} ekipa`);
    const idsAfterFirst = await fssPeople();

    // The same file again — nothing may change.
    await runImport();
    const second = await registry();
    if (JSON.stringify(second) !== JSON.stringify(first)) {
      fail(`Dvostruki uvoz je promenio stanje: ${JSON.stringify(first)} → ${JSON.stringify(second)}`);
    }
    pass('isti fajl uvezen dvaput — bez duplikata');

    // === FSS ID =============================================
    //
    // The yearly ID end to end: numbering, the form's ID column, transfers,
    // the turn of the year, deletion and merging — through the real form
    // and the real import screen where a club's file is involved.

    // Numbering: the demo's competitors numbered from 1 in a fixed order,
    // the fixture after them, nobody twice, a second import gives nothing.
    {
      const people = idsAfterFirst;
      const total = fssInvariants(people, 'posle uvoza');
      const n26 = numbersOf(people, season).sort((a, b) => a - b);
      if (n26[0] !== 1 || n26[n26.length - 1] !== n26.length) {
        fail(`Brojevi za ${season} nisu 1…${n26.length} bez rupa: ${n26.slice(0, 5).join(', ')}…`);
      }
      const demoFirst = await inStore(`
        const all = await store.listCompetitions();
        const demo = all.find((c) => c.date === '${season}-03-14');
        if (!demo) return null;
        const reg = await store.registryFor(demo.id);
        return [...reg.competitors].sort((a, b) => a.name.localeCompare(b.name, 'sr')
          || a.year - b.year || a.club.localeCompare(b.club, 'sr') || String(a.id).localeCompare(String(b.id)))
          .slice(0, 2).map((c) => c.fssId);`);
      if (demoFirst && (demoFirst[0] !== d.fssId(season, 1) || demoFirst[1] !== d.fssId(season, 2))) {
        fail(`Prva dva takmičara demo takmičenja nose ${demoFirst.join(', ')} — očekuje se FSS-1 i FSS-2.`);
      }
      fixture.people.forEach((p) => {
        if (!d.fssIdOf(personNamed(people, p.name), season)) fail(`${p.name} posle uvoza nema FSS ID.`);
      });
      (fixture.team?.members || []).forEach((m) => {
        if (!d.fssIdOf(personNamed(people, m.name), season)) fail(`Član ekipe ${m.name} nema FSS ID.`);
      });
      if (numbersOf(people, season - 1).length) fail(`Takmičenja iz ${season - 1}. dobila su ID-eve.`);
      const again = await fssPeople();
      if (JSON.stringify(again.map((p) => p.fssIds)) !== JSON.stringify(people.map((p) => p.fssIds))) {
        fail('Drugi uvoz istog fajla promenio je FSS ID-eve.');
      }
      pass(`FSS ID: ${total} ID-eva, ${season}. od 1 do ${n26.length} bez rupa, `
        + 'prvi po abecedi FSS-1, drugi FSS-2, svako po jedan, ponovljen uvoz ne daje nove');
    }

    // A form with IDs: own ID with the name spelled without diacritics,
    // no ID, a newcomer, somebody else's ID, a malformed ID, an ID from a
    // year nobody has.
    const P = fixture.people;
    const soloDiscipline = (year, onSeason) => {
      const group = d.groupOfYear(year, onSeason);
      return d.DISCIPLINES.find((x) => !x.team && x.drawBy !== 'weight'
        && x.groups.includes(group))?.name;
    };
    const plain = (p, onSeason = season) => ({
      firstName: p.firstName, lastName: p.lastName, name: p.name,
      year: p.year, sex: p.sex, belt: p.belt || 'zeleni', weight: '',
      disciplines: [soloDiscipline(p.year, onSeason)],
    });
    const named = (row, firstName, lastName) => ({
      ...row, firstName, lastName, name: `${firstName} ${lastName}`,
    });
    const idOf = (people, name) => d.fssIdOf(personNamed(people, name), season);
    const ascii = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'dj').replace(/Đ/g, 'Dj');
    const comp2 = await createCompetition('Provera FSS ID-a', `${season}-06-10`);
    {
      const before = await fssPeople();
      const top = Math.max(...numbersOf(before, season));
      const form = path.join(tmp, 'KK-Provera-ID.xlsx');
      fillForm({
        competitionName: 'Provera FSS ID-a', team: null,
        people: [
          { ...named(P[0], P[0].firstName, ascii(P[0].lastName)), fss: idOf(before, P[0].name) },
          { ...P[1] },
          named(plain(P[2]), 'Novko', 'Novaković'),
          { ...named(plain(P[3]), 'Uljez', 'Uljezović'), fss: idOf(before, P[3].name) },
          { ...named(plain(P[2]), 'Formo', 'Formatović'), fss: `FSS-A/${season % 100}` },
          { ...P[4], fss: d.fssId(season - 1, 5) },
          // First name and surname swapped between their columns.
          named(P[6], P[6].lastName, P[6].firstName),
        ],
      }, form);
      const { toast, done, bad } = await importForm(form, comp2);
      if (!bad.some((t) => t.includes('Uljez') && t.includes('pripada takmičaru'))) {
        fail(`Pregled uvoza ne zaustavlja tuđi ID: ${JSON.stringify(bad)}`);
      }
      if (/nije uvezeno zbog FSS ID-a/.test(toast)) fail(`Tuđi ID je stigao do uvoza: ${toast}`);
      const after = await fssPeople();
      fssInvariants(after, 'formular sa ID-em');
      const reg = await inStore(`return (await store.registryFor(${JSON.stringify(comp2)})).competitors
        .map((c) => ({ name: c.name, firstName: c.firstName, lastName: c.lastName,
          personId: c.personId, fssId: c.fssId }));`);
      if (reg.length !== 6) fail(`Uvezeno ${reg.length} takmičara umesto 6: ${reg.map((c) => c.name).join(', ')}`);
      const a = personNamed(after, P[0].name);
      if (reg.find((c) => c.name === ascii(P[0].name))?.personId !== a.id) {
        fail('Takmičar sa svojim ID-em (ime bez kvačica) nije prepoznat kao ista osoba.');
      }
      const swapped = reg.find((c) => c.personId === personNamed(after, P[6].name).id);
      if (!swapped || swapped.firstName !== P[6].firstName || swapped.lastName !== P[6].lastName) {
        fail(`Zamenjeno ime i prezime nije prepoznato kao ${P[6].name}: ${JSON.stringify(swapped)}`);
      }
      if (!a.aliases.length) fail('Drugi zapis imena nije sačuvan kao alias.');
      if (after.length !== before.length + 2) {
        fail(`Nastalo ${after.length - before.length} novih osoba umesto 2 (novajlija i neispravan ID).`);
      }
      if (idOf(after, 'Novko Novaković') !== d.fssId(season, top + 1)
        || idOf(after, 'Formo Formatović') !== d.fssId(season, top + 2)) {
        fail(`Novi ID-evi nisu ${top + 1} i ${top + 2}: ${idOf(after, 'Novko Novaković')}, `
          + `${idOf(after, 'Formo Formatović')}`);
      }
      [P[0], P[1], P[4]].forEach((p) => {
        if (JSON.stringify(personNamed(after, p.name).fssIds) !== JSON.stringify(personNamed(before, p.name).fssIds)) {
          fail(`${p.name} je dobio drugi ID iste godine.`);
        }
      });
      if (!/ne postoji u bazi/.test(done) || !/nije FSS ID/.test(done)) {
        fail(`Izveštaj uvoza ne imenuje zanemarene ID-eve: ${done}`);
      }
      pass(`formular sa ID-em: svoj ID prepoznat i bez kvačica, bez ID-a po imenu, novajlije `
        + `${d.fssId(season, top + 1)} i ${d.fssId(season, top + 2)}, tuđi ID zaustavljen u pregledu, `
        + `neispravan i nepostojeći zanemareni; „${P[6].lastName} ${P[6].firstName}" je ${P[6].name}`);
    }

    // A transfer: the new club writes the person's ID — same person, same
    // ID, points follow. A team member is moved on purpose: their old team
    // must still find them (checked by the team gold below).
    const mover = fixture.team?.members[0] || null;
    if (mover) {
      const before = await fssPeople();
      const moverId = idOf(before, mover.name);
      const form = path.join(tmp, 'KK-Provera-Dva.xlsx');
      fillForm({
        competitionName: 'Provera FSS ID-a', team: null,
        club: { name: 'KK Provera Dva', city: 'Proverovac', coach: 'Trener Drugić' },
        people: [
          { ...plain({ ...mover, belt: 'plavi' }), fss: moverId },
          { ...P[1], fss: idOf(before, P[1].name) },
        ],
      }, form);
      const { toast, done } = await importForm(form, comp2);
      const after = await fssPeople();
      fssInvariants(after, 'prelazak');
      const moved = personNamed(after, mover.name);
      if (moved.club !== 'KK Provera Dva') fail(`Prelazak nije upisan: ${mover.name} je i dalje u ${moved.club}.`);
      if (d.fssIdOf(moved, season) !== moverId) fail(`${mover.name} posle prelaska nema isti ID.`);
      if (after.length !== before.length) fail('Prelazak sa ID-em napravio je novu osobu.');
      if (!/Prelazak u drugi klub/.test(done)) fail(`Izveštaj ne imenuje prelazak: ${done}`);
      if (!/nije uvezeno zbog FSS ID-a: 1/.test(toast)) {
        fail(`Takmičar već prijavljen za drugi klub nije zaustavljen: ${toast}`);
      }
      pass(`prelazak po FSS ID-u: ${mover.name} u novom klubu sa istim ID-em, bez nove osobe; `
        + 'već prijavljen za drugi klub zaustavljen');
    }

    // The turn of the year: last year's ID recognises the person, the new
    // year numbers from 1 in row order, the old ID stays as history.
    const next = season + 1;
    const comp27 = await createCompetition('Provera nove godine', `${next}-03-01`);
    {
      const before = await fssPeople();
      const form = path.join(tmp, `KK-Provera-${next}.xlsx`);
      fillForm({
        competitionName: 'Provera nove godine', team: null,
        people: [
          { ...plain(P[0], next), fss: idOf(before, P[0].name) },
          { ...plain(P[1], next), fss: idOf(before, P[1].name) },
          { ...plain(P[2], next) },
          named(plain(P[3], next), 'Mladen', 'Mladenović'),
        ],
      }, form);
      const { done } = await importForm(form, comp27);
      const after = await fssPeople();
      fssInvariants(after, 'nova godina');
      const want = [P[0].name, P[1].name, P[2].name, 'Mladen Mladenović'];
      want.forEach((name, i) => {
        const got = d.fssIdOf(personNamed(after, name), next);
        if (got !== d.fssId(next, i + 1)) fail(`${name} za ${next}. nosi ${got} umesto ${d.fssId(next, i + 1)}.`);
      });
      const a = personNamed(after, P[0].name);
      if (d.fssIdOf(a, season) !== idOf(before, P[0].name)) fail('Prošlogodišnji ID nije ostao u istoriji.');
      if (!after.some((p) => p.fssIds.includes(d.fssId(season, 1)))
        || !after.some((p) => p.fssIds.includes(d.fssId(next, 1)))) {
        fail(`${d.fssId(season, 1)} i ${d.fssId(next, 1)} ne postoje istovremeno.`);
      }
      if (!/Prepoznato po FSS ID-u\s*2/.test(done)) fail(`Prošlogodišnji ID-evi nisu prepoznali takmičare: ${done}`);
      const again = await importForm(form, comp27);
      if (/novih FSS ID-eva/.test(again.toast)) fail(`Ponovljen uvoz za ${next}. dao je nove ID-eve: ${again.toast}`);
      pass(`nova godina: prošlogodišnji ID prepoznaje, ${d.fssId(next, 1)}…${d.fssId(next, 4)} redom, `
        + `${idOf(before, P[0].name)} ostaje u istoriji, ${d.fssId(season, 1)} i ${d.fssId(next, 1)} postoje zajedno`);
    }

    // Deletion and merging, straight through the store: a deleted
    // person's number is never handed out again; a mistyped year merged
    // into the right person keeps one ID for the year.
    {
      const disc = soloDiscipline(season - 30, next);
      const entry = (name, year) => JSON.stringify({
        firstName: name.split(' ')[0], lastName: name.split(' ').slice(1).join(' '),
        club: 'KK Provera', sex: 'M', year, belt: 'braon', weight: '', disciplines: [disc],
      });
      const result = await inStore(`
        const comp27 = ${JSON.stringify(comp27)};
        const gone = await store.addCompetitor(comp27, ${entry('Brisko Brisić', season - 30)});
        await store.removeCompetitor(comp27, gone.competitorId);
        const later = await store.addCompetitor(comp27, ${entry('Posle Brisića', season - 30)});
        const twin = await store.addCompetitor(${JSON.stringify(comp2)}, ${entry('Spojko Spojić', season - 30)});
        const typo = await store.addCompetitor(comp27, ${entry('Spojko Spojić', season - 29)});
        const merged = await store.editCompetitor(comp27, typo.competitorId, ${entry('Spojko Spojić', season - 30)});
        // The mistyped record also competed the year before, so it stays —
        // and still hands this year's ID over.
        await store.addCompetitor(${JSON.stringify(comp2)}, ${entry('Ostajko Ostojić', season - 29)});
        const right = await store.addCompetitor(${JSON.stringify(comp2)}, ${entry('Ostajko Ostojić', season - 30)});
        const wrong = await store.addCompetitor(comp27, ${entry('Ostajko Ostojić', season - 29)});
        await store.editCompetitor(comp27, wrong.competitorId, ${entry('Ostajko Ostojić', season - 30)});
        const people = await store.listPeople();
        const ostajko = (year) => people.find((p) => p.name === 'Ostajko Ostojić' && p.year === year);
        return {
          gone: gone.fssId, later: later.fssId, twin: twin.fssId, typo: typo.fssId,
          merged: merged.merged, mergedId: merged.fssId,
          spojko: people.filter((p) => p.name === 'Spojko Spojić').map((p) => p.fssIds || []),
          handed: wrong.fssId, right: right.fssId,
          rightIds: ostajko(${season - 30})?.fssIds || [], wrongIds: ostajko(${season - 29})?.fssIds || [],
        };`);
      const goneNo = d.parseFssId(result.gone)?.number;
      if (d.parseFssId(result.later)?.number !== goneNo + 1) {
        fail(`Posle brisanja ${result.gone} sledeći je ${result.later} — broj je ponovo upotrebljen.`);
      }
      if (!result.merged || result.spojko.length !== 1) fail(`Spajanje nije spojilo: ${JSON.stringify(result)}`);
      const [ids] = result.spojko;
      if (!ids.includes(result.twin) || !ids.includes(result.typo) || result.mergedId !== result.typo) {
        fail(`Posle spajanja ID-evi nisu na jednoj osobi: ${JSON.stringify(result)}`);
      }
      if (!result.rightIds.includes(result.handed) || result.wrongIds.includes(result.handed)
        || result.wrongIds.length !== 1) {
        fail(`Zapis koji ostaje nije predao ID za ${next}.: ${JSON.stringify(result)}`);
      }
      const dup = await js(`new Promise((resolve) => {
        const open = indexedDB.open('fss-manager');
        open.onsuccess = () => {
          const db = open.result;
          const t = db.transaction('people', 'readwrite');
          t.objectStore('people').put({ id: 'dvojnik', identity: 'dvojnik', name: 'Dvojnik',
            fssIds: [${JSON.stringify(result.later)}] });
          t.oncomplete = () => { db.close(); resolve('upisano'); };
          t.onabort = () => { db.close(); resolve(t.error?.name || 'prekinuto'); };
        };
        open.onerror = () => resolve('nema baze');
      })`);
      if (dup !== 'ConstraintError') fail(`Baza je primila drugu osobu sa ${result.later}: ${dup}`);
      fssInvariants(await fssPeople(), 'brisanje i spajanje');
      pass(`brisanje: posle ${result.gone} dolazi ${result.later}; spajanje: jedna osoba nosi `
        + `${result.twin} i ${result.typo}; baza odbija drugu osobu sa istim ID-em`);
    }

    // A form from before the ID column and the split name — one person
    // written surname first — imports as it always did.
    {
      const comp3 = await createCompetition('Provera starog formulara', `${season}-07-10`);
      const form = path.join(tmp, 'KK-Provera-stari.xlsx');
      const turned = P[7];
      fillForm({
        ...fixture,
        people: fixture.people.map((p) => (p === turned ? named(p, p.lastName, p.firstName) : p)),
      }, form, { legacy: true });
      const before = await fssPeople();
      await importForm(form, comp3);
      const reg = await inStore(`const r = await store.registryFor(${JSON.stringify(comp3)});
        return { entries: r.entries.length, teams: r.teams.length,
          ids: r.competitors.filter((c) => c.fssId).length, competitors: r.competitors.map((c) => ({
            personId: c.personId, firstName: c.firstName, lastName: c.lastName })) };`);
      if (reg.entries !== fixture.entries) fail(`Stari formular: ${reg.entries} prijava od ${fixture.entries}.`);
      if (fixture.team && reg.teams !== 1) fail('Stari formular: ekipa nije uvezena.');
      if (reg.ids !== reg.competitors.length) fail('Stari formular: neko je ostao bez FSS ID-a.');
      if ((await fssPeople()).length !== before.length) fail('Stari formular je napravio duplikate.');
      const back = reg.competitors.find((c) => c.personId === personNamed(before, turned.name).id);
      if (!back || back.firstName !== turned.firstName || back.lastName !== turned.lastName) {
        fail(`„${turned.lastName} ${turned.firstName}" iz jedne kolone nije prepoznat: ${JSON.stringify(back)}`);
      }
      pass(`stari formular (ime u jednoj koloni, bez FSS ID-a) uvezen: ${reg.entries} prijava i ekipa, `
        + `isti ljudi i ID-evi, „${turned.lastName} ${turned.firstName}" prepoznat`);
    }

    // On screen: the column, search by ID, read-only in the correction,
    // the history on the record card.
    {
      const people = await fssPeople();
      const target = P[5] || P[0];
      const id = idOf(people, target.name);
      await js('location.hash = "takmicari"');
      await until('spisak takmičara', '!!document.getElementById("competitor-search")');
      const head = await js('[...document.querySelectorAll(".grid thead th")].map((th) => th.textContent.trim())');
      if (head.slice(1, 4).join('|') !== 'FSS ID|Ime|Prezime') {
        fail(`Spisak takmičara ne počinje kolonama FSS ID, Ime, Prezime: ${head.slice(0, 5).join(', ')}`);
      }
      const search = (text) => js(`(() => {
        const box = document.getElementById('competitor-search');
        box.value = ${JSON.stringify(text)};
        box.dispatchEvent(new Event('input', { bubbles: true }));
        return [...document.querySelectorAll('tr[data-search]')].filter((r) => !r.hidden)
          .map((r) => [...r.querySelectorAll('.col-name')].map((c) => c.textContent.trim()).join(' '));
      })()`);
      const found = await search(id.toLowerCase());
      if (found.length !== 1 || found[0] !== target.name) {
        fail(`Pretraga po ${id} našla: ${JSON.stringify(found)}`);
      }
      const turned = await search(`${target.lastName} ${target.firstName}`.toLowerCase());
      if (!turned.includes(target.name)) fail(`Pretraga „prezime ime" ne nalazi ${target.name}.`);
      await search(id.toLowerCase());
      await js(`[...document.querySelectorAll('tr[data-search]')].find((r) => !r.hidden)
        .querySelector('[data-edit-entry]').click()`);
      await until('ispravka prijave', '!!document.getElementById("edit-entry-form")');
      const dialog = await js(`(() => {
        const form = document.getElementById('edit-entry-form');
        return { text: form.textContent, editable: [...form.querySelectorAll('input, select')]
          .some((el) => el.value === ${JSON.stringify(id)}),
          first: form.querySelector('#e-first')?.value, last: form.querySelector('#e-last')?.value };
      })()`);
      if (!dialog.text.includes(id) || dialog.editable) {
        fail(`Ispravka prijave ne prikazuje ${id} samo za čitanje.`);
      }
      if (dialog.first !== target.firstName || dialog.last !== target.lastName) {
        fail(`Ispravka prijave nema ime i prezime u zasebnim poljima: ${dialog.first} / ${dialog.last}`);
      }
      await js('document.querySelector("#modal button[data-close]").click()');
      const a = personNamed(people, P[0].name);
      const card = await js(`(async () => {
        const btn = document.createElement('button');
        btn.dataset.person = ${JSON.stringify(a.id)};
        document.getElementById('app').append(btn);
        btn.click();
        for (let i = 0; i < 50 && !document.querySelector('.career-ids'); i++) {
          await new Promise((r) => setTimeout(r, 50));
        }
        btn.remove();
        const text = document.querySelector('.career-ids')?.textContent || '';
        document.querySelector('#modal button[data-close]')?.click();
        return text;
      })()`);
      if (!a.fssIds.every((x) => card.includes(x))) fail(`Kartica ne prikazuje istoriju ID-eva: ${card}`);
      pass(`na ekranu: kolone FSS ID · Ime · Prezime, pretraga po ${id} i po „prezime ime", `
        + `ime i prezime u zasebnim poljima ispravke, ID samo za čitanje, `
        + `istorija ${a.fssIds.join(' · ')} na kartici takmičara`);
    }

    // === Dashboard figures =============================================
    await js('location.hash = "kontrolna-tabla"');
    await until('kontrolna tabla', 'document.querySelectorAll(".stat").length > 3');
    const stats = await js(`Object.fromEntries([...document.querySelectorAll('.stat')]
      .map((s) => [s.querySelector('.stat-label').textContent,
                   s.querySelector('.stat-value').textContent.replace(/\\s/g, '')]))`);
    const shown = (label) => Number(stats[label]);
    if (shown('Takmičari') !== first.competitors
      || shown('Prijave') !== first.entries
      || shown('Ekipe') !== first.teams) {
      fail(`Tabla kaže ${stats['Takmičari']}/${stats['Prijave']}/${stats['Ekipe']}, `
        + `baza ${first.competitors}/${first.entries}/${first.teams}.`);
    }
    pass('brojke na kontrolnoj tabli jednake bazi');

    // === Team placement: member points, one club medal =============================================
    const teamCheck = await js(`(async () => {
      const { store } = await import('./assets/js/store.js');
      const r = await store.registryFor(${JSON.stringify(compId)});
      const team = r.teams[0];
      if (!team) return { error: 'u registru nema nijedne ekipe' };
      await store.setTeamResult(team, 'zlato');
      await store.setCompetitionStatus(${JSON.stringify(compId)}, 'Završeno');
      const tally = await store.tallyByPerson(${JSON.stringify(compId)});
      const people = await store.listPeople();
      // By name and year only: one member has moved club since (the
      // transfer check above) and must still be found through the team.
      const members = (team.members || []).map((m) => {
        const person = people.find((p) => p.year === m.year
          && p.name.toLowerCase() === m.name.toLowerCase());
        const t = person && tally.get(person.id);
        return { name: m.name, found: !!person, zlato: t?.here.zlato || 0, bodovi: t?.here.bodovi || 0 };
      });
      const clubs = await store.clubTally();
      const mine = clubs.clubs.find((c) => c.name === team.club);
      return {
        label: team.label,
        members,
        club: { zlato: mine?.zlato || 0, medalje: mine?.medalje || 0, bodovi: mine?.bodovi || 0 },
      };
    })()`);
    if (teamCheck.error) fail(`Ekipni plasman: ${teamCheck.error}`);
    const gold = placementValue(d, 'zlato');
    teamCheck.members.forEach((m) => {
      if (!m.found) fail(`Član ekipe „${m.name}" nema svoje lice u bazi.`);
      if (m.zlato !== 1 || m.bodovi !== gold) {
        fail(`Član „${m.name}" ima ${m.zlato} zlata i ${m.bodovi} bodova — očekuje se 1 i ${gold}.`);
      }
    });
    if (teamCheck.club.zlato !== 1 || teamCheck.club.medalje !== 1 || teamCheck.club.bodovi !== gold) {
      fail(`Klubu ekipno zlato nije upisano jednom: ${JSON.stringify(teamCheck.club)}`);
    }
    pass(`ekipno zlato: ${teamCheck.members.length} člana po ${gold} bodova, klubu jedna medalja`
      + (mover ? ` — i ${mover.name}, koji je u međuvremenu prešao u drugi klub` : ''));

    // The team diploma exists and carries the team name, not members.
    await js('location.hash = "diplome"');
    await until('ekipna diploma', `!!document.querySelector('[data-dip-cat^="team:"]')`);
    const teamDiploma = await js(`document.querySelector('[data-dip-cat^="team:"] .result-disc')?.textContent`);
    if (teamDiploma !== teamCheck.label) {
      fail(`Na ekipnoj diplomi stoji „${teamDiploma}" umesto naziva tima „${teamCheck.label}".`);
    }
    pass(`ekipna diploma nosi naziv tima („${teamDiploma}")`);


    // === Documents to PDF =============================================
    await goto(`${ORIGIN}/documents.html`);
    await until('vrste dokumenata', 'document.querySelectorAll("#doc-types .toolbar-type").length > 0');
    const types = await js('[...document.querySelectorAll("#doc-types .toolbar-type")].map((b) => b.dataset.type)');
    for (const type of types) {
      await js(`document.querySelector('.toolbar-type[data-type="${type}"]').click()`);
      try {
        // The document draws through requestAnimationFrame, and headless
        // can doze off and deliver no frame. Requesting a screenshot
        // forces the compositor to produce one, so the render starts.
        const t0 = Date.now();
        for (;;) {
          const ok = await js(`document.querySelectorAll('#doc-sheet section.page').length > 0
            && document.querySelector('.toolbar-type[data-type="${type}"]').getAttribute('aria-selected') === 'true'`);
          if (ok) break;
          if (Date.now() - t0 > 20_000) fail(`Čekanje isteklo: dokument ${type}`);
          await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 20 }).catch(() => {});
          await sleep(150);
        }
      } catch (err) {
        const state = await js(`JSON.stringify({
          meta: document.getElementById('doc-meta').textContent,
          aria: document.querySelector('.toolbar-type[data-type="${type}"]')?.getAttribute('aria-selected'),
          pages: document.querySelectorAll('#doc-sheet section.page').length,
          hash: location.hash,
        })`);
        fail(`${err.message}\n  stanje: ${state}\n  konzola: ${consoleErrors.join(' | ') || '(čista)'}`);
      }
      await sleep(150);

      // The club sheet is where coaches read their competitors' IDs.
      if (type === 'klubovi') {
        const shown = await js(`(document.getElementById('doc-sheet').textContent.match(/FSS-\\d+\\/\\d{2}/g) || []).length`);
        if (shown < fixture.people.length) fail(`Prijave po klubovima nose ${shown} FSS ID-eva — premalo.`);
      }

      // Nothing may stick out of the sheet — width or height.
      const clipped = await js(`[...document.querySelectorAll('#doc-sheet section.page')]
        .flatMap((p, i) => (p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1)
          ? ['list ' + (i + 1) + ' (' + p.scrollWidth + '×' + p.scrollHeight + ' u ' + p.clientWidth + '×' + p.clientHeight + ')'] : [])`);
      if (clipped.length) fail(`Dokument „${type}" je isečen: ${clipped.join(', ')}`);

      const pdf = await cdp.send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
      const bytes = Buffer.from(pdf.data, 'base64');
      if (bytes.length < 10_000) fail(`PDF dokumenta „${type}" je sumnjivo mali (${bytes.length} B).`);
      fs.writeFileSync(path.join(tmp, `dokument-${type}.pdf`), bytes);
    }
    pass(`sva ${types.length} dokumenta odštampana u PDF, nijedan list nije isečen`);

    // === Console and network =============================================
    if (consoleErrors.length) fail(`Greške u konzoli:\n  ${consoleErrors.join('\n  ')}`);
    pass('konzola bez ijedne greške');
    if (badRequests.length) fail(`Zahtevi van lokalnog servera:\n  ${[...new Set(badRequests)].join('\n  ')}`);
    pass('nijedan zahtev nije otišao na mrežu');

    console.log(`\nSVE PROLAZI — ${passed} provera.`);
    if (KEEP) console.log(`Radni folder je zadržan: ${tmp}`);
  } finally {
    cdp?.close();
    chrome?.proc.kill();
    server.kill();
    // Chrome releases the profile a moment after closing; cleanup must
    // neither fail the check nor mask its real error.
    if (!KEEP) {
      await sleep(300);
      try {
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch { /* the system cleans temp anyway */ }
    }
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
