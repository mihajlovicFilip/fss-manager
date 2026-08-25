/**
 * Zvanični dokumenti — the four official printouts for a competition.
 *
 * This file is only the four `spec`s and the toolbar that switches between
 * them. Measuring, pagination and the letterhead live in doc-render.js,
 * shared with the Štampaj button inside the app, so a document and a
 * printed list come out of the printer looking like the same federation
 * made them.
 */

import {
  FEDERATION, WEIGHTS, HOME_CLUB,
  ageByCode, clubByName, disciplineByName, surnameOf, categoryKey, dateLabel,
} from './data.js';
import { store } from './store.js';
import {
  esc, cell, col, stamp, uniqueCount, renderInto, sheetLabel,
} from './doc-render.js';

const bySurnameThenName = (a, b) =>
  surnameOf(a.name).localeCompare(surnameOf(b.name), 'sr') ||
  a.name.localeCompare(b.name, 'sr');

const byClubThenSurname = (a, b) =>
  a.club.localeCompare(b.club, 'sr') || bySurnameThenName(a, b);

const sexLabel = (sex, plural = false) =>
  sex === 'M' ? (plural ? 'muškarci' : 'muški') : (plural ? 'žene' : 'ženski');

/** Every official document is signed off by the same two people. */
const SIGNATURES = ['Glavni sudija', 'Delegat saveza'];

// ── Document specs ─────────────────────────────────────────────────────

/**
 * The category the sample "Lista po kategoriji" is drawn for, plus its
 * schedule slot. In the mounted app this comes from the drawn-categories
 * screen; here it is the one category the demo registry is seeded with.
 */
const DRAWN_CATEGORY = {
  // Sportski kumite, jer se on i deli po telesnoj težini — tradicionalni je apsolutan,
  // pa uz njega telesna težina u naslovu ne bi ni imala šta da traži.
  discipline: 'Fudokan sport kumite',
  group: 'G',
  sex: 'M',
  weight: '75',
  tatami: 2,
  startsAt: '11:00',
};

const DOCUMENTS = [
  {
    id: 'kategorija',
    label: 'Lista po kategoriji',
    orientation: 'portrait',
    build(registry) {
      const k = DRAWN_CATEGORY;
      const discipline = disciplineByName(k.discipline);
      const age = ageByCode(k.group);
      const rows = registry.entries.filter((e) =>
        e.discipline === k.discipline && e.group === k.group &&
        e.sex === k.sex && e.weight === k.weight);

      return {
        kicker: `${k.discipline} · pojedinačno`,
        title: `Grupa ${k.group} · ${age.name.toLowerCase()} · ${sexLabel(k.sex, true)} · ${k.weight} kg`,
        meta1: `Sistem: ${discipline.system.toLowerCase()} · trajanje meča ${WEIGHTS[k.group].bout}`,
        meta2: `Tatami ${k.tatami} · početak ${k.startsAt}`,
        signatures: SIGNATURES,
        docCode: `Lista kategorije FSK-${k.group}-${k.sex}-${k.weight}`,
        columns: [
          col('#', '26px', 'center'), col('Ime i prezime'), col('Ime kluba'), col('Grad'),
          col('Godište', '56px', 'center'), col('Pojas', '58px'), col('Trener'),
          col('Plasman', '62px', 'center'),
        ],
        rows: rows.map((e, i) => ({
          zebra: i % 2 === 1,
          cells: [
            cell(i + 1, 'center'), cell(e.name, 'left', true), cell(e.club), cell(e.city),
            cell(e.year, 'center'), cell(e.belt), cell(e.coach), cell(null, 'center'),
          ],
        })),
        summary: `Ukupno prijavljenih u kategoriji: ${rows.length}`,
        summaryRight: `Klubova: ${uniqueCount(rows, (e) => e.club)}`,
      };
    },
  },

  {
    id: 'klub',
    label: 'Prijava kluba',
    orientation: 'portrait',
    build(registry) {
      const club = clubByName(HOME_CLUB);
      const rows = registry.entries
        .filter((e) => e.club === club.name)
        .sort(bySurnameThenName);
      const teams = registry.teams.filter((t) => t.club === club.name);

      return {
        kicker: 'Prijava kluba',
        title: `${club.name} · ${club.city}`,
        meta1: `Trener: ${club.coach}`,
        meta2: 'Prijava predata 11.03.2026.',
        signatures: SIGNATURES,
        docCode: 'Prijava kluba KKBC-2026',
        columns: [
          col('#', '26px', 'center'), col('Ime i prezime'), col('M/Ž', '40px', 'center'),
          col('Godište', '56px', 'center'), col('Pojas', '58px'), col('Nivo', '58px'),
          col('Disciplina', '80px'), col('Grupa', '48px', 'center'), col('Potvrda', '66px', 'center'),
        ],
        rows: rows.map((e, i) => ({
          zebra: i % 2 === 1,
          cells: [
            cell(i + 1, 'center'), cell(e.name, 'left', true), cell(e.sex, 'center'),
            cell(e.year, 'center'), cell(e.belt), cell(e.level), cell(e.discipline),
            cell(e.group, 'center'), cell(null, 'center'),
          ],
        })),
        summary: `Ukupno prijava kluba: ${rows.length}`,
        summaryRight: `Pojedinačno: ${rows.length} · Ekipno: ${teams.length}`,
      };
    },
  },

  {
    id: 'ekipe',
    label: 'Ekipne prijave',
    orientation: 'portrait',
    build(registry) {
      const teams = registry.teams;
      const rows = [];
      teams.forEach((team, ti) => {
        team.members.forEach((m, mi) => {
          const last = mi === team.members.length - 1;
          rows.push({
            groupId: team.id,
            zebra: ti % 2 === 1,
            groupInner: !last,
            groupEnd: last,
            cells: [
              cell(mi === 0 ? ti + 1 : null, 'center'),
              // Vrsta ekipe uz ime discipline — enbu ima muški i mešoviti
              // par, i to je razlika koja se sa spiska mora videti.
              cell(mi === 0
                ? [team.discipline, team.variantLabel].filter(Boolean).join(' · ')
                : null, 'left', true),
              cell(mi === 0 ? (team.label || team.club) : null),
              cell(mi === 0 ? team.city : null),
              cell(m.name), cell(m.year, 'center'), cell(m.belt),
              cell(mi === 0 ? team.group : null, 'center'),
              cell(null, 'center'),
            ],
          });
        });
      });

      const members = teams.reduce((sum, t) => sum + t.members.length, 0);
      return {
        kicker: 'Ekipne prijave · list Tim',
        title: 'Prijavljene ekipe',
        meta1: '',
        meta2: '',
        signatures: SIGNATURES,
        docCode: 'Ekipne prijave EP-2026-01',
        columns: [
          col('#', '26px', 'center'), col('Ekipa', '112px'), col('Ime kluba'), col('Grad'),
          col('Takmičar'), col('Godište', '52px', 'center'), col('Pojas', '52px'),
          col('Grupa', '44px', 'center'), col('Potvrda', '58px', 'center'),
        ],
        rows,
        summary: `Ukupno ekipa: ${teams.length} · takmičara u ekipama: ${members}`,
        summaryRight: `Klubova: ${uniqueCount(teams, (t) => t.club)}`,
      };
    },
  },

  {
    id: 'pun',
    label: 'Pun spisak takmičara',
    orientation: 'landscape',
    rowsPerPage: 22,
    build(registry) {
      const rows = [...registry.entries].sort(byClubThenSurname);
      return {
        kicker: 'Zvanični spisak',
        title: 'Spisak prijavljenih takmičara',
        meta1: '',
        meta2: competition.entriesClosed
          ? `Prijave zaključene ${competition.entriesClosed}`
          : 'Prijave još nisu zaključene',
        signatures: SIGNATURES,
        docCode: 'Spisak takmičara SP-2026-01',
        columns: [
          col('#', '26px', 'center'), col('Ime i prezime'), col('Ime kluba'), col('Grad'),
          col('Trener'), col('M/Ž', '38px', 'center'), col('God.', '44px', 'center'),
          col('Pojas', '52px'), col('Nivo', '52px'), col('Disciplina', '78px'),
          col('Grupa', '46px', 'center'), col('Telesna težina', '50px', 'center'),
        ],
        rows: rows.map((e, i) => ({
          zebra: i % 2 === 1,
          cells: [
            cell(i + 1, 'center'), cell(e.name, 'left', true), cell(e.club), cell(e.city),
            cell(e.coach), cell(e.sex, 'center'), cell(e.year, 'center'), cell(e.belt),
            cell(e.level), cell(e.discipline), cell(e.group, 'center'),
            cell(e.weight ?? '', 'center'),
          ],
        })),
        summary: `Ukupno prijava: ${rows.length}`,
        summaryRight: `Klubova: ${uniqueCount(rows, (e) => e.club)} · Kategorija: ${uniqueCount(rows, categoryKey)}`,
      };
    },
  },
];

// ── Controller ─────────────────────────────────────────────────────────

/** Popunjava ih `start()` iz baze pre prvog iscrtavanja. */
let registry = { competitors: [], entries: [], teams: [] };
let competition = null;

const sheet = document.getElementById('doc-sheet');
const typeList = document.getElementById('doc-types');
const metaLabel = document.getElementById('doc-meta');

const docById = (id) => DOCUMENTS.find((d) => d.id === id) || DOCUMENTS[0];

let current = docById(location.hash.slice(1)).id;

function render() {
  if (!competition) {
    sheet.innerHTML = '';
    metaLabel.textContent = 'Nema aktuelnog takmičenja';
    return;
  }
  const doc = docById(current);
  const spec = doc.build(registry);
  const pages = renderInto(sheet, spec, {
    context: {
      name: competition.name,
      sub: `${dateLabel(competition.date)} · ${competition.place}`,
    },
    orientation: doc.orientation,
    printedAt: stamp(),
  });
  metaLabel.textContent = sheetLabel(doc.orientation, pages);

  typeList.querySelectorAll('.toolbar-type').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.type === current));
  });
  document.title = `${spec.title} · ${FEDERATION.name}`;
}

typeList.innerHTML = DOCUMENTS.map((d) => (
  `<button type="button" class="toolbar-type" role="tab" data-type="${d.id}"
     aria-selected="false">${esc(d.label)}</button>`
)).join('');

typeList.addEventListener('click', (event) => {
  const btn = event.target.closest('.toolbar-type');
  if (!btn) return;
  current = btn.dataset.type;
  history.replaceState(null, '', `#${current}`);
  render();
});

window.addEventListener('hashchange', () => {
  const next = docById(location.hash.slice(1)).id;
  if (next !== current) { current = next; render(); }
});

document.getElementById('doc-print').addEventListener('click', () => window.print());

/**
 * Učitava aktuelno takmičenje i njegove prijave, pa iscrtava. Dokumenti
 * uvek prikazuju ono takmičenje koje je izabrano u aplikaciji — nema
 * zasebnog izbora ovde, da se ne bi desilo da se štampa jedno a na ekranu
 * stoji drugo.
 */
async function start() {
  try {
    await store.ready();
    competition = await store.activeCompetition();
    registry = await store.registryFor(competition?.id);
  } catch (err) {
    metaLabel.textContent = 'Podaci se ne mogu otvoriti';
    console.error(err);
    return;
  }
  render();

  // Paginacija se meri, pa mora da se meri u pravom pismu. Prvo iscrtavanje
  // ume da stigne pre nego što je Barlow raščitan — kad fontovi legnu,
  // premeri se.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (document.fonts.status === 'loaded') render();
    });
  }
}

window.addEventListener('beforeprint', () => {
  if (competition && !document.querySelector('section.page')) render();
});

start();
