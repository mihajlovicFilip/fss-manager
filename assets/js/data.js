/**
 * Domain model for the Fudokan savez Srbije TMS.
 *
 * Everything the official documents print is derived from this module:
 * the federation letterhead, the competition being documented, the
 * age-group / discipline / level / weight matrices, and the entry
 * registry itself.
 *
 * The registry below is a deterministic demo dataset — same seed, same
 * rows on every load, so the printed documents are reproducible. Replace
 * `buildRegistry` with a fetch from the TMS backend and nothing else in
 * this module or in documents.js has to change: the documents only ever
 * read `competitors`, `entries` and `teams`.
 */

export const FEDERATION = {
  name: 'Fudokan savez Srbije',
  /** Sedište kancelarije saveza — ne mesto održavanja takmičenja (to je
   *  COMPETITION.place, i menja se od takmičenja do takmičenja). */
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
 * Takmičenje kojim se baza puni pri prvom pokretanju. Od tog trenutka
 * takmičenja žive u bazi (store.js) i menjaju se iz aplikacije — ovo je samo
 * seme, da ekran nikad ne krene prazan.
 */
/**
 * Verzija demo registra. Podiže se kad se `buildRegistry()` promeni tako da
 * stara baza više ne prikazuje ono što aplikacija sad ume — a to se dešava
 * pri svakoj izmeni obima ili oblika demo podataka.
 *
 * Bez ovoga aplikacija ćuti: `seed()` puni bazu samo kad je prazna, pa ko je
 * jednom otvorio staru verziju zauvek gleda stare brojke i s pravom pita
 * „gde su novi takmičari".
 */
export const DEMO_VERSION = 6;

/**
 * Verzija aplikacije, ispisana u dnu navigacije.
 *
 * Postoji zbog jednog konkretnog gubljenja vremena: kad se folder osveži a
 * pregledač i dalje služi staru verziju iz keša, sa ekrana se to ne vidi —
 * brojke izgledaju „pogrešno" a niko ne zna gleda li novo ili staro. Ovako
 * se pogleda dno navigacije i odmah zna. Podiže se zajedno sa `CACHE` u
 * sw.js.
 */
export const APP_VERSION = 'v63';

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
 * Odigrano takmičenje kojim se baza takođe puni pri prvom pokretanju, sa
 * upisanim plasmanima. Bez njega se ne bi videlo ono zbog čega ukupan zbir
 * bodova i postoji — sabiranje kroz sezone. Briše se kao i svako drugo.
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
 * Datumi se čuvaju kao ISO (2026-03-14) jer se tako sortiraju i ne zavise od
 * podešavanja računara; na ekran i na papir idu u domaćem obliku.
 */
export const dateLabel = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}.` : (iso || '');
};

/**
 * Plasmani i bodovi. Bodovna skala je pravilnik, ne kod — menja se ovde na
 * jednom mestu i sve što je izračunato iz nje se povuče za njom (bodovi po
 * takmičenju, ukupan zbir, rang lista kad dođe na red).
 *
 * `medal: true` znači da se plasman broji u medalje; učešće nosi bodove ali
 * nije medalja.
 *
 * `slots` je koliko puta plasman sme da se dodeli u jednoj kategoriji.
 * **Bronzi su dva mesta** — repasaž daje dva treća, i to nije greška nego
 * pravilo. `null` znači bez ograničenja (učešće).
 */
export const PLACEMENTS = [
  { key: 'zlato',  label: 'Zlato',  short: 'Z', place: '1. mesto', medal: true,  points: 100, slots: 1 },
  { key: 'srebro', label: 'Srebro', short: 'S', place: '2. mesto', medal: true,  points: 75,  slots: 1 },
  { key: 'bronza', label: 'Bronza', short: 'B', place: '3. mesto', medal: true,  points: 50,  slots: 2 },
  { key: 'ucesce', label: 'Učešće', short: 'U', place: null,       medal: false, points: 25,  slots: null },
];

export const placementByKey = (key) => PLACEMENTS.find((p) => p.key === key) || null;

/**
 * Koliko puta jedan plasman sme da se dodeli unutar jedne kategorije.
 * `null` znači neograničeno.
 *
 * Po pravilniku kategorija ima jedno prvo, jedno drugo i dva treća mesta.
 * Discipline koje se ne izvlače nego mere ili boduju — kihon u mestu i
 * tamashiwari — nose `openPlacements`, pa im broj istih plasmana nije ograničen.
 */
export const placementSlots = (discipline, key) => {
  if (disciplineByName(discipline)?.openPlacements) return null;
  return placementByKey(key)?.slots ?? null;
};

/** Bodovi za jedan plasman. Nepoznat ili neupisan plasman ne nosi ništa. */
export const pointsFor = (key) => placementByKey(key)?.points || 0;

/**
 * Upis na već odštampanu diplomu.
 *
 * Diplome se štampaju unapred, u tiražu, sa gotovim tekstom i praznim
 * linijama; posle takmičenja se u te linije upisuje ko je šta osvojio. Papir
 * je dakle zadat, a aplikacija na njemu ima samo četiri mesta — i mora da
 * pogodi svako.
 *
 * Zato se ne opisuje izgled nego **položaj**: za svaki red koliko je
 * milimetara od gornje ivice lista, koliko levo (−) ili desno (+) od sredine,
 * i koliko je slovo veliko u tipografskim tačkama. Sve troje meri urednik na
 * svojoj diplomi, jednom, i to ostaje upisano — blanko se ne menja godinama.
 *
 * Ovo su samo početne mere, da polja ne budu prazna: nijedna diploma nije
 * kao druga, pa se prvo štampa probni list sa lenjirom.
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
 * Kotizacije.
 *
 * Klub plaća po **prijavi, ne po takmičaru**: ko je prijavljen u tri
 * discipline plaća tri kotizacije. Ekipa se plaća kao celina, bez obzira na
 * broj članova, a enbu ima svoj iznos jer je par.
 *
 * Starijim uzrastima savez oprašta prve tri discipline (`free.count` u
 * grupama `free.groups`) — ali ne sve: **tamashiwari i tsumeai se plaćaju
 * uvek**, kao i svaka ekipna prijava. Zato oproštaj ne skida sa ukupnog broja
 * nego samo sa onih disciplina koje smeju da budu besplatne.
 *
 * Iznosi kreću od nule namerno: aplikacija ne izmišlja cenu. Dok se ne unesu
 * u Podešavanjima, list kotizacija to i piše.
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

/** „1.500 din" — dinari, bez para, po domaćem pisanju hiljada. */
export const money = (amount) =>
  `${new Intl.NumberFormat('sr-RS').format(Math.round(amount || 0))} din`;

/**
 * Koliko kotizacija duguje jedan takmičar, i koliko mu je oprošteno.
 *
 * @param {Array} entries pojedinačne prijave tog takmičara
 * @param {object} fees   podešavanje kotizacija
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

/** Ekipna kotizacija: enbu ima svoju cenu, ostale ekipe zajedničku. */
export const teamFeeOf = (team, fees) =>
  (team?.discipline === 'Enbu' ? (fees?.enbu || 0) : (fees?.team || 0));

/** Rangovi takmičenja — biraju se pri kreiranju novog. */
export const COMPETITION_LEVELS = [
  'Državno prvenstvo',
  'Kup Srbije',
  'Regionalno takmičenje',
  'Klupski turnir',
  'Međunarodno',
];

/**
 * A i B kalendar. Svaka takmičarska godina ima oba: A lista su takmičenja
 * koja ulaze u bodovanje, B lista sve ostalo — turniri, memorijali, susreti
 * koji se odigraju i upišu, ali ne pomeraju rang listu.
 *
 * Plasman sa B liste je i dalje plasman i medalja je i dalje medalja; samo
 * bodovi ne teku iz njega. Zato se ovo nigde ne pretvara u brisanje podataka,
 * već samo u uslov pri sabiranju.
 */
export const CALENDARS = [
  { key: 'A', label: 'A lista', note: 'ulazi u bodovanje', scores: true },
  { key: 'B', label: 'B lista', note: 'ne ulazi u bodovanje', scores: false },
];

/** Takmičenje bez oznake broji se kao A — tako je i bilo pre uvođenja liste. */
export const calendarOf = (competition) =>
  (competition?.calendar === 'B' ? 'B' : 'A');

/**
 * Da li bodovi sa tog takmičenja teku u trajnu evidenciju.
 *
 * Dva uslova, i oba su ista odluka posmatrana sa dve strane: takmičenje mora
 * da bude **na A listi** i mora da bude **zatvoreno**. Dok traje, plasman se
 * unosi i medalja se broji kao i svuda — ali bodovi stoje, jer se do
 * poslednje kategorije još sve može ispraviti. Zatvaranje takmičenja je
 * trenutak knjiženja.
 */
export const pointsCounted = (competition) =>
  calendarOf(competition) === 'A' && competition?.status === 'Završeno';

/**
 * Dok su prijave otvorene, spisak takmičara se menja i dopunjuje; od
 * „Prijave zatvorene" nadalje je zamrznut, pa je ono što je odštampano i ono
 * što je u bazi ista stvar. Vraćanjem prijava se opet otključava.
 */
export const ENTRIES_OPEN = ['Nacrt', 'Prijave otvorene'];
export const entriesOpen = (competition) =>
  ENTRIES_OPEN.indexOf(competition?.status || 'Nacrt') >= 0;

export const MONTHS = [
  'januar', 'februar', 'mart', 'april', 'maj', 'jun',
  'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar',
];

/** Stanja kroz koja takmičenje prolazi. Novo uvek kreće kao nacrt. */
export const COMPETITION_STATUSES = ['Nacrt', 'Prijave otvorene', 'Prijave zatvorene', 'Završeno'];

/**
/**
 * Uzrasne grupe.
 *
 * The codes are the federation's A–J sequence. The rulebook writes them in
 * Cyrillic (А Б Ц Д Е Ф Г Х И Ј); they are stored and printed in Latin here
 * because Barlow carries no Cyrillic, so on paper those ten capitals fell
 * back to a system font and set about twice as wide as the text around them.
 * The letters and their order are unchanged — only the script.
 *
 * **Grupe se vezuju za uzrast, ne za godišta.** Zvanična tabela saveza je
 * ispisana godištima („2019. i mlađi = poletarci"), ali se svake sezone cela
 * pomeri tačno za jednu godinu — 2025. su poletarci bili 2018. i mlađi, 2026.
 * su 2019. i mlađi. Ono što se ne menja je **uzrast**: poletarac je onaj ko u
 * toj godini puni najviše sedam. Zato ovde stoji uzrast, a godišta se računaju
 * iz njega za svaku sezonu posebno — i tabela se nikad više ne prepisuje rukom.
 *
 * Sezona je **godina takmičenja**, ne današnji datum: takmičenje iz 2025. i
 * dalje razvrstava po tabeli iz 2025, pa se stari rezultati ne premeštaju u
 * druge kategorije kad pređe Nova godina.
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

/** Tekuća takmičarska godina — sezona kad se ne kaže koja. */
export const SEASON = () => new Date().getFullYear();

/** Godina takmičenja; bez datuma pada na tekuću. */
export const seasonOf = (competition) =>
  Number(String(competition?.date || '').slice(0, 4)) || SEASON();

/** Godišta koja jedna grupa obuhvata u datoj sezoni — najmlađe pa najstarije. */
export const yearsOf = (age, season = SEASON()) => ({
  najmladje: season - age.from,
  najstarije: season - age.to,
});

/** „2019. i mlađi", „2018/2017", „2010–2008", „1976. i stariji". */
export function yearsLabel(age, season = SEASON()) {
  const { najmladje, najstarije } = yearsOf(age, season);
  // Otvorena grupa se piše svojom **jedinom pravom granicom**: poletarci
  // najstarijim godištem koje primaju, veterani najmlađim.
  if (age.from === 0) return `${najstarije}. i mlađi`;
  if (age.to >= 100) return `${najmladje}. i stariji`;
  if (najmladje - najstarije === 1) return `${najmladje}/${najstarije}`;
  return `${najmladje}–${najstarije}`;
}

/**
 * Matrica disciplina — jedini izvor istine o tome koja je prijava dozvoljena.
 * Ništa u aplikaciji ne zna spisak disciplina mimo ove liste, pa nijedan
 * dokument ne može da odštampa Kobudo za poletarca.
 *
 * Prepisano iz zvanične tabele saveza za sezonu 2026: `+` znači da grupa sme u
 * tu disciplinu, `−` i prazno polje da ne sme. **Za veterane (J) ne važe ekipne
 * discipline** — nijedna, ni enbu ni timovi, kako i piše u zaglavlju tabele.
 *
 * Dve porodice discipline dele ovu listu. **Tradicionalne** su one iz
 * zvanične tabele i ne nose nikakvu oznaku — one su podrazumevane.
 * **Fudokan sport** discipline nose `style: 'sport'` i ime im tako i glasi,
 * pa se na svakom spisku i filteru razlikuju bez ijedne dodatne kolone.
 *
 * Razlika koja se lako previdi: **tradicionalni kumite nema telesne težine** — sve je
 * apsolutna kategorija, pa se telesna težina uz njega i ne piše. **Sportski kumite
 * ima telesne težine.** Zato `drawBy` stoji na disciplini, a ne pravilo tipa „ako se
 * zove kumite".
 *
 * DODAVANJE DISCIPLINE: dopiši jedan objekat u listu. Ništa drugo se ne dira —
 * kontrolna tabla, provere, filteri i štampani spiskovi je pokupe same.
 *
 *   { name: 'Kihon kata', kind: 'P', system: 'Bodovanje (flag system)',
 *     drawBy: null, groups: 'CDE', order: 13 }
 *
 *   name    — kako se piše na zvaničnim listama; ovim se disciplina i
 *             prepoznaje, pa mora biti jedinstveno
 *   kind    — 'P' pojedinačno, 'E' ekipno, 'P/E' i jedno i drugo
 *   system  — sistem takmičenja, ide u podnaslov liste po kategoriji
 *   drawBy  — po čemu se kategorije dele unutar grupe i pola:
 *             'weight' po telesnoj težini (grupa mora imati telesne težine u WEIGHTS),
 *             'level' po nivou pojasa, 'variant' po vrsti para/ekipe,
 *             `null` nikako — cela grupa je jedna kategorija
 *   style   — 'sport' za fudokan sport discipline; tradicionalne se ne
 *             označavaju, one su podrazumevane
 *   team    — { min, max } za ekipne discipline: koliko takmičara čini ekipu
 *   variants— vrste ekipe koje se odvojeno takmiče; `pattern` je sastav po
 *             polu. Enbu ih ima dve: muški par i mešoviti
 *   groups  — šifre uzrasnih grupa iz AGES kojima je disciplina otvorena
 *   order   — redosled na listama i u padajućim menijima
 *   note    — dodatno ograničenje iz pravilnika, ako ga ima (opciono)
 *
 * Isto važi i za uzrasne grupe (AGES) i telesne težine (WEIGHTS) — sve troje su
 * pravilnik, ne kod. Ekran „Podešavanja" je mesto gde ovo jednog dana treba
 * da se menja iz aplikacije, bez otvaranja fajla.
 */
export const DISCIPLINES = [
  // ── Tradicionalne ────────────────────────────────────────────────────
  { name: 'Kate',                 kind: 'P/E', system: 'Eliminacija po nivoima',   drawBy: 'level',  groups: 'ABCDEFGHIJ', order: 1 },
  { name: 'Kihon u mestu',        kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'A',          order: 2, note: 'samo 9. i 8. kyu', openPlacements: true },
  { name: 'Kihon kumite',         kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'ABCD',       order: 3 },
  { name: 'Kihon ippon kumite',   kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'AB',         order: 4 },
  { name: 'Jiu ippon kumite',     kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'CD',         order: 5 },
  { name: 'Jiu ippon kumite tim', kind: 'E',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'CD',         order: 6, team: { min: 3, max: 4 } },
  // Enbu je par, i realno su to dva takmičenja: muški par i mešoviti.
  { name: 'Enbu',                 kind: 'E',   system: 'Bodovanje (flag system)',  drawBy: 'variant', groups: 'ABCDEFGHI', order: 7,
    team: { min: 2, max: 2 },
    variants: [
      { key: 'M-M', label: 'muški par',    pattern: ['M', 'M'] },
      { key: 'M-F', label: 'mešoviti par', pattern: ['M', 'Ž'] },
    ] },
  { name: 'Ko go kumite',         kind: 'P',   system: 'Direktna eliminacija',     drawBy: null,     groups: 'EF',         order: 8 },
  { name: 'Ko go kumite tim',     kind: 'E',   system: 'Direktna eliminacija',     drawBy: null,     groups: 'EF',         order: 9, team: { min: 3, max: 4 } },
  { name: 'Fuku go',              kind: 'P',   system: 'Kombinovano bodovanje',    drawBy: null,     groups: 'EFGHIJ',     order: 10 },
  // Tradicionalni kumite je apsolutna kategorija — bez telesna težina.
  { name: 'Kumite',               kind: 'P',   system: 'Eliminacija sa repasažom', drawBy: null,     groups: 'GHIJ',       order: 11 },
  { name: 'Kumite tim',           kind: 'E',   system: 'Eliminacija sa repasažom', drawBy: null,     groups: 'GHI',        order: 12, team: { min: 3, max: 4 } },
  { name: 'Tsumeai',              kind: 'P',   system: 'Direktna eliminacija',     drawBy: null,     groups: 'HIJ',        order: 13 },
  { name: 'Tamashiwari',          kind: 'P',   system: 'Bodovanje (merenje)',      drawBy: null,     groups: 'GHIJ',       order: 14, openPlacements: true },
  { name: 'Kobudo',               kind: 'P',   system: 'Bodovanje (flag system)',  drawBy: null,     groups: 'FGHIJ',      order: 15 },

  // ── Fudokan sport ────────────────────────────────────────────────────
  { name: 'Fudokan sport kate',       kind: 'P', style: 'sport', system: 'Eliminacija po nivoima',   drawBy: 'level',  groups: 'ABCDEFGHIJ', order: 20 },
  { name: 'Fudokan sport kumite',     kind: 'P', style: 'sport', system: 'Eliminacija sa repasažom', drawBy: 'weight', groups: 'ABCDEFGHIJ', order: 21 },
  { name: 'Fudokan sport kata tim',   kind: 'E', style: 'sport', system: 'Eliminacija po nivoima',   drawBy: null,     groups: 'ABCDEFGHI',  order: 22, team: { min: 3, max: 3 } },
  { name: 'Fudokan sport kumite tim', kind: 'E', style: 'sport', system: 'Eliminacija sa repasažom', drawBy: null,     groups: 'ABCDEFGHI',  order: 23, team: { min: 3, max: 4 } },
];

/** Fudokan sport discipline; tradicionalne se ne označavaju posebno. */
export const isSport = (discipline) => discipline?.style === 'sport';

/** Ekipne discipline nose `team`; pojedinačne ga nemaju. */
export const isTeamDiscipline = (discipline) => !!discipline?.team;

/** „3 takmičara" ili „3–4 takmičara" — sastav ekipe, za spiskove. */
export const teamSizeLabel = (discipline) => {
  const t = discipline?.team;
  if (!t) return '';
  if (t.min === 2 && t.max === 2) return 'par';
  return t.min === t.max ? `${t.min} takmičara` : `${t.min}–${t.max} takmičara`;
};

/**
 * Vrste ekipe koje se odvojeno takmiče.
 *
 * Disciplina bez izričitih varijanti ima dve podrazumevane — mušku i žensku,
 * jer je ekipa inače jednog pola. Enbu ih ima svoje: muški i mešoviti par, a
 * mešoviti par **nema pol**, pa se kategorija za njega deli po vrsti para a
 * ne po polu.
 */
export const teamVariants = (discipline) => discipline?.variants || [
  { key: 'M', label: 'muškarci', sex: 'M' },
  { key: 'Ž', label: 'žene', sex: 'Ž' },
];

/** „Grupa C · pioniri · mešoviti par" — kategorija jedne ekipe. */
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

/** Telesne težine i trajanje meča po uzrasnoj grupi. */
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

// ── Lookups ────────────────────────────────────────────────────────────

export const ageByCode = (code) => AGES.find((a) => a.code === code) || null;
export const clubByName = (name) => CLUBS.find((c) => c.name === name) || null;
export const disciplineByName = (name) => DISCIPLINES.find((d) => d.name === name) || null;

/** The uzrasna grupa a birth year falls into. */
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
 * Ime kako se piše, bez obzira kako je otkucano.
 *
 * Klubovi kucaju kako stignu — „MARKO MARKOVIĆ", „marko marković", „Marko
 * MARKOVIĆ". Na papiru to izgleda kao tri različita čoveka, pa se svako ime
 * pre upisa svodi na isti oblik: **veliko samo prvo slovo svakog dela**, i
 * posle crtice u prezimenu („Marić-Petrović").
 *
 * Domaća azbuka se poštuje kroz `toLocaleUpperCase('sr')` — inače „đ" ne bi
 * postalo „Đ". Dvoslovi ostaju kako treba sami od sebe: uvećava se samo prvo
 * slovo, pa je „njegoš" → „Njegoš", a ne „NJegoš".
 *
 * Ovo **ne rešava dvostruki upis** — lice se i tako prepoznaje bez obzira na
 * veličinu slova (`identityOf` poredi mala slova). Rešava kako ime izgleda na
 * spisku, diplomi i računu.
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
 * Kategorija u kojoj se prijava izvlači. Po čemu se deli govori `drawBy` na
 * samoj disciplini — po telesnoj težini, po nivou pojasa, ili nikako. Ovo je ono što
 * se broji kad negde piše „koliko kategorija", i na tabli i na papiru.
 *
 * Namerno se čita iz pravilnika, a ne iz imena discipline: tradicionalni i
 * sportski kumite se isto zovu „kumite" a dele se različito — tradicionalni
 * nikako (apsolutna), sportski po telesnoj težini.
 */
export const categoryKey = (e) => {
  const drawBy = disciplineByName(e.discipline)?.drawBy;
  if (drawBy === 'weight') return `${e.discipline}|${e.group}|${e.sex}|${e.weight}`;
  if (drawBy === 'level') return `${e.discipline}|${e.group}|${e.sex}|${e.level}`;
  return `${e.discipline}|${e.group}|${e.sex}`;
};

// ── Demo registry ──────────────────────────────────────────────────────

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
 * Godište za demo takmičara. Krajnje grupe su otvorene s jedne strane
 * (poletarci „2018. i mlađi", veterani „1975. i stariji"), pa se za uzorak
 * sužavaju na životan raspon umesto na granicu iz tabele.
 */
const sampleYears = (age, season = SEASON()) => {
  const { najmladje, najstarije } = yearsOf(age, season);
  return [Math.max(najstarije, season - 70), najmladje];
};

const FIRST_M = ['Miloš', 'Nikola', 'Stefan', 'Luka', 'Marko', 'Vuk', 'Filip', 'Đorđe', 'Petar', 'Lazar', 'Aleksa', 'Uroš', 'Nemanja', 'Dušan', 'Andrej', 'Mihajlo'];
const FIRST_F = ['Ana', 'Jovana', 'Milica', 'Teodora', 'Sara', 'Anđela', 'Katarina', 'Nina', 'Iva', 'Mila', 'Dunja', 'Lena', 'Tijana', 'Nevena', 'Sofija'];
const LAST = ['Jovanović', 'Petrović', 'Nikolić', 'Stanković', 'Ilić', 'Marković', 'Đorđević', 'Pavlović', 'Popović', 'Lukić', 'Savić', 'Radić', 'Tomić', 'Mitić', 'Vasić', 'Kostić', 'Milošević', 'Ristić'];


/**
 * Builds the entry registry for the current competition.
 *
 * @returns {{competitors: Array, entries: Array, teams: Array}}
 *   `entries` is one row per prijava — a competitor entered in one
 *   discipline. That is the unit every document counts and prints.
 */
/**
 * Nivoi pojasa koji na jednom prvenstvu zaista izlaze u datoj uzrasnoj grupi.
 *
 * Beli pojas ne postoji među seniorima, kao ni crni među poletarcima — a
 * kategorija po nivou koja bi imala dva takmičara nije kategorija. Dva nivoa
 * po grupi drže svaku kate kategoriju popunjenom, a broj ljudi na prvenstvu
 * u granicama u kojima zaista jeste.
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

/** Pojas kojim se jedan nivo predstavlja — nivo je ono po čemu se kate izvlači. */
const BELT_FOR_LEVEL = {
  '0. nivo': ['beli'],
  '1. nivo': ['žuti', 'oranž'],
  '2. nivo': ['zeleni', 'plavi'],
  '3. nivo': ['braon', 'crni'],
};

/**
 * Ime pod kojim ekipa izlazi na spisak i u granu.
 *
 * Ekipa nema svoje ime — nastupa pod imenom kluba. Kad klub prijavi **dve u
 * istoj kategoriji**, obe dobijaju broj („KK Niš 1", „KK Niš 2"); dok je
 * jedna, broj bi bio samo šum. Kategorija je ovde disciplina + uzrasna grupa
 * + vrsta ekipe, jer se u toj kutiji i sreću.
 */
/** Redni broj ekipe se piše rimski — „KK Niš II", kako stoji i na diplomi. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

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
 * Registar prijava za jedno prvenstvo.
 *
 * Gradi se **od kategorija naniže, ne od ljudi naviše.** Prvo se ispiše
 * spisak kategorija koje po pravilniku uopšte postoje — kate po nivou,
 * kumite po telesnoj težini, ostalo po grupi i polu — pa se svaka popuni sa 10 do 15
 * takmičara. Tako nijedna kategorija ne ostane sa dva prijavljena, što je
 * ono što se u praksi i dešava kad se registar pravi obrnuto.
 *
 * Ljudi se **ponovo koriste** kroz discipline: kategorija prvo uzme onoga ko
 * je već prijavljen a ispunjava uslov (isti nivo za kate, ista telesna težina za
 * kumite), i tek kad takvih nema pravi novog. Zato prvenstvo sa hiljadu i po
 * prijava stane u pet stotina ljudi — jedan takmičar nastupa u tri discipline
 * u proseku, kao i uživo.
 *
 * @returns {{competitors: Array, entries: Array, teams: Array}}
 */
export function buildRegistry(seed = 7) {
  const rng = seeded(seed);
  const competitors = [];
  const entries = [];

  /** Koliko prijava ide u jednu kategoriju. */
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
      // Telesna težina je osobina takmičara, ne prijave: isti čovek ne može da se
      // pojavi u dve telesne težine, pa se bira jednom i nosi kroz sve nastupe.
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
       * Popuni jednu kategoriju. `matches` je uslov koji takmičar mora da
       * ispuni da bi uopšte mogao u nju (nivo za kate, telesna težina za kumite);
       * `make` pravi novog kad postojećih nema dovoljno.
       */
      const fill = (discipline, weight, matches, make) => {
        const want = target();
        // Prvi na redu je onaj sa najmanje dosadašnjih nastupa. Bez toga bi
        // šačica prvonapravljenih pokupila sve discipline, a ostatak ostao
        // sa jednim nastupom — što nije ni ravnomerno ni nalik istini.
        const free = pool
          .filter((c) => matches(c) && !c.disciplines.has(discipline))
          .sort((a, b) => a.disciplines.size - b.disciplines.size || a.id - b.id);
        for (let i = 0; i < want; i++) {
          const competitor = i < free.length ? free[i] : pool[pool.push(make()) - 1];
          enter(competitor, discipline, weight);
        }
      };

      // Discipline koje dele ljude po nivou idu prve — one prave takmičare
      // sa određenim nivoom, pa se svi ostali nastupi slažu preko njih.
      const byLevel = allowed.filter((d) => d.drawBy === 'level');
      const rest = allowed.filter((d) => d.drawBy !== 'level');

      byLevel.forEach((discipline) => {
        levels.forEach((level) => {
          fill(discipline.name, null, (c) => c.level === level,
            () => makeCompetitor(sex, age.code, level, rng.pick(weights)));
        });
      });

      rest.forEach((discipline) => {
        // Ekipne discipline nemaju pojedinačne prijave — ekipa je učesnik.
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

  // Radna oznaka disciplina je poslužila punjenju; zapis takmičara je nosi
  // dalje bez razloga, a Set ne preživi ni kloniranje ni upis u bazu.
  competitors.forEach((c) => { delete c.disciplines; });

  // ── Ekipe ────────────────────────────────────────────────────────────
  //
  // Ekipne discipline nemaju pojedinačne prijave — učesnik je ekipa. Sastav
  // se uzima iz već napravljenih takmičara **istog kluba i iste uzrasne
  // grupe**, jer ekipa i jeste to.
  //
  // Pol nije uvek osobina ekipe: enbu ima mešoviti par, koji nema pol nego
  // vrstu. Zato se ekipe prave po **varijanti** (`teamVariants`), a ne po
  // polu — disciplina bez izričitih varijanti dobija dve podrazumevane,
  // mušku i žensku, pa je stara podela i dalje tu, samo izražena opštije.
  const teams = [];
  const teamDisciplines = DISCIPLINES.filter((d) => d.team);

  /**
   * Bira sastav ekipe iz kluba. `pattern` traži tačno određene polove
   * (muški par, mešoviti par); bez njega se uzima traženi broj takmičara
   * jednog pola. Imena moraju biti različita — dvoje istoimenih na spisku
   * izgleda kao greška u unosu i kad su to dva različita čoveka.
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
      // Ko je već u nekoj ekipi ove discipline ne ulazi u drugu — ni u drugu
      // ekipu iste vrste, ni u drugu vrstu. Enbu ima muški i mešoviti par;
      // isti čovek ne nastupa u oba.
      const takenIn = new Map();
      const takenFor = (club) => {
        if (!takenIn.has(club)) takenIn.set(club, new Set());
        return takenIn.get(club);
      };

      teamVariants(discipline).forEach((variant) => {
        [...byClub.values()].forEach((mates) => {
          // Ne prijavljuje svaki klub ekipu u svakoj kategoriji — ekipa traži
          // ljude koji su tu i spremni, a to se ne poklopi svaki put.
          if (rng.next() > 0.4) return;
          // Jak klub ume da prijavi i drugu ekipu u istoj kategoriji.
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
              // Mešoviti par nema pol — vrsta para je ono što ga određuje.
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
