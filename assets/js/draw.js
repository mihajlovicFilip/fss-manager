/**
 * Žreb — izvlačenje takmičara u granu.
 *
 * Grana je jednostruka eliminacija. Broj mesta je prva stepenica dvojke koja
 * primi sve prijavljene, a razlika se popunjava slobodnim prolazima (BYE):
 * trinaest takmičara daje granu od šesnaest, pet parova koji se stvarno bore
 * i tri koji prolaze bez borbe. Slobodni prolazi se **crtaju**, jer se tako
 * na listu vidi ko je i zašto već u sledećoj koloni.
 *
 * Najveća grana je **32 takmičara**. Preko toga se kategorija deli na dve
 * grane, iz svake prolaze po četiri, i one se sastaju u završnoj grani od
 * osam.
 *
 * Raspored je nasumičan. Jedino pravilo: **u prvoj rundi se ne smeju sresti
 * dva takmičara iz istog kluba.** To nije uvek moguće — kad iz jednog kluba
 * dođe više od polovine kategorije, neki par mora da bude klupski; tada se
 * to prijavi umesto da se tiho preskoči, jer je to podatak koji glavni sudija
 * mora da zna pre nego što potpiše.
 *
 * Modul ne zna ništa o papiru ni o ekranu — vraća opis grane, a crta ga
 * doc-render.js.
 */

/** Najviše takmičara u jednoj grani; preko toga se kategorija deli. */
export const MAX_BRACKET = 32;

/** Koliko ih iz svake polovine ide u završnu granu kad se kategorija deli. */
export const ADVANCE_PER_HALF = 4;

/** Imena rundi po broju takmičara koji u njih ulaze. */
const ROUND_NAME = { 2: 'F', 4: 'SF', 8: 'QF' };
const roundName = (remaining) => ROUND_NAME[remaining] || `R${remaining}`;

const ROUND_FULL = {
  F: 'Finale',
  SF: 'Polufinale',
  QF: 'Četvrtfinale',
};
export const roundLabel = (short) => ROUND_FULL[short] || `Runda ${short.slice(1)}`;

/** Prva stepenica dvojke koja primi `n` takmičara, najmanje 2. */
export const bracketSize = (n) => Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(n, 2))));

/** Nasumičan redosled — Fisher–Yates, sa RNG-om koji se prosleđuje spolja. */
function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Raspoređuje slobodne prolaze po grani.
 *
 * Ne u nizu na vrhu: tri BYE-a jedan ispod drugog znače da cela gornja
 * četvrtina grane prolazi bez borbe, a donja se bije od prvog kola. Zato se
 * mečevi koji dobijaju BYE biraju **ravnomerno raspoređeni** po grani.
 *
 * @returns {number[]} indeksi mečeva prve runde koji dobijaju slobodan prolaz
 */
function byeMatches(matchCount, byes) {
  if (byes <= 0) return [];
  if (byes >= matchCount) return [...Array(matchCount).keys()];
  const step = matchCount / byes;
  return Array.from({ length: byes }, (unused, i) => Math.round(i * step + step / 2) - 1)
    .map((i) => Math.min(Math.max(i, 0), matchCount - 1));
}

const clubOf = (c) => (c ? c.club || '' : '');

/**
 * Razdvaja klupske parove u prvoj rundi.
 *
 * Prolazi kroz parove i, kad naiđe na dva iz istog kluba, traži takmičara u
 * drugom paru sa kojim zamena razdvaja oba para. Zamena se prihvata samo ako
 * ne pravi novi klupski par — inače bi se problem samo pomerio.
 *
 * @returns {number} koliko je klupskih parova ostalo nerazdvojeno
 */
function separateClubs(slots) {
  const pairs = slots.length / 2;
  // Prazan klub nije klub: mesta u završnoj grani („1. iz grane A") nemaju
  // klub, pa bi se bez ovog uslova svaki takav par brojao kao klupski.
  const clash = (i) => {
    const a = slots[i * 2], b = slots[i * 2 + 1];
    return !!a && !!b && !!clubOf(a) && clubOf(a) === clubOf(b);
  };

  for (let i = 0; i < pairs; i++) {
    if (!clash(i)) continue;
    let fixed = false;
    for (let j = 0; j < pairs && !fixed; j++) {
      if (j === i) continue;
      for (const side of [0, 1]) {
        const mine = i * 2 + 1;
        const theirs = j * 2 + side;
        const other = slots[j * 2 + (1 - side)];
        // Zamena vredi samo ako oba para posle nje budu čista.
        const mineAfter = slots[i * 2];
        if (slots[theirs] && clubOf(slots[theirs]) === clubOf(mineAfter)) continue;
        if (other && clubOf(other) === clubOf(slots[mine])) continue;
        [slots[mine], slots[theirs]] = [slots[theirs], slots[mine]];
        fixed = true;
        break;
      }
    }
  }

  let left = 0;
  for (let i = 0; i < pairs; i++) if (clash(i)) left += 1;
  return left;
}

/**
 * Jedna grana od spiska takmičara.
 *
 * @param {Array}  list    takmičari; svaki nosi bar `name` i `club`
 * @param {object} opts    `random` (podrazumevano Math.random), `title`,
 *                         `shuffle: false` kad je redosled već određen
 * @returns {{size, rounds, slots, byes, clubClash, title}}
 */
export function buildBracket(list, { random = Math.random, title = '', shuffle = true } = {}) {
  const size = bracketSize(list.length);
  const matchCount = size / 2;
  const byes = size - list.length;

  // Nasumičan redosled, pa slobodni prolazi na ravnomerno razmaknuta mesta.
  const order = shuffle ? shuffled(list, random) : [...list];
  const slots = new Array(size).fill(null);
  const withBye = new Set(byeMatches(matchCount, byes));
  let next = 0;
  for (let i = 0; i < matchCount; i++) {
    slots[i * 2] = order[next++] || null;
    slots[i * 2 + 1] = withBye.has(i) ? null : (order[next++] || null);
  }

  const clubClash = separateClubs(slots);

  // ── Runde ────────────────────────────────────────────────────────────
  const rounds = [];
  const first = [];
  for (let i = 0; i < matchCount; i++) {
    const a = slots[i * 2];
    const b = slots[i * 2 + 1];
    first.push({
      index: i,
      a: a ? a.name : (b ? 'BYE' : null),
      b: b ? b.name : (a ? 'BYE' : null),
      aClub: a ? a.club : '',
      bClub: b ? b.club : '',
      // Meč u kom je jedna strana BYE nema borbe — pobednik je poznat i
      // upisuje se u sledeću kolonu, tačno kao na zvaničnoj grani.
      walkover: (!a && !!b) ? b.name : (!b && !!a) ? a.name : null,
      real: !!a && !!b,
    });
  }
  rounds.push({ name: roundName(size), matches: first });

  let previous = first;
  for (let remaining = size / 2; remaining >= 2; remaining /= 2) {
    const matches = [];
    for (let i = 0; i < remaining / 2; i++) {
      const feedA = previous[i * 2];
      const feedB = previous[i * 2 + 1];
      matches.push({
        index: i,
        a: feedA?.walkover || null,
        b: feedB?.walkover || null,
        aClub: '', bClub: '',
        walkover: null,
        real: false,
      });
    }
    rounds.push({ name: roundName(remaining), matches });
    previous = matches;
  }

  return { size, rounds, slots, byes, clubClash, title, entries: list.length };
}

/**
 * Cela kategorija — jedna grana, ili dve plus završna kad ih ima preko 32.
 *
 * Podela je nasumična, kao i sam žreb: spisak se izmeša pa preseče na pola.
 * Završna grana nosi mesta („1. iz grane A") umesto imena, jer se ona
 * popunjavaju tek kad prve dve budu odigrane.
 *
 * @returns {Array} grane, redom kojim se štampaju
 */
export function drawCategory(list, { random = Math.random } = {}) {
  if (list.length <= MAX_BRACKET) {
    return [buildBracket(list, { random })];
  }

  const mixed = shuffled(list, random);
  const half = Math.ceil(mixed.length / 2);
  const a = buildBracket(mixed.slice(0, half), { random, title: 'Grana A' });
  const b = buildBracket(mixed.slice(half), { random, title: 'Grana B' });

  const finalists = [];
  for (const side of ['A', 'B']) {
    for (let i = 1; i <= ADVANCE_PER_HALF; i++) {
      finalists.push({ name: `${i}. iz grane ${side}`, club: '', placeholder: true });
    }
  }
  // Ukršteno, i **bez mešanja**: prvi iz jedne grane ide na četvrtog iz
  // druge, pa se dvoje iz iste grane sretnu tek u finalu. Mešanje bi taj
  // raspored odmah pokvarilo.
  const order = [0, 7, 1, 6, 2, 5, 3, 4].map((i) => finalists[i]);
  const finale = buildBracket(order, { title: 'Završna grana', shuffle: false });

  return [a, b, finale];
}
