/**
 * Deljeni renderer papira.
 *
 * One printed sheet is described by a `spec`: a letterhead, a title band,
 * a table of columns and rows, an optional totals row, and a foot. This
 * module turns such a spec into A4 pages — it measures, it paginates, it
 * stamps the letterhead — and it does not care who asked.
 *
 * Two callers use it:
 *   documents.js  the four official documents on their own page
 *   print.js      the Štampaj button on every list inside the app
 *
 * Keeping them on one renderer is the point: a list printed from the app
 * and a document printed from documents.html must come out of the printer
 * looking like they came from the same federation.
 *
 * The physical page box, the page breaks and the @page rule are owned by
 * <doc-page>; nothing here touches them beyond setting `orientation`.
 */

import { FEDERATION } from './data.js';

// ── Small helpers ──────────────────────────────────────────────────────

export const esc = (v) => String(v).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/**
 * A table cell.
 * `null` prints an empty box (a field to be filled in by hand);
 * `''` or `undefined` prints an em dash (a value that does not apply).
 */
export const cell = (value, align = 'left', strong = false) => ({ value, align, strong });

export const col = (label, width = null, align = 'left') => ({ label, width, align });

const cellHtml = (c) => {
  const classes = ['is-' + c.align];
  if (c.strong) classes.push('is-strong');
  const text = c.value === null ? '' : (c.value === '' || c.value === undefined) ? '—' : c.value;
  return `<td class="${classes.join(' ')}">${esc(text)}</td>`;
};

const rowClasses = (row) => {
  const classes = [];
  if (row.zebra) classes.push('is-zebra');
  if (row.groupInner) classes.push('is-group-inner');
  if (row.groupEnd) classes.push('is-group-end');
  return classes.join(' ');
};

/** Serbian plural for the page counter: 1 strana, 2–4 strane, 5+ strana. */
export const pageWord = (n) => {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return 'strana';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'strane';
  return 'strana';
};

const pad2 = (n) => String(n).padStart(2, '0');
export const stamp = (d = new Date()) =>
  `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}. u ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

export const uniqueCount = (items, key) => new Set(items.map(key)).size;

// ── Pagination ─────────────────────────────────────────────────────────

/** Maximal runs of rows sharing a `groupId` — a team must not be split. */
function blocksOf(rows) {
  const blocks = [];
  rows.forEach((row) => {
    const prev = blocks[blocks.length - 1];
    if (row.groupId != null && prev && prev.id === row.groupId) prev.rows.push(row);
    else blocks.push({ id: row.groupId ?? null, rows: [row] });
  });
  return blocks;
}

/** Length of the trailing block on a page. */
function trailingBlockSize(page) {
  const id = page[page.length - 1]?.groupId;
  if (id == null) return 1;
  let n = 0;
  for (let i = page.length - 1; i >= 0 && page[i].groupId === id; i--) n++;
  return n;
}

/**
 * Slices a spec's rows into pages, by measured height rather than by a
 * row count — Barlow, the fallback stack, portrait and landscape all fit
 * a different number of rows, and a hard-coded count silently clips the
 * overflow (paginated pages are `overflow: hidden`).
 *
 * Rows carrying the same `groupId` (the members of one team) stay on one
 * page. The final page also carries the totals row, the totals line and
 * the signature block, so it holds less; when the tail would run into
 * them, trailing blocks move onto one more page.
 *
 * @param {Array}  rows      row descriptors
 * @param {number[]} heights measured px height of each row, index-aligned
 * @param {{body:number, bodyLast:number}} space px available to tbody
 */
export function paginate(rows, heights, space) {
  const heightOf = (page) => page.reduce((sum, row) => sum + (heights[row.index] || 0), 0);
  const pages = [];
  let page = [];
  let used = 0;

  for (const block of blocksOf(rows)) {
    const blockHeight = heightOf(block.rows);
    // A block taller than a whole page cannot be kept together — let it flow.
    if (blockHeight > space.body) {
      for (const row of block.rows) {
        const h = heights[row.index] || 0;
        if (page.length && used + h > space.body) { pages.push(page); page = []; used = 0; }
        page.push(row);
        used += h;
      }
      continue;
    }
    if (page.length && used + blockHeight > space.body) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(...block.rows);
    used += blockHeight;
  }
  pages.push(page);

  // Make room on the final page for the totals and the signatures.
  for (;;) {
    const last = pages[pages.length - 1];
    if (heightOf(last) <= space.bodyLast) break;
    const moved = [];
    while (heightOf(last) > space.bodyLast) {
      const size = trailingBlockSize(last);
      if (size >= last.length) break; // one indivisible block — leave it be
      moved.unshift(...last.splice(last.length - size));
    }
    if (!moved.length) break;
    pages.push(moved);
  }

  balanceTail(pages, heightOf, space);
  return pages;
}

/**
 * A final page holding one or two stranded rows under a full signature
 * block reads as a mistake on an official document, so pull rows back
 * from the previous page until the two are roughly even.
 */
function balanceTail(pages, heightOf, space) {
  if (pages.length < 2) return;
  const last = pages[pages.length - 1];
  const prev = pages[pages.length - 2];
  if (last.length >= prev.length * 0.4) return;

  for (;;) {
    const size = trailingBlockSize(prev);
    if (size >= prev.length) break;              // never empty the page before it
    const moving = prev.slice(prev.length - size);
    if (heightOf(last) + heightOf(moving) > space.bodyLast) break;
    if (last.length + size >= prev.length) break; // stop once they are even
    prev.length -= size;
    last.unshift(...moving);
  }
}

// ── Rendering ──────────────────────────────────────────────────────────

/**
 * One sheet.
 *
 * @param {object} spec       kicker, title, meta1, meta2, docCode, columns,
 *                            rows, optional `foot` (totals row cells),
 *                            optional `summary`/`summaryRight`, optional
 *                            `signatures` (array of labels; omit for none)
 * @param {Array}  rows       the slice of rows on this page
 * @param {object} ctx        context (the right-hand letterhead block),
 *                            page number/total, printedAt
 */
export function renderPage(spec, rows, { context, number, total, printedAt, isLast, probe = false }) {
  const head = (spec.columns || []).map((c) => {
    const style = c.width ? ` style="width:${c.width}"` : '';
    return `<th class="is-${c.align}"${style}>${esc(c.label)}</th>`;
  }).join('');

  const body = rows.map((r) => (
    `<tr class="${rowClasses(r)}">${r.cells.map(cellHtml).join('')}</tr>`
  )).join('');

  // The totals row belongs to the table, so it lives in <tfoot> — and only
  // on the last page, otherwise every sheet would claim to be the total.
  const foot = isLast && spec.foot
    ? `<tfoot><tr>${spec.foot.map(cellHtml).join('')}</tr></tfoot>`
    : '';

  const summary = isLast && spec.summary ? `
      <div class="doc-summary">
        <span>${esc(spec.summary)}</span>
        <span class="doc-summary-right">${esc(spec.summaryRight || '')}</span>
      </div>` : '';

  // A protocol gets signed; a working list does not. Specs that want
  // signature rules name them, the rest print without.
  const signatures = isLast && spec.signatures?.length ? `
        <div class="doc-signatures">${spec.signatures.map((label) => `
          <div class="doc-sign">
            <div class="doc-sign-rule"></div>
            <div class="doc-sign-label">${esc(label)}</div>
          </div>`).join('')}
        </div>` : '';

  return `
    <section class="page${probe ? ' is-probe' : ''}">
      <header class="doc-head">
        <img class="doc-crest" src="${esc(FEDERATION.crest.src)}" alt="${esc(FEDERATION.crest.alt)}">
        <div class="doc-org">
          <div class="doc-org-name">${esc(FEDERATION.name)}</div>
          <div class="doc-org-sub">${esc(FEDERATION.subtitle)}</div>
        </div>
        <div class="doc-comp">
          <div class="doc-comp-name">${esc(context.name)}</div>
          <div class="doc-comp-sub">${esc(context.sub)}</div>
        </div>
      </header>

      <div class="doc-title-band">
        <div>
          <div class="doc-kicker">${esc(spec.kicker)}</div>
          <div class="doc-title">${esc(spec.title)}</div>
        </div>
        <div class="doc-title-meta">${[spec.meta1, spec.meta2]
          .filter(Boolean).map((line) => `
          <div>${esc(line)}</div>`).join('')}
        </div>
      </div>

      ${spec.lead || `
      <table class="doc-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
        ${foot}
      </table>`}
${summary}
      <footer class="doc-foot">${signatures}
        <div class="doc-footer">
          <span>${esc(FEDERATION.name)} · ${esc(spec.docCode)}</span>
          <span>Štampano ${esc(printedAt)}</span>
          <span>Strana ${number} / ${total}</span>
        </div>
      </footer>
    </section>`;
}

// ── Grana žreba ────────────────────────────────────────────────────────

/*
 * Grana se ne slaže u tabelu — meč u drugoj koloni stoji tačno na sredini
 * između dva meča iz kojih izlazi, a to je geometrija, ne red i kolona.
 * Zato se svaki meč i svaka spojnica postavljaju apsolutno, u milimetrima,
 * izračunato iz veličine grane. U milimetrima jer je odredište papir: ono
 * što se ovde izračuna izađe iz štampača tačno te veličine.
 */

/**
 * Mere po veličini grane, u milimetrima. Grana od 32 mora da stane na istu
 * stranu kao grana od 8, pa se sve steže — ime u kutiji od 26 mm se preloma
 * u tri tačke, ali cela grana ostaje na jednom listu, što je važnije.
 */
const BRACKET_SIZE = {
  2:  { slot: 9,   gap: 12,  box: 52, score: 9, link: 9, font: 10.5, tag: true },
  4:  { slot: 8,   gap: 10,  box: 46, score: 8, link: 8, font: 10,   tag: true },
  8:  { slot: 7,   gap: 7,   box: 42, score: 7, link: 7, font: 9.5,  tag: true },
  16: { slot: 6,   gap: 4.5, box: 34, score: 6, link: 5, font: 8.5,  tag: true },
  32: { slot: 4.4, gap: 2,   box: 27, score: 5, link: 4, font: 7.4,  tag: false },
};

/**
 * Crta jednu granu.
 *
 * Do 16 mesta svaki meč nosi oznaku iznad kutije („R16 · meč 1"), kao na
 * zvaničnoj grani. Na 32 za to nema visine, pa oznaka runde ide u zaglavlje
 * kolone a broj meča u uski žleb levo — isti podatak, četvrtina prostora.
 *
 * @returns {{html: string, width: number, height: number}} mere u mm
 */
export function bracketHtml(bracket) {
  const m = BRACKET_SIZE[bracket.size] || BRACKET_SIZE[32];
  const matchH = m.slot * 2;
  const tagH = m.tag ? 3.4 : 0;
  const pitch = matchH + tagH + m.gap;
  const columnW = m.box + m.score + m.link;
  const headH = m.tag ? 0 : 5;

  const first = bracket.rounds[0].matches.length;
  const height = headH + first * pitch - m.gap;
  const width = bracket.rounds.length * columnW - m.link;

  // Sredina svakog meča: prva runda je ravnomerna, svaka sledeća sedi tačno
  // između dva meča iz kojih izlazi.
  const centres = [];
  bracket.rounds.forEach((round, r) => {
    centres[r] = round.matches.map((unused, i) => (r === 0
      ? headH + i * pitch + tagH + matchH / 2
      : (centres[r - 1][i * 2] + centres[r - 1][i * 2 + 1]) / 2));
  });

  const parts = [];

  bracket.rounds.forEach((round, r) => {
    const left = r * columnW;
    // U zbijenom prikazu ime runde stoji u zaglavlju kolone — svake, ne
    // samo prve, jer se sa lista poziva „četvrtfinale, meč 3".
    if (!m.tag) {
      parts.push(`<div class="br-col" style="left:${left}mm;width:${m.box + m.score}mm">${
        esc(round.name)}</div>`);
    }

    round.matches.forEach((match, i) => {
      const top = centres[r][i] - matchH / 2;
      const slot = (name, side) => `
        <div class="br-slot${name === 'BYE' ? ' is-bye' : ''}${name ? '' : ' is-open'}">
          <span class="br-name">${name ? esc(name) : ''}</span>
          <span class="br-score"></span>
        </div>`;

      parts.push(`
        <div class="br-match" style="left:${left}mm;top:${top - tagH}mm;width:${m.box + m.score}mm">${
        m.tag ? `<div class="br-tag">${esc(round.name)} · meč ${i + 1}</div>` : ''}
          <div class="br-box" style="height:${matchH}mm">${slot(match.a)}${slot(match.b)}</div>
        </div>`);

      if (!m.tag) {
        parts.push(`<div class="br-no" style="left:${left - 4.5}mm;top:${top + m.slot / 2 - 1.6}mm">${
          i + 1}</div>`);
      }

      // Spojnica: iz oba meča prethodne runde u ovaj — vodoravno do sredine
      // razmaka, uspravno između njih, pa vodoravno u ovaj meč.
      if (r > 0) {
        const fromX = (r - 1) * columnW + m.box + m.score;
        const midX = fromX + m.link / 2;
        const topY = centres[r - 1][i * 2];
        const botY = centres[r - 1][i * 2 + 1];
        parts.push(`<div class="br-link" style="left:${fromX}mm;top:${topY}mm;width:${m.link / 2}mm"></div>`);
        parts.push(`<div class="br-link" style="left:${fromX}mm;top:${botY}mm;width:${m.link / 2}mm"></div>`);
        parts.push(`<div class="br-link is-v" style="left:${midX}mm;top:${topY}mm;height:${botY - topY}mm"></div>`);
        parts.push(`<div class="br-link" style="left:${midX}mm;top:${centres[r][i]}mm;width:${m.link / 2}mm"></div>`);
      }
    });
  });

  return {
    width,
    height,
    html: `<div class="br" style="height:${height}mm;font-size:${m.font}px">${parts.join('')}</div>`,
  };
}

// ── Measuring ──────────────────────────────────────────────────────────

/** The sheet <doc-page size="a4"> hands each page, per orientation. */
export const PAGE_SIZE = {
  portrait: { width: '210mm', height: '297mm' },
  landscape: { width: '297mm', height: '210mm' },
};

/** Off-screen host the measuring pass lays its throwaway page out in. */
let measureHost = null;
function ensureMeasureHost() {
  if (!measureHost) {
    measureHost = document.createElement('div');
    measureHost.className = 'doc-measure';
    measureHost.setAttribute('aria-hidden', 'true');
    document.body.appendChild(measureHost);
  }
  return measureHost;
}

/** Resolves a CSS length (mm) to px by handing it to a real element. */
function toPx(length, host) {
  const ruler = document.createElement('div');
  ruler.style.cssText = `position:absolute;visibility:hidden;height:${length}`;
  host.appendChild(ruler);
  const px = ruler.getBoundingClientRect().height;
  ruler.remove();
  return px;
}

/**
 * Lays one throwaway page out off-screen, at the real A4 page width and
 * at natural height, and reads the geometry back: how tall each row
 * actually is, and how much vertical room is left for the table body once
 * the letterhead, the title band, the totals and the foot have taken
 * theirs.
 *
 * The probe is measured outside <doc-page> on purpose — inside it, the
 * component's own sheet padding and size containment are still settling
 * on the first paint, and a page measured a few millimetres too narrow
 * wraps its cells and halves the row count.
 */
export function measure(spec, { context, printedAt, orientation }) {
  const host = ensureMeasureHost();
  const size = PAGE_SIZE[orientation] || PAGE_SIZE.portrait;
  host.style.width = size.width;
  host.innerHTML = renderPage(spec, spec.rows, {
    context, number: 1, total: 1, printedAt, isLast: true, probe: true,
  });

  const page = host.querySelector('.page');
  const pageTop = page.getBoundingClientRect().top;
  const heights = [...page.querySelectorAll('tbody tr')]
    .map((tr) => tr.getBoundingClientRect().height);

  const bodyTop = page.querySelector('tbody').getBoundingClientRect().top - pageTop;
  const foot = page.querySelector('.doc-foot');
  const footHeight = foot.getBoundingClientRect().height;

  const heightWithMargin = (el, side) => {
    if (!el) return 0;
    return el.getBoundingClientRect().height + parseFloat(getComputedStyle(el)[side]);
  };
  const signaturesHeight = heightWithMargin(page.querySelector('.doc-signatures'), 'marginBottom');
  const summaryHeight = heightWithMargin(page.querySelector('.doc-summary'), 'marginTop');
  const totalsHeight = page.querySelector('tfoot tr')?.getBoundingClientRect().height || 0;

  const box = toPx(size.height, host);
  const bottom = parseFloat(getComputedStyle(page).paddingBottom);

  host.innerHTML = '';
  return {
    heights,
    space: {
      // Intermediate pages carry neither the signature block nor the totals.
      body: box - bodyTop - bottom - (footHeight - signaturesHeight),
      bodyLast: box - bodyTop - bottom - footHeight - summaryHeight - totalsHeight,
    },
  };
}

/* ── Tabla ────────────────────────────────────────────────────────────── */

/*
 * Tabla je raspored po borilištima: **kolona po borilištu, kartica po
 * nastupu**.
 *
 * Tabela to ne ume. U njoj je red vodoravna celina, pa mora da bude visok
 * koliko i njegova najviša ćelija — raspored u kom jedno borilište ima
 * šesnaest stavki a ostala po šest zato ispadne tri lista, od kojih su dva
 * gotovo prazna. Tabla umesto reda ima kolonu koja teče sama za sebe:
 * kartica se stavlja tamo gde ima mesta, a ne u red koji čeka najdužu
 * kolonu, pa isti raspored stane na jedan list.
 *
 * Prelama se po kolonama: kad se strana napuni, kolona se nastavlja na
 * sledećoj, ispod istog zaglavlja. Prelom se, kao i kod tabele, računa iz
 * izmerene visine, a ne iz procene.
 */

/** Jedna kartica: redni broj nastupa, naslov i spisak pod njim. */
export const boardCard = (order, head, items = []) => ({ order, head, items });

const boardCardHtml = (card) => `
          <div class="board-card">
            <div class="board-card-head">${card.order
    ? `<span class="board-card-no">${esc(card.order)}.</span>` : ''}${esc(card.head)}</div>${card.items.length ? `
            <div class="board-card-list">${card.items.map(esc).join(' · ')}</div>` : ''}
          </div>`;

/** Jedna strana table: zaglavlja svih kolona i kartice koje su na nju stale. */
function boardPageHtml(board, slices, scale = 1) {
  return `
      <div class="board" style="--board-cols:${board.columns.length};--board-scale:${scale}">${board.columns.map((column, i) => `
        <div class="board-col">
          <div class="board-head">${esc(column.label)}</div>${(slices[i] || []).map(boardCardHtml).join('')}
        </div>`).join('')}
      </div>`;
}

/**
 * Meri tablu: koliko visine kolona ima na raspolaganju i kolika je svaka
 * kartica. Cela tabla se za to jednom položi van ekrana, na pravoj širini
 * lista — kartica prelomljena na dva reda visoka je dvostruko, a to se ne
 * može znati unapred.
 */
function measureBoard(spec, { context, printedAt, orientation, scale = 1 }) {
  const host = ensureMeasureHost();
  const size = PAGE_SIZE[orientation] || PAGE_SIZE.portrait;
  host.style.width = size.width;
  const all = spec.board.columns.map((column) => column.cards);
  host.innerHTML = renderPage({ ...spec, columns: [], lead: boardPageHtml(spec.board, all, scale) }, [], {
    context, number: 1, total: 1, printedAt, isLast: true, probe: true,
  });

  const page = host.querySelector('.page');
  const board = page.querySelector('.board');
  const boardTop = board.getBoundingClientRect().top - page.getBoundingClientRect().top;
  const footHeight = page.querySelector('.doc-foot').getBoundingClientRect().height;
  const summary = page.querySelector('.doc-summary');
  const summaryHeight = summary
    ? summary.getBoundingClientRect().height + parseFloat(getComputedStyle(summary).marginTop)
    : 0;
  const box = toPx(size.height, host);
  const bottom = parseFloat(getComputedStyle(page).paddingBottom);

  const columns = [...board.querySelectorAll('.board-col')];
  const gap = parseFloat(getComputedStyle(columns[0] || board).rowGap) || 0;
  // Zaglavlje kolone se ponavlja na svakoj strani, pa ga jednom oduzmemo od
  // raspoložive visine umesto da ga svaki put računamo.
  const headHeight = Math.max(0, ...columns.map(
    (c) => c.querySelector('.board-head')?.getBoundingClientRect().height || 0,
  ));
  const heights = columns.map((c) => [...c.querySelectorAll('.board-card')]
    .map((el) => el.getBoundingClientRect().height));

  host.innerHTML = '';
  return {
    heights,
    gap,
    space: box - boardTop - bottom - footHeight - summaryHeight - headHeight - gap,
  };
}

/** Kartice po stranama — svaka kolona se puni za sebe. */
function paginateBoard(board, { heights, gap, space }) {
  const pages = [];
  const pageAt = (i) => {
    if (!pages[i]) pages[i] = board.columns.map(() => []);
    return pages[i];
  };

  board.columns.forEach((column, c) => {
    let page = 0;
    let used = 0;
    column.cards.forEach((card, i) => {
      const height = heights[c]?.[i] || 0;
      const need = used ? used + gap + height : height;
      // Kartica viša od lista ostaje cela na svojoj strani — nema šta da se
      // preseče na pola.
      if (used && need > space) { page += 1; used = height; } else { used = need; }
      pageAt(page)[c].push(card);
    });
  });

  return pages.length ? pages : [board.columns.map(() => [])];
}

/**
 * Bira kako će tabla na papir: prvo položaj lista, pa veličinu sloga.
 *
 * Traži se **jedan list**, sa najvećim slovom koje na njega staje. Uspravan
 * list je viši, pa kolonu sa mnogo kartica često primi tamo gde ga položen
 * ne bi — zato se oba probaju, tim redom koji raspored zatraži. Smanjuje se
 * tek kad nijedan položaj ne pomogne, i to samo do granice ispod koje se
 * spisak na zidu više ne bi pročitao.
 */
const BOARD_SCALES = [1, 0.94, 0.88, 0.82];

function fitBoard(spec, { context, printedAt, orientation, pinned }) {
  const wanted = !pinned && spec.board.orientations?.length
    ? spec.board.orientations
    : [orientation];
  let best = null;
  for (const scale of BOARD_SCALES) {
    for (const side of wanted) {
      const pages = paginateBoard(
        spec.board,
        measureBoard(spec, { context, printedAt, orientation: side, scale }),
      );
      if (pages.length === 1) return { pages, orientation: side, scale };
      if (!best || pages.length < best.pages.length) best = { pages, orientation: side, scale };
    }
  }
  return best;
}

function renderBoard(spec, board, { pages, scale }, { context, total, printedAt, offset }) {
  return pages.map((slices, i) => renderPage({
    ...spec,
    columns: [],
    lead: boardPageHtml(board, slices, scale),
    foot: null,
  }, [], {
    context, number: offset + i + 1, total, printedAt, isLast: i === pages.length - 1,
  })).join('');
}

/* ── Upis na već odštampan papir ──────────────────────────────────────── */

/*
 * Diploma je **tuđi papir**. Odštampana je unapred, u tiražu, sa gotovim
 * tekstom i praznim linijama; posle takmičenja se u te linije upisuje ko je
 * šta osvojio. Aplikacija tu ne crta dokument nego pogađa mesto — zato list
 * ovde nema ni zaglavlje, ni naslov, ni podnožje, ni margine: samo tekst,
 * na milimetar tamo gde je urednik izmerio da na diplomi ima mesta.
 *
 * Milimetri se broje od ivice lista, a ne od ivice otiska, jer je to jedino
 * što se na diplomi može izmeriti lenjirom. Koliko od toga štampač zaista
 * može da otisne razlikuje se od uređaja do uređaja — zbog toga postoji
 * probni list, a ne zbog nesigurnosti u računicu.
 */

/** Jedan red upisa: šta piše i gde stoji. */
export const slipLine = (text, { top, x = 0, size, caps = false, strong = false }) =>
  ({ text, top, x, size, caps, strong });

/**
 * Koliko je koji red širok.
 *
 * Dva upisa umeju da stoje na istoj visini — „1. mesto" levo, disciplina
 * desno, jer diploma tako i piše: „осваја ___ место у дисциплини ___". Da
 * dugo ime discipline ne bi prešlo preko mesta, red se drži unutar polovine
 * razmaka do suseda na istoj visini; što ne stane, prelama se naniže umesto
 * da se pruži postrance.
 */
function slipWidths(lines, width) {
  const half = width / 2 - 8;
  const rows = new Map();
  lines.forEach((line) => {
    const key = Math.round(line.top * 2);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(line);
  });

  const reach = new Map();
  rows.forEach((group) => {
    const sorted = [...group].sort((a, b) => a.x - b.x);
    sorted.forEach((line, i) => {
      const left = i ? (line.x + sorted[i - 1].x) / 2 : -half;
      const right = i < sorted.length - 1 ? (line.x + sorted[i + 1].x) / 2 : half;
      reach.set(line, Math.max(8, Math.min(line.x - left, right - line.x)));
    });
  });
  return reach;
}

function slipLineHtml(line, reach) {
  const style = [
    `top:${line.top}mm`,
    `left:calc(50% + ${line.x - reach}mm)`,
    `width:${reach * 2}mm`,
    `font-size:${line.size}pt`,
  ].join(';');
  const classes = ['slip-line'];
  if (line.caps) classes.push('is-caps');
  if (line.strong) classes.push('is-strong');
  return `
      <div class="${classes.join(' ')}" style="${style}">${esc(line.text)}</div>`;
}

/**
 * Lenjir na probnom listu.
 *
 * Uz obe ivice ide skala u milimetrima od gornje ivice, a preko sredine
 * uspravna linija sa skalom levo i desno od nje — tačno tri mere koje
 * podešavanje traži. Probni list se štampa na običan papir i prisloni uz
 * diplomu prema svetlu; ono što se sa lenjira pročita upisuje se u polja.
 */
function slipRulerHtml({ width, height }) {
  const parts = [];
  for (let mm = 5; mm < height; mm += 5) {
    const ten = mm % 10 === 0;
    parts.push(`
      <div class="slip-tick is-left${ten ? ' is-ten' : ''}" style="top:${mm}mm"></div>
      <div class="slip-tick is-right${ten ? ' is-ten' : ''}" style="top:${mm}mm"></div>`);
    if (mm % 20 === 0) {
      parts.push(`
      <div class="slip-mm is-left" style="top:${mm}mm">${mm}</div>
      <div class="slip-mm is-right" style="top:${mm}mm">${mm}</div>`);
    }
  }

  const reach = Math.floor((width / 2 - 12) / 10) * 10;
  for (let mm = -reach; mm <= reach; mm += 10) {
    parts.push(`
      <div class="slip-col${mm === 0 ? ' is-mid' : ''}" style="left:calc(50% + ${mm}mm)"></div>
      <div class="slip-col-mm" style="left:calc(50% + ${mm}mm)">${mm > 0 ? '+' : ''}${mm}</div>`);
  }

  return `
      <div class="slip-ruler">${parts.join('')}
      </div>`;
}

/** Jedan list po diplomi — bez numeracije, jer je papir već sam svoj. */
function renderSlips(spec) {
  return spec.slips.map((slip) => {
    const reach = slipWidths(slip.lines, slip.size?.width || 210);
    return `
    <section class="page is-slip">${slip.ruler ? slipRulerHtml(slip.ruler) : ''}${
  slip.lines.map((line) => slipLineHtml(line, reach.get(line))).join('')}${slip.note ? `
      <div class="slip-note">${esc(slip.note)}</div>` : ''}
    </section>`;
  }).join('');
}

/**
 * Uvodne strane — sve što nije tabela: grana žreba, naslovna, šta god.
 *
 * Svaka je svoja strana i sama zna svoju visinu, pa se ne meri i ne prelama.
 * Numeracija ide kroz ceo dokument: uvodne strane i tabela iza njih su
 * **jedan dokument**, jer je grana bez spiska takmičara pola posla.
 */
function renderLeads(spec, leads, { context, total, printedAt, offset = 0 }) {
  return leads.map((lead, i) => renderPage({
    ...spec,
    ...lead,
    lead: lead.html,
    rows: [],
    columns: [],
    foot: null,
  }, [], {
    context,
    number: offset + i + 1,
    total,
    printedAt,
    isLast: true,
  })).join('');
}

/**
 * Jedan dokument u HTML: uvodne strane, pa tabla, pa tabela — u tom redu, sa
 * numeracijom koja teče kroz sve tri, jer je to **jedan dokument**.
 */
function renderDocument(spec, { context, printedAt, orientation, pinned = false }) {
  const rows = spec.rows || [];
  rows.forEach((row, i) => { row.index = i; });

  const leads = spec.leads || [];
  const slips = spec.slips || [];
  const board = spec.board
    ? fitBoard(spec, { context, printedAt, orientation, pinned })
    : null;
  // Tabla sama bira položaj lista; ostatak dokumenta ide za njom, jer je
  // <doc-page> jedan format papira za ceo štos.
  const side = board?.orientation || orientation;

  let chunks = [];
  if (rows.length) {
    const { heights, space } = measure(spec, { context, printedAt, orientation: side });
    chunks = paginate(rows, heights, space);
  }

  const boardPages = board ? board.pages.length : 0;
  const total = leads.length + boardPages + slips.length + chunks.length;
  const html = renderLeads(spec, leads, { context, total, printedAt })
    + (board
      ? renderBoard(spec, spec.board, board, { context, total, printedAt, offset: leads.length })
      : '')
    + (slips.length ? renderSlips(spec) : '')
    + chunks.map((slice, i) => renderPage(spec, slice, {
      context,
      number: leads.length + boardPages + slips.length + i + 1,
      total,
      printedAt,
      isLast: i === chunks.length - 1,
    })).join('');

  return { html, total, orientation: side };
}

export function renderInto(sheet, spec, { context, orientation = 'portrait', printedAt = stamp() }) {
  const out = renderDocument(spec, { context, printedAt, orientation });
  sheet.setAttribute('orientation', out.orientation);
  sheet.innerHTML = out.html;
  return out.total;
}

/**
 * Several documents into one print job — used by „Završetak sezone", where
 * every category is **its own list** and prints as one.
 *
 * Each document is measured and paginated on its own and keeps its own page
 * numbering („Strana 1 / 2" starts again at every list), because a person
 * holding the sheet for Grupa C · žene should see how long *that* list is,
 * not where it happens to sit in a stack of forty. Since the pages are
 * explicit sheets, the next list starts on fresh paper by construction.
 *
 * One orientation for the whole job — <doc-page> pins the page box once, and
 * a print job that flips paper halfway through is a jam waiting to happen.
 *
 * @returns {{documents:number, pages:number}}
 */
export function renderAllInto(sheet, jobs, { orientation = 'portrait', printedAt = stamp() } = {}) {
  const usable = jobs.filter(
    (job) => job.spec?.rows?.length || job.spec?.leads?.length
      || job.spec?.board || job.spec?.slips?.length,
  );
  sheet.setAttribute('orientation', orientation);

  let html = '';
  let pages = 0;
  usable.forEach(({ spec, context }) => {
    // Štos je jedan format papira od početka do kraja — dokument u njemu ne
    // sme sam da okrene list.
    const out = renderDocument(spec, { context, printedAt, orientation, pinned: true });
    html += out.html;
    pages += out.total;
  });

  sheet.innerHTML = html;
  return { documents: usable.length, pages };
}

/** „A4 uspravno · 3 strane" — the label under every rendered document. */
export const sheetLabel = (orientation, pages) =>
  `A4 ${orientation === 'landscape' ? 'položeno' : 'uspravno'} · ${pages} ${pageWord(pages)}`;
