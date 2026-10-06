/**
 * Data storage — IndexedDB, local, no server.
 *
 * This is the only seam between the app and its data. Screens and
 * documents call functions here and get promises; if a small server ever
 * stands behind these functions, nothing else changes.
 *
 * Why IndexedDB and not localStorage: localStorage is synchronous, holds
 * only text and caps at a few megabytes — one competition with 1500
 * entries passes that easily.
 *
 * === How the data connects =============================================
 *
 *   people        one person, once. Lives above competitions; points
 *                 accumulate here across seasons.
 *   competitors   that person at one competition (club, belt, age group)
 *   entries       one entry = a competitor in one discipline
 *   results       a placement on one entry; points derive from it
 *   teams         team entries
 *   competitions  the competitions themselves
 *   meta          active competition, mat plan, seasons
 *
 * A person also carries their yearly FSS IDs (fssIds) — one per calendar
 * year, handed out here and nowhere else (see "FSS ID" below).
 *
 * Points are never stored as a number. They are always computed from
 * placements via PLACEMENTS in data.js — change the scale in one place
 * and every old table recalculates itself.
 */

import {
  SEED_COMPETITION, PAST_COMPETITION, buildRegistry, DISCIPLINES, AGES, DEMO_VERSION,
  disciplinesForGroup, categoryKey, pointsFor, placementByKey, calendarOf, labelTeams,
  clubByName, groupOfYear, SEASON, DIPLOMA_DEFAULT, pointsCounted, BELTS, WEIGHTS,
  levelOfBelt, seasonOf, entriesOpen, FEES_DEFAULT, properName,
  FSS_ID_SINCE, fssId, fssIdOf, nextFssNumber, fssVerdict, nameWords, nameParts,
  parseFssId, CLUBS,
} from './data.js';

/** The demo includes one past-season competition, split by its table. */
const PROSLA_SEZONA = SEASON() - 1;

const DB_NAME = 'fss-manager';
const DB_VERSION = 3;

/**
 * The database name before the product name was fixed. A rename without a
 * migration would strand everything in a database nobody opens any more —
 * the transfer runs once, on first launch after the fix.
 */
const PREVIOUS_DB_NAME = 'fss-menager';

/*
 * An index is a name, or { name, unique, multiEntry } when it needs more.
 * fssIds is unique across all people: the database itself refuses a
 * second person with an ID somebody already holds.
 */
const STORES = {
  competitions: { keyPath: 'id' },
  people: {
    keyPath: 'id',
    indexes: ['identity', { name: 'fssIds', unique: true, multiEntry: true }],
  },
  competitors: { keyPath: 'id', indexes: ['competitionId', 'personId'] },
  entries: { keyPath: 'id', indexes: ['competitionId', 'competitorId'] },
  results: { keyPath: 'id', indexes: ['competitionId', 'personId', 'entryId'] },
  teams: { keyPath: 'id', indexes: ['competitionId'] },
  meta: { keyPath: 'key' },
};

let dbPromise = null;

/**
 * Moves data from the old database name, if one is found. Runs quietly
 * before the new database opens; a failed transfer must not break the
 * launch — an app that will not open is worse than one that starts with
 * demo data.
 */
async function migrateFromPreviousName() {
  if (!indexedDB.databases) return;
  let names;
  try {
    names = (await indexedDB.databases()).map((d) => d.name);
  } catch (err) {
    return;
  }
  if (!names.includes(PREVIOUS_DB_NAME) || names.includes(DB_NAME)) return;

  const open = (name) => new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Stara baza je otvorena u drugom prozoru.'));
  });

  try {
    const old = await open(PREVIOUS_DB_NAME);
    const stores = [...old.objectStoreNames].filter((n) => n in STORES);
    if (!stores.length) { old.close(); return; }

    const data = await Promise.all(stores.map((name) => new Promise((resolve, reject) => {
      const request = old.transaction(name, 'readonly').objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    })));
    old.close();

    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(stores, 'readwrite');
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      stores.forEach((name, i) => {
        const os = transaction.objectStore(name);
        data[i].forEach((row) => os.put(row));
      });
    });
    indexedDB.deleteDatabase(PREVIOUS_DB_NAME);
    console.info(`Podaci su preneti iz baze „${PREVIOUS_DB_NAME}".`);
  } catch (err) {
    console.warn('Prenos iz stare baze nije uspeo:', err.message);
  }
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const upgrade = request.transaction;
      // Stores and indexes are only added, never dropped — a database
      // made by an older version must survive the upgrade with its data.
      Object.entries(STORES).forEach(([name, spec]) => {
        const os = db.objectStoreNames.contains(name)
          ? upgrade.objectStore(name)
          : db.createObjectStore(name, { keyPath: spec.keyPath });
        (spec.indexes || []).forEach((index) => {
          const { name, ...options } = typeof index === 'string' ? { name: index } : index;
          if (!os.indexNames.contains(name)) os.createIndex(name, name, { unique: false, ...options });
        });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Baza je otvorena u drugom prozoru — zatvori ga pa osveži.'));
  });
  return dbPromise;
}

/** One transaction, one promise. `run` receives the object stores. */
async function tx(names, mode, run) {
  const db = await openDb();
  const list = Array.isArray(names) ? names : [names];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(list, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transakcija prekinuta'));
    // The result resolves only once the transaction commits — otherwise
    // a read right after a write could miss it.
    Promise.resolve(run(...list.map((n) => transaction.objectStore(n))))
      .then((value) => { result = value; })
      .catch((err) => { try { transaction.abort(); } catch { /* already aborted */ } reject(err); });
  });
}

const wrap = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const allBy = (osName, index, value) =>
  tx(osName, 'readonly', (os) => wrap(os.index(index).getAll(value)));

const all = (osName) => tx(osName, 'readonly', (os) => wrap(os.getAll()));

/** crypto.randomUUID needs a secure context; localhost is, file:// is not. */
const newId = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));

/**
 * What makes the same person across two competitions.
 *
 * A licence number is official and wins when present. Until they are in
 * the database, a person is name + birth year + club — the most precise
 * identification available. The club is there because of namesakes: two
 * clubs really do enter two different children with the same name and
 * year. The known cost: whoever changes club starts as a new record,
 * points from zero. The import names every such case (transfers) instead
 * of deciding quietly.
 *
 * The name counts by its words, not their order: "Petar Petrović" and
 * "Petrović Petar" are one person.
 */
const looseIdentity = (person) => `nm:${nameWords(person.name)}|${person.year}`;

/** An identity written before word order stopped counting, rewritten. */
const reorderedIdentity = (identity) => String(identity)
  .replace(/^nm:([^|]*)/, (match, name) => `nm:${nameWords(name)}`);

/**
 * How a name is written on a record. A person the database knows keeps
 * the order it has for them, so a form that swapped first name and
 * surname still lists them the right way round; otherwise as written.
 */
function writtenName(row, person) {
  const source = person && nameWords(row.name) === nameWords(person.name) ? person : row;
  const { first, last } = nameParts(source);
  return { name: source.name, firstName: first, lastName: last };
}

const identityOf = (person) => {
  if (person.licence) return `lic:${String(person.licence).trim().toUpperCase()}`;
  const club = String(person.club || '').trim().toLowerCase();
  return club ? `${looseIdentity(person)}|${club}` : looseIdentity(person);
};

/**
 * The people behind a team's members, resolved by identity (name + year
 * + the team's club). A member carries no personId — imports and
 * corrections track them by name — so the person is found fresh each
 * time, by the same rule the import used. A member with no person record
 * (a team from an older database) is skipped.
 */
const teamMembersOf = (team, personByIdentity) => (team.members || [])
  .map((m) => personByIdentity.get(identityOf({ ...m, club: team.club })))
  .filter(Boolean);

/** A team result row, recognised by its kind, addressed via entryId. */
const teamOf = (result, teamById) => (result.kind === 'team'
  ? teamById.get(result.teamId || result.entryId) || null : null);

/**
 * Everyone by identity: current identities first, then former ones
 * (aliases). An alias is a name an FSS ID proved belongs to the same
 * person — another spelling, or the club before a transfer — so a team
 * entered under it still finds its member.
 */
const identityIndex = (people) => {
  const map = new Map(people.map((p) => [p.identity, p]));
  people.forEach((p) => (p.aliases || []).forEach((a) => { if (!map.has(a)) map.set(a, p); }));
  return map;
};

/**
 * Migrates existing people to club-carrying identities. An older database
 * has identities without the club; unmigrated, the next import would see
 * everyone as unknown and duplicate them. The club comes from the most
 * recent appearance. Version 3 stopped word order from counting, so every
 * identity — and every alias — is written again.
 */
async function migrateIdentities() {
  const done = await metaGet('identityVersion', 0);
  if (done >= 3) return;

  const [people, competitors] = await Promise.all([all('people'), all('competitors')]);
  const byPerson = new Map();
  competitors.forEach((c) => {
    if (!c.personId) return;
    const prev = byPerson.get(c.personId);
    if (!prev || String(c.competitionId) > String(prev.competitionId)) byPerson.set(c.personId, c);
  });

  const updated = people.map((p) => {
    const club = p.club || byPerson.get(p.id)?.club || '';
    const identity = identityOf({ ...p, club });
    const aliases = p.aliases
      && [...new Set(p.aliases.map(reorderedIdentity))].filter((a) => a !== identity);
    return { ...p, club, identity, ...(aliases ? { aliases } : {}) };
  });

  await tx(['people', 'meta'], 'readwrite', (ppl, meta) => {
    updated.forEach((r) => ppl.put(r));
    meta.put({ key: 'identityVersion', value: 3 });
  });
}

// === FSS ID =============================================

/** meta key: the highest number handed out per year — outlives deletions. */
const FSS_TOP = 'fssTop';

/**
 * Hands out a year's next numbers. It starts from everyone already in the
 * database and from `tops`, the remembered highest per year, which it
 * updates in place for the caller to store with the people.
 */
function fssDispenser(people, tops) {
  const ids = people.flatMap((p) => p.fssIds || []);
  const next = new Map();
  return (year) => {
    const n = next.get(year) || nextFssNumber(ids, year, tops[year] || 0);
    next.set(year, n + 1);
    tops[year] = n;
    return fssId(year, n);
  };
}

/**
 * Gives a person their ID for the year if they have none yet. True when
 * one was given. Years before FSS_ID_SINCE give nothing.
 */
function grantFssId(person, year, dispense) {
  if (year < FSS_ID_SINCE || fssIdOf(person, year)) return false;
  person.fssIds = [...(person.fssIds || []), dispense(year)];
  return true;
}

/** Fixed order for numbering: alphabetically, then year, club and id. */
const byNameForIds = (a, b) => String(a.name).localeCompare(String(b.name), 'sr')
  || Number(a.year) - Number(b.year)
  || String(a.club || '').localeCompare(String(b.club || ''), 'sr')
  || String(a.id).localeCompare(String(b.id));

/**
 * Everybody competing from FSS_ID_SINCE on has their ID for the
 * competition's year. Runs on every start: the first time it numbers a
 * database that had no IDs, after that it only fills a gap if one shows
 * up. The order is fixed — competitions by date, their competitors
 * alphabetically, then team members — so the same database always gets
 * the same numbers. A failure must not stop the app from opening; the
 * next start tries again.
 */
async function ensureFssIds() {
  try {
    const [competitions, competitors, teams, people, tops] = await Promise.all([
      all('competitions'), all('competitors'), all('teams'), all('people'), metaGet(FSS_TOP, {}),
    ]);
    const personById = new Map(people.map((p) => [p.id, p]));
    const byIdentity = identityIndex(people);
    const dispense = fssDispenser(people, tops);
    const changed = new Set();
    const give = (person, year) => {
      if (person && grantFssId(person, year, dispense)) changed.add(person);
    };

    competitions
      .filter((c) => seasonOf(c) >= FSS_ID_SINCE)
      .sort((a, b) => (a.date || '').localeCompare(b.date || '')
        || (a.createdAt || '').localeCompare(b.createdAt || '')
        || String(a.id).localeCompare(String(b.id)))
      .forEach((competition) => {
        const year = seasonOf(competition);
        competitors.filter((c) => c.competitionId === competition.id)
          .sort(byNameForIds)
          .forEach((c) => give(personById.get(c.personId), year));
        teams.filter((t) => t.competitionId === competition.id)
          .sort((a, b) => [a.discipline, a.group, a.variant || a.sex, a.club].join('|')
            .localeCompare([b.discipline, b.group, b.variant || b.sex, b.club].join('|'), 'sr')
            || String(a.id).localeCompare(String(b.id)))
          .forEach((t) => teamMembersOf(t, byIdentity).forEach((p) => give(p, year)));
      });

    if (!changed.size) return;
    await tx(['people', 'meta'], 'readwrite', (ppl, meta) => {
      changed.forEach((p) => ppl.put(p));
      meta.put({ key: FSS_TOP, value: tops });
    });
  } catch (err) {
    console.warn('FSS ID-evi nisu dodeljeni:', err.message);
  }
}

// === Seeding on first run =============================================

/** Stores the demo fills — and empties when the demo refreshes. */
const DATA_STORES = ['competitions', 'people', 'competitors', 'entries', 'results', 'teams'];

/**
 * Is the database still an untouched demo: exactly the two seeded
 * competitions and none of the user's own. Once the user adds their own,
 * the demo is never touched automatically — stale numbers beat lost work.
 */
async function demoUntouched() {
  const competitions = await all('competitions');
  const seeded = [SEED_COMPETITION.name, PAST_COMPETITION.name];
  return competitions.length === seeded.length
    && competitions.every((c) => seeded.includes(c.name));
}

/**
 * A database seeded by an older demo cannot show what the app now does.
 * An untouched demo refreshes silently; one the user has worked in is
 * left alone and only marked stale — the dashboard then offers a button.
 */
async function refreshDemo() {
  const version = await tx('meta', 'readonly', (os) => wrap(os.get('demoVersion')));
  if (version?.value === DEMO_VERSION) return;

  if (!await demoUntouched()) {
    await tx('meta', 'readwrite', (os) => os.put({ key: 'demoStale', value: DEMO_VERSION }));
    return;
  }

  await tx([...DATA_STORES, 'meta'], 'readwrite', (...stores) => {
    stores.forEach((os) => os.clear());
  });
  await seed();
}

/**
 * Turns the demo registry into one competition's records: every entry
 * gets its id and its link to a person. Used both for seeding and for
 * creating a new competition pre-filled — one path, same shape.
 *
 * @param {string} competitionId  where the entries go
 * @param {number} seed           same seed, same registry
 */
function registryRecords(competitionId, seed) {
  const registry = buildRegistry(seed);
  const people = [];
  const competitors = registry.competitors.map((c) => {
    const person = {
      id: newId(), identity: identityOf(c),
      name: c.name, firstName: c.firstName, lastName: c.lastName,
      sex: c.sex, year: c.year, club: c.club || '', licence: c.licence,
    };
    people.push(person);
    return { ...c, id: newId(), competitionId, personId: person.id };
  });

  const byOldId = new Map(registry.competitors.map((c, i) => [c.id, competitors[i]]));
  const entries = registry.entries.map(({ competitor, ...rest }) => ({
    ...rest,
    id: newId(),
    competitionId,
    competitorId: byOldId.get(competitor.id).id,
    personId: byOldId.get(competitor.id).personId,
  }));
  const teams = registry.teams.map((t) => ({ ...t, id: newId(), competitionId }));
  return { people, competitors, entries, teams };
}

async function seed() {
  const done = await tx('meta', 'readonly', (os) => wrap(os.get('seeded')));
  if (done) return;

  const competitionId = newId();

  const competition = {
    ...SEED_COMPETITION,
    id: competitionId,
    disciplines: DISCIPLINES.map((d) => d.name),
    createdAt: new Date().toISOString(),
  };

  const { people, competitors, entries, teams } = registryRecords(competitionId, 7);

  // A finished past-season competition with the same people and recorded
  // placements — without it, the running total has nothing to add.
  const past = seedPastCompetition(people, competitors);

  await tx(['competitions', 'people', 'competitors', 'entries', 'teams', 'results', 'meta'], 'readwrite',
    (comps, ppl, cmp, ent, tms, res, meta) => {
      comps.put(competition);
      comps.put(past.competition);
      people.forEach((r) => ppl.put(r));
      competitors.forEach((r) => cmp.put(r));
      past.competitors.forEach((r) => cmp.put(r));
      entries.forEach((r) => ent.put(r));
      past.entries.forEach((r) => ent.put(r));
      teams.forEach((r) => tms.put(r));
      past.results.forEach((r) => res.put(r));
      meta.put({ key: 'activeCompetitionId', value: competitionId });
      meta.put({ key: 'seeded', value: new Date().toISOString() });
      meta.put({ key: 'demoVersion', value: DEMO_VERSION });
    });
}

/**
 * Builds the past-season competition from existing people and hands out
 * placements per category — one gold, one silver, two bronzes, the rest
 * participation — so the numbers look like reality.
 */
function seedPastCompetition(people, competitors) {
  const competitionId = newId();
  const competition = {
    ...PAST_COMPETITION,
    id: competitionId,
    disciplines: DISCIPLINES.map((d) => d.name),
    createdAt: new Date().toISOString(),
  };

  const belts = ['žuti', 'oranž', 'zeleni', 'plavi', 'braon'];
  // The club a person carries this season — last season keeps it, except
  // for those who transferred in between.
  const clubOfPerson = new Map(competitors.map((c) => [
    c.personId, { name: c.club, city: c.city, coach: c.coach },
  ]));
  const past = [];
  const entries = [];

  // Last season: the same people a year younger, so their age group may
  // differ — the discipline is picked by that competition's group. It is
  // smaller than the current one on purpose: about a third of the same
  // people is what gives the running total something to add.
  people.slice(0, Math.round(people.length / 3)).forEach((person, i) => {
    const year = person.year;
    const group = groupOfYear(year, PROSLA_SEZONA);
    const allowed = disciplinesForGroup(group);
    if (!allowed.length) return;

    // The club stays the same as this season — a transfer is the
    // exception. Every seventh person changes club: enough to show old
    // medals staying with the old club without the transfer mark losing
    // its meaning.
    const moved = i % 7 === 3;
    const other = PAST_CLUBS[i % PAST_CLUBS.length];
    const now = clubOfPerson.get(person.id);
    const club = moved || !now ? other : now;
    const competitor = {
      id: newId(), competitionId, personId: person.id,
      name: person.name, firstName: person.firstName, lastName: person.lastName,
      sex: person.sex, year, group,
      club: club.name, city: club.city, coach: club.coach,
      belt: belts[i % belts.length], level: '', licence: person.licence,
    };
    past.push(competitor);

    const picks = [allowed.find((d) => d.name === 'Kate') || allowed[0]];
    if (i % 3 === 0 && allowed.length > 1) picks.push(allowed[(i % (allowed.length - 1)) + 1]);

    picks.forEach((d) => entries.push({
      id: newId(), competitionId, competitorId: competitor.id, personId: person.id,
      name: competitor.name, firstName: competitor.firstName, lastName: competitor.lastName,
      sex: competitor.sex, year, group,
      club: competitor.club, city: competitor.city, coach: competitor.coach,
      belt: competitor.belt, level: competitor.level,
      discipline: d.name, weight: null,
    }));
  });

  const byCategory = new Map();
  entries.forEach((e) => {
    const key = categoryKey(e);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push(e);
  });

  const order = ['zlato', 'srebro', 'bronza'];
  const results = [];
  byCategory.forEach((group) => {
    group.forEach((entry, position) => {
      results.push({
        id: newId(),
        competitionId,
        personId: entry.personId,
        entryId: entry.id,
        discipline: entry.discipline,
        placement: order[position] || 'ucesce',
        recordedAt: PAST_COMPETITION.date + 'T18:00:00.000Z',
      });
    });
  });

  return { competition, competitors: past, entries, results };
}

const PAST_CLUBS = [
  { name: 'KK Niš', city: 'Niš', coach: 'Slobodan Tomić' },
  { name: 'KK Banatski cvet', city: 'Zrenjanin', coach: 'Nikola Vukelić' },
  { name: 'KK Vračar', city: 'Beograd', coach: 'Jelena Perić' },
  { name: 'KK Kragujevac', city: 'Kragujevac', coach: 'Boris Lukić' },
  { name: 'KK Vojvodina', city: 'Novi Sad', coach: 'Marko Savić' },
  { name: 'KK Zemun', city: 'Beograd', coach: 'Dejan Radić' },
];

/**
 * Databases from before people existed have no personId on competitors.
 * This finds or creates a person for each — runs once, then has nothing
 * to do.
 */
async function linkPeople() {
  const competitors = await all('competitors');
  const orphans = competitors.filter((c) => !c.personId);
  if (!orphans.length) return;

  const existing = await all('people');
  const byIdentity = new Map(existing.map((p) => [p.identity, p]));
  const created = [];
  const updated = [];

  orphans.forEach((c) => {
    const identity = identityOf(c);
    let person = byIdentity.get(identity);
    if (!person) {
      person = {
        id: newId(), identity, name: c.name, sex: c.sex, year: c.year,
        club: c.club || '', licence: c.licence,
      };
      byIdentity.set(identity, person);
      created.push(person);
    }
    updated.push({ ...c, personId: person.id });
  });

  const entries = await all('entries');
  const personByCompetitor = new Map(updated.map((c) => [c.id, c.personId]));

  await tx(['people', 'competitors', 'entries'], 'readwrite', (ppl, cmp, ent) => {
    created.forEach((r) => ppl.put(r));
    updated.forEach((r) => cmp.put(r));
    entries.forEach((e) => {
      const personId = personByCompetitor.get(e.competitorId);
      if (personId && !e.personId) ent.put({ ...e, personId });
    });
  });
}

let readyPromise = null;

// === Public API =============================================


// === Seasons =============================================

/*
 * A season is not hard-coded — the federation has no "starts September
 * 1st" rule, so the editor decides when it begins and ends and the app
 * just remembers. A season is a date range: the open one has a start and
 * no end. Closing writes the end, archives it and opens the next from
 * the following day. Rankings are computed over competitions in the
 * range — nothing is copied or frozen, so a correction in a closed
 * season still moves its list once reopened.
 *
 * meta['seasons']     closed seasons: { id, name, from, to, closedAt }
 * meta['seasonStart'] the date the open season runs from
 */

const metaGet = async (key, fallback = null) => {
  const row = await tx('meta', 'readonly', (os) => wrap(os.get(key)));
  return row ? row.value : fallback;
};
const metaSet = (key, value) => tx('meta', 'readwrite', (os) => os.put({ key, value }));

const ISO = (d) => d.toISOString().slice(0, 10);
const dayAfter = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return ISO(d);
};

/**
 * "2025/26" when the range crosses New Year, else "2026". Just a
 * suggestion — the editor changes it on closing.
 */
function seasonName(from, to) {
  const a = Number((from || '').slice(0, 4));
  const b = Number((to || from || '').slice(0, 4));
  if (!a) return 'Sezona';
  if (!b || a === b) return String(a);
  return `${a}/${String(b).slice(2)}`;
}

/** Does a date fall in the season. An open season has no upper bound. */
const inSeason = (date, season) =>
  !!date && date >= season.from && (!season.to || date <= season.to);

export const store = {
  /** Opens the database, seeds and migrates as needed. Call first. */
  ready() {
    if (!readyPromise) {
      readyPromise = migrateFromPreviousName()
        .then(openDb).then(seed).then(refreshDemo).then(linkPeople)
        .then(migrateIdentities).then(ensureFssIds);
    }
    return readyPromise;
  },

  /** Does the database carry an older demo the user already works in. */
  async demoIsStale() {
    const row = await tx('meta', 'readonly', (os) => wrap(os.get('demoStale')));
    return !!row;
  },

  /**
   * Protection from silent deletion. A browser low on disk space may
   * clear IndexedDB without asking — and the whole season is in it.
   * persist() asks for permanent storage; once granted it stays granted,
   * so the request repeats safely on every launch. Usage comes along so
   * Podešavanja has something to show.
   */
  async storageProtection() {
    if (!navigator.storage?.persist) return { supported: false };
    let persisted = await navigator.storage.persisted();
    if (!persisted) persisted = await navigator.storage.persist();
    let usage = 0;
    let quota = 0;
    if (navigator.storage.estimate) {
      ({ usage = 0, quota = 0 } = await navigator.storage.estimate());
    }
    return { supported: true, persisted, usage, quota };
  },

  // === Competitions =============================================

  async listCompetitions() {
    const rows = await all('competitions');
    // Most recent first; competitions without a date at the bottom.
    return rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },

  getCompetition(id) {
    if (!id) return Promise.resolve(null);
    return tx('competitions', 'readonly', (os) => wrap(os.get(id)));
  },

  async createCompetition(data) {
    const competition = {
      id: newId(),
      name: data.name.trim(),
      date: data.date,
      place: data.place.trim(),
      level: data.level,
      calendar: data.calendar === 'B' ? 'B' : 'A',
      description: (data.description || '').trim(),
      // From the calendar a competition arrives with basic data only;
      // an empty discipline pick means "everything in the rulebook".
      disciplines: data.disciplines?.length ? data.disciplines : DISCIPLINES.map((d) => d.name),
      status: 'Nacrt',
      createdAt: new Date().toISOString(),
    };
    await tx('competitions', 'readwrite', (os) => os.put(competition));

    // A pre-filled competition writes its entries immediately, in the
    // same shape the seeded one carries.
    if (data.withRegistry) {
      // Drugo seme od zasejanog, da to ne budu isti ljudi pod istim imenima.
      const { people, competitors, entries, teams } =
        registryRecords(competition.id, 11 + (await all('competitions')).length);
      await tx(['people', 'competitors', 'entries', 'teams'], 'readwrite',
        (ppl, cmp, ent, tms) => {
          people.forEach((r) => ppl.put(r));
          competitors.forEach((r) => cmp.put(r));
          entries.forEach((r) => ent.put(r));
          teams.forEach((r) => tms.put(r));
        });
      await ensureFssIds();
      competition.entries = entries.length;
      competition.competitors = competitors.length;
    }
    return competition;
  },

  /** Deletes a competition and everything with it — entries, results. */
  async deleteCompetition(id) {
    const [competitors, entries, teams, results] = await Promise.all([
      allBy('competitors', 'competitionId', id),
      allBy('entries', 'competitionId', id),
      allBy('teams', 'competitionId', id),
      allBy('results', 'competitionId', id),
    ]);
    await tx(['competitions', 'competitors', 'entries', 'teams', 'results'], 'readwrite',
      (comps, cmp, ent, tms, res) => {
        comps.delete(id);
        competitors.forEach((r) => cmp.delete(r.id));
        entries.forEach((r) => ent.delete(r.id));
        teams.forEach((r) => tms.delete(r.id));
        results.forEach((r) => res.delete(r.id));
      });
    if (await store.activeCompetitionId() === id) {
      const rest = await store.listCompetitions();
      await store.setActiveCompetition(rest.length ? rest[0].id : null);
    }
    // People who no longer appear anywhere have no business staying.
    await pruneOrphanPeople();
  },

  async activeCompetitionId() {
    const row = await tx('meta', 'readonly', (os) => wrap(os.get('activeCompetitionId')));
    return row ? row.value : null;
  },

  setActiveCompetition(id) {
    return tx('meta', 'readwrite', (os) => os.put({ key: 'activeCompetitionId', value: id }));
  },

  async activeCompetition() {
    return store.getCompetition(await store.activeCompetitionId());
  },

  // === Entries =============================================

  /**
   * One competition's entries in the shape screens and documents expect.
   * A new competition returns empty lists — correct state, not an error.
   */
  async registryFor(competitionId) {
    if (!competitionId) return { competitors: [], entries: [], teams: [] };
    const [competition, competitors, entries, teams, register] = await Promise.all([
      store.getCompetition(competitionId),
      allBy('competitors', 'competitionId', competitionId),
      allBy('entries', 'competitionId', competitionId),
      allBy('teams', 'competitionId', competitionId),
      all('people'),
    ]);
    // A team's display name is computed, never stored — the numeral
    // depends on how many teams the club has in the category, and that
    // changes with every new entry.
    labelTeams(teams);
    // The FSS ID shown is the person's ID for this competition's year —
    // read from the person, never copied onto the entry.
    const year = seasonOf(competition);
    const personById = new Map(register.map((p) => [p.id, p]));
    const byIdentity = identityIndex(register);
    competitors.forEach((c) => { c.fssId = fssIdOf(personById.get(c.personId), year); });
    teams.forEach((t) => {
      t.members = (t.members || []).map((m) => ({
        ...m, fssId: fssIdOf(byIdentity.get(identityOf({ ...m, club: t.club })), year),
      }));
    });
    const people = new Map(competitors.map((c) => [c.id, c]));
    return {
      competitors,
      teams,
      entries: entries.map((e) => ({ ...e, competitor: people.get(e.competitorId) || null })),
    };
  },

  /**
   * Imports one club's entry file — the only place somebody else's file
   * enters the database, so it is careful:
   *
   * A person is recognised, never recreated — an entry binds to an
   * existing person even from a past season, so points land on one
   * ranking row. Importing twice creates no duplicates: entries already
   * on the competition are skipped and counted separately, so a club may
   * send a corrected file.
   *
   * An FSS ID on a row names the person directly — this year's or an
   * older one, which is how a club writes it until the new one arrives —
   * but only when it agrees with the row's name and birth year. One that
   * belongs to somebody else stops the row (rejected, with its Excel row
   * number); one that is malformed or unknown is ignored and the row is
   * matched by name as before (notes). Everybody imported leaves with
   * their ID for the competition's year.
   *
   * @returns {{people:number, competitors:number, entries:number, skipped:number,
   *            teams:number, teamsSkipped:number, granted:number, recognized:number,
   *            transfers:Array, rejected:Array, notes:Array}}
   */
  async importClubEntry(competitionId, payload) {
    const competition = await store.getCompetition(competitionId);
    if (!competition) throw new Error('Takmičenje nije pronađeno.');
    // The guard lives here, not just on the button: closed entries mean
    // the list no longer changes — not even by import.
    if (!entriesOpen(competition)) {
      throw new Error(`Na takmičenju „${competition.name}" su prijave zatvorene`
        + ' — uvoz je zaustavljen.');
    }

    const club = payload.club;
    const city = payload.city || clubByName(club)?.city || '';
    const coach = payload.coach || clubByName(club)?.coach || '';
    const year = seasonOf(competition);

    const [people, mine, theirEntries, theirTeams, tops] = await Promise.all([
      all('people'),
      allBy('competitors', 'competitionId', competitionId),
      allBy('entries', 'competitionId', competitionId),
      allBy('teams', 'competitionId', competitionId),
      metaGet(FSS_TOP, {}),
    ]);

    /**
     * Which person is this. Identity is name + year + club (until
     * licences arrive), so the same name and year under another club is
     * a new person. Such cases are reported to the caller (transfers)
     * with both clubs, so the editor knows a namesake or a transfer was
     * found — never decided quietly. A former identity (alias) counts
     * after the current ones.
     */
    const byIdentity = new Map();
    const byAlias = new Map();
    const byLoose = new Map();
    const add = (map, k, p) => {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    };
    const index = (p) => {
      add(byIdentity, p.identity, p);
      (p.aliases || []).forEach((a) => add(byAlias, a, p));
      if (!p.licence) add(byLoose, looseIdentity(p), p);
    };
    people.forEach(index);
    const candidatesOf = (identity) =>
      [...(byIdentity.get(identity) || []), ...(byAlias.get(identity) || [])];

    const owners = new Map(people.flatMap((p) => (p.fssIds || []).map((id) => [id, p])));
    const dispense = fssDispenser(people, tops);

    const key = (personId, forClub) => `${personId}|${forClub}`;
    const hereByClub = new Map(mine.map((c) => [key(c.personId, c.club), c]));
    // Who is already entered here for another club, and for which.
    const busy = new Map(mine.filter((c) => c.club !== club).map((c) => [c.personId, c.club]));
    const hasEntry = new Set(theirEntries.map((e) => `${e.competitorId}|${e.discipline}`));

    const newPeople = [];
    const changedPeople = new Set();
    const newCompetitors = [];
    const newEntries = [];
    const transfers = [];
    const rejected = [];
    const notes = [];
    let skipped = 0;
    let granted = 0;
    let recognized = 0;

    const give = (person) => {
      if (!grantFssId(person, year, dispense)) return;
      granted += 1;
      if (!newPeople.includes(person)) changedPeople.add(person);
    };

    /**
     * The ID proved this row is `person`. When the row says it another way
     * — another club (a transfer) or another spelling — the person takes
     * the new club, and what they were called before stays as an alias,
     * so older teams and forms written the old way still find them.
     */
    const relink = (person, row, identity, id) => {
      const from = person.club || '';
      const moved = from.toLowerCase() !== club.toLowerCase();
      const current = moved ? identityOf({ ...person, club }) : person.identity;
      const takenByOther = (k) => (byIdentity.get(k) || []).some((p) => p.id !== person.id);
      if (moved && takenByOther(current)) {
        notes.push({
          row: row.row, name: row.name,
          message: `${person.name} (${person.year}) već postoji u bazi i pod klubom ${club}`
            + ` — moguće da je ista osoba upisana dvaput; prijava je vezana za ${id}`,
        });
        return;
      }
      const aliases = new Set(person.aliases || []);
      if (current !== person.identity) aliases.add(person.identity);
      if (identity !== current && !takenByOther(identity)) aliases.add(identity);
      aliases.delete(current);
      if (!moved && aliases.size === (person.aliases || []).length) return;

      const before = byIdentity.get(person.identity) || [];
      byIdentity.set(person.identity, before.filter((p) => p !== person));
      person.identity = current;
      person.aliases = [...aliases];
      if (moved) person.club = club;
      add(byIdentity, current, person);
      aliases.forEach((a) => add(byAlias, a, person));
      if (!newPeople.includes(person)) changedPeople.add(person);
      if (moved) {
        transfers.push({ name: person.name, year: person.year, from, to: club, id, recognized: true });
      }
    };

    (payload.competitors || []).forEach((c) => {
      const identity = identityOf({ ...c, club });
      const said = fssVerdict(c, year, (id) => owners.get(id) || null);
      let person = null;

      if (said.status === 'conflict') {
        rejected.push({
          row: c.row, name: c.name,
          message: `${said.id} pripada takmičaru ${said.person.name}`
            + ` (${said.person.year}, ${said.person.club || 'bez kluba'})`,
        });
        return;
      }
      if (said.status === 'match') {
        if (busy.has(said.person.id)) {
          rejected.push({
            row: c.row, name: c.name,
            message: `${said.id} — ${said.person.name} je na ovom takmičenju već prijavljen`
              + ` za ${busy.get(said.person.id)}`,
          });
          return;
        }
        person = said.person;
        recognized += 1;
        relink(person, c, identity, said.id);
      } else if (said.status === 'invalid' || said.status === 'unknown') {
        notes.push({
          row: c.row, name: c.name,
          message: said.status === 'invalid'
            ? `„${said.typed}" nije FSS ID — zanemaren, takmičar je tražen po imenu`
            : `${said.id} ne postoji u bazi — zanemaren, takmičar je tražen po imenu`,
        });
      }

      if (!person) person = candidatesOf(identity).find((p) => !busy.has(p.id)) || null;

      if (!person) {
        // The same person under another club — or a namesake. Without a
        // licence there is no telling, so a new person is created and
        // the case named.
        const elsewhere = (byLoose.get(looseIdentity(c)) || [])
          .filter((p) => String(p.club || '').toLowerCase() !== club.toLowerCase());
        if (elsewhere.length) {
          transfers.push({ name: c.name, year: c.year, from: elsewhere[0].club || '', to: club });
        }
        person = {
          id: newId(), identity, ...writtenName(c, c), sex: c.sex, year: c.year,
          club, licence: null,
        };
        index(person);
        newPeople.push(person);
      }
      give(person);
      const named = writtenName(c, person);

      // The age group is computed from the year here too, never taken
      // from the file — the rulebook is the only source.
      const group = groupOfYear(c.year, seasonOf(competition)) || c.group || '';

      let competitor = hereByClub.get(key(person.id, club));
      if (!competitor) {
        competitor = {
          id: newId(), competitionId, personId: person.id,
          ...named, sex: c.sex, year: c.year, group,
          club, city, coach, belt: c.belt, level: c.level,
          // Weight belongs to the competitor; the club enters it with a
          // weight-drawn discipline — the first such is taken.
          weight: (c.disciplines || []).map((d) => d.weight).find(Boolean) || null,
        };
        hereByClub.set(key(person.id, club), competitor);
        newCompetitors.push(competitor);
      }

      (c.disciplines || []).forEach((d) => {
        const key = `${competitor.id}|${d.name}`;
        if (hasEntry.has(key)) { skipped += 1; return; }
        hasEntry.add(key);
        newEntries.push({
          id: newId(), competitionId, competitorId: competitor.id, personId: person.id,
          discipline: d.name, weight: d.weight || null,
          // A flat row, like the seeded entries — lists and documents
          // read from here with no joins.
          ...named, sex: c.sex, year: c.year, group,
          club, city, coach, belt: c.belt, level: c.level,
        });
      });
    });

    // A team member is a person in the database too — otherwise a team
    // placement would have nobody to credit. Recognised by the same
    // identity as individual entries; a namesake from another club is
    // named here as well, never resolved quietly.
    const membersOf = new Map();
    (payload.teams || []).forEach((t) => {
      membersOf.set(t, (t.members || []).map((m) => {
        const identity = identityOf({ ...m, club });
        let person = candidatesOf(identity)[0] || null;
        if (!person) {
          const elsewhere = (byLoose.get(looseIdentity(m)) || [])
            .filter((p) => String(p.club || '').toLowerCase() !== club.toLowerCase());
          if (elsewhere.length) {
            transfers.push({ name: m.name, year: m.year, from: elsewhere[0].club || '', to: club });
          }
          person = {
            id: newId(), identity, ...writtenName(m, m), sex: m.sex, year: m.year,
            club, licence: null,
          };
          index(person);
          newPeople.push(person);
        }
        give(person);
        // The team keeps the member as the database knows them.
        return { ...m, ...writtenName(m, person) };
      }));
    });

    // The same team is the same discipline, group, variant, club and
    // members. A club may enter two teams in one category, so the
    // members are what tells them apart.
    const teamKey = (t) => [t.discipline, t.group, t.variant, t.club,
      (t.members || []).map((m) => nameWords(m.name)).sort().join('|')].join('§');
    const haveTeams = new Set(theirTeams.map(teamKey));
    const newTeams = [];
    let teamsSkipped = 0;

    (payload.teams || []).forEach((t) => {
      const record = {
        ...t, members: membersOf.get(t), id: newId(), competitionId, club, city, coach,
      };
      if (haveTeams.has(teamKey(record))) { teamsSkipped += 1; return; }
      haveTeams.add(teamKey(record));
      newTeams.push(record);
    });

    await tx(['people', 'competitors', 'entries', 'teams', 'meta'], 'readwrite',
      (ppl, cmp, ent, tms, meta) => {
        changedPeople.forEach((r) => ppl.put(r));
        newPeople.forEach((r) => ppl.put(r));
        newCompetitors.forEach((r) => cmp.put(r));
        newEntries.forEach((r) => ent.put(r));
        newTeams.forEach((r) => tms.put(r));
        if (granted) meta.put({ key: FSS_TOP, value: tops });
      });

    return {
      transfers,
      rejected,
      notes,
      granted,
      recognized,
      people: newPeople.length,
      competitors: newCompetitors.length,
      entries: newEntries.length,
      skipped,
      teams: newTeams.length,
      teamsSkipped,
    };
  },

  /**
   * Who holds which FSS ID — the import screen checks a form's IDs
   * against it before anything is written. Map ID → person.
   */
  async fssOwners() {
    const people = await all('people');
    return new Map(people.flatMap((p) => (p.fssIds || []).map((id) => [id, p])));
  },

  /**
   * The list the club entry form carries, so a coach types an ID and the
   * row fills itself: every FSS ID from last year on — a club writes last
   * year's until it has the new one — with first name, surname, year, sex
   * and the belt of the most recent appearance. The club decides whether a
   * row fills at all (see build-entry-form.py), and the clubs are listed
   * for the header's menu as well.
   *
   * @returns {Promise<{rows: Array<{id, firstName, lastName, year, sex, belt, club}>,
   *                    clubs: string[]}>}
   */
  async entryFormRoster() {
    const [people, competitors, competitions] = await Promise.all([
      all('people'), all('competitors'), all('competitions'),
    ]);
    const dateOf = new Map(competitions.map((c) => [c.id, c.date || '']));
    const lastBelt = new Map();
    competitors.forEach((c) => {
      const date = dateOf.get(c.competitionId) || '';
      const seen = lastBelt.get(c.personId);
      if (c.belt && (!seen || date >= seen.date)) lastBelt.set(c.personId, { date, belt: c.belt });
    });

    const since = SEASON() - 1;
    const sexLabel = { M: 'muški', Ž: 'ženski' };
    const rows = people.flatMap((p) => (p.fssIds || [])
      .filter((id) => (parseFssId(id)?.year || 0) >= since)
      .map((id) => {
        const { first, last } = nameParts(p);
        return {
          id, firstName: first, lastName: last, year: p.year, sex: sexLabel[p.sex] || '',
          belt: lastBelt.get(p.id)?.belt || '', club: p.club || '',
        };
      }));
    rows.sort((a, b) => a.club.localeCompare(b.club, 'sr')
      || a.lastName.localeCompare(b.lastName, 'sr')
      || a.firstName.localeCompare(b.firstName, 'sr') || a.id.localeCompare(b.id));

    const clubs = [...new Set([...CLUBS.map((c) => c.name), ...people.map((p) => p.club)])]
      .filter(Boolean).sort((a, b) => a.localeCompare(b, 'sr'));
    return { rows, clubs };
  },

  // === Entry corrections =============================================

  /**
   * What may be written on an entry, and what follows from it. A
   * correction never rewrites just the field — it re-derives everything
   * downstream: group from year, level from belt, allowed disciplines
   * from group, weight from group and sex. The same path the import
   * takes, so an entry means the same thing however it arrived. Throws
   * a readable sentence the dialog shows, like an import rejection.
   */
  async validateEntry(competition, patch) {
    const season = seasonOf(competition);
    // First name and surname arrive apart; a caller with the whole name
    // has it split at the last space. Each is normalised before any check
    // and before identity, so "MARKO MARKOVIĆ" and "Marko Marković" are
    // stored the same, not just recognised as the same person.
    const parts = patch.firstName !== undefined || patch.lastName !== undefined
      ? { first: patch.firstName, last: patch.lastName } : nameParts({ name: patch.name });
    const firstName = properName(parts.first);
    const lastName = properName(parts.last);
    const name = `${firstName} ${lastName}`.trim();
    const year = Number(patch.year) || 0;
    const group = groupOfYear(year, season);
    const sex = patch.sex === 'M' || patch.sex === 'Ž' ? patch.sex : '';
    const belt = BELTS.indexOf(patch.belt) >= 0 ? patch.belt : '';

    if (!firstName) throw new Error('Nije uneto ime.');
    if (!lastName) throw new Error('Nije uneto prezime.');
    const letters = /^[\p{L}\s'-]+$/u;
    if (!letters.test(firstName)) throw new Error(`Ime „${firstName}" sadrži znakove koji nisu slova.`);
    if (!letters.test(lastName)) throw new Error(`Prezime „${lastName}" sadrži znakove koji nisu slova.`);
    if (!year) throw new Error('Nije izabrano godište.');
    if (!group) throw new Error(`Godište ${year} nije obuhvaćeno uzrasnom tabelom.`);
    if (!sex) throw new Error('Nije izabran pol.');
    if (!belt) throw new Error('Nije izabran pojas.');

    const names = [...new Set((patch.disciplines || []).filter(Boolean))];
    if (!names.length) throw new Error('Nije izabrana nijedna disciplina.');

    const disciplines = names.map((discipline) => {
      const d = DISCIPLINES.find((x) => x.name === discipline);
      if (!d) throw new Error(`Disciplina „${discipline}" ne postoji u pravilniku.`);
      if (d.team) throw new Error(`„${d.name}" je ekipna disciplina i ne unosi se ovde.`);
      if (d.groups.indexOf(group) < 0) {
        throw new Error(`„${d.name}" nije moguća za uzrast ${group}.`);
      }
      return d;
    });

    const allowed = WEIGHTS[group]?.[sex] || [];
    const weighed = disciplines.find((d) => d.drawBy === 'weight');
    const weight = allowed.indexOf(patch.weight) >= 0 ? patch.weight : '';
    if (weighed && !weight) {
      throw new Error(`Nije izabrana telesna težina, koju ${weighed.name} zahteva`
        + ` (${allowed.join(', ')}).`);
    }

    const club = clubByName(patch.club);
    return {
      name, firstName, lastName, sex, year, group, belt,
      level: levelOfBelt(belt),
      weight: weight || null,
      club: patch.club || '',
      city: club?.city || patch.city || '',
      coach: club?.coach || patch.coach || '',
      disciplines: disciplines.map((d) => ({
        name: d.name, weight: d.drawBy === 'weight' ? weight : null,
      })),
    };
  },

  /**
   * Writes one new entry from the app — for competition day, when a club
   * brings a competitor who is not on the list. Goes the same path as
   * the import (validateEntry, same person matching), so an entry made
   * here means nothing different. Somebody already entered is refused:
   * that is a correction, not a second entry.
   */
  async addCompetitor(competitionId, patch) {
    const competition = await store.getCompetition(competitionId);
    if (!competition) throw new Error('Takmičenje ne postoji.');
    if (!entriesOpen(competition)) {
      throw new Error('Prijave su zatvorene — nove prijave se ne upisuju.');
    }

    const clean = await store.validateEntry(competition, patch);
    if (!clean.club) throw new Error('Nije izabran klub.');

    const [people, mine, tops] = await Promise.all([
      all('people'),
      allBy('competitors', 'competitionId', competitionId),
      metaGet(FSS_TOP, {}),
    ]);

    // Same rule as the import: a taken person means either the same
    // entry (an error) or a namesake from another club (a new person).
    // Current identities first, then former ones.
    const identity = identityOf(clean);
    const candidates = people.filter((p) => p.identity === identity)
      .concat(people.filter((p) => p.identity !== identity && (p.aliases || []).includes(identity)));
    const busy = new Set(mine.map((c) => c.personId));
    const already = mine.find((c) => candidates.some((p) => p.id === c.personId));
    if (already) {
      // Named as entered there — with first name and surname swapped it
      // must still be clear who it is.
      throw new Error(`${already.name} (${clean.year}) je već prijavljen`
        + ` za ${already.club} — ispravi postojeću prijavu.`);
    }

    let person = candidates.find((p) => !busy.has(p.id)) || null;
    // Same name and year under another club: namesake or transfer —
    // a new person either way, because identity carries the club.
    const elsewhere = !person && people.some((p) => !p.licence
      && looseIdentity(p) === looseIdentity(clean)
      && String(p.club || '').toLowerCase() !== clean.club.toLowerCase());
    const isNew = !person;
    if (isNew) {
      person = {
        id: newId(), identity, ...writtenName(clean, clean), sex: clean.sex, year: clean.year,
        club: clean.club, licence: null,
      };
    }
    const named = writtenName(clean, person);

    const competitor = {
      id: newId(), competitionId, personId: person.id,
      ...named, sex: clean.sex, year: clean.year, group: clean.group,
      club: clean.club, city: clean.city, coach: clean.coach,
      belt: clean.belt, level: clean.level, weight: clean.weight,
    };
    const year = seasonOf(competition);
    const granted = grantFssId(person, year, fssDispenser(people, tops));

    await tx(['people', 'competitors', 'entries', 'meta'], 'readwrite', (ppl, cmp, ent, meta) => {
      if (isNew || granted) ppl.put(person);
      if (granted) meta.put({ key: FSS_TOP, value: tops });
      cmp.put(competitor);
      clean.disciplines.forEach((d) => ent.put({
        id: newId(), competitionId, competitorId: competitor.id, personId: person.id,
        discipline: d.name, weight: d.weight,
        // A flat row, like the import — lists and documents read from here.
        ...named, sex: clean.sex, year: clean.year, group: clean.group,
        club: clean.club, city: clean.city, coach: clean.coach,
        belt: clean.belt, level: clean.level,
      }));
    });

    return {
      competitorId: competitor.id,
      group: clean.group,
      entries: clean.disciplines.length,
      // A person who competed before is recognised, not created again.
      known: !isNew,
      // The same name and year exists under another club.
      elsewhere,
      fssId: fssIdOf(person, year),
    };
  },

  /**
   * Corrects one entry and everything derived from it: the person, the
   * competitor record, every entry row and their details inside teams —
   * entries are deliberately flat rows, so a correction must visit all.
   *
   * Year and name define the person: if the correction turns somebody
   * into a person the database already knows — the point of fixing a
   * mistyped year — the entry is re-linked to that person, placements
   * included, so points land on the right ranking row.
   *
   * @returns {{group:string, added:number, removed:number, teams:number, merged:boolean,
   *            fssId:string|null}}
   */
  async editCompetitor(competitionId, competitorId, patch) {
    const competition = await store.getCompetition(competitionId);
    if (!competition) throw new Error('Takmičenje ne postoji.');
    if (!entriesOpen(competition)) {
      throw new Error('Prijave su zatvorene — podaci se više ne menjaju.');
    }

    const competitor = await tx('competitors', 'readonly', (os) => wrap(os.get(competitorId)));
    if (!competitor) throw new Error('Prijava ne postoji.');

    const clean = await store.validateEntry(competition, patch);

    const [people, mine, elsewhere, theirEntries, theirResults, teams, competitions, tops] =
      await Promise.all([
        all('people'),
        allBy('competitors', 'competitionId', competitionId),
        allBy('competitors', 'personId', competitor.personId),
        allBy('entries', 'competitorId', competitorId),
        allBy('results', 'competitionId', competitionId),
        allBy('teams', 'competitionId', competitionId),
        all('competitions'),
        metaGet(FSS_TOP, {}),
      ]);

    const person = people.find((p) => p.id === competitor.personId) || null;
    // The club is part of identity, so correcting it changes identity —
    // but the same person record, so history follows the person. That is
    // the difference between a correction (the editor knows it is the
    // same person) and an import (it cannot know).
    const identity = identityOf({ ...clean, licence: person?.licence || null });
    const twin = people.find((p) => p.id !== competitor.personId
      && (p.identity === identity || (p.aliases || []).includes(identity)));
    if (twin && mine.some((c) => c.personId === twin.id && c.id !== competitorId)) {
      throw new Error(`${clean.name} (${clean.year}) je već prijavljen na ovo takmičenje.`);
    }
    const personId = twin ? twin.id : competitor.personId;

    // Two records of one person merge into one FSS ID for the year: the
    // twin's own, else the one this entry was given, else a new number.
    // The old record lets go of its ID unless it still competes that year.
    const year = seasonOf(competition);
    const yearOf = new Map(competitions.map((c) => [c.id, seasonOf(c)]));
    const others = elsewhere.filter((c) => c.id !== competitorId);
    const stays = !!person && others.length > 0;
    let survivor = null;
    let leaving = null;
    let granted = false;
    if (twin) {
      const own = fssIdOf(person, year);
      const handOver = own && !others.some((c) => yearOf.get(c.competitionId) === year) ? own : null;
      if (handOver && stays) leaving = { ...person, fssIds: person.fssIds.filter((id) => id !== handOver) };
      if (!fssIdOf(twin, year)) {
        survivor = { ...twin };
        if (handOver) survivor.fssIds = [...(twin.fssIds || []), handOver];
        else granted = grantFssId(survivor, year, fssDispenser(people, tops));
        if (!handOver && !granted) survivor = null;
      }
    }

    // Entries: what stays, what goes, what is added.
    const wanted = new Map(clean.disciplines.map((d) => [d.name, d]));
    const removed = theirEntries.filter((e) => !wanted.has(e.discipline));
    const kept = theirEntries.filter((e) => wanted.has(e.discipline));
    const have = new Set(kept.map((e) => e.discipline));
    const added = clean.disciplines.filter((d) => !have.has(d.name));

    const flat = {
      name: clean.name, firstName: clean.firstName, lastName: clean.lastName,
      sex: clean.sex, year: clean.year, group: clean.group,
      club: clean.club, city: clean.city, coach: clean.coach,
      belt: clean.belt, level: clean.level,
    };
    const goneIds = new Set(removed.map((e) => e.id));
    const keptIds = new Set(kept.map((e) => e.id));
    // A placement on an entry that no longer exists refers to nothing.
    const goneResults = theirResults.filter((r) => goneIds.has(r.entryId));
    // An entry moved onto another person takes its placements along.
    const movedResults = personId === competitor.personId
      ? [] : theirResults.filter((r) => keptIds.has(r.entryId));

    // Teams carry their members inside, so a correction must visit them.
    const isThem = (m) => nameWords(m.name) === nameWords(competitor.name) && m.year === competitor.year;
    const touchedTeams = teams.filter((t) => (t.members || []).some(isThem));
    touchedTeams.forEach((team) => {
      team.members = team.members.map((m) => (isThem(m)
        ? {
          ...m, name: clean.name, firstName: clean.firstName, lastName: clean.lastName,
          year: clean.year, belt: clean.belt, sex: clean.sex,
        }
        : m));
    });

    await tx(['people', 'competitors', 'entries', 'results', 'teams', 'meta'], 'readwrite',
      (ppl, cmp, ent, res, tms, meta) => {
        if (twin) {
          // A person left with no entries anywhere has no reason to
          // stay in the database.
          if (person && !stays) ppl.delete(person.id);
          else if (leaving) ppl.put(leaving);
          // Only after the old record let go of its ID — no ID is ever
          // held by two people, not even inside one transaction.
          if (survivor) ppl.put(survivor);
          if (granted) meta.put({ key: FSS_TOP, value: tops });
        } else if (person) {
          ppl.put({
            ...person, identity, name: clean.name, firstName: clean.firstName,
            lastName: clean.lastName, sex: clean.sex, year: clean.year, club: clean.club,
            ...(person.aliases ? { aliases: person.aliases.filter((a) => a !== identity) } : {}),
          });
        }

        cmp.put({ ...competitor, ...flat, personId, weight: clean.weight });
        removed.forEach((e) => ent.delete(e.id));
        goneResults.forEach((r) => res.delete(r.id));
        kept.forEach((e) => ent.put({
          ...e, ...flat, personId, weight: wanted.get(e.discipline).weight,
        }));
        added.forEach((d) => ent.put({
          id: newId(), competitionId, competitorId, personId,
          discipline: d.name, weight: d.weight, ...flat,
        }));
        movedResults.forEach((r) => res.put({ ...r, personId }));
        touchedTeams.forEach((t) => tms.put(t));
      });

    return {
      group: clean.group,
      added: added.length,
      removed: removed.length,
      teams: touchedTeams.length,
      merged: !!twin,
      fssId: fssIdOf(survivor || twin || person, year),
    };
  },

  /**
   * Removes one competitor from a competition — their disciplines and
   * everything written on them. A team they were in goes with them: a
   * team missing a member would draw and print wrong with nobody seeing
   * why. Better it disappears visibly, with a message saying how many.
   * The person stays if they competed elsewhere — their history is not
   * this competition's property.
   */
  async removeCompetitor(competitionId, competitorId) {
    const competition = await store.getCompetition(competitionId);
    if (!entriesOpen(competition)) {
      throw new Error('Prijave su zatvorene — podaci se više ne menjaju.');
    }
    const competitor = await tx('competitors', 'readonly', (os) => wrap(os.get(competitorId)));
    if (!competitor) throw new Error('Prijava ne postoji.');

    const [theirEntries, theirResults, teams, everywhere] = await Promise.all([
      allBy('entries', 'competitorId', competitorId),
      allBy('results', 'competitionId', competitionId),
      allBy('teams', 'competitionId', competitionId),
      allBy('competitors', 'personId', competitor.personId),
    ]);

    const ids = new Set(theirEntries.map((e) => e.id));
    const goneResults = theirResults.filter((r) => ids.has(r.entryId));
    const goneTeams = teams.filter((t) =>
      (t.members || []).some((m) => nameWords(m.name) === nameWords(competitor.name)
        && m.year === competitor.year));
    const lonely = everywhere.length <= 1;

    await tx(['people', 'competitors', 'entries', 'results', 'teams'], 'readwrite',
      (ppl, cmp, ent, res, tms) => {
        theirEntries.forEach((e) => ent.delete(e.id));
        goneResults.forEach((r) => res.delete(r.id));
        goneTeams.forEach((t) => tms.delete(t.id));
        cmp.delete(competitorId);
        if (lonely && competitor.personId) ppl.delete(competitor.personId);
      });

    return { entries: theirEntries.length, teams: goneTeams.length };
  },

  // === Placements and points =============================================

  /**
   * Writes a placement on one entry. `placement` is a PLACEMENTS key; an
   * empty value deletes the record — no placement, no points.
   */
  async setResult(entry, placement) {
    const existing = (await allBy('results', 'entryId', entry.id))[0] || null;
    if (!placement) {
      if (existing) await tx('results', 'readwrite', (os) => os.delete(existing.id));
      return null;
    }
    if (!placementByKey(placement)) throw new Error(`Nepoznat plasman: ${placement}`);
    const result = {
      id: existing?.id || newId(),
      competitionId: entry.competitionId,
      personId: entry.personId,
      entryId: entry.id,
      discipline: entry.discipline,
      placement,
      recordedAt: new Date().toISOString(),
    };
    await tx('results', 'readwrite', (os) => os.put(result));
    return result;
  },

  /**
   * One team's placement. The result row carries kind: 'team' and the
   * team instead of a person — members are not credited here but by the
   * tallies, like everything else: each member full points on their own
   * record, the club one medal per team, not per member.
   */
  async setTeamResult(team, placement) {
    const existing = (await allBy('results', 'entryId', team.id))[0] || null;
    if (!placement) {
      if (existing) await tx('results', 'readwrite', (os) => os.delete(existing.id));
      return null;
    }
    if (!placementByKey(placement)) throw new Error(`Nepoznat plasman: ${placement}`);
    const result = {
      id: existing?.id || newId(),
      competitionId: team.competitionId,
      // entryId carries the team id to reuse the existing index.
      entryId: team.id,
      teamId: team.id,
      personId: null,
      kind: 'team',
      discipline: team.discipline,
      placement,
      recordedAt: new Date().toISOString(),
    };
    await tx('results', 'readwrite', (os) => os.put(result));
    return result;
  },

  /**
   * Writes the same placement on every entry that has none yet — most
   * competitors get participation, only medallists change. Entries that
   * already have a placement are untouched; one transaction, because two
   * thousand separate writes would take a while.
   *
   * @returns {number} how many entries received the placement
   */
  async fillPlacement(competitionId, entryIds, placement) {
    if (!placementByKey(placement)) throw new Error(`Nepoznat plasman: ${placement}`);
    const [entries, teams, results] = await Promise.all([
      allBy('entries', 'competitionId', competitionId),
      allBy('teams', 'competitionId', competitionId),
      allBy('results', 'competitionId', competitionId),
    ]);
    const taken = new Set(results.map((r) => r.entryId));
    // The screen's id list mixes entries and teams — sorted out here.
    const wanted = new Set(entryIds);
    const missing = entries.filter((e) => wanted.has(e.id) && !taken.has(e.id));
    const missingTeams = teams.filter((t) => wanted.has(t.id) && !taken.has(t.id));
    if (!missing.length && !missingTeams.length) return 0;

    const recordedAt = new Date().toISOString();
    await tx('results', 'readwrite', (os) => {
      missing.forEach((entry) => os.put({
        id: newId(),
        competitionId: entry.competitionId,
        personId: entry.personId,
        entryId: entry.id,
        discipline: entry.discipline,
        placement,
        recordedAt,
      }));
      missingTeams.forEach((team) => os.put({
        id: newId(),
        competitionId: team.competitionId,
        entryId: team.id,
        teamId: team.id,
        personId: null,
        kind: 'team',
        discipline: team.discipline,
        placement,
        recordedAt,
      }));
    });
    return missing.length + missingTeams.length;
  },

  resultsFor(competitionId) {
    return competitionId ? allBy('results', 'competitionId', competitionId) : Promise.resolve([]);
  },

  /**
   * Per-person tally: medals and points at one competition, and totals
   * across seasons. Points are always computed from placements, never
   * stored.
   *
   * @returns {Map<string, {here: Tally, total: Tally, competitions: number}>}
   *   keyed by personId; Tally is { zlato, srebro, bronza, ucesce, medalje, bodovi }
   */
  async tallyByPerson(competitionId) {
    const [results, competitions, teams, register] = await Promise.all([
      all('results'), all('competitions'), all('teams'), all('people'),
    ]);
    // Only closed A-list competitions carry points. A medal counts
    // immediately, whatever the list and whether the competition is done.
    const scoring = new Set(competitions.filter(pointsCounted).map((c) => c.id));
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const personByIdentity = identityIndex(register);

    const blank = () => ({ zlato: 0, srebro: 0, bronza: 0, ucesce: 0, medalje: 0, bodovi: 0 });
    const add = (tally, placement, scores) => {
      tally[placement] = (tally[placement] || 0) + 1;
      if (placementByKey(placement)?.medal) tally.medalje += 1;
      if (scores) tally.bodovi += pointsFor(placement);
    };

    const map = new Map();
    const rowOf = (personId) => {
      if (!map.has(personId)) {
        map.set(personId, { here: blank(), total: blank(), competitions: new Set() });
      }
      return map.get(personId);
    };
    const score = (personId, r) => {
      const row = rowOf(personId);
      const scores = scoring.has(r.competitionId);
      add(row.total, r.placement, scores);
      row.competitions.add(r.competitionId);
      if (r.competitionId === competitionId) add(row.here, r.placement, scores);
    };

    results.forEach((r) => {
      // A team placement: every member gets full points and the medal.
      const team = teamOf(r, teamById);
      if (team) {
        teamMembersOf(team, personByIdentity).forEach((p) => score(p.id, r));
        return;
      }
      if (!r.personId) return;
      score(r.personId, r);
    });

    map.forEach((row) => { row.competitions = row.competitions.size; });
    return map;
  },

  /**
   * One person's appearances across all seasons — one row per
   * competition, with entries and placements. The competitor's record
   * card.
   */
  async careerFor(personId) {
    if (!personId) return [];
    const [competitors, results] = await Promise.all([
      allBy('competitors', 'personId', personId),
      allBy('results', 'personId', personId),
    ]);
    const byEntry = new Map(results.map((r) => [r.entryId, r]));

    const rows = [];
    for (const competitor of competitors) {
      // Sequential on purpose: a person has a handful of appearances,
      // and the database works from memory anyway.
      const competition = await store.getCompetition(competitor.competitionId);
      if (!competition) continue;
      const entries = await allBy('entries', 'competitorId', competitor.id);
      rows.push({
        competition,
        competitor,
        entries: entries.map((e) => ({ ...e, placement: byEntry.get(e.id)?.placement || null })),
      });
    }
    return rows.sort((a, b) => (b.competition.date || '').localeCompare(a.competition.date || ''));
  },

  /** Changes the competition state (draft → entries → finished, and back). */
  async setCompetitionStatus(id, status) {
    const competition = await store.getCompetition(id);
    if (!competition) return null;
    const updated = { ...competition, status, statusChangedAt: new Date().toISOString() };
    await tx('competitions', 'readwrite', (os) => os.put(updated));
    return updated;
  },

  /**
   * Deletes everything and reseeds the demo. Needed when the rulebook
   * changes — groups and disciplines are baked into stored entries. This
   * deletes real competitions too, hence the confirmation.
   */
  async resetDemo() {
    await tx([...DATA_STORES, 'meta'], 'readwrite',
      (...stores) => stores.forEach((os) => os.clear()));
    readyPromise = null;
    await store.ready();
  },

  /**
   * Per-club totals across all seasons: medals, points, people and
   * entries. A medal belongs to the club the competitor represented that
   * day — the competitor record carries it, so a transfer moves nothing.
   * A team medal counts once for the club, however many members won it.
   *
   * @returns {{clubs: Array, totals: Object}} clubs sorted by points
   */
  async clubTally() {
    const [competitors, entries, results, competitions, teams, register] = await Promise.all([
      all('competitors'), all('entries'), all('results'), all('competitions'),
      all('teams'), all('people'),
    ]);
    const scoring = new Set(competitions.filter(pointsCounted).map((c) => c.id));

    const competitorById = new Map(competitors.map((c) => [c.id, c]));
    const entryById = new Map(entries.map((e) => [e.id, e]));
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const personByIdentity = identityIndex(register);

    const blank = (name) => ({
      name,
      city: '',
      zlato: 0, srebro: 0, bronza: 0, ucesce: 0,
      medalje: 0, bodovi: 0,
      people: new Set(), competitions: new Set(), entries: 0,
    });
    const clubs = new Map();
    const clubOf = (name) => {
      if (!clubs.has(name)) clubs.set(name, blank(name));
      return clubs.get(name);
    };

    // Clubs and their people first — so a club with no medals yet still
    // shows on the list.
    competitors.forEach((c) => {
      if (!c.club) return;
      const club = clubOf(c.club);
      if (c.city) club.city = c.city;
      if (c.personId) club.people.add(c.personId);
      club.competitions.add(c.competitionId);
    });
    entries.forEach((e) => { if (e.club) clubOf(e.club).entries += 1; });

    // A team belongs to its club too: members count as people, the team
    // as an entry — a club competing only in teams must not look absent.
    teams.forEach((t) => {
      if (!t.club) return;
      const club = clubOf(t.club);
      if (t.city) club.city = t.city;
      club.competitions.add(t.competitionId);
      club.entries += 1;
      teamMembersOf(t, personByIdentity).forEach((p) => club.people.add(p.id));
    });

    results.forEach((r) => {
      // A team medal counts once for the club — one placement, however
      // many members. Per-member points live on the personal record.
      const team = teamOf(r, teamById);
      const name = team ? team.club : (() => {
        const entry = entryById.get(r.entryId);
        const competitor = entry && competitorById.get(entry.competitorId);
        return competitor?.club || entry?.club;
      })();
      if (!name) return;
      const club = clubOf(name);
      club[r.placement] = (club[r.placement] || 0) + 1;
      if (placementByKey(r.placement)?.medal) club.medalje += 1;
      if (scoring.has(r.competitionId)) club.bodovi += pointsFor(r.placement);
    });

    // personIds stays with the club, not just a count: a filtered list
    // must count unique people, and that is not the sum of a column —
    // the same person appears for one club at several competitions, and
    // after a transfer for two different clubs.
    const list = [...clubs.values()]
      .map((c) => ({
        ...c,
        people: c.people.size,
        personIds: [...c.people],
        competitions: c.competitions.size,
      }))
      .sort((a, b) => b.bodovi - a.bodovi
        || b.medalje - a.medalje
        || a.name.localeCompare(b.name, 'sr'));

    // The total is not the sum of the column: whoever competed for two
    // clubs counts in both, so the sum would overshoot.
    const everyone = new Set(competitors.map((c) => c.personId).filter(Boolean));
    teams.forEach((t) => teamMembersOf(t, personByIdentity)
      .forEach((p) => everyone.add(p.id)));
    const totals = ['zlato', 'srebro', 'bronza', 'ucesce', 'medalje', 'bodovi']
      .reduce((acc, key) => ({ ...acc, [key]: list.reduce((sum, c) => sum + c[key], 0) }),
        { people: everyone.size, clubs: list.length });

    return { clubs: list, totals };
  },

  listPeople() { return all('people'); },

  // === Mat schedule =============================================

  /**
   * The mat plan for one competition. Only the editor's decision is
   * stored — mat count and, per block, which mat, order and disciplines.
   * The blocks themselves are derived from entries on every open, so an
   * entry arriving after the plan was made does not stay invisible.
   */
  async tatamiPlan(competitionId) {
    const prazan = { count: 2, axis: 'uzrast', pairs: {}, order: {} };
    if (!competitionId) return prazan;
    const row = await metaGet(`tatami:${competitionId}`, null);
    return { ...prazan, ...(row || {}) };
  },

  saveTatamiPlan(competitionId, plan) {
    return metaSet(`tatami:${competitionId}`, {
      count: plan.count,
      axis: plan.axis,
      pairs: plan.pairs,
      order: plan.order,
      // The older-format record stays until translated, so nothing is
      // lost if an older app version opens the plan.
      blocks: plan.blocks,
      migrated: plan.migrated,
      savedAt: new Date().toISOString(),
    });
  },

  // === Diploma setup =============================================

  /**
   * Where each diploma line is written. A property of the blank diploma,
   * not the competition: one print run lasts years, so it is measured
   * once. Stored whole, with defaults under anything missing, so an
   * older setup does not lose a line added since.
   */
  async diplomaSetup() {
    const row = await metaGet('diploma', null);
    const lines = { ...DIPLOMA_DEFAULT.lines };
    Object.entries(row?.lines || {}).forEach(([key, line]) => {
      if (lines[key]) lines[key] = { ...lines[key], ...line };
    });
    return { ...DIPLOMA_DEFAULT, ...(row || {}), lines };
  },

  saveDiplomaSetup(setup) {
    return metaSet('diploma', {
      orientation: setup.orientation,
      lines: setup.lines,
      savedAt: new Date().toISOString(),
    });
  },

  // === Fees =============================================

  /**
   * Fee amounts and the free-discipline rule. Like the diploma measures,
   * a property of the federation, not the competition.
   */
  async fees() {
    const row = await metaGet('fees', null);
    return {
      ...FEES_DEFAULT,
      ...(row || {}),
      free: { ...FEES_DEFAULT.free, ...(row?.free || {}) },
    };
  },

  saveFees(fees) {
    return metaSet('fees', {
      individual: Number(fees.individual) || 0,
      team: Number(fees.team) || 0,
      enbu: Number(fees.enbu) || 0,
      coachRefund: Number(fees.coachRefund) || 0,
      free: {
        count: Number(fees.free.count) || 0,
        groups: fees.free.groups || '',
        always: fees.free.always || [],
      },
      savedAt: new Date().toISOString(),
    });
  },

  // === Seasons and rankings =============================================

  /**
   * All seasons — the open one first, then closed ones, most recent
   * first. The open season starts where the previous ended; with none
   * closed, it starts at the oldest competition in the database.
   */
  async listSeasons() {
    const [closed, start, competitions] = await Promise.all([
      metaGet('seasons', []), metaGet('seasonStart', null), all('competitions'),
    ]);
    const dates = competitions.map((c) => c.date).filter(Boolean).sort();
    const from = start
      || (closed.length ? dayAfter(closed[closed.length - 1].to) : null)
      || dates[0]
      || ISO(new Date());

    const open = {
      id: 'open', from, to: null, open: true,
      name: seasonName(from, dates[dates.length - 1] || from),
    };
    return [open, ...[...closed].reverse().map((x) => ({ ...x, open: false }))];
  },

  async currentSeason() {
    return (await store.listSeasons())[0];
  },

  seasonById(id) {
    return store.listSeasons().then((list) => list.find((x) => x.id === id) || list[0]);
  },

  /**
   * Closes the season and opens the next from the following day. Name
   * and dates come from outside — the editor confirms or changes them.
   * Reversible like every state change: reopenSeason puts it back to
   * work, and nothing is copied or frozen on close.
   */
  async closeSeason({ name, from, to }) {
    const closed = await metaGet('seasons', []);
    const season = {
      id: newId(),
      name: (name || seasonName(from, to)).trim(),
      from,
      to,
      closedAt: new Date().toISOString(),
    };
    await metaSet('seasons', [...closed, season]);
    await metaSet('seasonStart', dayAfter(to));
    return season;
  },

  /** Puts the last closed season back to work; the open one absorbs it. */
  async reopenSeason(id) {
    const closed = await metaGet('seasons', []);
    const season = closed.find((x) => x.id === id) || closed[closed.length - 1];
    if (!season) return null;
    await metaSet('seasons', closed.filter((x) => x !== season));
    await metaSet('seasonStart', season.from);
    return season;
  },

  /**
   * One season's rankings: one list for clubs, one per age group split
   * by sex. Points sum per person, not per appearance; club and group
   * come from the last appearance in the season, and a mid-season club
   * change is marked. Everyone who competed is on the list, points or
   * not.
   */
  async rankings(season) {
    const [competitions, competitors, entries, results, teams, register] = await Promise.all([
      all('competitions'), all('competitors'), all('entries'), all('results'),
      all('teams'), all('people'),
    ]);

    const inside = competitions.filter((c) => inSeason(c.date, season))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const ids = new Set(inside.map((c) => c.id));
    // Rankings sum the A list. A B-list competition stays in the season
    // and the calendar, but none of its placements move the order.
    const scoring = new Set(inside.filter(pointsCounted).map((c) => c.id));
    const dateOf = new Map(inside.map((c) => [c.id, c.date || '']));

    const mine = competitors.filter((c) => ids.has(c.competitionId));
    const competitorById = new Map(mine.map((c) => [c.id, c]));
    const entryById = new Map(entries.filter((e) => ids.has(e.competitionId))
      .map((e) => [e.id, e]));
    const teamById = new Map(teams.filter((t) => ids.has(t.competitionId))
      .map((t) => [t.id, t]));
    const personByIdentity = identityIndex(register);

    const blank = () => ({ zlato: 0, srebro: 0, bronza: 0, ucesce: 0, medalje: 0, bodovi: 0 });
    const score = (row, placement, scores) => {
      row[placement] = (row[placement] || 0) + 1;
      if (placementByKey(placement)?.medal) row.medalje += 1;
      if (scores) row.bodovi += pointsFor(placement);
    };

    // === Competitors =============================================
    const people = new Map();
    mine.forEach((c) => {
      if (!c.personId) return;
      if (!people.has(c.personId)) {
        people.set(c.personId, {
          personId: c.personId, ...blank(),
          nastupa: 0, clubs: new Set(), lastDate: '',
          name: c.name, club: c.club, city: c.city, year: c.year,
          group: c.group, sex: c.sex, belt: c.belt,
        });
      }
      const row = people.get(c.personId);
      row.nastupa += 1;
      if (c.club) row.clubs.add(c.club);
      // The last appearance in the season carries club, belt and group.
      const date = dateOf.get(c.competitionId) || '';
      if (date >= row.lastDate) {
        Object.assign(row, {
          lastDate: date, name: c.name, club: c.club, city: c.city,
          year: c.year, group: c.group, sex: c.sex, belt: c.belt,
        });
      }
    });

    // === Clubs =============================================
    const clubs = new Map();
    const clubOf = (name) => {
      if (!clubs.has(name)) {
        clubs.set(name, { name, city: '', ...blank(), people: new Set(), entries: 0 });
      }
      return clubs.get(name);
    };
    mine.forEach((c) => {
      if (!c.club) return;
      const club = clubOf(c.club);
      if (c.city) club.city = c.city;
      if (c.personId) club.people.add(c.personId);
    });
    entries.forEach((e) => { if (ids.has(e.competitionId) && e.club) clubOf(e.club).entries += 1; });

    results.forEach((r) => {
      if (!ids.has(r.competitionId)) return;
      const scores = scoring.has(r.competitionId);

      // A team placement: the club once, every member full points. A
      // member with no individual appearance this season gets their row
      // here — they must exist or their team points would be lost.
      const team = teamOf(r, teamById);
      if (team) {
        if (team.club) score(clubOf(team.club), r.placement, scores);
        teamMembersOf(team, personByIdentity).forEach((p) => {
          if (!people.has(p.id)) {
            const member = (team.members || []).find((m) =>
              personByIdentity.get(identityOf({ ...m, club: team.club })) === p) || {};
            people.set(p.id, {
              personId: p.id, ...blank(),
              nastupa: 0, clubs: new Set([team.club]), lastDate: '',
              name: p.name, club: team.club, city: team.city || '',
              year: p.year, group: team.group, sex: member.sex || p.sex || '',
              belt: member.belt || '',
            });
          }
          if (team.club) clubOf(team.club).people.add(p.id);
          score(people.get(p.id), r.placement, scores);
        });
        return;
      }

      const entry = entryById.get(r.entryId);
      const competitor = entry && competitorById.get(entry.competitorId);
      const person = r.personId && people.get(r.personId);
      if (person) score(person, r.placement, scores);
      // The medal belongs to the club represented that day, not today's.
      const name = competitor?.club || entry?.club;
      if (name) score(clubOf(name), r.placement, scores);
    });

    const byScore = (a, b) => b.bodovi - a.bodovi || b.medalje - a.medalje
      || b.zlato - a.zlato || b.srebro - a.srebro
      || a.name.localeCompare(b.name, 'sr');

    /** Shared place: same points, same place, then a skip (1, 2, 2, 4). */
    const place = (rows) => {
      let last = null, lastPlace = 0;
      rows.forEach((row, i) => {
        const key = `${row.bodovi}|${row.medalje}|${row.zlato}|${row.srebro}`;
        row.place = key === last ? lastPlace : i + 1;
        last = key; lastPlace = row.place;
      });
      return rows;
    };

    const clubList = place([...clubs.values()]
      .map((c) => ({ ...c, people: c.people.size, personIds: [...c.people] }))
      .sort(byScore));

    // === Per age group and sex =============================================
    const groups = [];
    AGES.forEach((age) => {
      ['M', 'Ž'].forEach((sex) => {
        const rows = [...people.values()]
          .filter((p) => p.group === age.code && p.sex === sex)
          .map((p) => ({ ...p, clubs: [...p.clubs], moved: p.clubs.size > 1 }))
          .sort(byScore);
        if (!rows.length) return;
        groups.push({
          id: `${age.code}-${sex}`,
          code: age.code,
          sex,
          age,
          name: `Grupa ${age.code} · ${age.name.toLowerCase()} · ${sex === 'M' ? 'muškarci' : 'žene'}`,
          rows: place(rows),
        });
      });
    });

    return {
      season,
      competitions: inside,
      scoring: inside.filter(pointsCounted),
      // Competitions that would carry points once closed. The list must
      // say it is waiting for them, or it quietly under-reports.
      pending: inside.filter((c) => calendarOf(c) === 'A' && !pointsCounted(c)),
      clubs: clubList,
      groups,
      totals: {
        competitions: inside.length,
        people: people.size,
        clubs: clubList.length,
        bodovi: [...people.values()].reduce((a, p) => a + p.bodovi, 0),
        medalje: [...people.values()].reduce((a, p) => a + p.medalje, 0),
      },
    };
  },
};

/**
 * People with no appearance anywhere — pruned after a competition is
 * deleted. Team membership is an appearance too: whoever exists only as
 * a member, exists.
 */
async function pruneOrphanPeople() {
  const [people, competitors, teams] = await Promise.all([
    all('people'), all('competitors'), all('teams'),
  ]);
  const used = new Set(competitors.map((c) => c.personId));
  const memberIdentities = new Set(teams.flatMap((t) =>
    (t.members || []).map((m) => identityOf({ ...m, club: t.club }))));
  const orphans = people.filter((p) => !used.has(p.id) && !memberIdentities.has(p.identity)
    && !(p.aliases || []).some((a) => memberIdentities.has(a)));
  if (!orphans.length) return;
  await tx('people', 'readwrite', (os) => orphans.forEach((p) => os.delete(p.id)));
}
