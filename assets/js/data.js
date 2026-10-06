/**
 * The rulebook and the demo registry.
 *
 * Everything the app derives comes from this module: the federation
 * letterhead, age groups, disciplines, levels, weight classes, placements
 * and points. The demo registry is deterministic — same seed, same rows
 * on every load — so the printed documents are reproducible.
 */

export const FEDERATION = {
  name: 'Fudokan savez Srbije',
  /** The federation office's seat — not the competition venue (that is
   *  the competition's own `place`, and changes every time). */
  subtitle: 'Fudokan Federation of Serbia · Leskovac',
  /**
   * Letterhead mark. The grb alone, not the full roundel: at the ~13 mm the
   * letterhead gives it, the roundel's "FUDOKAN SAVEZ SRBIJE" lettering
   * turns to mush — and the sheet already sets that name in type right
   * beside it. The full roundel is the app icon (assets/icons).
   */
  crest: { src: 'assets/img/fss-grb.png', alt: 'Grb Fudokan saveza Srbije' },
};

/**
 * Version of the demo registry. Bump it when buildRegistry() changes in a
 * way an old database cannot show — otherwise seed() only fills an empty
 * database, and whoever opened an old version keeps seeing old numbers.
 */
export const DEMO_VERSION = 6;

/**
 * App version, shown at the bottom of the navigation — the quickest way
 * to see whether the browser is serving the current build or a cached
 * one. Bumped together with CACHE in sw.js.
 */
export const APP_VERSION = 'v66';

export const SEED_COMPETITION = {
  name: 'Prvenstvo Srbije 2026',
  date: '2026-03-14',
  place: 'Hala Ranko Žeravica, Beograd',
  level: 'Državno prvenstvo',
  calendar: 'A',
  status: 'Prijave otvorene',
  entriesClosed: '12.03.2026. u 24:00',
  description: '',
};

/**
 * A finished competition also seeded on first run, with placements — so
 * the whole point of the running total, points across seasons, is
 * visible. Deleted like any other.
 */
export const PAST_COMPETITION = {
  name: 'Prvenstvo Srbije za mlađe uzraste 2025',
  date: '2025-10-18',
  place: 'Hala Čair, Niš',
  level: 'Državno prvenstvo',
  calendar: 'A',
  status: 'Završeno',
  entriesClosed: '16.10.2025. u 24:00',
  description: '',
};

/**
 * Dates are stored as ISO (2026-03-14) — they sort correctly and do not
 * depend on machine settings; screens and paper get the local form.
 */
export const dateLabel = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}.` : (iso || '');
};

/**
 * Placements and points. The scale is rulebook, not code — change it here
 * and everything derived follows.
 *
 * medal: true counts toward the medal column; participation carries
 * points but is not a medal. slots is how many times a placement may be
 * awarded in one category — bronze has two on purpose (repechage gives
 * two thirds); null means unlimited.
 */
export const PLACEMENTS = [
  { key: 'zlato',  label: 'Zlato',  short: 'Z', place: '1. mesto', medal: true,  points: 100, slots: 1 },
  { key: 'srebro', label: 'Srebro', short: 'S', place: '2. mesto', medal: true,  points: 75,  slots: 1 },
  { key: 'bronza', label: 'Bronza', short: 'B', place: '3. mesto', medal: true,  points: 50,  slots: 2 },
  { key: 'ucesce', label: 'Učešće', short: 'U', place: null,       medal: false, points: 25,  slots: null },
];

export const placementByKey = (key) => PLACEMENTS.find((p) => p.key === key) || null;

/**
 * How many times one placement may be awarded within a category; null
 * means unlimited. Disciplines that are scored or measured rather than
 * drawn (kihon u mestu, tamashiwari) carry openPlacements and have no
 * limit.
 */
export const placementSlots = (discipline, key) => {
  if (disciplineByName(discipline)?.openPlacements) return null;
  return placementByKey(key)?.slots ?? null;
};

/** Points for one placement. Unknown or missing carries nothing. */
export const pointsFor = (key) => placementByKey(key)?.points || 0;

/**
 * Writing on a pre-printed diploma.
 *
 * Diplomas are printed in advance with blank lines; the app only fills
 * them in. So what is described here is position, not looks: millimetres
 * from the top edge, left (−) or right (+) of centre, and type size in
 * points. The editor measures these once on their own diploma — these
 * are just starting values, and a test sheet with a ruler prints first.
 */
export const DIPLOMA_LINES = [
  { key: 'ime',        label: 'Ime i prezime', top: 108, x: 0,   size: 22, caps: true },
  { key: 'klub',       label: 'Klub',          top: 122, x: 0,   size: 12, caps: false },
  { key: 'mesto',      label: 'Mesto',         top: 142, x: -38, size: 13, caps: false },
  { key: 'disciplina', label: 'Disciplina',    top: 142, x: 22,  size: 13, caps: false },
  { key: 'kategorija', label: 'Kategorija',    top: 154, x: 0,   size: 11, caps: false },
];

export const DIPLOMA_DEFAULT = {
  orientation: 'portrait',
  lines: DIPLOMA_LINES.reduce((acc, line) => ({
    ...acc,
    [line.key]: { on: true, top: line.top, x: line.x, size: line.size },
  }), {}),
};

/**
 * Entry fees. A club pays per entry, not per competitor: three
 * disciplines, three fees. A team pays as a whole; enbu has its own price.
 *
 * Older groups get the first free.count disciplines free (free.groups) —
 * but tamashiwari and tsumeai are always paid, as is every team entry.
 * Amounts start at zero on purpose: until they are set in Podešavanja,
 * the fee sheet says so.
 */
export const FEES_DEFAULT = {
  individual: 0,
  team: 0,
  enbu: 0,
  coachRefund: 0,
  free: {
    count: 3,
    groups: 'HIJ',
    always: ['Tamashiwari', 'Tsumeai'],
  },
};

/** "1.500 din" — dinars, no decimals, local thousands format. */
export const money = (amount) =>
  `${new Intl.NumberFormat('sr-RS').format(Math.round(amount || 0))} din`;

/**
 * How many fees one competitor owes, and how many are waived.
 *
 * @param {Array} entries the competitor's individual entries
 * @param {object} fees   fee settings
 */
export function feeCountFor(entries, fees) {
  const rule = fees?.free || FEES_DEFAULT.free;
  const always = new Set(rule.always || []);
  const group = entries[0]?.group || '';
  const oprostivo = entries.filter((e) => !always.has(e.discipline)).length;
  const free = (rule.groups || '').indexOf(group) >= 0
    ? Math.min(rule.count || 0, oprostivo)
    : 0;
  return { entries: entries.length, free, paid: entries.length - free };
}

/** Team fee: enbu has its own price, other teams share one. */
export const teamFeeOf = (team, fees) =>
  (team?.discipline === 'Enbu' ? (fees?.enbu || 0) : (fees?.team || 0));

/** Competition levels — picked when creating a new one. */
export const COMPETITION_LEVELS = [
  'Državno prvenstvo',
  'Kup Srbije',
  'Regionalno takmičenje',
  'Klupski turnir',
  'Međunarodno',
];

/**
 * A and B calendars. A-list competitions count toward ranking points;
 * B-list ones (tournaments, memorials) are recorded but move nothing.
 * A B-list placement is still a placement and a medal still a medal —
 * only the points do not flow, so this is a condition when summing,
 * never a deletion.
 */
export const CALENDARS = [
  { key: 'A', label: 'A lista', note: 'ulazi u bodovanje', scores: true },
  { key: 'B', label: 'B lista', note: 'ne ulazi u bodovanje', scores: false },
];

/** A competition with no calendar counts as A — as before the lists. */
export const calendarOf = (competition) =>
  (competition?.calendar === 'B' ? 'B' : 'A');

/**
 * Whether points from a competition flow into the permanent record: it
 * must be A-list and closed. While it runs, placements and medals are
 * recorded, but points wait — everything can still be corrected until
 * the last category. Closing the competition is the moment of booking.
 */
export const pointsCounted = (competition) =>
  calendarOf(competition) === 'A' && competition?.status === 'Završeno';

/**
 * While entries are open the competitor list can change; from "Prijave
 * zatvorene" on it is frozen, so what is printed and what is in the
 * database are the same thing. Reopening entries unlocks it again.
 */
export const ENTRIES_OPEN = ['Nacrt', 'Prijave otvorene'];
export const entriesOpen = (competition) =>
  ENTRIES_OPEN.indexOf(competition?.status || 'Nacrt') >= 0;

export const MONTHS = [
  'januar', 'februar', 'mart', 'april', 'maj', 'jun',
  'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar',
];

/** States a competition passes through. A new one starts as a draft. */
export const COMPETITION_STATUSES = ['Nacrt', 'Prijave otvorene', 'Prijave zatvorene', 'Završeno'];

/**
 * Age groups.
 *
 * The codes are the federation's A–J sequence, stored in Latin because
 * Barlow carries no Cyrillic — on paper those capitals would fall back to
 * a system font twice as wide.
 *
 * Groups are tied to age, not to birth years. The official table is
 * written in years ("2019 and younger"), but it shifts by one every
 * season; the age is what stays. Birth years are computed per season, so
 * the table is never retyped — and the season is the competition's year,
 * not today's date, so old results never move category at New Year.
 */
export const AGES = [
  { code: 'A', name: 'Poletarci',       from: 0,  to: 7 },
  { code: 'B', name: 'Mlađi pioniri',   from: 8,  to: 9 },
  { code: 'C', name: 'Pioniri',         from: 10, to: 11 },
  { code: 'D', name: 'Stariji pioniri', from: 12, to: 13 },
  { code: 'E', name: 'Kadeti',          from: 14, to: 15 },
  { code: 'F', name: 'Juniori',         from: 16, to: 18 },
  { code: 'G', name: 'Omladinci',       from: 19, to: 20 },
  { code: 'H', name: 'Mlađi seniori',   from: 21, to: 34 },
  { code: 'I', name: 'Stariji seniori', from: 35, to: 49 },
  { code: 'J', name: 'Veterani',        from: 50, to: 120 },
];

/** The current competition year — the season when none is given. */
export const SEASON = () => new Date().getFullYear();

/** The competition's year; falls back to the current one. */
export const seasonOf = (competition) =>
  Number(String(competition?.date || '').slice(0, 4)) || SEASON();

/** Birth years a group covers in a season — youngest and oldest. */
export const yearsOf = (age, season = SEASON()) => ({
  najmladje: season - age.from,
  najstarije: season - age.to,
});

/** "2019. i mlađi", "2018/2017", "2010–2008", "1976. i stariji". */
export function yearsLabel(age, season = SEASON()) {
  const { najmladje, najstarije } = yearsOf(age, season);
  // An open-ended group is written by its one real boundary: poletarci
  // by the oldest year they accept, veterans by the youngest.
  if (age.from === 0) return `${najstarije}. i mlađi`;
  if (age.to >= 100) return `${najmladje}. i stariji`;
  if (najmladje - najstarije === 1) return `${najmladje}/${najstarije}`;
  return `${najmladje}–${najstarije}`;
}

/**
 * The discipline matrix — the only source of truth for what may be
 * entered. Copied from the federation's official table for season 2026.
 * Veterans (J) have no team disciplines, as the table's header says.
 *
 * Traditional disciplines carry no marker; Fudokan sport ones carry
 * style: 'sport'. Easy to miss: traditional kumite has no weight classes
 * (open category), sport kumite does — which is why drawBy sits on the
 * discipline instead of a name-based rule.
 *
 * ADDING A DISCIPLINE: append one object; dashboards, checks, filters
 * and printed lists pick it up on their own.
 *
 *   name    — as written on official lists; must be unique
 *   kind    — 'P' individual, 'E' team, 'P/E' both
 *   system  — competition system, printed under the category list
 *   drawBy  — what splits categories within group and sex: 'weight',
 *             'level', 'variant', or null (the whole group is one)
 *   style   — 'sport' for Fudokan sport disciplines
 *   team    — { min, max } members for team disciplines
 *   variants— team variants that compete separately; pattern is the
 *             sex make-up (enbu: men's pair and mixed pair)
 *   groups  — AGES codes the discipline is open to
 *   order   — order on lists and in menus
 *   note    — an extra rulebook restriction, if any
 *
 * AGES and WEIGHTS are rulebook too, not code. The Podešavanja screen is
 * where this should one day be edited from the app.
 */
export const DISCIPLINES = [
  // === Traditional =============================================
  { name: 'Kate',                 kind: 'P/E', system: 'Eliminacija po nivoima',   drawBy: 'level',  groups: 'ABCDEFGHIJ', order: 1 },
  { name: 'Kihon u mestu',        kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'A',          order: 2, note: 'samo 9. i 8. kyu', openPlacements: true },
  { name: 'Kihon kumite',         kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'ABCD',       order: 3 },
  { name: 'Kihon ippon kumite',   kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'AB',         order: 4 },
  { name: 'Jiu ippon kumite',     kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'CD',         order: 5 },
  { name: 'Jiu ippon kumite tim', kind: 'E',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'CD',         order: 6, team: { min: 3, max: 4 } },
  // Enbu is a pair, and really two competitions: men's and mixed.
  { name: 'Enbu',                 kind: 'E',   system: 'Bodovanje (flag system)',  drawBy: 'variant', groups: 'ABCDEFGHI', order: 7,
    team: { min: 2, max: 2 },
    variants: [
      { key: 'M-M', label: 'muški par',    pattern: ['M', 'M'] },
      { key: 'M-F', label: 'mešoviti par', pattern: ['M', 'Ž'] },
    ] },
  { name: 'Ko go kumite',         kind: 'P',   system: 'Direktna eliminacija',     drawBy: null,     groups: 'EF',         order: 8 },
  { name: 'Ko go kumite tim',     kind: 'E',   system: 'Direktna eliminacija',     drawBy: null,     groups: 'EF',         order: 9, team: { min: 3, max: 4 } },
  { name: 'Fuku go',              kind: 'P',   system: 'Kombinovano bodovanje',    drawBy: null,     groups: 'EFGHIJ',     order: 10 },
  // Traditional kumite is an open category — no weight classes.
  { name: 'Kumite',               kind: 'P',   system: 'Eliminacija sa repasažom', drawBy: null,     groups: 'GHIJ',       order: 11 },
  { name: 'Kumite tim',           kind: 'E',   system: 'Eliminacija sa repasažom', drawBy: null,     groups: 'GHI',        order: 12, team: { min: 3, max: 4 } },
  { name: 'Tsumeai',              kind: 'P',   system: 'Direktna eliminacija',     drawBy: null,     groups: 'HIJ',        order: 13 },
  { name: 'Tamashiwari',          kind: 'P',   system: 'Bodovanje (merenje)',      drawBy: null,     groups: 'GHIJ',       order: 14, openPlacements: true },
  { name: 'Kobudo',               kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'FGHIJ',      order: 15 },

  // === Fudokan sport =============================================
  { name: 'Fudokan sport kate',       kind: 'P', style: 'sport', system: 'Eliminacija po nivoima',   drawBy: 'level',  groups: 'ABCDEFGHIJ', order: 20 },
  { name: 'Fudokan sport kumite',     kind: 'P', style: 'sport', system: 'Eliminacija sa repasažom', drawBy: 'weight', groups: 'ABCDEFGHIJ', order: 21 },
  { name: 'Fudokan sport kata tim',   kind: 'E', style: 'sport', system: 'Eliminacija po nivoima',   drawBy: null,     groups: 'ABCDEFGHI',  order: 22, team: { min: 3, max: 3 } },
  { name: 'Fudokan sport kumite tim', kind: 'E', style: 'sport', system: 'Eliminacija sa repasažom', drawBy: null,     groups: 'ABCDEFGHI',  order: 23, team: { min: 3, max: 4 } },
];

/** Fudokan sport disciplines; traditional ones carry no marker. */
export const isSport = (discipline) => discipline?.style === 'sport';

/** Team disciplines carry `team`; individual ones do not. */
export const isTeamDiscipline = (discipline) => !!discipline?.team;

/** "3 takmičara" or "3–4 takmičara" — team size, for lists. */
export const teamSizeLabel = (discipline) => {
  const t = discipline?.team;
  if (!t) return '';
  if (t.min === 2 && t.max === 2) return 'par';
  return t.min === t.max ? `${t.min} takmičara` : `${t.min}–${t.max} takmičara`;
};

/**
 * Team variants that compete separately. A discipline without explicit
 * variants gets the default two, men's and women's. Enbu has its own:
 * men's pair and mixed pair — and a mixed pair has no sex, so its
 * category splits by variant instead.
 */
export const teamVariants = (discipline) => discipline?.variants || [
  { key: 'M', label: 'muškarci', sex: 'M' },
  { key: 'Ž', label: 'žene', sex: 'Ž' },
];

/** "Grupa C · pioniri · mešoviti par" — one team's category. */
export const teamCategoryLabel = (team) => {
  const age = ageByCode(team.group);
  return [`Grupa ${team.group}`, age ? age.name.toLowerCase() : null, team.variantLabel]
    .filter(Boolean).join(' · ');
};

export const BELTS = ['beli', 'žuti', 'oranž', 'zeleni', 'plavi', 'braon', 'crni'];

export const LEVELS = [
  { level: '0. nivo', belts: ['beli'] },
  { level: '1. nivo', belts: ['žuti', 'oranž'] },
  { level: '2. nivo', belts: ['zeleni', 'plavi'] },
  { level: '3. nivo', belts: ['braon', 'crni'] },
];

/** Weight classes and bout length per age group. */
export const WEIGHTS = {
  'A': { M: ['30', '40', '+40'], 'Ž': ['30', '35', '+35'], bout: '60 s' },
  'B': { M: ['35', '40', '+40'], 'Ž': ['35', '40', '+40'], bout: '60 s' },
  'C': { M: ['35', '45', '+45'], 'Ž': ['37', '42', '+42'], bout: '60 s' },
  'D': { M: ['45', '55', '+55'], 'Ž': ['42', '53', '+53'], bout: '90 s' },
  'E': { M: ['57', '70', '+70'], 'Ž': ['47', '54', '+54'], bout: '120 s' },
  'F': { M: ['68', '76', '+76'], 'Ž': ['53', '59', '+59'], bout: '120 s' },
  'G': { M: ['75', '84', '+84'], 'Ž': ['61', '68', '+68'], bout: '120 s' },
  'H': { M: ['apsolutna'], 'Ž': ['apsolutna'], bout: '120 s' },
  'I': { M: ['apsolutna'], 'Ž': ['apsolutna'], bout: '120 s' },
  'J': { M: ['apsolutna'], 'Ž': ['apsolutna'], bout: '120 s' },
};

export const CLUBS = [
  { name: 'KK Fudokan Beograd', city: 'Beograd',    coach: 'Nenad Ilić' },
  { name: 'KK Vojvodina',       city: 'Novi Sad',   coach: 'Marko Savić' },
  { name: 'KK Zemun',           city: 'Beograd',    coach: 'Dejan Radić' },
  { name: 'KK Niš',             city: 'Niš',        coach: 'Slobodan Tomić' },
  { name: 'KK Vračar',          city: 'Beograd',    coach: 'Jelena Perić' },
  { name: 'KK Kragujevac',      city: 'Kragujevac', coach: 'Boris Lukić' },
  { name: 'KK Subotica',        city: 'Subotica',   coach: 'Attila Horvat' },
  { name: 'KK Čačak',           city: 'Čačak',      coach: 'Vladimir Mitić' },
  { name: 'KK Zvezdara',        city: 'Beograd',    coach: 'Goran Simić' },
  { name: 'KK Sombor',          city: 'Sombor',     coach: 'Petar Kovač' },
  { name: 'KK Užice',           city: 'Užice',      coach: 'Radovan Đukić' },
  { name: 'KK Leskovac',        city: 'Leskovac',   coach: 'Zoran Stojanović' },
  { name: 'KK Banatski cvet',   city: 'Zrenjanin',  coach: 'Nikola Vukelić' },
];

/** The club whose entry form the "Prijava kluba" document is printed for. */
export const HOME_CLUB = 'KK Banatski cvet';

// === Lookups =============================================

export const ageByCode = (code) => AGES.find((a) => a.code === code) || null;
export const clubByName = (name) => CLUBS.find((c) => c.name === name) || null;
export const disciplineByName = (name) => DISCIPLINES.find((d) => d.name === name) || null;

/** The age group a birth year falls into. */
export const groupOfYear = (year, season = SEASON()) => {
  const uzrast = season - year;
  const age = AGES.find((a) => uzrast >= a.from && uzrast <= a.to);
  return age ? age.code : '';
};

/** Nivo (0–3) for a belt — Kate is drawn by level, not by belt. */
export const levelOfBelt = (belt) => {
  const lvl = LEVELS.find((l) => l.belts.includes(belt));
  return lvl ? lvl.level : '';
};

/** Disciplines an age group may enter. */
export const disciplinesForGroup = (code) =>
  DISCIPLINES.filter((d) => d.groups.indexOf(code) >= 0);

/**
 * A name written the way names are written, however it was typed:
 * "MARKO MARKOVIĆ" and "marko marković" both become "Marko Marković",
 * hyphenated surnames included. toLocaleUpperCase('sr') keeps "đ" → "Đ"
 * correct, and only the first letter is raised ("njegoš" → "Njegoš").
 *
 * This does not deduplicate — identity compares in lower case anyway.
 * It fixes how the name reads on a list, a diploma and a bill.
 */
export const properName = (value) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('sr')
  .replace(/(^|[\s'\u2019-])(\p{L})/gu,
    (match, before, letter) => before + letter.toLocaleUpperCase('sr'));

/** Serbian-aware surname sort key (entries print "po klubu, pa po prezimenu"). */
export const surnameOf = (fullName) => fullName.slice(fullName.lastIndexOf(' ') + 1);

/**
 * The category an entry is drawn in — split by the discipline's drawBy:
 * weight, belt level, or nothing. This is what counts as "a category"
 * everywhere, on screen and on paper. Read from the rulebook, not the
 * discipline name, because the two kumites split differently.
 */
export const categoryKey = (e) => {
  const drawBy = disciplineByName(e.discipline)?.drawBy;
  if (drawBy === 'weight') return `${e.discipline}|${e.group}|${e.sex}|${e.weight}`;
  if (drawBy === 'level') return `${e.discipline}|${e.group}|${e.sex}|${e.level}`;
  return `${e.discipline}|${e.group}|${e.sex}`;
};

// === FSS ID =============================================

/*
 * The federation's yearly competitor number: FSS-125/26 is competitor 125
 * of 2026. A person gets one number per calendar year — the year of the
 * competition, not the ranking season — and a new one every year; last
 * year's stays on the record as history. Only the app hands numbers out,
 * never a club, and a number given once is never given again that year,
 * not even after the person is deleted.
 *
 * Stored on the person as the IDs themselves (fssIds: ['FSS-81/25',
 * 'FSS-125/26']): the year is part of the ID, so the list is the history,
 * and the database can index it to keep every ID unique.
 */

/** The first year numbers are handed out; older competitions keep none. */
export const FSS_ID_SINCE = 2026;

/** FSS-125/26 for number 125 in 2026. */
export const fssId = (year, number) => `FSS-${number}/${String(year % 100).padStart(2, '0')}`;

/**
 * Reads an ID as somebody typed it: "FSS-125/26", in any case, spaces
 * around it allowed. FSS-0/26, FSS-A/26, FSS-10 and 10/26 are not IDs.
 * Returns the ID written the one way the app writes it, plus its number
 * and year.
 */
export function parseFssId(value) {
  const m = /^FSS-\s*(\d+)\s*\/(\d{2})$/i.exec(String(value ?? '').trim());
  if (!m || Number(m[1]) < 1) return null;
  const year = 2000 + Number(m[2]);
  return { id: fssId(year, Number(m[1])), number: Number(m[1]), year };
}

/** The person's ID for one year, or null. */
export const fssIdOf = (person, year) =>
  (person?.fssIds || []).find((id) => parseFssId(id)?.year === year) || null;

/** A person's IDs, newest year first: [{ year: 2027, id: 'FSS-37/27' }, …]. */
export const fssHistory = (person) => (person?.fssIds || [])
  .map((id) => ({ id, year: parseFssId(id)?.year || 0 }))
  .sort((a, b) => b.year - a.year);

/**
 * The next number for a year: one above the highest ever handed out —
 * not the number of people, and never a gap a deleted person left.
 * `top` is the remembered highest, which outlives deletions; the IDs are
 * checked as well, so a lost counter still cannot repeat a number.
 */
export function nextFssNumber(ids, year, top = 0) {
  let highest = top;
  for (const id of ids) {
    const parsed = parseFssId(id);
    if (parsed && parsed.year === year) highest = Math.max(highest, parsed.number);
  }
  return highest + 1;
}

/**
 * Two spellings of one name compare equal: lower case, no diacritics,
 * letters only — "Petrovic" and "Petrović" match, "Marko Petrović" and
 * "Petar Petrović" do not.
 */
export const nameKey = (value) => String(value ?? '').toLocaleLowerCase('sr')
  .replace(/đ/g, 'dj')
  .normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^\p{L}]/gu, '');

/**
 * What an ID written on a form says about its row. The ID names a person
 * only when it agrees with the row's name and birth year — a mistyped
 * number must not move entries and points onto somebody else.
 *
 *   none      no ID on the row
 *   invalid   not an ID at all — ignored, the row is matched by name
 *   unknown   nobody has this ID — ignored the same way
 *   conflict  the ID belongs to somebody else — the row is not imported
 *   match     the ID's owner is this row; `old` when the ID is from
 *             another year (a club writes last year's until it has the
 *             new one), `current` is the owner's ID for this year, if any
 *
 * @param {{fss: string, name: string, year: number}} row
 * @param {number} year       the competition's year
 * @param {Function} ownerOf  ID → person, or null
 */
export function fssVerdict(row, year, ownerOf) {
  const typed = String(row.fss ?? '').trim();
  if (!typed) return { status: 'none' };
  const parsed = parseFssId(typed);
  if (!parsed) return { status: 'invalid', typed };
  const person = ownerOf(parsed.id);
  if (!person) return { status: 'unknown', id: parsed.id };
  if (nameKey(person.name) !== nameKey(row.name) || Number(person.year) !== Number(row.year)) {
    return { status: 'conflict', id: parsed.id, person };
  }
  return {
    status: 'match', id: parsed.id, person,
    old: parsed.year !== year, from: parsed.year, current: fssIdOf(person, year),
  };
}

// === Demo registry =============================================

/** Deterministic LCG — the printed documents must not change between loads. */
function seeded(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return {
    next,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
  };
}

/**
 * A demo competitor's birth year. Edge groups are open on one side, so
 * the sample narrows them to a lifelike range instead of the table's
 * boundary.
 */
const sampleYears = (age, season = SEASON()) => {
  const { najmladje, najstarije } = yearsOf(age, season);
  return [Math.max(najstarije, season - 70), najmladje];
};

const FIRST_M = ['Miloš', 'Nikola', 'Stefan', 'Luka', 'Marko', 'Vuk', 'Filip', 'Đorđe', 'Petar', 'Lazar', 'Aleksa', 'Uroš', 'Nemanja', 'Dušan', 'Andrej', 'Mihajlo'];
const FIRST_F = ['Ana', 'Jovana', 'Milica', 'Teodora', 'Sara', 'Anđela', 'Katarina', 'Nina', 'Iva', 'Mila', 'Dunja', 'Lena', 'Tijana', 'Nevena', 'Sofija'];
const LAST = ['Jovanović', 'Petrović', 'Nikolić', 'Stanković', 'Ilić', 'Marković', 'Đorđević', 'Pavlović', 'Popović', 'Lukić', 'Savić', 'Radić', 'Tomić', 'Mitić', 'Vasić', 'Kostić', 'Milošević', 'Ristić'];


/**
 * Belt levels that realistically appear in each age group — no white
 * belts among seniors, no black among poletarci. Two levels per group
 * keep every kata category filled and the head count lifelike.
 */
const LEVELS_BY_GROUP = {
  A: ['0. nivo', '1. nivo'],
  B: ['0. nivo', '1. nivo'],
  C: ['1. nivo', '2. nivo'],
  D: ['1. nivo', '2. nivo'],
  E: ['1. nivo', '2. nivo'],
  F: ['2. nivo', '3. nivo'],
  G: ['2. nivo', '3. nivo'],
  H: ['2. nivo', '3. nivo'],
  I: ['2. nivo', '3. nivo'],
  J: ['2. nivo', '3. nivo'],
};

/** Belts representing a level — kata is drawn by level, not belt. */
const BELT_FOR_LEVEL = {
  '0. nivo': ['beli'],
  '1. nivo': ['žuti', 'oranž'],
  '2. nivo': ['zeleni', 'plavi'],
  '3. nivo': ['braon', 'crni'],
};

/** Team numbers are written in roman — "KK Niš II", as on the diploma. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * The name a team competes under. A team has no name of its own — it
 * carries the club's, with a roman numeral when the club enters more
 * than one team in the same category (discipline + group + variant).
 */
export function labelTeams(teams) {
  const counts = new Map();
  const key = (t) => `${t.discipline}|${t.group}|${t.variant || t.sex}|${t.club}`;
  teams.forEach((t) => counts.set(key(t), (counts.get(key(t)) || 0) + 1));

  const seen = new Map();
  teams.forEach((t) => {
    const k = key(t);
    if (counts.get(k) === 1) { t.label = t.club; return; }
    const n = (seen.get(k) || 0) + 1;
    seen.set(k, n);
    t.label = `${t.club} ${ROMAN[n - 1] || n}`;
  });
  return teams;
}

/**
 * The demo entry registry for one championship.
 *
 * Built from categories down, not from people up: first the list of
 * categories the rulebook allows, then each filled with 10–15
 * competitors — so no category ends up with two entrants. People are
 * reused across disciplines, so 1500 entries fit in about 500 people,
 * as in real life.
 *
 * @returns {{competitors: Array, entries: Array, teams: Array}}
 */
export function buildRegistry(seed = 7) {
  const rng = seeded(seed);
  const competitors = [];
  const entries = [];

  /** How many entries go into one category. */
  const target = () => rng.int(10, 15);

  const makeCompetitor = (sex, group, level, weight) => {
    const age = ageByCode(group);
    const club = rng.pick(CLUBS);
    const first = sex === 'M' ? rng.pick(FIRST_M) : rng.pick(FIRST_F);
    const c = {
      id: competitors.length + 1,
      name: `${first} ${rng.pick(LAST)}`,
      sex,
      year: rng.int(...sampleYears(age)),
      group,
      club: club.name,
      city: club.city,
      coach: club.coach,
      belt: rng.pick(BELT_FOR_LEVEL[level]),
      level,
      // Weight belongs to the competitor, not the entry: one person
      // cannot appear in two weight classes.
      weight,
      disciplines: new Set(),
    };
    competitors.push(c);
    return c;
  };

  const enter = (competitor, discipline, weight = null) => {
    competitor.disciplines.add(discipline);
    entries.push({
      id: entries.length + 1,
      competitor,
      discipline,
      weight,
      // Denormalised for the table renderers — one flat row per prijava.
      name: competitor.name,
      sex: competitor.sex,
      year: competitor.year,
      group: competitor.group,
      club: competitor.club,
      city: competitor.city,
      coach: competitor.coach,
      belt: competitor.belt,
      level: competitor.level,
    });
  };

  AGES.forEach((age) => {
    ['M', 'Ž'].forEach((sex) => {
      const allowed = disciplinesForGroup(age.code);
      if (!allowed.length) return;

      const levels = LEVELS_BY_GROUP[age.code];
      const weights = WEIGHTS[age.code][sex];
      const pool = [];

      /**
       * Fills one category. `matches` is the condition a competitor must
       * meet (level for kata, weight for kumite); `make` creates a new
       * one when there are not enough.
       */
      const fill = (discipline, weight, matches, make) => {
        const want = target();
        // The one with the fewest entries so far goes first — otherwise
        // a handful of early competitors would collect every discipline.
        const free = pool
          .filter((c) => matches(c) && !c.disciplines.has(discipline))
          .sort((a, b) => a.disciplines.size - b.disciplines.size || a.id - b.id);
        for (let i = 0; i < want; i++) {
          const competitor = i < free.length ? free[i] : pool[pool.push(make()) - 1];
          enter(competitor, discipline, weight);
        }
      };

      // Level-drawn disciplines go first — they create competitors with
      // a set level, and every other entry builds on them.
      const byLevel = allowed.filter((d) => d.drawBy === 'level');
      const rest = allowed.filter((d) => d.drawBy !== 'level');

      byLevel.forEach((discipline) => {
        levels.forEach((level) => {
          fill(discipline.name, null, (c) => c.level === level,
            () => makeCompetitor(sex, age.code, level, rng.pick(weights)));
        });
      });

      rest.forEach((discipline) => {
        // Team disciplines have no individual entries — the team enters.
        if (discipline.team) return;
        if (discipline.drawBy === 'weight') {
          weights.forEach((weight) => {
            fill(discipline.name, weight, (c) => c.weight === weight,
              () => makeCompetitor(sex, age.code, rng.pick(levels), weight));
          });
        } else {
          fill(discipline.name, null, () => true,
            () => makeCompetitor(sex, age.code, rng.pick(levels), rng.pick(weights)));
        }
      });
    });
  });

  // The working discipline set served the filling; a Set survives
  // neither cloning nor a database write, so it goes.
  competitors.forEach((c) => { delete c.disciplines; });

  // === Teams =============================================
  //
  // The team is the entrant. Members come from already-created
  // competitors of the same club and age group. Teams are built per
  // variant (teamVariants), not per sex — enbu's mixed pair has a
  // variant instead of a sex.
  const teams = [];
  const teamDisciplines = DISCIPLINES.filter((d) => d.team);

  /**
   * Picks a team from one club. `pattern` demands exact sexes (men's
   * pair, mixed pair); without it, the size in one sex. Names must
   * differ — two same names on a list read as a typing error.
   */
  const pickTeam = (mates, size, variant, taken) => {
    const used = new Set();
    const take = (sex) => mates.find((c) => !taken.has(c.id) && !used.has(c.name)
      && (!sex || c.sex === sex) && used.add(c.name) && true);

    const wanted = variant.pattern || new Array(size).fill(variant.sex);
    const members = [];
    for (const sex of wanted) {
      const found = take(sex);
      if (!found) return null;
      members.push(found);
    }
    return members;
  };

  AGES.forEach((age) => {
    const inGroup = competitors.filter((c) => c.group === age.code);
    if (!inGroup.length) return;

    const byClub = new Map();
    inGroup.forEach((c) => {
      if (!byClub.has(c.club)) byClub.set(c.club, []);
      byClub.get(c.club).push(c);
    });

    teamDisciplines.forEach((discipline) => {
      if (discipline.groups.indexOf(age.code) < 0) return;
      // Whoever is already in a team of this discipline enters no other
      // — enbu has men's and mixed pairs, one person competes in one.
      const takenIn = new Map();
      const takenFor = (club) => {
        if (!takenIn.has(club)) takenIn.set(club, new Set());
        return takenIn.get(club);
      };

      teamVariants(discipline).forEach((variant) => {
        [...byClub.values()].forEach((mates) => {
          // Not every club enters a team in every category.
          if (rng.next() > 0.4) return;
          // A strong club may enter a second team in the same category.
          const taken = takenFor(mates[0].club);
          const howMany = rng.next() < 0.25 ? 2 : 1;
          for (let n = 0; n < howMany; n++) {
            const size = rng.int(discipline.team.min, discipline.team.max);
            const members = pickTeam(mates, size, variant, taken);
            if (!members) break;
            members.forEach((c) => taken.add(c.id));
            teams.push({
              id: teams.length + 1,
              discipline: discipline.name,
              group: age.code,
              // A mixed pair has no sex — the variant defines it.
              sex: variant.sex || '',
              variant: variant.key,
              variantLabel: variant.label,
              club: members[0].club,
              city: members[0].city,
              coach: members[0].coach,
              members: members.map((c) => ({ name: c.name, year: c.year, belt: c.belt, sex: c.sex })),
            });
          }
        });
      });
    });
  });

  labelTeams(teams);
  return { competitors, entries, teams };
}
