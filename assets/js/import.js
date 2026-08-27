/**
 * Čitanje prijave koju je klub popunio u Excelu.
 *
 * Formular (`form/FSS-Entry-Form.xlsx`) klubovi popunjavaju kod sebe;
 * aplikaciju ne otvaraju. Ovde stiže njihov fajl, i ovo je jedino mesto gde
 * tuđi podaci ulaze u aplikaciju — pa je celo pravilo ovog modula:
 *
 * **Ništa se ne uzima na reč.** Excel ima svoje padajuće menije i svoju
 * kolonu „Provera", ali to je pomoć trenerima, ne zaštita. Fajl može da
 * stigne popunjen ručno, iz Google tabela, iz starije verzije formulara ili
 * sa isključenim proverama. Zato se ovde sve računa iznova iz pravilnika u
 * `data.js`: uzrasna grupa iz godišta, dozvoljene discipline iz grupe,
 * telesna težina iz grupe i pola. Izvedene kolone iz fajla se **ne čitaju**.
 *
 * **Kolone se traže po naslovu, ne po mestu.** Trener koji doda kolonu ili
 * zamrzne prvi red ne sme da obori uvoz.
 *
 * **Uzrast se računa po sezoni takmičenja u koje se uvozi**, ne po današnjem
 * datumu. Prijava koja u januaru stigne za prošlogodišnje takmičenje razvrstava
 * se po tabeli te sezone.
 *
 * **Red koji ne valja ne obara ostale.** Svaki red nosi svoju poruku o tome
 * šta mu fali, sa brojem reda iz Excela — savez tako zna šta tačno da javi
 * klubu, a ispravni redovi mogu da uđu odmah.
 */

import {
  BELTS, WEIGHTS, DISCIPLINES,
  ageByCode, disciplineByName, groupOfYear, levelOfBelt, teamVariants, SEASON, properName,
} from './data.js';
import { readWorkbook } from './xlsx.js';

// ── Sitni pomoćnici ────────────────────────────────────────────────────

const LETTERS = 'A-Za-zČčĆćĐđŠšŽž';
const NAME_OK = new RegExp(`^[${LETTERS}][${LETTERS} '-]*$`);

const tidy = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

/**
 * Ključ po kome se poredе naslovi kolona i vrednosti iz menija: bez naših
 * kvačica, malim slovima, bez razmaka. „Ime i prezime", „IME I PREZIME" i
 * „ime i prezime " su ista stvar, a takva razlika ne sme da obori uvoz.
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

/** „muški", „M", „m" → 'M'. Prazno vraća prazno. */
function readSex(value) {
  const k = key(value);
  if (!k) return '';
  if (k.startsWith('m') || k === 'muski') return 'M';
  if (k.startsWith('z') || k.startsWith('f') || k === 'zenski') return 'Ž';
  return '';
}

const readBelt = (value) => BELTS.find((b) => key(b) === key(value)) || '';

/** Telesna težina stiže i kao broj i kao tekst: 75, „75", „75 kg", „+84", „apsolutna". */
function readWeight(value, allowed) {
  const raw = tidy(value).replace(/\s*kg\s*$/i, '');
  if (!raw) return '';
  return allowed.find((w) => key(w) === key(raw)) || '';
}

/**
 * Da li je red prazan **tamo gde se čita**.
 *
 * Formular nosi sto dvadeset praznih redova sa formulama i okvirima, pa red
 * nije prazan zato što u njemu nema ničega — nego zato što u njemu nema
 * ničega **što se unosi**. Izvedene kolone se ne broje.
 */
const rowIsEmpty = (row, columns) => !row
  || columns.every((c) => c === undefined || row[c] === null || tidy(row[c]) === '');

/** Posle ovoliko praznih redova zaredom tabela je gotova. */
const KRAJ = 5;

/**
 * Napomena ispod tabele nije red prijave. Prepoznaje se po tome što je duga
 * rečenica u prvoj koloni — nijedno ime ni disciplina nemaju šezdeset slova.
 */
const isNote = (row, columns) => {
  const filled = columns.filter((c) => c !== undefined && tidy(row[c]));
  return filled.length === 1 && tidy(row[filled[0]]).length > 60;
};

/**
 * Nalazi red sa naslovima i pravi mapu `ključ naslova → indeks kolone`.
 * Traži se red u kome stoje svi zadati naslovi, među prvih pedeset.
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

/** Vrednosti iz zaglavlja fajla: naziv polja u jednoj koloni, upis u sledećoj. */
function headerFields(rows, wanted) {
  const found = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] || [];
    for (let c = 0; c < row.length; c++) {
      const k = key(row[c]);
      const want = wanted.find((w) => key(w) === k);
      if (want && found[want] === undefined) {
        // Upis stoji desno od naziva; prazna ćelija između se preskače.
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

// ── Pojedinačne prijave ────────────────────────────────────────────────

function readSolo(rows, season) {
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
  // Discipline su sve kolone čiji naslov počinje na „Disciplina" — koliko ih
  // formular ima, toliko se i čita.
  const cDisc = [];
  head.map.forEach((at, k) => { if (k.startsWith('disciplina')) cDisc.push(at); });
  cDisc.sort((a, b) => a - b);

  const unos = [cGod, cIme, cPol, cPojas, cKg, ...cDisc];
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

      // Telesna težina se traži samo tamo gde se kategorija po njoj i deli — uz
      // sportski kumite. Tradicionalni je apsolutna kategorija.
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

    if (!problem) {
      const dup = `${key(line.competitor.name)}|${year}`;
      if (seen.has(dup)) {
        line.problem = `takmičar je već unet u redu ${seen.get(dup)}`;
        delete line.competitor;
      } else {
        seen.set(dup, line.excelRow);
      }
    } else {
      line.problem = problem;
    }
    out.push(line);
  }

  return { rows: out };
}

// ── Ekipne prijave ─────────────────────────────────────────────────────

function readTeams(rows, season) {
  const head = headerRow(rows, ['Disciplina']);
  if (!head) return { rows: [] };

  const col = (naslov) => head.map.get(key(naslov));
  const cDisc = col('Disciplina');
  const cVrsta = col('Vrsta');

  // Članovi stoje u trojkama „1. godište · 1. ime i prezime · 1. pol".
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
        // I član ekipe se upisuje u pisanom obliku — inače isti čovek stoji
        // jednako u spisku pojedinačnih a drugačije u ekipi.
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

      // Vrstu bira klub samo tamo gde je disciplina zaista ima (enbu);
      // ostale ekipe su jednog pola, pa im vrstu određuje sastav.
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

// ── Ceo fajl ───────────────────────────────────────────────────────────

/**
 * Čita prijavu iz .xlsx fajla.
 *
 * Nikad ne baca — prima fajl koji je stigao spolja i može biti bilo šta.
 *
 * @returns {Promise<{error?: string, payload?: object, summary?: object,
 *                    people?: object[], teams?: object[]}>}
 *   `people` i `teams` su **svi** pročitani redovi, i ispravni i neispravni,
 *   sa brojem reda iz Excela — ekran ih tako može prikazati sve, a uvesti
 *   samo one koji valjaju.
 */
export async function readEntryFile(file, season = SEASON()) {
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

  const solo = readSolo(soloRows, season);
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
