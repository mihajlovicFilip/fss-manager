/**
 * Reading a club's completed entry form.
 *
 * This is the only place where somebody else's file enters the app, so:
 *
 * Nothing is taken on trust. The form's menus and its "Provera" column
 * help the coach, they are not protection — the file can arrive typed by
 * hand or from an old form. Everything is recomputed from the rulebook in
 * data.js: age group from year, allowed disciplines from group, weight
 * from group and sex. Derived columns in the file are never read.
 *
 * Columns are found by header, not by position — an added column or a
 * frozen row must not break the import.
 *
 * Age is computed for the competition's season, not today's date.
 *
 * A bad row does not sink the others. Every row carries its own message
 * with its Excel row number, so the club can be told exactly what to fix.
 *
 * The "FSS ID" column is optional — forms from before it import as they
 * always did. An ID that belongs to somebody else stops its row here
 * already, by the same rule the import applies (fssVerdict in data.js).
 */

import {
  BELTS, WEIGHTS, DISCIPLINES,
  ageByCode, disciplineByName, groupOfYear, levelOfBelt, teamVariants, SEASON, properName,
  fssVerdict,
} from './data.js';
import { readWorkbook } from './xlsx.js';

// === Helpers =============================================

const LETTERS = 'A-Za-zČčĆćĐđŠšŽž';
const NAME_OK = new RegExp(`^[${LETTERS}][${LETTERS} '-]*$`);

const tidy = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/**
 * Key used to compare headers and menu values: lowercase, no diacritics,
 * no spaces — "Ime i prezime" and "IME I PREZIME" are the same thing.
 */
const key = (v) => tidy(v).toLowerCase()
  .replace(/[čć]/g, 'c').replace(/đ/g, 'dj').replace(/š/g, 's').replace(/ž/g, 'z')
  .replace(/[^a-z0-9]/g, '');

const nameProblem = (value) => {
  const name = tidy(value);
  if (!name) return 'nije uneto ime';
  if (!NAME_OK.test(name)) return `ime „${name}" sadrži znakove koji nisu slova`;
  if (name.split(' ').length < 2) return `„${name}" ne sadrži i ime i prezime`;
  return null;
};

/** "muški", "M", "m" → 'M'. Empty stays empty. */
function readSex(value) {
  const k = key(value);
  if (!k) return '';
  if (k.startsWith('m') || k === 'muski') return 'M';
  if (k.startsWith('z') || k.startsWith('f') || k === 'zenski') return 'Ž';
  return '';
}

const readBelt = (value) => BELTS.find((b) => key(b) === key(value)) || '';

/** Weight arrives as number or text: 75, "75", "75 kg", "+84", "apsolutna". */
function readWeight(value, allowed) {
  const raw = tidy(value).replace(/\s*kg\s*$/i, '');
  if (!raw) return '';
  return allowed.find((w) => key(w) === key(raw)) || '';
}

/**
 * Is the row empty where we actually read it? The form carries 120 blank
 * rows full of formulas, so only the input columns count.
 */
const rowIsEmpty = (row, columns) => !row
  || columns.every((c) => c === undefined || row[c] === null || tidy(row[c]) === '');

/** After this many empty rows in a row, the table is over. */
const KRAJ = 5;

/**
 * A note under the table is not an entry row: it is one long sentence in
 * a single column — no name or discipline has sixty characters.
 */
const isNote = (row, columns) => {
  const filled = columns.filter((c) => c !== undefined && tidy(row[c]));
  return filled.length === 1 && tidy(row[filled[0]]).length > 60;
};

/**
 * Finds the header row and maps header key → column index. Looks for a
 * row containing all required headers, within the first fifty.
 */
function headerRow(rows, required) {
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const row = rows[i] || [];
    const map = new Map();
    row.forEach((cell, col) => {
      const k = key(cell);
      if (k && !map.has(k)) map.set(k, col);
    });
    if (required.every((r) => map.has(key(r)))) return { at: i, map };
  }
  return null;
}

/** Header fields: label in one column, the value to its right. */
function headerFields(rows, wanted) {
  const found = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] || [];
    for (let c = 0; c < row.length; c++) {
      const k = key(row[c]);
      const want = wanted.find((w) => key(w) === k);
      if (want && found[want] === undefined) {
        // The value sits right of the label; blank cells are skipped.
        for (let n = c + 1; n < c + 4 && n < Math.max(row.length, c + 4); n++) {
          if (tidy(row[n])) { found[want] = tidy(row[n]); break; }
        }
      }
    }
  }
  return found;
}

const sheetLike = (book, ...words) => book.names.find((n) =>
  words.some((w) => key(n).includes(key(w))));

// === FSS ID =============================================

/**
 * What the screen says next to an ID on a row that imports. Empty for
 * this year's ID that matched — nothing to add.
 */
function fssNote(said, season, club) {
  if (said.status === 'invalid') return `„${said.typed}" nije FSS ID — zanemaren`;
  if (said.status === 'unknown') return `${said.id} ne postoji u bazi — zanemaren`;
  if (said.status !== 'match') return '';
  const notes = [];
  if (said.old) {
    notes.push(said.current
      ? `ID iz ${said.from}. — važeći je ${said.current}`
      : `ID iz ${said.from}. — dobija nov za ${season}.`);
  }
  const from = said.person.club || '';
  if (club && from && from.toLowerCase() !== club.toLowerCase()) notes.push(`prelazak iz kluba ${from}`);
  return notes.join(' · ');
}

// === Individual entries =============================================

/**
 * @param {Map} [owners] FSS ID → person, from the database; without it the
 *                       IDs are read but not checked
 * @param {string} [club] the club in the form's header — for naming a transfer
 */
function readSolo(rows, season, owners = null, club = '') {
  const head = headerRow(rows, ['Godište', 'Ime i prezime']);
  if (!head) {
    return { rows: [], error: 'Na listu prijava nema reda sa naslovima kolona (Godište, Ime i prezime).' };
  }

  const col = (naslov) => head.map.get(key(naslov));
  const cIme = col('Ime i prezime');
  const cGod = col('Godište');
  const cPol = col('Pol');
  const cPojas = col('Pojas');
  const cKg = col('Telesna težina');
  const cFss = col('FSS ID');
  // Disciplines are all columns whose header starts with "Disciplina" —
  // however many the form has.
  const cDisc = [];
  head.map.forEach((at, k) => { if (k.startsWith('disciplina')) cDisc.push(at); });
  cDisc.sort((a, b) => a - b);

  const unos = [cGod, cIme, cPol, cPojas, cKg, cFss, ...cDisc];
  const out = [];
  const seen = new Map();
  let prazno = 0;

  for (let i = head.at + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (rowIsEmpty(row, unos)) {
      prazno += 1;
      if (prazno >= KRAJ) break;
      continue;
    }
    prazno = 0;
    if (isNote(row, unos)) continue;

    const line = { excelRow: i + 1, raw: tidy(row[cIme]) || '(bez imena)' };
    const year = Number(tidy(row[cGod]));
    const group = year ? groupOfYear(year, season) : '';
    const sex = readSex(row[cPol]);
    const belt = readBelt(row[cPojas]);
    const names = cDisc.map((c) => tidy(row[c])).filter(Boolean);

    const problem = (() => {
      if (!year) return 'nije uneto godište';
      if (!group) return `godište ${year} nije obuhvaćeno uzrasnom tabelom`;
      const bad = nameProblem(row[cIme]);
      if (bad) return bad;
      if (!sex) return 'nije unet pol';
      if (!belt) return tidy(row[cPojas]) ? `pojas „${tidy(row[cPojas])}" ne postoji u pravilniku` : 'nije unet pojas';
      if (!names.length) return 'nije izabrana nijedna disciplina';

      const disciplines = [];
      for (const name of names) {
        const d = DISCIPLINES.find((x) => key(x.name) === key(name));
        if (!d) return `disciplina „${name}" ne postoji u pravilniku`;
        if (d.team) return `„${d.name}" je ekipna disciplina i unosi se na listu „Ekipno"`;
        if (d.groups.indexOf(group) < 0) {
          return `„${d.name}" nije moguća za uzrast ${group} · ${ageByCode(group).name.toLowerCase()}`;
        }
        if (disciplines.some((x) => x.name === d.name)) return `„${d.name}" je uneta dvaput`;
        disciplines.push(d);
      }

      // Weight is required only where the category is split by it —
      // sport kumite. Traditional kumite is an open category.
      const weighed = disciplines.find((d) => d.drawBy === 'weight');
      const allowed = WEIGHTS[group]?.[sex] || [];
      const weight = readWeight(row[cKg], allowed);
      if (weighed && !weight) {
        return tidy(row[cKg])
          ? `telesna težina „${tidy(row[cKg])}" nije predviđena za uzrast ${group} (${allowed.join(', ')})`
          : `nije uneta telesna težina, koju ${weighed.name} zahteva`;
      }

      line.competitor = {
        name: properName(row[cIme]), sex, year, group, belt, level: levelOfBelt(belt),
        disciplines: disciplines.map((d) => ({
          name: d.name, weight: d.drawBy === 'weight' ? weight : null,
        })),
      };
      return null;
    })();

    // The ID stays on the row whatever becomes of it — the screen shows it.
    const typed = cFss === undefined ? '' : tidy(row[cFss]);
    if (typed) line.fss = typed;
    if (!problem) {
      line.competitor.row = line.excelRow;
      if (typed) line.competitor.fss = typed;
    }
    const said = !problem && typed && owners
      ? fssVerdict(line.competitor, season, (id) => owners.get(id) || null)
      : { status: 'none' };

    if (problem) {
      line.problem = problem;
    } else if (said.status === 'conflict') {
      line.problem = `${said.id} pripada takmičaru ${said.person.name} (${said.person.year}, `
        + `${said.person.club || 'bez kluba'}) — proveri ID ili ime`;
      delete line.competitor;
    } else {
      const dup = `${key(line.competitor.name)}|${year}`;
      if (seen.has(dup)) {
        line.problem = `takmičar je već unet u redu ${seen.get(dup)}`;
        delete line.competitor;
      } else {
        seen.set(dup, line.excelRow);
        line.fssNote = fssNote(said, season, club);
      }
    }
    out.push(line);
  }

  return { rows: out };
}

// === Team entries =============================================

function readTeams(rows, season) {
  const head = headerRow(rows, ['Disciplina']);
  if (!head) return { rows: [] };

  const col = (naslov) => head.map.get(key(naslov));
  const cDisc = col('Disciplina');
  const cVrsta = col('Vrsta');

  // Members come in triples: "1. godište · 1. ime i prezime · 1. pol".
  const members = [];
  for (let n = 1; n <= 8; n++) {
    const god = col(`${n}. godište`);
    const ime = col(`${n}. ime i prezime`);
    const pol = col(`${n}. pol`);
    if (god === undefined || ime === undefined) break;
    members.push({ god, ime, pol });
  }
  if (!members.length) return { rows: [] };

  const unos = [cDisc, cVrsta, ...members.flatMap((m) => [m.god, m.ime, m.pol])];
  const out = [];
  let prazno = 0;

  for (let i = head.at + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (rowIsEmpty(row, unos)) {
      prazno += 1;
      if (prazno >= KRAJ) break;
      continue;
    }
    prazno = 0;
    if (isNote(row, unos)) continue;

    const line = { excelRow: i + 1, raw: tidy(row[cDisc]) || '(bez discipline)' };

    line.problem = (() => {
      const name = tidy(row[cDisc]);
      if (!name) return 'nije uneta disciplina';
      const d = DISCIPLINES.find((x) => key(x.name) === key(name));
      if (!d) return `disciplina „${name}" ne postoji u pravilniku`;
      if (!d.team) return `„${d.name}" nije ekipna disciplina`;

      const people = [];
      for (const m of members) {
        const year = Number(tidy(row[m.god]));
        const who = tidy(row[m.ime]);
        if (!year && !who) continue;
        if (!year) return `članu „${who}" nije uneto godište`;
        if (!who) return `članu sa godištem ${year} nije uneto ime`;
        const bad = nameProblem(who);
        if (bad) return bad;
        const sex = readSex(row[m.pol]);
        if (!sex) return `članu „${who}" nije unet pol`;
        // Team member names get the same written form as individual
        // entries, so the same person reads the same everywhere.
        people.push({ name: properName(who), sex, year, group: groupOfYear(year, season) });
      }

      if (!people.length) return 'ekipi nije unet nijedan član';
      if (people.some((m) => !m.group)) return 'godište nekog od članova nije obuhvaćeno uzrasnom tabelom';
      const group = people[0].group;
      if (people.some((m) => m.group !== group)) {
        return 'članovi ekipe nisu iz iste uzrasne grupe';
      }
      if (new Set(people.map((m) => key(m.name))).size !== people.length) {
        return 'isti takmičar je unet dvaput u istoj ekipi';
      }
      if (d.groups.indexOf(group) < 0) {
        return `„${d.name}" nije moguća za uzrast ${group} · ${ageByCode(group).name.toLowerCase()}`;
      }
      if (people.length < d.team.min || people.length > d.team.max) {
        return `${d.name} zahteva ${d.team.min === d.team.max
          ? `${d.team.min} člana` : `${d.team.min}–${d.team.max} člana`}, a uneto ih je ${people.length}`;
      }

      // The club picks a variant only where the discipline has one
      // (enbu); other teams are single-sex, so the members decide it.
      const variants = teamVariants(d);
      const picked = tidy(row[cVrsta]);
      const variant = d.variants
        ? variants.find((v) => key(v.label) === key(picked) || key(v.key) === key(picked))
        : variants.find((v) => v.sex === people[0].sex);
      if (!variant) {
        return picked ? `vrsta „${picked}" nije predviđena za ${d.name}` : 'nije izabrana vrsta ekipe';
      }
      if (variant.pattern) {
        const want = [...variant.pattern].sort().join();
        const have = people.map((m) => m.sex).sort().join();
        if (want !== have) return `sastav ekipe ne odgovara vrsti „${variant.label}"`;
      } else if (people.some((m) => m.sex !== people[0].sex)) {
        return 'ekipa mora biti jednog pola';
      }

      line.team = {
        discipline: d.name, group,
        sex: variant.sex || '', variant: variant.key, variantLabel: variant.label,
        members: people.map((m) => ({ name: m.name, sex: m.sex, year: m.year })),
      };
      return null;
    })();

    out.push(line);
  }

  return { rows: out };
}

// === Whole file =============================================

/**
 * Reads an entry file. Never throws — the file arrived from outside and
 * can be anything.
 *
 * @param {Map} [owners] FSS ID → person, to check the form's IDs (store.fssOwners)
 * @returns {Promise<{error?: string, payload?: object, summary?: object,
 *                    people?: object[], teams?: object[]}>}
 *   `people` and `teams` are all rows read, valid and invalid, each with
 *   its Excel row number — the screen shows all, imports only the valid.
 */
export async function readEntryFile(file, season = SEASON(), owners = null) {
  let book;
  try {
    book = await readWorkbook(file);
  } catch (err) {
    return { error: `${err.message} Očekuje se .xlsx — ako je fajl stari .xls, otvori ga u Excelu i sačuvaj kao .xlsx.` };
  }

  const soloName = sheetLike(book, 'Prijava', 'Pojedinačno') || book.names[0];
  const teamName = sheetLike(book, 'Ekipno', 'Ekipe');
  if (!soloName) return { error: 'Radna sveska nema nijedan list.' };

  const soloRows = book.sheet(soloName);
  const fields = headerFields(soloRows, ['Klub', 'Grad', 'Trener', 'Takmičenje']);
  if (!fields.Klub) {
    return { error: 'U zaglavlju prijave nije upisan klub — bez njega se prijava ne može uvesti.' };
  }

  const solo = readSolo(soloRows, season, owners, fields.Klub);
  if (solo.error) return { error: solo.error };
  const teams = teamName ? readTeams(book.sheet(teamName), season) : { rows: [] };

  const people = solo.rows;
  const good = people.filter((r) => r.competitor);
  const goodTeams = teams.rows.filter((r) => r.team);
  if (!people.length && !teams.rows.length) {
    return { error: 'Prijava je prazna — u fajlu nema nijednog unetog takmičara.' };
  }

  return {
    people,
    teams: teams.rows,
    payload: {
      club: fields.Klub,
      city: fields.Grad || '',
      coach: fields.Trener || '',
      competition: fields.Takmičenje || '',
      competitors: good.map((r) => r.competitor),
      teams: goodTeams.map((r) => r.team),
    },
    summary: {
      club: fields.Klub,
      city: fields.Grad || '',
      coach: fields.Trener || '',
      competition: fields.Takmičenje || '',
      competitors: good.length,
      entries: good.reduce((a, r) => a + r.competitor.disciplines.length, 0),
      teams: goodTeams.length,
      badPeople: people.length - good.length,
      badTeams: teams.rows.length - goodTeams.length,
      sheets: [soloName, teamName].filter(Boolean),
    },
  };
}
