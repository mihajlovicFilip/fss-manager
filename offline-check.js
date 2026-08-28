#!/usr/bin/env node
/**
 * offline-check.js — stalna provera cele aplikacije, bez ijedne zavisnosti.
 *
 *     node offline-check.js          # cela provera
 *     node offline-check.js --keep   # zadrži radni folder sa PDF-ovima
 *
 * Šta se proverava, redom:
 *
 *   1. **Uvoz iz pravog formulara.** Fikstura se ne crta iz glave: uzima se
 *      isti `form/FSS-Entry-Form.xlsx` koji se šalje klubovima i u njega se
 *      upišu takmičari — čime se usput proverava i da su listovi i naslovi
 *      kolona tamo gde ih čitač očekuje. Godišta se **računaju** iz uzrasne
 *      tabele za tekuću sezonu, ne kucaju — inače bi fikstura za koju godinu
 *      sama iskliznula u drugu uzrasnu grupu i pala bez razloga.
 *   2. **Svaki ekran se otvara** u headless Chrome-u, bez ijedne greške u
 *      konzoli i bez ijednog zahteva koji bi otišao van lokalnog servera.
 *   3. **Brojke se slažu**: ono što kontrolna tabla prikazuje mora biti
 *      jednako onome što je u bazi, a ono što je u bazi jednako fiksturi.
 *   4. **Dvostruki uvoz ne pravi duplikate** — isti fajl se uveze još jednom
 *      i ništa ne sme da se promeni.
 *   5. **Dokumenti se štampaju u PDF**, svaki tip, i nijedan list ne sme da
 *      bude isečen (sadržaj ne prelazi ivice lista).
 *
 * Traži: Node 22+ (ugrađeni WebSocket za CDP), python3 (server) i Google
 * Chrome ili Chromium. Ništa se ne instalira: zip se čita i piše kroz
 * `zlib`, a Chrome se vozi sirovim DevTools protokolom.
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

let passed = 0;
const pass = (msg) => { passed += 1; console.log(`  ✓ ${msg}`); };
const fail = (msg) => { throw new Error(msg); };

// ── Zip: čitanje i pisanje kroz zlib ───────────────────────────────────
//
// Isti posao koji u aplikaciji radi assets/js/xlsx.js, samo u Node-u i u oba
// smera: fajlovi koji se ne menjaju prepišu se komprimovani kakvi jesu, a
// izmenjeni list se ponovo deflate-uje. Excel-u je svejedno, čitaču takođe.

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

// ── Upis ćelija u list formulara ───────────────────────────────────────
//
// Redovi formulara već postoje (nose formule i okvire), pa se nove ćelije
// **umeću među zatečene**, po redosledu kolona — Excel i čitač očekuju
// ćelije reda poređane sleva nadesno.

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
    // Polja za unos u formularu postoje kao prazne ćelije sa stilom (okvir,
    // otključanost) — takva se zamenjuje, a stil joj se zadržava. Ćelija sa
    // sadržajem se ne gazi: to bi značilo da se raspored formulara promenio.
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

// ── Fikstura iz pravilnika ─────────────────────────────────────────────

const CLUB = { name: 'KK Provera', city: 'Proverovac', coach: 'Trener Proverić' };
const SURNAMES = ['Petrović', 'Jovanović', 'Nikolić', 'Marković', 'Đorđević', 'Stojanović',
  'Ilić', 'Pavlović', 'Simić', 'Kostić', 'Popović', 'Todorović', 'Ristić', 'Stanković'];

/** Godište koje u datoj sezoni sigurno pada u traženu grupu — računato, ne kucano. */
function yearInGroup(d, age, season) {
  for (let a = age.from; a <= age.to; a++) {
    const year = season - a;
    if (d.groupOfYear(year, season) === age.code) return year;
  }
  return null;
}

/**
 * Sastavlja prijavu: po jedan takmičar iz svake uzrasne grupe (do dve
 * discipline, telesna težina samo gde je žreb po njoj deli) i jedna ekipa.
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
    people.push({
      year, sex, weight,
      name: `Proverko ${SURNAMES[people.length]}`,
      belt: d.BELTS[i % d.BELTS.length],
      disciplines: picked,
    });
  });
  if (!people.length) fail('Iz pravilnika se ne da sastaviti nijedan takmičar — provera ne može dalje.');

  // Ekipa: disciplina bez varijanti ako postoji, inače prva varijanta prve
  // ekipne discipline. Članovi su iz iste grupe, imena van pojedinačnog spiska.
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
        members: sexes.map((sex, i) => ({
          year, sex, name: `Ekipko ${SURNAMES[SURNAMES.length - 1 - i]}`,
        })),
      };
    }
  }

  return {
    people, team, season, competitionName,
    entries: people.reduce((a, p) => a + p.disciplines.length, 0),
  };
}

/** Upisuje fiksturu u kopiju pravog formulara i vraća putanju do fajla. */
function fillForm(fixture, outPath) {
  const entries = readZip(fs.readFileSync(path.join(ROOT, 'form', 'FSS-Entry-Form.xlsx')));
  const byName = new Map(entries.map((e) => [e.name, e]));

  // Ime lista vodi do fajla preko workbook.xml i rels — kao u xlsx.js.
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

  // List „Prijava": zaglavlje (B4–B7) pa po red za svakog takmičara od reda 11.
  const soloPath = target('Prijava');
  let solo = inflate(byName.get(soloPath)).toString();
  solo = withCells(solo, 4, [strCell('B4', CLUB.name)]);
  solo = withCells(solo, 5, [strCell('B5', CLUB.city)]);
  solo = withCells(solo, 6, [strCell('B6', CLUB.coach)]);
  solo = withCells(solo, 7, [strCell('B7', fixture.competitionName)]);
  fixture.people.forEach((p, i) => {
    const r = 11 + i;
    const cells = [
      numCell(`A${r}`, p.year),
      strCell(`B${r}`, p.name),
      strCell(`C${r}`, p.sex),
      strCell(`D${r}`, p.belt),
      ...p.disciplines.map((name, n) => strCell(`${colLetter(6 + n)}${r}`, name)),
    ];
    if (p.weight) cells.push(strCell(`O${r}`, p.weight));
    solo = withCells(solo, r, cells);
  });

  // List „Ekipno": jedan red od reda 10 — disciplina, vrsta, članovi u
  // trojkama godište · ime · pol počev od kolone E.
  const teamPath = target('Ekipno');
  let teamXml = inflate(byName.get(teamPath)).toString();
  if (fixture.team) {
    const cells = [strCell('A10', fixture.team.discipline)];
    if (fixture.team.variant) cells.push(strCell('B10', fixture.team.variant));
    fixture.team.members.forEach((m, i) => {
      const base = 4 + i * 3; // E=4
      cells.push(
        numCell(`${colLetter(base)}10`, m.year),
        strCell(`${colLetter(base + 1)}10`, m.name),
        strCell(`${colLetter(base + 2)}10`, m.sex),
      );
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

// ── Server i Chrome ────────────────────────────────────────────────────

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
    } catch { /* server se još podiže */ }
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

  // Chrome sam upiše port u profil — čita se odatle, ne pogađa.
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

/** Najmanji mogući CDP klijent preko ugrađenog WebSocket-a. */
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

// ── Provera ────────────────────────────────────────────────────────────

async function main() {
  console.log('offline-check · FSS Manager\n');

  // Pravilnik se čita iz istog data.js koji koristi i aplikacija.
  const d = await import(pathToFileURL(path.join(ROOT, 'assets', 'js', 'data.js')).href);
  const season = d.SEASON();
  const competitionName = 'Provera aplikacije';
  const fixture = buildFixture(d, season, competitionName);
  pass(`fikstura za sezonu ${season}: ${fixture.people.length} takmičara, `
    + `${fixture.entries} prijava, ${fixture.team ? 1 : 0} ekipa`);

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

    // Ništa ne sme da ode van lokalnog servera — ni font, ni analitika, ništa.
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

    // ── Prvo otvaranje ─────────────────────────────────────────────────
    await goto(`${ORIGIN}/index.html`);
    await until('prvo iscrtavanje', 'document.getElementById("app")?.innerHTML.length > 300', 30_000);
    const version = await js('document.querySelector(".side-version")?.textContent');
    if (version !== d.APP_VERSION) {
      fail(`Oznaka verzije na ekranu (${version}) nije APP_VERSION iz data.js (${d.APP_VERSION}).`);
    }
    pass(`aplikacija se otvara, verzija ${version}`);

    // ── Takmičenje za proveru ──────────────────────────────────────────
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

    // ── Svaki ekran ────────────────────────────────────────────────────
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

    // ── Uvoz popunjenog formulara ──────────────────────────────────────
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

    // Isti fajl još jednom — ništa ne sme da se promeni.
    await runImport();
    const second = await registry();
    if (JSON.stringify(second) !== JSON.stringify(first)) {
      fail(`Dvostruki uvoz je promenio stanje: ${JSON.stringify(first)} → ${JSON.stringify(second)}`);
    }
    pass('isti fajl uvezen dvaput — bez duplikata');

    // ── Brojke na kontrolnoj tabli ─────────────────────────────────────
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

    // ── Dokumenti u PDF ────────────────────────────────────────────────
    await goto(`${ORIGIN}/documents.html`);
    await until('vrste dokumenata', 'document.querySelectorAll("#doc-types .toolbar-type").length > 0');
    const types = await js('[...document.querySelectorAll("#doc-types .toolbar-type")].map((b) => b.dataset.type)');
    for (const type of types) {
      await js(`document.querySelector('.toolbar-type[data-type="${type}"]').click()`);
      try {
        // Dokument se crta kroz requestAnimationFrame, a headless ume da
        // zadrema i ne isporuči nijedan kadar. Traženje snimka ekrana tera
        // kompozitor da kadar ipak proizvede, pa zakazano crtanje krene.
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

      // Ništa ne sme da viri van lista — širina ni visina.
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

    // ── Konzola i mreža ────────────────────────────────────────────────
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
    // Chrome pušta profil tek koji trenutak posle gašenja; čišćenje ne sme
    // da sruši proveru ni da zaseni njenu pravu grešku.
    if (!KEEP) {
      await sleep(300);
      try {
        fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch { /* temp folder ionako čisti sistem */ }
    }
  }
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
