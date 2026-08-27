/**
 * Štampa iz aplikacije.
 *
 * Every list in the app has a Štampaj button, and every one of them ends
 * up here. The rule is simple and it is the whole point of the module:
 * **what goes on paper is what is on the screen.** Search boxes and
 * filters hide rows; the printout drops exactly those rows and names the
 * filter on the sheet, so nobody is left holding a list that quietly
 * omits half a discipline.
 *
 * How it works. A screen registers a *builder* — a plain function that,
 * called at print time, returns the spec for one document. The button (or
 * a plain Cmd+P) calls it, hands the spec to doc-render.js, drops the
 * result into a hidden <doc-page> and opens the print dialog. The app
 * itself is hidden for print media, the sheet takes its place, and the
 * page never navigates: the dialog opens over the list you were reading.
 *
 * Nothing here knows what a competitor or a club is. Žreb, tatami
 * schedules and rang lista register a builder the same way.
 */

import { renderInto, renderAllInto, stamp } from './doc-render.js';

/** The current screen's builder, or null on a screen with nothing to print. */
let builder = null;

/** The <doc-page> the document is drawn into. Created on first print. */
let sheet = null;

/** True while a whole stack sits on the sheet, so beforeprint leaves it be. */
let stacked = false;

function ensureSheet() {
  if (!sheet) {
    sheet = document.createElement('doc-page');
    sheet.className = 'print-sheet';
    sheet.setAttribute('size', 'a4');
    sheet.setAttribute('aria-hidden', 'true');
    document.body.appendChild(sheet);
  }
  return sheet;
}

/**
 * Registers what this screen prints, and throws away whatever the last
 * screen left in the sheet. Call it on every render — with `null` for a
 * screen that has nothing to print, so Cmd+P there falls back to the
 * browser's own behaviour instead of printing a stale list.
 */
export function setPrintable(fn) {
  builder = fn || null;
  stacked = false;
  if (sheet) sheet.innerHTML = '';
  document.body.classList.remove('is-printing');
}

/**
 * Builds the document and marks the body so the print stylesheet swaps the
 * app for the sheet. Returns false when there is nothing to print — the
 * mark comes off and the browser prints the screen as it normally would.
 */
function prepare() {
  // Na listu već stoji ceo štos i `window.print()` je ovo i pokrenuo — ne
  // gazi ga onim što je trenutno na ekranu.
  //
  // Zastavica se **ne** spušta posle `print()` nego tek na sledećem
  // iscrtavanju (`setPrintable`). Razlog je trka: `beforeprint` i
  // `afterprint` u nekim pregledačima stižu tek pošto `print()` vrati
  // kontrolu, i to ne uvek tim redom. Ko spusti zastavicu ranije, dočeka
  // `beforeprint` bez nje, pokuša da gradi iz ekranskog builder-a (kog na
  // žrebu nema) i skloni papir taman pred štampu — u PDF-u tada umesto
  // grane izađe ekran.
  if (stacked) return true;
  const job = builder?.();
  if (!job || !(job.spec?.rows?.length || job.spec?.leads?.length || job.spec?.board)) {
    // Ekran bez svog builder-a, a na listu ipak nešto stoji: to je štos koji
    // je neko upravo pripremio. Ostavi ga.
    if (!sheet?.firstElementChild) document.body.classList.remove('is-printing');
    return !!sheet?.firstElementChild;
  }
  renderInto(ensureSheet(), job.spec, {
    context: job.context,
    orientation: job.orientation || 'portrait',
    printedAt: stamp(),
  });
  document.body.classList.add('is-printing');
  return true;
}

/** The Štampaj button. Returns false if the screen had nothing to print. */
export function printNow() {
  if (!prepare()) return false;
  window.print();
  return true;
}

/**
 * Prints a whole stack in one go — many documents, one print job, each on
 * its own paper with its own page numbering. This is what „Završetak
 * sezone" uses: one list per category, exactly as Filip asked.
 *
 * Bypasses the registered builder on purpose. The stack is assembled at the
 * moment the editor asks for it, not on every render.
 *
 * @returns {{documents:number, pages:number}} what actually went to paper
 */
export function printStack(jobs, orientation = 'portrait') {
  const done = renderAllInto(ensureSheet(), jobs, { orientation, printedAt: stamp() });
  if (!done.documents) {
    document.body.classList.remove('is-printing');
    return done;
  }
  document.body.classList.add('is-printing');
  stacked = true;
  window.print();
  return done;
}

// Cmd+P / Ctrl+P bypasses the button, so build there too — otherwise the
// most obvious way to print would produce an empty sheet. The button's own
// window.print() lands here as well; rebuilding is cheap and keeps one path.
window.addEventListener('beforeprint', prepare);

// ── Reading the screen ─────────────────────────────────────────────────

/**
 * Is this element still on screen, or did a filter hide it?
 *
 * Both the search boxes and the results filters work by setting `hidden`,
 * on the row itself or on the category or discipline around it — so one
 * `closest` answers the question at every level at once. Deliberately not
 * `offsetParent`: a row inside a collapsed accordion is on the screen,
 * just folded away, and it belongs on the printout.
 */
export const onScreen = (el) => !!el && !el.closest('[hidden]');

/**
 * The values of the visible rows' `data-print-id`, in screen order — the
 * bridge between a filtered table and the data it was drawn from.
 */
export function visibleIds(selector = '[data-print-id]', root = document) {
  return [...root.querySelectorAll(selector)]
    .filter(onScreen)
    .map((el) => el.dataset.printId);
}

/**
 * „Disciplina: Kate · Godište: 2010" — the active filters, written out for
 * the sheet. A printed list must say what it left out.
 *
 * @param {Array<[string, string]>} pairs label and chosen value, value
 *        empty when that filter is not set
 */
export const filterLabel = (pairs) => pairs
  .filter(([, value]) => value)
  .map(([label, value]) => `${label}: ${value}`)
  .join(' · ');
