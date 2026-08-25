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
  clubByName, groupOfYear, SEASON,
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
 * Šta čini isto lice na dva različita takmičenja. Broj licence je zvanična
 * identifikacija i ima prednost; bez njega se pada na ime + godište, što je
 * dovoljno dobro dok uvoz iz Excela ne donese licence.
 */
const identityOf = (person) => (person.licence
  ? `lic:${String(person.licence).trim().toUpperCase()}`
  : `nm:${String(person.name).trim().toLowerCase()}|${person.year}`);

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
      name: c.name, sex: c.sex, year: c.year, licence: c.licence,
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
      person = { id: newId(), identity, name: c.name, sex: c.sex, year: c.year, licence: c.licence };
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
        .then(openDb).then(seed).then(refreshDemo).then(linkPeople);
    }
    return readyPromise;
  },

  /** Da li baza nosi demo stariji od aplikacije, a korisnik već radi u njoj. */
  async demoIsStale() {
    const row = await tx('meta', 'readonly', (os) => wrap(os.get('demoStale')));
    return !!row;
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

    const club = payload.club;
    const city = payload.city || clubByName(club)?.city || '';
    const coach = payload.coach || clubByName(club)?.coach || '';

    const [people, mine, theirEntries, theirTeams] = await Promise.all([
      all('people'),
      allBy('competitors', 'competitionId', competitionId),
      allBy('entries', 'competitionId', competitionId),
      allBy('teams', 'competitionId', competitionId),
    ]);

    const byIdentity = new Map(people.map((p) => [p.identity, p]));
    const byPerson = new Map(mine.map((c) => [c.personId, c]));
    const hasEntry = new Set(theirEntries.map((e) => `${e.competitorId}|${e.discipline}`));

    const newPeople = [];
    const newCompetitors = [];
    const newEntries = [];
    let skipped = 0;

    (payload.competitors || []).forEach((c) => {
      const identity = identityOf(c);
      let person = byIdentity.get(identity);
      if (!person) {
        person = { id: newId(), identity, name: c.name, sex: c.sex, year: c.year, licence: null };
        byIdentity.set(identity, person);
        newPeople.push(person);
      }

      let competitor = byPerson.get(person.id);
      if (!competitor) {
        competitor = {
          id: newId(), competitionId, personId: person.id,
          name: c.name, sex: c.sex, year: c.year, group: c.group,
          club, city, coach, belt: c.belt, level: c.level,
          // Telesna težina je osobina takmičara, a klub je prijavljuje uz disciplinu
          // koja se po njoj deli — uzima se prva takva.
          weight: (c.disciplines || []).map((d) => d.weight).find(Boolean) || null,
        };
        byPerson.set(person.id, competitor);
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
          name: c.name, sex: c.sex, year: c.year, group: c.group,
          club, city, coach, belt: c.belt, level: c.level,
        });
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
      people: newPeople.length,
      competitors: newCompetitors.length,
      entries: newEntries.length,
      skipped,
      teams: newTeams.length,
      teamsSkipped,
    };
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
    const [results, competitions] = await Promise.all([all('results'), all('competitions')]);
    // Bodove nose samo takmičenja sa A liste. Medalja sa B liste je i dalje
    // medalja — broji se u kolonu, samo ne donosi bodove.
    const scoring = new Set(competitions.filter((c) => calendarOf(c) === 'A').map((c) => c.id));

    const blank = () => ({ zlato: 0, srebro: 0, bronza: 0, ucesce: 0, medalje: 0, bodovi: 0 });
    const add = (tally, placement, scores) => {
      tally[placement] = (tally[placement] || 0) + 1;
      if (placementByKey(placement)?.medal) tally.medalje += 1;
      if (scores) tally.bodovi += pointsFor(placement);
    };

    const map = new Map();
    results.forEach((r) => {
      if (!r.personId) return;
      if (!map.has(r.personId)) {
        map.set(r.personId, { here: blank(), total: blank(), competitions: new Set() });
      }
      const row = map.get(r.personId);
      const scores = scoring.has(r.competitionId);
      add(row.total, r.placement, scores);
      row.competitions.add(r.competitionId);
      if (r.competitionId === competitionId) add(row.here, r.placement, scores);
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
    const [competitors, entries, results, competitions] = await Promise.all([
      all('competitors'), all('entries'), all('results'), all('competitions'),
    ]);
    const scoring = new Set(competitions.filter((c) => calendarOf(c) === 'A').map((c) => c.id));

    const competitorById = new Map(competitors.map((c) => [c.id, c]));
    const entryById = new Map(entries.map((e) => [e.id, e]));

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

    results.forEach((r) => {
      const entry = entryById.get(r.entryId);
      const competitor = entry && competitorById.get(entry.competitorId);
      const name = competitor?.club || entry?.club;
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
    if (!competitionId) return { count: 2, blocks: {} };
    const row = await metaGet(`tatami:${competitionId}`, null);
    return { count: 2, blocks: {}, ...(row || {}) };
  },

  saveTatamiPlan(competitionId, plan) {
    return metaSet(`tatami:${competitionId}`, {
      count: plan.count,
      blocks: plan.blocks,
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
    const [competitions, competitors, entries, results] = await Promise.all([
      all('competitions'), all('competitors'), all('entries'), all('results'),
    ]);

    const inside = competitions.filter((c) => inSeason(c.date, season))
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const ids = new Set(inside.map((c) => c.id));
    // Rang lista je zbir A liste. Takmičenje sa B liste ostaje u sezoni i
    // vidi se u kalendaru, ali nijedan njegov plasman ne pomera poredak.
    const scoring = new Set(inside.filter((c) => calendarOf(c) === 'A').map((c) => c.id));
    const dateOf = new Map(inside.map((c) => [c.id, c.date || '']));

    const mine = competitors.filter((c) => ids.has(c.competitionId));
    const competitorById = new Map(mine.map((c) => [c.id, c]));
    const entryById = new Map(entries.filter((e) => ids.has(e.competitionId))
      .map((e) => [e.id, e]));

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
      const entry = entryById.get(r.entryId);
      const competitor = entry && competitorById.get(entry.competitorId);
      const person = r.personId && people.get(r.personId);
      const scores = scoring.has(r.competitionId);
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
      scoring: inside.filter((c) => calendarOf(c) === 'A'),
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

/** Lica bez ijednog nastupa — briše ih se posle brisanja takmičenja. */
async function pruneOrphanPeople() {
  const [people, competitors] = await Promise.all([all('people'), all('competitors')]);
  const used = new Set(competitors.map((c) => c.personId));
  const orphans = people.filter((p) => !used.has(p.id));
  if (!orphans.length) return;
  await tx('people', 'readwrite', (os) => orphans.forEach((p) => os.delete(p.id)));
}
