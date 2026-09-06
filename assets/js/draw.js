/**
 * Draw — placing competitors into a bracket.
 *
 * Single elimination. The bracket size is the next power of two, and the
 * difference is filled with byes: 13 competitors give a bracket of 16.
 * Byes are drawn on the sheet, so it is visible who advances and why.
 *
 * The largest bracket is 32. Above that the category splits into two
 * brackets; four advance from each into a final bracket of eight.
 *
 * Order is random. One rule: two competitors from the same club must not
 * meet in the first round. When that is impossible (one club fills more
 * than half the category), it is reported instead of silently ignored —
 * the head referee must know before signing.
 *
 * This module knows nothing about paper or screen — it returns a bracket
 * description, doc-render.js draws it.
 */

/** Most competitors in one bracket; above this the category splits. */
export const MAX_BRACKET = 32;

/** How many advance from each half into the final bracket. */
export const ADVANCE_PER_HALF = 4;

/** Round names by the number of competitors entering them. */
const ROUND_NAME = { 2: 'F', 4: 'SF', 8: 'QF' };
const roundName = (remaining) => ROUND_NAME[remaining] || `R${remaining}`;

const ROUND_FULL = {
  F: 'Finale',
  SF: 'Polufinale',
  QF: 'Četvrtfinale',
};
export const roundLabel = (short) => ROUND_FULL[short] || `Runda ${short.slice(1)}`;

/** Next power of two that fits n competitors, at least 2. */
export const bracketSize = (n) => Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(n, 2))));

/** Random order — Fisher–Yates, with the RNG passed in. */
function shuffled(list, random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Spreads byes across the bracket instead of stacking them at the top,
 * so no quarter of the bracket advances entirely without a fight.
 *
 * @returns {number[]} first-round match indexes that get a bye
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
 * Separates same-club pairs in the first round. A swap is accepted only
 * if it does not create a new same-club pair elsewhere.
 *
 * @returns {number} how many same-club pairs could not be separated
 */
function separateClubs(slots) {
  const pairs = slots.length / 2;
  // An empty club is not a club: final-bracket placeholders ("1. iz grane
  // A") have none, and must not count as a same-club pair.
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
        // The swap counts only if both pairs are clean afterwards.
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
 * One bracket from a list of competitors.
 *
 * @param {Array}  list    competitors; each carries at least name and club
 * @param {object} opts    random (default Math.random), title,
 *                         shuffle: false when the order is already fixed
 * @returns {{size, rounds, slots, byes, clubClash, title}}
 */
export function buildBracket(list, { random = Math.random, title = '', shuffle = true } = {}) {
  const size = bracketSize(list.length);
  const matchCount = size / 2;
  const byes = size - list.length;

  // Random order, then byes on evenly spaced matches.
  const order = shuffle ? shuffled(list, random) : [...list];
  const slots = new Array(size).fill(null);
  const withBye = new Set(byeMatches(matchCount, byes));
  let next = 0;
  for (let i = 0; i < matchCount; i++) {
    slots[i * 2] = order[next++] || null;
    slots[i * 2 + 1] = withBye.has(i) ? null : (order[next++] || null);
  }

  const clubClash = separateClubs(slots);

  // === Rounds =============================================
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
      // A match against a bye has no fight — the winner is known and
      // written into the next column, as on the official sheet.
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
 * A whole category — one bracket, or two plus a final above 32 entries.
 * The final bracket carries placeholders ("1. iz grane A") instead of
 * names, filled in once the first two brackets are played.
 *
 * @returns {Array} brackets, in print order
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
  // Crossed, and not shuffled: first from one half meets fourth from the
  // other, so two from the same half meet only in the final.
  const order = [0, 7, 1, 6, 2, 5, 3, 4].map((i) => finalists[i]);
  const finale = buildBracket(order, { title: 'Završna grana', shuffle: false });

  return [a, b, finale];
}
