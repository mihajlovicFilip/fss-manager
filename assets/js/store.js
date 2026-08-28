/**
 * Trajno čuvanje podataka — IndexedDB, lokalno, bez servera.
 *
 * Ovo je jedini šav između aplikacije i podataka. Ekrani i dokumenti ne znaju
 * odakle podaci dolaze; zovu funkcije odavde i dobijaju obećanja. Kad jednog
 * dana u hali bude više uređaja, iza istih ovih funkcija stane mali server na
 * laptopu organizatora, a ništa drugo se ne menja.
 *
 * Zašto IndexedDB, a ne localStorage: localStorage je sinhron (blokira
 * iscrtavanje), drži samo tekst i staje na par megabajta. Jedno takmičenje sa
 * hiljadu i po prijava lako pređe tu granicu.
 *
 * ── Kako su podaci povezani ────────────────────────────────────────────
 *
 *   people        jedno lice, jednom. Živi iznad takmičenja i preko njega se
 *                 sabiraju bodovi kroz sezone. Prepoznaje se po broju licence.
 *   competitors   to lice na jednom takmičenju (klub, pojas, uzrast tog dana)
 *   entries       jedna prijava = takmičar u jednoj disciplini
 *   results       plasman na jednoj prijavi; bodovi se iz njega računaju
 *   teams         ekipne prijave
 *   competitions  sama takmičenja
 *   meta          koje je takmičenje aktuelno, da li je baza napunjena
 *
 * Bodovi se nigde ne čuvaju kao broj. Uvek se računaju iz plasmana preko
 * PLACEMENTS u data.js — kad savez promeni skalu, promeni se na jednom mestu
 * i sve stare tabele se same preračunaju.
 */

import {
  SEED_COMPETITION, PAST_COMPETITION, buildRegistry, DISCIPLINES, AGES, DEMO_VERSION,
  disciplinesForGroup, categoryKey, pointsFor, placementByKey, calendarOf, labelTeams,
  clubByName, groupOfYear, SEASON, DIPLOMA_DEFAULT, pointsCounted, BELTS, WEIGHTS,
  levelOfBelt, seasonOf, entriesOpen, FEES_DEFAULT, properName,
} from './data.js';

/** Demo nosi i jedno takmičenje iz prošle sezone — ono se deli po njenoj tabeli. */
const PROSLA_SEZONA = SEASON() - 1;

const DB_NAME = 'fss-manager';
const DB_VERSION = 2;

/**
 * Ime baze pre nego što je naziv proizvoda ispravljen.
 *
 * Baza u pregledaču se prepoznaje po imenu, pa bi preimenovanje bez prenosa
 * ostavilo sve upisano takmičenje u bazi koju niko više ne otvara. Prenos se
 * radi jednom, pri prvom pokretanju posle ispravke.
 */
const PREVIOUS_DB_NAME = 'fss-menager';

const STORES = {
  competitions: { keyPath: 'id' },
  people: { keyPath: 'id', indexes: ['identity'] },
  competitors: { keyPath: 'id', indexes: ['competitionId', 'personId'] },
  entries: { keyPath: 'id', indexes: ['competitionId', 'competitorId'] },
  results: { keyPath: 'id', indexes: ['competitionId', 'personId', 'entryId'] },
  teams: { keyPath: 'id', indexes: ['competitionId'] },
  meta: { keyPath: 'key' },
};

let dbPromise = null;

/**
 * Prenosi podatke iz baze pod starim imenom, ako je zatekne.
 *
 * Radi se pre otvaranja nove baze i tiho: ako stare nema, ako nova već postoji
 * ili ako pregledač ne ume da izlista baze, prosto se ne desi ništa. Neuspeh
 * prenosa ne sme da obori pokretanje — gore je aplikacija koja se ne otvara
 * nego aplikacija koja krene sa demo podacima.
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
      // Prodavnice i indeksi se dodaju, nikad ne ruše — baza koja je nastala
      // pod starijom verzijom mora da preživi nadogradnju sa podacima.
      Object.entries(STORES).forEach(([name, spec]) => {
        const os = db.objectStoreNames.contains(name)
          ? upgrade.objectStore(name)
          : db.createObjectStore(name, { keyPath: spec.keyPath });
        (spec.indexes || []).forEach((index) => {
          if (!os.indexNames.contains(index)) os.createIndex(index, index, { unique: false });
        });
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Baza je otvorena u drugom prozoru — zatvori ga pa osveži.'));
  });
  return dbPromise;
}

/** Jedna transakcija, jedno obećanje. `run` dobija objekte prodavnica. */
async function tx(names, mode, run) {
  const db = await openDb();
  const list = Array.isArray(names) ? names : [names];
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(list, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transakcija prekinuta'));
    // Rezultat se pamti, a razrešava tek kad se transakcija zaista upiše —
    // inače bi čitanje odmah posle upisa moglo da promaši.
    Promise.resolve(run(...list.map((n) => transaction.objectStore(n))))
      .then((value) => { result = value; })
      .catch((err) => { try { transaction.abort(); } catch { /* već prekinuta */ } reject(err); });
  });
}

const wrap = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const allBy = (osName, index, value) =>
  tx(osName, 'readonly', (os) => wrap(os.index(index).getAll(value)));

const all = (osName) => tx(osName, 'readonly', (os) => wrap(os.getAll()));

/** crypto.randomUUID traži siguran kontekst; localhost jeste, file:// nije. */
const newId = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));

/**
 * Šta čini isto lice na dva različita takmičenja.
 *
 * Broj licence je zvanična identifikacija i ima prednost. Savez ih izdaje, ali
 * ih još nema u bazi, pa se do tada lice određuje sa **ime + godište + klub** —
 * na Filipovu odluku, kao trenutno najpreciznije što postoji.
 *
 * Klub je u identitetu zbog imenjaka: dva kluba umeju da prijave dva različita
 * deteta istog imena i istog godišta, i to se bez kluba ne može razlikovati.
 * Cena te odluke je poznata i namerno prihvaćena: **ko pređe u drugi klub, u
 * bazi je nov takmičar** i bodovi mu kreću od nule. Uvoz takav slučaj prepozna
 * i imenuje (`transfers`), da se ne desi tiho.
 */
const looseIdentity = (person) =>
  `nm:${String(person.name).trim().toLowerCase()}|${person.year}`;

const identityOf = (person) => {
  if (person.licence) return `lic:${String(person.licence).trim().toUpperCase()}`;
  const club = String(person.club || '').trim().toLowerCase();
  return club ? `${looseIdentity(person)}|${club}` : looseIdentity(person);
};

/**
 * Lica članova jedne ekipe, preko identiteta (ime + godište + klub ekipe).
 *
 * Član se ne pamti sa personId — uvoz i ispravke ga vode po imenu — pa se
 * lice svaki put nađe iznova, istim pravilom kojim ga je uvoz i upisao.
 * Član čije lice ne postoji (ekipa iz baze starije od ove mogućnosti) se
 * preskače: bodovi ne mogu da legnu na red koga nema.
 */
const teamMembersOf = (team, personByIdentity) => (team.members || [])
  .map((m) => personByIdentity.get(identityOf({ ...m, club: team.club })))
  .filter(Boolean);

/** Ekipni red rezultata prepoznaje se po oznaci, sa starim `entryId` upisom. */
const teamOf = (result, teamById) => (result.kind === 'team'
  ? teamById.get(result.teamId || result.entryId) || null : null);

/**
 * Prevod zatečenih lica na identitet sa klubom.
 *
 * Baza napravljena ranijom verzijom nosi identitete bez kluba; da se ne
 * prevedu, sledeći uvoz bi svakog od njih video kao nepoznatog i napravio
 * duplikat. Klub se uzima sa **poslednjeg nastupa**, jer je to i klub za koji
 * lice trenutno važi.
 */
async function migrateIdentities() {
  const done = await metaGet('identityVersion', 0);
  if (done >= 2) return;

  const [people, competitors] = await Promise.all([all('people'), all('competitors')]);
  const byPerson = new Map();
  competitors.forEach((c) => {
    if (!c.personId) return;
    const prev = byPerson.get(c.personId);
    if (!prev || String(c.competitionId) > String(prev.competitionId)) byPerson.set(c.personId, c);
  });

  const updated = people.map((p) => {
    const club = p.club || byPerson.get(p.id)?.club || '';
    return { ...p, club, identity: identityOf({ ...p, club }) };
  });

  await tx(['people', 'meta'], 'readwrite', (ppl, meta) => {
    updated.forEach((r) => ppl.put(r));
    meta.put({ key: 'identityVersion', value: 2 });
  });
}

// ── Punjenje pri prvom pokretanju ──────────────────────────────────────

/** Prodavnice koje demo puni — i koje se pri osvežavanju demoa prazne. */
const DATA_STORES = ['competitions', 'people', 'competitors', 'entries', 'results', 'teams'];

/**
 * Da li je baza i dalje netaknut demo: tačno dva zasejana takmičenja i
 * nijedno svoje. Čim korisnik upiše svoje takmičenje, demo se više ne dira
 * sam od sebe — bolje da gleda stare brojke nego da izgubi svoj rad.
 */
async function demoUntouched() {
  const competitions = await all('competitions');
  const seeded = [SEED_COMPETITION.name, PAST_COMPETITION.name];
  return competitions.length === seeded.length
    && competitions.every((c) => seeded.includes(c.name));
}

/**
 * Baza napunjena starijom verzijom demoa ne pokazuje ono što aplikacija sad
 * ume. Ako je demo netaknut, osveži ga bez pitanja; ako je korisnik već
 * počeo da radi u njemu, ostavi ga na miru i samo obeleži da je zastareo —
 * kontrolna tabla to onda ponudi kao dugme.
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
 * Pretvara demo registar u zapise jednog takmičenja.
 *
 * `buildRegistry()` vraća listu sa indeksima umesto ključeva; ovde svaka
 * prijava dobija svoj id i vezu ka licu. Isto se koristi i pri zasejavanju
 * baze i kad se **novo takmičenje pravi već popunjeno** — jedan put do
 * podataka, pa novo takmičenje izgleda tačno kao zasejano.
 *
 * @param {string} competitionId  kome se prijave upisuju
 * @param {number} seed           isto seme daje isti registar
 */
function registryRecords(competitionId, seed) {
  const registry = buildRegistry(seed);
  const people = [];
  const competitors = registry.competitors.map((c) => {
    const person = {
      id: newId(), identity: identityOf(c),
      name: c.name, sex: c.sex, year: c.year, club: c.club || '', licence: c.licence,
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

  // Odigrano takmičenje iz prošle sezone, sa istim licima i upisanim
  // plasmanima — tek uz njega ukupan zbir bodova ima šta da sabere.
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
 * Pravi prošlosezonsko takmičenje od već postojećih lica i deli plasmane.
 * Medalje se ne bacaju nasumično: prijave se grupišu po kategoriji i u svakoj
 * prva tri mesta idu redom, ostali dobijaju učešće — tako u jednoj kategoriji
 * postoji tačno jedno zlato, kao i u stvarnosti.
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
  // Klub koji lice nosi ove sezone — prošla sezona ga zadržava, osim kod
  // onih koji su u međuvremenu prešli.
  const clubOfPerson = new Map(competitors.map((c) => [
    c.personId, { name: c.club, city: c.city, coach: c.coach },
  ]));
  const past = [];
  const entries = [];

  // Prošla sezona: isti ljudi, godinu dana mlađi, pa im uzrasna grupa može
  // biti druga — zato se disciplina bira po grupi tog takmičenja.
  // Prošla sezona je manja od aktuelne — otprilike trećina istih ljudi, jer
  // je to ono što ukupnom zbiru bodova daje šta da sabere, a ne još jedno
  // prvenstvo iste veličine.
  people.slice(0, Math.round(people.length / 3)).forEach((person, i) => {
    const year = person.year;
    const group = groupOfYear(year, PROSLA_SEZONA);
    const allowed = disciplinesForGroup(group);
    if (!allowed.length) return;

    // Klub ostaje isti kao ove sezone — prelazak je izuzetak, ne pravilo.
    // Svaki sedmi menja klub: dovoljno da se vidi kako ranije osvojene
    // medalje ostaju kod starog kluba i kako rang lista to označi, a da
    // oznaka „promena kluba" ne stoji na svakom redu i ne izgubi smisao.
    const moved = i % 7 === 3;
    const other = PAST_CLUBS[i % PAST_CLUBS.length];
    const now = clubOfPerson.get(person.id);
    const club = moved || !now ? other : now;
    const competitor = {
      id: newId(), competitionId, personId: person.id,
      name: person.name, sex: person.sex, year, group,
      club: club.name, city: club.city, coach: club.coach,
      belt: belts[i % belts.length], level: '', licence: person.licence,
    };
    past.push(competitor);

    const picks = [allowed.find((d) => d.name === 'Kate') || allowed[0]];
    if (i % 3 === 0 && allowed.length > 1) picks.push(allowed[(i % (allowed.length - 1)) + 1]);

    picks.forEach((d) => entries.push({
      id: newId(), competitionId, competitorId: competitor.id, personId: person.id,
      name: competitor.name, sex: competitor.sex, year, group,
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
 * Baze nastale pre uvođenja lica nemaju `personId` na takmičarima. Ovde se
 * to dopunjuje: za svakog takmičara se nađe ili napravi lice po licenci.
 * Prolazi jednom i posle je bez posla.
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

// ── Javni deo ──────────────────────────────────────────────────────────


// ── Sezone ─────────────────────────────────────────────────────────────

/*
 * Sezona nije zakucana u kod. Nema pravila „počinje 1. septembra" jer ga
 * savez nema — **urednik određuje** kad sezona počinje i kad se završava,
 * a aplikacija samo pamti šta je odredio.
 *
 * Zato je sezona samo raspon datuma: otvorena sezona ima početak i nema
 * kraj, i traje dok je urednik ne zatvori. Zatvaranje upisuje kraj, gurne
 * sezonu u arhivu i otvori sledeću od sutradan. Rang liste se računaju nad
 * takmičenjima koja padaju u taj raspon — ništa se ne prepisuje i ne
 * zamrzava, pa ispravka rezultata u zatvorenoj sezoni i dalje pomera njenu
 * rang listu kad se sezona ponovo otvori.
 *
 * meta['seasons']     zatvorene sezone: { id, name, from, to, closedAt }
 * meta['seasonStart'] datum od kog teče otvorena sezona
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
 * „2025/26" kad raspon pređe Novu godinu, inače „2026". Ime je samo predlog:
 * urednik ga menja pri zatvaranju.
 */
function seasonName(from, to) {
  const a = Number((from || '').slice(0, 4));
  const b = Number((to || from || '').slice(0, 4));
  if (!a) return 'Sezona';
  if (!b || a === b) return String(a);
  return `${a}/${String(b).slice(2)}`;
}

/** Da li takmičenje tog datuma pada u sezonu. Otvorena sezona nema gornju među. */
const inSeason = (date, season) =>
  !!date && date >= season.from && (!season.to || date <= season.to);

export const store = {
  /** Otvara bazu, po potrebi je puni i dopunjuje veze. Zovi pre svega. */
  ready() {
    if (!readyPromise) {
      readyPromise = migrateFromPreviousName()
        .then(openDb).then(seed).then(refreshDemo).then(linkPeople)
        .then(migrateIdentities);
    }
    return readyPromise;
  },

  /** Da li baza nosi demo stariji od aplikacije, a korisnik već radi u njoj. */
  async demoIsStale() {
    const row = await tx('meta', 'readonly', (os) => wrap(os.get('demoStale')));
    return !!row;
  },

  /**
   * Zaštita od tihog brisanja. Kad pregledaču zafali prostora na disku, sme
   * da obriše IndexedDB bez pitanja i bez traga — a u njoj je cela sezona.
   * `persist()` traži da skladište postane trajno; jednom odobreno važi
   * trajno, pa se zahtev slobodno ponavlja pri svakom pokretanju. Uz odgovor
   * ide i zauzeće, da Podešavanja imaju šta da pokažu.
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

  // ── Takmičenja ───────────────────────────────────────────────────────

  async listCompetitions() {
    const rows = await all('competitions');
    // Najskorije napred; takmičenja bez datuma na dno.
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
      // Iz kalendara se takmičenje upisuje sa osnovnim podacima; discipline
      // se biraju kasnije, pa prazan izbor znači „sve iz pravilnika".
      disciplines: data.disciplines?.length ? data.disciplines : DISCIPLINES.map((d) => d.name),
      status: 'Nacrt',
      createdAt: new Date().toISOString(),
    };
    await tx('competitions', 'readwrite', (os) => os.put(competition));

    // Popunjeno takmičenje: prijave se upisuju odmah, u istom obliku u kom
    // ih nosi i zasejano. Postoji zato što je čekanje da se stara baza sama
    // osveži izgubljen posao — novo takmičenje se pravi svež i gotovo.
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
      competition.entries = entries.length;
      competition.competitors = competitors.length;
    }
    return competition;
  },

  /** Briše takmičenje i sve što uz njega ide — prijave, takmičare, rezultate. */
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
    // Lica koja više nigde ne nastupaju nemaju šta da rade u bazi.
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

  // ── Prijave ──────────────────────────────────────────────────────────

  /**
   * Prijave jednog takmičenja u obliku u kome ih ekrani i dokumenti očekuju.
   * Novo takmičenje vraća prazne liste — to je tačno stanje, ne greška.
   */
  async registryFor(competitionId) {
    if (!competitionId) return { competitors: [], entries: [], teams: [] };
    const [competitors, entries, teams] = await Promise.all([
      allBy('competitors', 'competitionId', competitionId),
      allBy('entries', 'competitionId', competitionId),
      allBy('teams', 'competitionId', competitionId),
    ]);
    // Ime pod kojim ekipa nastupa računa se iz onoga što je u bazi, ne čuva
    // se — broj uz klub zavisi od toga koliko ekipa taj klub ima u toj
    // kategoriji, a to se menja sa svakom novom prijavom.
    labelTeams(teams);
    const people = new Map(competitors.map((c) => [c.id, c]));
    return {
      competitors,
      teams,
      entries: entries.map((e) => ({ ...e, competitor: people.get(e.competitorId) || null })),
    };
  },

  /**
   * Uvozi prijavu koju je klub izvezao sa ekrana „Prijava kluba".
   *
   * Ovo je jedino mesto gde tuđi fajl ulazi u bazu, pa se ponaša oprezno:
   *
   * **Lice se prepoznaje, ne pravi ponovo.** Ako isti čovek već postoji —
   * makar sa prošlogodišnjeg takmičenja — prijava se veže za njega, inače mu
   * bodovi ne bi legli na isti red rang liste.
   *
   * **Uvoz dvaput ne pravi duplikate.** Prijava koja već stoji na takmičenju
   * se preskače i broji odvojeno, da klub sme da pošalje ispravljen fajl bez
   * straha da će svi biti upisani po dva puta.
   *
   * @returns {{people:number, competitors:number, entries:number, skipped:number,
   *            teams:number, teamsSkipped:number}}
   */
  async importClubEntry(competitionId, payload) {
    const competition = await store.getCompetition(competitionId);
    if (!competition) throw new Error('Takmičenje nije pronađeno.');
    // Zabrana stoji ovde, a ne samo na dugmetu: zatvorene prijave znače da se
    // spisak više ne menja, pa ni uvozom.
    if (!entriesOpen(competition)) {
      throw new Error(`Na takmičenju „${competition.name}" su prijave zatvorene`
        + ' — uvoz je zaustavljen.');
    }

    const club = payload.club;
    const city = payload.city || clubByName(club)?.city || '';
    const coach = payload.coach || clubByName(club)?.coach || '';

    const [people, mine, theirEntries, theirTeams] = await Promise.all([
      all('people'),
      allBy('competitors', 'competitionId', competitionId),
      allBy('entries', 'competitionId', competitionId),
      allBy('teams', 'competitionId', competitionId),
    ]);

    /**
     * Koje je lice ovo.
     *
     * Identitet je **ime + godište + klub** (dok licenci nema), pa dva kluba
     * koja prijave dva različita deteta istog imena i istog godišta dobijaju
     * dva lica — što je i bio razlog za klub u identitetu.
     *
     * Naličje te odluke: isto ime i godište pod **drugim** klubom više nije
     * isti čovek nego novo lice, pa ko pređe u drugi klub kreće od nule.
     * Aplikacija tu ne odlučuje tiho — takav slučaj se prijavljuje pozivaocu
     * (`transfers`) sa oba kluba, da urednik zna da je zatečen imenjak ili
     * prelazak.
     */
    const byIdentity = new Map();
    const byLoose = new Map();
    people.forEach((p) => {
      const add = (map, k) => {
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(p);
      };
      add(byIdentity, p.identity);
      if (!p.licence) add(byLoose, looseIdentity(p));
    });

    const key = (personId, forClub) => `${personId}|${forClub}`;
    const hereByClub = new Map(mine.map((c) => [key(c.personId, c.club), c]));
    const busy = new Set(mine.filter((c) => c.club !== club).map((c) => c.personId));
    const hasEntry = new Set(theirEntries.map((e) => `${e.competitorId}|${e.discipline}`));

    const newPeople = [];
    const newCompetitors = [];
    const newEntries = [];
    const transfers = [];
    let skipped = 0;

    (payload.competitors || []).forEach((c) => {
      const identity = identityOf({ ...c, club });
      const candidates = byIdentity.get(identity) || [];
      let person = candidates.find((p) => !busy.has(p.id)) || null;

      if (!person) {
        // Isti čovek pod drugim klubom — ili njegov imenjak. Bez licence se
        // to ne može razlikovati, pa se upisuje kao novo lice i imenuje.
        const elsewhere = (byLoose.get(looseIdentity(c)) || [])
          .filter((p) => String(p.club || '').toLowerCase() !== club.toLowerCase());
        if (elsewhere.length) {
          transfers.push({ name: c.name, year: c.year, from: elsewhere[0].club || '', to: club });
        }
        person = {
          id: newId(), identity, name: c.name, sex: c.sex, year: c.year,
          club, licence: null,
        };
        if (!byIdentity.has(identity)) byIdentity.set(identity, []);
        byIdentity.get(identity).push(person);
        const loose = looseIdentity(c);
        if (!byLoose.has(loose)) byLoose.set(loose, []);
        byLoose.get(loose).push(person);
        newPeople.push(person);
      }

      // Uzrasna grupa se i ovde računa iz godišta, a ne uzima iz fajla:
      // pravilnik je jedini izvor, ma ko punio prijavu.
      const group = groupOfYear(c.year, seasonOf(competition)) || c.group || '';

      let competitor = hereByClub.get(key(person.id, club));
      if (!competitor) {
        competitor = {
          id: newId(), competitionId, personId: person.id,
          name: c.name, sex: c.sex, year: c.year, group,
          club, city, coach, belt: c.belt, level: c.level,
          // Telesna težina je osobina takmičara, a klub je prijavljuje uz disciplinu
          // koja se po njoj deli — uzima se prva takva.
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
          // Ravan red, isto kao kod zasejanih prijava — spiskovi i dokumenti
          // čitaju odavde, bez ijednog spajanja.
          name: c.name, sex: c.sex, year: c.year, group,
          club, city, coach, belt: c.belt, level: c.level,
        });
      });
    });

    // I član ekipe je lice u bazi — bez toga ekipni plasman ne bi imao kome
    // da upiše bodove. Prepoznaje se istim identitetom (ime + godište + klub)
    // kao i pojedinačna prijava, a imenjak iz drugog kluba se i ovde imenuje,
    // ne rešava tiho.
    (payload.teams || []).forEach((t) => {
      (t.members || []).forEach((m) => {
        const identity = identityOf({ ...m, club });
        if (byIdentity.has(identity)) return;
        const elsewhere = (byLoose.get(looseIdentity(m)) || [])
          .filter((p) => String(p.club || '').toLowerCase() !== club.toLowerCase());
        if (elsewhere.length) {
          transfers.push({ name: m.name, year: m.year, from: elsewhere[0].club || '', to: club });
        }
        const person = {
          id: newId(), identity, name: m.name, sex: m.sex, year: m.year,
          club, licence: null,
        };
        byIdentity.set(identity, [person]);
        const loose = looseIdentity(m);
        if (!byLoose.has(loose)) byLoose.set(loose, []);
        byLoose.get(loose).push(person);
        newPeople.push(person);
      });
    });

    // Ista ekipa je ista disciplina, grupa, vrsta, klub i isti sastav. Klub
    // sme da prijavi dve ekipe u istoj kategoriji, pa razlikuje sastav.
    const teamKey = (t) => [t.discipline, t.group, t.variant, t.club,
      (t.members || []).map((m) => m.name).sort().join('|')].join('§');
    const haveTeams = new Set(theirTeams.map(teamKey));
    const newTeams = [];
    let teamsSkipped = 0;

    (payload.teams || []).forEach((t) => {
      const record = { ...t, id: newId(), competitionId, club, city, coach };
      if (haveTeams.has(teamKey(record))) { teamsSkipped += 1; return; }
      haveTeams.add(teamKey(record));
      newTeams.push(record);
    });

    await tx(['people', 'competitors', 'entries', 'teams'], 'readwrite',
      (ppl, cmp, ent, tms) => {
        newPeople.forEach((r) => ppl.put(r));
        newCompetitors.forEach((r) => cmp.put(r));
        newEntries.forEach((r) => ent.put(r));
        newTeams.forEach((r) => tms.put(r));
      });

    return {
      transfers,
      people: newPeople.length,
      competitors: newCompetitors.length,
      entries: newEntries.length,
      skipped,
      teams: newTeams.length,
      teamsSkipped,
    };
  },

  // ── Ispravka prijave ─────────────────────────────────────────────────

  /**
   * Šta se sme upisati na prijavu, i šta iz toga sledi.
   *
   * Klub greši: pošalje pogrešan pol, promaši godište, upiše disciplinu koja
   * za taj uzrast ne postoji. Ispravka zato **ne prepisuje samo polje** nego
   * ponovo izvodi sve što iz njega sledi — uzrasnu grupu iz godišta, nivo iz
   * pojasa, dozvoljene discipline iz grupe, telesnu težinu iz grupe i pola.
   * To je isti put kojim ide i uvoz; da ispravka ide drugim putem, ista
   * prijava bi značila jedno kad stigne iz Excela a drugo kad se ispravi.
   *
   * Baca grešku sa rečenicom koja se čita — nju dijalog ispisuje kao što
   * uvoz ispisuje razlog za red koji nije uvezen.
   */
  async validateEntry(competition, patch) {
    const season = seasonOf(competition);
    // Ime se svodi na pisani oblik **pre** svake provere i pre identiteta, pa
    // se „MARKO MARKOVIĆ" i „Marko Marković" i upisuju isto, a ne samo
    // prepoznaju kao isto lice.
    const name = properName(patch.name);
    const year = Number(patch.year) || 0;
    const group = groupOfYear(year, season);
    const sex = patch.sex === 'M' || patch.sex === 'Ž' ? patch.sex : '';
    const belt = BELTS.indexOf(patch.belt) >= 0 ? patch.belt : '';

    if (!name) throw new Error('Nije uneto ime i prezime.');
    if (!/^[\p{L}\s'-]+$/u.test(name)) {
      throw new Error(`Ime „${name}" sadrži znakove koji nisu slova.`);
    }
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
      name, sex, year, group, belt,
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
   * Upisuje novu prijavu, jednu, iz aplikacije.
   *
   * Postoji zbog dana takmičenja: klub dovede takmičara koga na spisku nema,
   * a čekati ispravljen Excel u hali nema smisla. Ide **istim putem kao
   * uvoz** — kroz `validateEntry()` i kroz isto prepoznavanje lica — pa
   * prijava upisana ovde ne znači ništa drugo od one koja je stigla iz
   * formulara.
   *
   * Ko je već prijavljen ne upisuje se drugi put: to je ispravka postojeće
   * prijave, i poruka tako i kaže.
   */
  async addCompetitor(competitionId, patch) {
    const competition = await store.getCompetition(competitionId);
    if (!competition) throw new Error('Takmičenje ne postoji.');
    if (!entriesOpen(competition)) {
      throw new Error('Prijave su zatvorene — nove prijave se ne upisuju.');
    }

    const clean = await store.validateEntry(competition, patch);
    if (!clean.club) throw new Error('Nije izabran klub.');

    const [people, mine] = await Promise.all([
      all('people'),
      allBy('competitors', 'competitionId', competitionId),
    ]);

    // Isto pravilo kao pri uvozu: zauzeto lice znači ili istu prijavu (greška)
    // ili imenjaka iz drugog kluba (novo lice).
    const identity = identityOf(clean);
    const candidates = people.filter((p) => p.identity === identity);
    const busy = new Set(mine.map((c) => c.personId));
    const already = mine.find((c) => candidates.some((p) => p.id === c.personId));
    if (already) {
      throw new Error(`${clean.name} (${clean.year}) je već prijavljen`
        + ` za ${already.club} — ispravi postojeću prijavu.`);
    }

    let person = candidates.find((p) => !busy.has(p.id)) || null;
    // Isto ime i godište pod drugim klubom: imenjak ili prelazak — u oba
    // slučaja novo lice, jer identitet nosi klub.
    const elsewhere = !person && people.some((p) => !p.licence
      && looseIdentity(p) === looseIdentity(clean)
      && String(p.club || '').toLowerCase() !== clean.club.toLowerCase());
    const isNew = !person;
    if (isNew) {
      person = {
        id: newId(), identity, name: clean.name, sex: clean.sex, year: clean.year,
        club: clean.club, licence: null,
      };
    }

    const competitor = {
      id: newId(), competitionId, personId: person.id,
      name: clean.name, sex: clean.sex, year: clean.year, group: clean.group,
      club: clean.club, city: clean.city, coach: clean.coach,
      belt: clean.belt, level: clean.level, weight: clean.weight,
    };

    await tx(['people', 'competitors', 'entries'], 'readwrite', (ppl, cmp, ent) => {
      if (isNew) ppl.put(person);
      cmp.put(competitor);
      clean.disciplines.forEach((d) => ent.put({
        id: newId(), competitionId, competitorId: competitor.id, personId: person.id,
        discipline: d.name, weight: d.weight,
        // Ravan red, isto kao kod uvoza — spiskovi i dokumenti čitaju odavde.
        name: clean.name, sex: clean.sex, year: clean.year, group: clean.group,
        club: clean.club, city: clean.city, coach: clean.coach,
        belt: clean.belt, level: clean.level,
      }));
    });

    return {
      competitorId: competitor.id,
      group: clean.group,
      entries: clean.disciplines.length,
      // Lice koje je već nastupalo ranije prepoznato je, ne napravljeno opet.
      known: !isNew,
      // Isto ime i godište postoji pod drugim klubom — imenjak ili prelazak.
      elsewhere,
    };
  },

  /**
   * Ispravlja jednu prijavu i sve što je iz nje izvedeno.
   *
   * Menja se lice, zapis takmičara na tom takmičenju, svi njegovi redovi
   * prijava i podaci o njemu u ekipama — jer su prijave namerno ravni redovi
   * (spiskovi i dokumenti čitaju odatle, bez ijednog spajanja), pa ispravka
   * mora da ih obiđe sve.
   *
   * **Godište i ime određuju lice.** Ako ispravka od jednog čoveka napravi
   * onog koji u bazi već postoji — a to je i cilj kad se ispravlja omaška u
   * godištu — prijava se prevezuje na zatečeno lice, zajedno sa upisanim
   * plasmanima, da bodovi legnu na isti red rang liste.
   *
   * @returns {{group:string, added:number, removed:number, teams:number, merged:boolean}}
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

    const [people, mine, elsewhere, theirEntries, theirResults, teams] = await Promise.all([
      all('people'),
      allBy('competitors', 'competitionId', competitionId),
      allBy('competitors', 'personId', competitor.personId),
      allBy('entries', 'competitorId', competitorId),
      allBy('results', 'competitionId', competitionId),
      allBy('teams', 'competitionId', competitionId),
    ]);

    const person = people.find((p) => p.id === competitor.personId) || null;
    // Klub je deo identiteta, pa ispravka kluba menja i njega — ali **isti
    // zapis lica**, pa istorija ide za čovekom. To je i razlika između
    // ispravke (urednik zna da je to isti čovek) i uvoza (ne zna).
    const identity = identityOf({ ...clean, licence: person?.licence || null });
    const twin = people.find((p) => p.identity === identity && p.id !== competitor.personId);
    if (twin && mine.some((c) => c.personId === twin.id && c.id !== competitorId)) {
      throw new Error(`${clean.name} (${clean.year}) je već prijavljen na ovo takmičenje.`);
    }
    const personId = twin ? twin.id : competitor.personId;

    // Prijave: šta ostaje, šta odlazi, šta se dodaje.
    const wanted = new Map(clean.disciplines.map((d) => [d.name, d]));
    const removed = theirEntries.filter((e) => !wanted.has(e.discipline));
    const kept = theirEntries.filter((e) => wanted.has(e.discipline));
    const have = new Set(kept.map((e) => e.discipline));
    const added = clean.disciplines.filter((d) => !have.has(d.name));

    const flat = {
      name: clean.name, sex: clean.sex, year: clean.year, group: clean.group,
      club: clean.club, city: clean.city, coach: clean.coach,
      belt: clean.belt, level: clean.level,
    };
    const goneIds = new Set(removed.map((e) => e.id));
    const keptIds = new Set(kept.map((e) => e.id));
    // Plasman upisan na prijavu koje više nema nema se na šta odnositi.
    const goneResults = theirResults.filter((r) => goneIds.has(r.entryId));
    // Ako je prijava prevezana na drugo lice, plasmani idu za njom.
    const movedResults = personId === competitor.personId
      ? [] : theirResults.filter((r) => keptIds.has(r.entryId));

    // Ekipe pamte svoje članove u sebi, pa ih ispravka mora obići.
    const touchedTeams = teams.filter((t) =>
      (t.members || []).some((m) => m.name === competitor.name && m.year === competitor.year));
    touchedTeams.forEach((team) => {
      team.members = team.members.map((m) => (
        m.name === competitor.name && m.year === competitor.year
          ? { ...m, name: clean.name, year: clean.year, belt: clean.belt, sex: clean.sex }
          : m));
    });

    await tx(['people', 'competitors', 'entries', 'results', 'teams'], 'readwrite',
      (ppl, cmp, ent, res, tms) => {
        if (twin) {
          // Lice koje je ostalo bez ijedne prijave, i ovde i na svim drugim
          // takmičenjima, nema zašto da stoji u bazi.
          if (person && !elsewhere.some((c) => c.id !== competitorId)) ppl.delete(person.id);
        } else if (person) {
          ppl.put({
            ...person, identity, name: clean.name, sex: clean.sex,
            year: clean.year, club: clean.club,
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
    };
  },

  /**
   * Briše jednu prijavu sa takmičenja — takmičara, sve njegove discipline i
   * sve što je na njima upisano.
   *
   * **Ekipa u kojoj je bio član briše se sa njim.** Ekipa kojoj fali čovek
   * nije ekipa: izvukla bi se i odštampala pogrešna, a niko ne bi video zašto.
   * Bolje da nestane vidljivo, uz poruku koliko ih je nestalo.
   *
   * Lice ostaje u bazi ako je nastupalo i drugde — njegova istorija nije
   * vlasništvo ovog takmičenja.
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
      (t.members || []).some((m) => m.name === competitor.name && m.year === competitor.year));
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

  // ── Plasmani i bodovi ────────────────────────────────────────────────

  /**
   * Upisuje plasman na jednu prijavu. `placement` je ključ iz PLACEMENTS, a
   * prazna vrednost briše upis — takmičar koji je nastupio ali plasman još
   * nije unet ne sme da nosi bodove.
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
   * Plasman jedne ekipe. Red rezultata nosi `kind: 'team'` i ekipu umesto
   * lica — bodove članovima ne upisuje ovde nego ih, kao i sve ostalo,
   * izvode zbirovi iz plasmana: svaki član dobija pune bodove na svoj
   * karton, a klubu se ekipna medalja broji jednom, ne po članu.
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
      // `entryId` nosi ekipu zbog postojećeg indeksa; `kind` kaže šta je red.
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
   * Upisuje isti plasman na sve prijave koje ga još nemaju.
   *
   * Postoji zbog jedne stvari na dan takmičenja: većina prijavljenih dobija
   * učešće, a menja se samo šačica onih sa medaljom. Bez ovoga bi se svaki od
   * dve hiljade redova otvarao ručno.
   *
   * Prijava koja već ima plasman se **ne dira** — ovo dopunjuje, ne prepisuje.
   * Sve ide u jednu transakciju, jer bi dve hiljade zasebnih upisa trajale.
   *
   * @returns {number} koliko je prijava dobilo plasman
   */
  async fillPlacement(competitionId, entryIds, placement) {
    if (!placementByKey(placement)) throw new Error(`Nepoznat plasman: ${placement}`);
    const [entries, teams, results] = await Promise.all([
      allBy('entries', 'competitionId', competitionId),
      allBy('teams', 'competitionId', competitionId),
      allBy('results', 'competitionId', competitionId),
    ]);
    const taken = new Set(results.map((r) => r.entryId));
    // U spisku sa ekrana stoje i prijave i ekipe — razvrstava ih baza, ne ekran.
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
   * Zbir po licu: medalje i bodovi na traženom takmičenju, i ukupno kroz sve
   * sezone. Bodovi se svaki put računaju iz plasmana, nikad ne stoje upisani.
   *
   * @returns {Map<string, {here: Tally, total: Tally, competitions: number}>}
   *   ključ je personId; Tally je { zlato, srebro, bronza, ucesce, medalje, bodovi }
   */
  async tallyByPerson(competitionId) {
    const [results, competitions, teams, register] = await Promise.all([
      all('results'), all('competitions'), all('teams'), all('people'),
    ]);
    // Bodove nose samo takmičenja sa A liste, i to tek kad su zatvorena.
    // Medalja se broji odmah — u kolonu ulazi čim se plasman upiše, bez
    // obzira na listu i na to da li je takmičenje gotovo.
    const scoring = new Set(competitions.filter(pointsCounted).map((c) => c.id));
    const teamById = new Map(teams.map((t) => [t.id, t]));
    const personByIdentity = new Map(register.map((p) => [p.identity, p]));

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
      // Ekipni plasman: svaki član dobija pune bodove i medalju na svoj red.
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
   * Nastupi jednog lica kroz sve sezone — po jedno takmičenje, sa prijavama i
   * plasmanima. Ovo je karton takmičara: gde je nastupao i šta je osvojio.
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
      // Namerno redom, ne paralelno: jedan takmičar ima nekoliko nastupa, a
      // ovako je kod čitljiv i baza svakako radi iz memorije.
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

  /** Menja stanje takmičenja (nacrt → prijave → završeno i nazad). */
  async setCompetitionStatus(id, status) {
    const competition = await store.getCompetition(id);
    if (!competition) return null;
    const updated = { ...competition, status, statusChangedAt: new Date().toISOString() };
    await tx('competitions', 'readwrite', (os) => os.put(updated));
    return updated;
  },

  /**
   * Briše sve i puni bazu ispočetka demo podacima. Treba kad se pravilnik
   * promeni — godišta uzrasnih grupa i matrica disciplina su ugrađeni u već
   * upisane prijave, pa se stara demo baza ne poklapa sa novom tabelom.
   * Prava takmičenja ovo naravno briše, zato ide uz potvrdu.
   */
  async resetDemo() {
    await tx([...DATA_STORES, 'meta'], 'readwrite',
      (...stores) => stores.forEach((os) => os.clear()));
    readyPromise = null;
    await store.ready();
  },

  /**
   * Zbir po klubovima kroz sve sezone: medalje, bodovi, koliko lica i koliko
   * nastupa. Medalja se pripisuje klubu koji je takmičar **tada** predstavljao
   * — zapis `competitors` nosi klub tog dana, pa promena kluba ne premešta
   * ranije osvojene medalje.
   *
   * Ekipni plasmani se ovde još ne broje: rezultat visi o prijavi
   * (`entries`), a ekipe su zaseban zapis bez rezultata.
   *
   * @returns {{clubs: Array, totals: Object}} klubovi sortirani po bodovima
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
    const personByIdentity = new Map(register.map((p) => [p.identity, p]));

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

    // Prvo klubovi i njihovi ljudi — da se u spisku vidi i klub koji još nema
    // nijednu medalju.
    competitors.forEach((c) => {
      if (!c.club) return;
      const club = clubOf(c.club);
      if (c.city) club.city = c.city;
      if (c.personId) club.people.add(c.personId);
      club.competitions.add(c.competitionId);
    });
    entries.forEach((e) => { if (e.club) clubOf(e.club).entries += 1; });

    // I ekipa pripada klubu: njeni članovi ulaze u broj lica, prijava u broj
    // prijava — da klub koji nastupa samo ekipno ne izgleda kao da ga nema.
    teams.forEach((t) => {
      if (!t.club) return;
      const club = clubOf(t.club);
      if (t.city) club.city = t.city;
      club.competitions.add(t.competitionId);
      club.entries += 1;
      teamMembersOf(t, personByIdentity).forEach((p) => club.people.add(p.id));
    });

    results.forEach((r) => {
      // Ekipna medalja se klubu broji jednom — ekipa je jedan plasman, ma
      // koliko članova imala. Bodove po članu vodi lični karton, ne ovaj zbir.
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

    // `personIds` ostaje uz klub, ne samo brojka: kad se spisak filtrira,
    // zbir takmičara mora da bude broj *jedinstvenih* lica u toj podlisti, a
    // to se ne dobija sabiranjem kolone — isti čovek nastupa i za svoj klub
    // na više takmičenja, i (posle prelaska) za dva različita kluba.
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

    // Zbir se ne dobija sabiranjem kolone „takmičari": ko je nastupao za dva
    // kluba broji se u oba, pa bi zbir bio veći od stvarnog broja lica.
    const everyone = new Set(competitors.map((c) => c.personId).filter(Boolean));
    teams.forEach((t) => teamMembersOf(t, personByIdentity)
      .forEach((p) => everyone.add(p.id)));
    const totals = ['zlato', 'srebro', 'bronza', 'ucesce', 'medalje', 'bodovi']
      .reduce((acc, key) => ({ ...acc, [key]: list.reduce((sum, c) => sum + c[key], 0) }),
        { people: everyone.size, clubs: list.length });

    return { clubs: list, totals };
  },

  listPeople() { return all('people'); },

  // ── Raspored po borilištima ──────────────────────────────────────────

  /**
   * Plan borilišta za jedno takmičenje: koliko ih ima i šta se na kom radi.
   *
   * Čuva se **samo odluka urednika** — broj borilišta i, po bloku, na koje
   * ide, kojim redom i koje discipline. Sami blokovi se ne čuvaju: oni se
   * izvode iz prijava pri svakom otvaranju, pa prijava koja stigne posle
   * pravljenja rasporeda ne ostane nevidljiva. Zapis koji više nema svoju
   * grupu prosto ostane neupotrebljen.
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
      // Zapis starijeg oblika ostaje dok se ne prevede, pa se ništa ne gubi
      // ako se plan otvori starijom verzijom aplikacije.
      blocks: plan.blocks,
      migrated: plan.migrated,
      savedAt: new Date().toISOString(),
    });
  },

  // ── Upis na diplome ──────────────────────────────────────────────────

  /**
   * Gde se na diplomi šta upisuje.
   *
   * Podešavanje je osobina **blanko diplome, ne takmičenja**: isti tiraž se
   * troši godinama, pa se meri jednom i čuva za sve. Zapisuje se ceo, sa
   * podrazumevanim merama pod onim što nije upisano, da starije podešavanje
   * ne ostane bez reda koji je u međuvremenu dodat.
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

  // ── Kotizacije ───────────────────────────────────────────────────────

  /**
   * Iznosi kotizacija i pravilo o besplatnim disciplinama.
   *
   * Kao i mere za diplome, ovo je osobina **saveza, ne takmičenja**: cenovnik
   * se donosi jednom i važi dok se ne promeni.
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

  // ── Sezone i rang liste ──────────────────────────────────────────────

  /**
   * Sve sezone — otvorena prva, pa zatvorene od najskorije. Otvorena sezona
   * počinje tamo gde se prethodna završila; ako nijedna nije zatvorena,
   * počinje od najstarijeg takmičenja u bazi, jer bi svaki drugi datum
   * proizvoljno isekao istoriju koju urednik nije tražio da se iseče.
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
   * Zatvara sezonu i otvara sledeću od sutradan. Ime i oba datuma dolaze
   * spolja — urednik ih potvrđuje ili menja pri zatvaranju.
   *
   * Povratno je, kao i svaka druga promena stanja u aplikaciji: `reopenSeason`
   * vraća sezonu u rad. Ništa se pri zatvaranju ne prepisuje niti zamrzava,
   * pa ispravka koja stigne posle zatvaranja nije izgubljena — sezona se
   * otvori, ispravi i ponovo zatvori.
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

  /** Vraća poslednju zatvorenu sezonu u rad — otvorena sezona je opet spaja. */
  async reopenSeason(id) {
    const closed = await metaGet('seasons', []);
    const season = closed.find((x) => x.id === id) || closed[closed.length - 1];
    if (!season) return null;
    await metaSet('seasons', closed.filter((x) => x !== season));
    await metaSet('seasonStart', season.from);
    return season;
  },

  /**
   * Rang liste jedne sezone: jedna za klubove i po jedna za svaku uzrasnu
   * grupu podeljenu na muškarce i žene.
   *
   * Bodovi se sabiraju **po licu**, ne po nastupu: isti čovek na tri
   * takmičenja u sezoni je jedan red sa zbirom. Klub i uzrasna grupa se
   * uzimaju sa **poslednjeg** nastupa u sezoni, jer je to stanje sa kojim
   * sezonu završava; ako je usput promenio klub, red to i kaže.
   *
   * U listu ulaze svi koji su nastupali, i oni bez ijednog boda — lista je
   * ujedno i spisak svih koji su se te sezone takmičili u toj kategoriji.
   */
  async rankings(season) {
    const [competitions, competitors, entries, results, teams, register] = await Promise.all([
      all('competitions'), all('competitors'), all('entries'), all('results'),
      all('teams'), all('people'),
    ]);

    const inside = competitions.filter((c) => inSeason(c.date, season))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const ids = new Set(inside.map((c) => c.id));
    // Rang lista je zbir A liste. Takmičenje sa B liste ostaje u sezoni i
    // vidi se u kalendaru, ali nijedan njegov plasman ne pomera poredak.
    const scoring = new Set(inside.filter(pointsCounted).map((c) => c.id));
    const dateOf = new Map(inside.map((c) => [c.id, c.date || '']));

    const mine = competitors.filter((c) => ids.has(c.competitionId));
    const competitorById = new Map(mine.map((c) => [c.id, c]));
    const entryById = new Map(entries.filter((e) => ids.has(e.competitionId))
      .map((e) => [e.id, e]));
    const teamById = new Map(teams.filter((t) => ids.has(t.competitionId))
      .map((t) => [t.id, t]));
    const personByIdentity = new Map(register.map((p) => [p.identity, p]));

    const blank = () => ({ zlato: 0, srebro: 0, bronza: 0, ucesce: 0, medalje: 0, bodovi: 0 });
    const score = (row, placement, scores) => {
      row[placement] = (row[placement] || 0) + 1;
      if (placementByKey(placement)?.medal) row.medalje += 1;
      if (scores) row.bodovi += pointsFor(placement);
    };

    // ── Takmičari ──────────────────────────────────────────────────────
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
      // Poslednji nastup u sezoni nosi klub, pojas i grupu.
      const date = dateOf.get(c.competitionId) || '';
      if (date >= row.lastDate) {
        Object.assign(row, {
          lastDate: date, name: c.name, club: c.club, city: c.city,
          year: c.year, group: c.group, sex: c.sex, belt: c.belt,
        });
      }
    });

    // ── Klubovi ────────────────────────────────────────────────────────
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

      // Ekipni plasman: klub jednom, a svaki član pune bodove na svoj red.
      // Član koji te sezone nije nastupao pojedinačno dobija red ovde — u
      // rang listi mora da postoji, inače bi mu ekipni bodovi propali.
      const team = teamOf(r, teamById);
      if (team) {
        if (team.club) score(clubOf(team.club), r.placement, scores);
        teamMembersOf(team, personByIdentity).forEach((p) => {
          if (!people.has(p.id)) {
            const member = (team.members || []).find((m) =>
              identityOf({ ...m, club: team.club }) === p.identity) || {};
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
      // Medalja pripada klubu za koji se tog dana nastupalo, ne današnjem.
      const name = competitor?.club || entry?.club;
      if (name) score(clubOf(name), r.placement, scores);
    });

    const byScore = (a, b) => b.bodovi - a.bodovi || b.medalje - a.medalje
      || b.zlato - a.zlato || b.srebro - a.srebro
      || a.name.localeCompare(b.name, 'sr');

    /** Deljeno mesto: isti bodovi — isto mesto, pa preskok (1, 2, 2, 4). */
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

    // ── Po uzrasnoj grupi i polu ───────────────────────────────────────
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
      // Takmičenja koja bi nosila bodove da su zatvorena. Rang lista mora da
      // kaže da ih čeka — inače tiho prikazuje manje nego što stvarno jeste.
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
 * Lica bez ijednog nastupa — briše ih se posle brisanja takmičenja.
 * Nastup je i članstvo u ekipi: ko postoji samo kao član, postoji.
 */
async function pruneOrphanPeople() {
  const [people, competitors, teams] = await Promise.all([
    all('people'), all('competitors'), all('teams'),
  ]);
  const used = new Set(competitors.map((c) => c.personId));
  const memberIdentities = new Set(teams.flatMap((t) =>
    (t.members || []).map((m) => identityOf({ ...m, club: t.club }))));
  const orphans = people.filter((p) => !used.has(p.id) && !memberIdentities.has(p.identity));
  if (!orphans.length) return;
  await tx('people', 'readwrite', (os) => orphans.forEach((p) => os.delete(p.id)));
}
