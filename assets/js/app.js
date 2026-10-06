/**
 * App shell: navigation, dashboard and competition records.
 *
 * Screens use hash routes, so they can be linked directly and survive refreshes.
 * Documents use a separate page because printing has its own layout rules.
 *
 * All data comes from store.js. Missing values are shown as empty states,
 * not as made-up numbers.
 */

import {
  FEDERATION, DISCIPLINES, COMPETITION_LEVELS, PLACEMENTS, CALENDARS, MONTHS, APP_VERSION, AGES,
  categoryKey, disciplinesForGroup, disciplineByName, dateLabel, ageByCode, clubByName,
  placementByKey, placementSlots, pointsFor, calendarOf, teamCategoryLabel, teamSizeLabel,
  seasonOf, yearsLabel, DIPLOMA_LINES, DIPLOMA_DEFAULT, entriesOpen, pointsCounted,
  BELTS, CLUBS, WEIGHTS, groupOfYear, levelOfBelt, FEES_DEFAULT,
  FSS_ID_SINCE, fssIdOf, fssHistory, nameParts,
} from './data.js';
import { store } from './store.js';
import { cell, col, boardCard, slipLine, uniqueCount, bracketHtml } from './doc-render.js';
import { drawCategory, MAX_BRACKET } from './draw.js';
import { setPrintable, printNow, printStack, visibleIds, onScreen, filterLabel } from './print.js';
import { readEntryFile } from './import.js';
import { buildEntryForm } from './entry-form.js';

// === Helpers =============================================

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/** Format thousands with a space, for example 1486 becomes "1 486". */
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const plural = (n, one, few, many) => {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
};

const uniq = (items, key) => new Set(items.map(key));

// === Screens =============================================

/* Navigation order follows the menu.
 * Items without a view are planned screens and open a short description instead. */
const SCREENS = [
  { id: 'kontrolna-tabla', label: 'Kontrolna tabla', view: 'dashboard',
    kicker: () => FEDERATION.name, title: 'Kontrolna tabla' },

  { id: 'takmicenja', label: 'Takmičenja', view: 'competitions',
    kicker: () => 'Evidencija', title: 'Takmičenja',
    actions: [
      { label: 'Vrati demo podatke', go: 'reset-demo', quiet: true },
      { label: '+ Novo takmičenje', go: 'novo-takmicenje', primary: true },
    ] },

  { id: 'takmicari', label: 'Takmičari', view: 'competitors', title: 'Takmičari' },

  { id: 'klubovi', label: 'Klubovi', view: 'clubs',
    kicker: () => 'Evidencija', title: 'Klubovi' },

  { id: 'uvoz', label: 'Uvoz prijava', view: 'import',
    kicker: () => 'Excel formulari koje klubovi šalju', title: 'Uvoz prijava' },

  { id: 'zreb', label: 'Žreb / Tabele', view: 'draw',
    kicker: () => 'Grane po kategorijama', title: 'Žreb' },

  { id: 'tatami', label: 'Tatami', view: 'tatami',
    kicker: () => 'Raspored', title: 'Borilišta' },

  { id: 'rezultati', label: 'Rezultati', view: 'results', title: 'Rezultati' },

  { id: 'diplome', label: 'Diplome', view: 'diplomas',
    kicker: () => 'Upis na odštampane diplome', title: 'Diplome' },

  { id: 'rang', label: 'Rang lista', view: 'rankings',
    kicker: () => 'Bodovanje kroz sezonu', title: 'Rang lista' },

  { id: 'kalendar', label: 'Kalendar', view: 'calendar',
    kicker: () => 'A i B lista', title: 'Kalendar',
    actions: [{ label: '+ Novo takmičenje', go: 'novo-takmicenje', primary: true }] },

  { id: 'dokumenti', label: 'Dokumenti', href: 'documents.html' },

  { id: 'podesavanja', label: 'Podešavanja', view: 'settings',
    kicker: () => 'Cenovnik i pravila', title: 'Podešavanja' },
];

const NAV_MAIN = ['kontrolna-tabla', 'takmicenja', 'uvoz', 'takmicari',
  'klubovi', 'zreb', 'tatami', 'rezultati', 'diplome', 'rang',
  'kalendar', 'dokumenti'];

const screenById = (id) => SCREENS.find((s) => s.id === id);

// === Derived values =============================================
/* Dashboard values are calculated from the registry.
 * pending: true means the value is not available yet, so it is shown as a dash instead of zero. */
function summarise(registry, competition) {
  const { competitors, entries, teams } = registry;
  const active = competition?.disciplines?.length || DISCIPLINES.length;
  const used = uniq(entries, (e) => e.discipline).size;

  return [
    { label: 'Takmičari', value: num(competitors.length), note: 'jedinstvenih lica' },
    { label: 'Prijave', value: num(entries.length), note: 'jedan red po disciplini' },
    { label: 'Klubovi', value: num(uniq(entries, (e) => e.club).size),
      note: `iz ${uniq(entries, (e) => e.city).size} ${plural(uniq(entries, (e) => e.city).size, 'grada', 'grada', 'gradova')}` },
    { label: 'Kategorije', value: num(uniq(entries, categoryKey).size),
      note: `${plural(used, 'aktivna', 'aktivne', 'aktivnih')} ${used} od ${active} disciplina` },
    { label: 'Ekipe', value: num(teams.length),
      note: `${teams.reduce((s, t) => s + t.members.length, 0)} takmičara u ekipama` },
    { label: 'Mečevi', value: '—', pending: true, note: 'žreb nije generisan' },
  ];
}

/* Checks the registry and returns only real issues.
 * If everything is fine, no issues are shown. */
function checks(registry) {
  const { entries } = registry;
  const found = [];

  const byCategory = new Map();
  entries.forEach((e) => byCategory.set(categoryKey(e), (byCategory.get(categoryKey(e)) || 0) + 1));
  const singles = [...byCategory.values()].filter((n) => n === 1).length;
  if (singles) {
    found.push({
      title: `${singles} ${plural(singles, 'kategorija', 'kategorije', 'kategorija')} sa jednim takmičarem`,
      action: 'Otvori žreb →', go: 'zreb',
    });
  }

  const noWeight = entries.filter((e) =>
    disciplineByName(e.discipline)?.drawBy === 'weight' && !e.weight);
  if (noWeight.length) {
    found.push({
      title: `${noWeight.length} ${plural(noWeight.length, 'prijava', 'prijave', 'prijava')} bez telesne težine`,
      action: 'Otvori takmičare →', go: 'takmicari',
    });
  }

  const illegal = entries.filter((e) =>
    !disciplinesForGroup(e.group).some((d) => d.name === e.discipline));
  if (illegal.length) {
    found.push({
      title: `${illegal.length} ${plural(illegal.length, 'prijava', 'prijave', 'prijava')} van matrice disciplina`,
      action: 'Otvori takmičare →', go: 'takmicari',
    });
  }

  return found;
}

// === Competition state =============================================

/* Competition status can move forward or backward.
 * Late entries and result corrections may require reopening a previous stage. */

function statusActions(status) {
  switch (status) {
    case 'Nacrt':
      return [{ label: 'Otvori prijave', to: 'Prijave otvorene', strong: true }];
    case 'Prijave otvorene':
      return [{ label: 'Zatvori prijave', to: 'Prijave zatvorene', strong: true }];
    case 'Prijave zatvorene':
      return [
        { label: 'Vrati prijave', to: 'Prijave otvorene' },
        { label: 'Zatvori takmičenje', to: 'Završeno', strong: true },
      ];
    case 'Završeno':
      return [{ label: 'Otvori takmičenje', to: 'Prijave zatvorene' }];
    default:
      return [{ label: 'Otvori prijave', to: 'Prijave otvorene', strong: true }];
  }
}

// === Dashboard =============================================

function dashboardHtml({ competition, registry, demoStale }) {
  if (!competition) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema nijednog takmičenja</h2>
        <p class="soon-note">Nema izabranog takmičenja.</p>
        <div class="soon-links">
          <button type="button" class="btn-app is-primary" data-go="novo-takmicenje">+ Novo takmičenje</button>
        </div>
      </div>`;
  }

  const statTiles = summarise(registry, competition).map((s) => `
    <div class="stat${s.pending ? ' is-pending' : ''}">
      <div class="stat-label">${esc(s.label)}</div>
      <div class="stat-value">${esc(s.value)}</div>
      <div class="stat-note">${esc(s.note)}</div>
    </div>`).join('');

// Older demo data is refreshed only if the database is still untouched.
// If the user already has their own data, it is left unchanged.
  const stale = demoStale ? {
    title: 'Demo podaci su stariji od aplikacije',
    note: 'Vraćanje demo podataka briše sve iz baze.',
    action: 'Vrati demo podatke',
    go: 'reset-demo',
  } : null;

  const found = [...(stale ? [stale] : []),
    ...(registry.entries.length ? checks(registry) : [])];
  const checkList = registry.entries.length === 0 && !stale
    ? '<div class="empty">Nema nijedne prijave.</div>'
    : (found.length ? found.map((c) => `
      <div class="check">
        <div class="check-title">${esc(c.title)}</div>
        <div class="check-note">${esc(c.note)}</div>
        <button type="button" class="check-action" data-go="${esc(c.go)}">${esc(c.action)}</button>
      </div>`).join('')
      : '<div class="empty">Sve provere prolaze.</div>');

  return `
    <div class="comp-card">
      <i class="mark tl" aria-hidden="true">+</i><i class="mark tr" aria-hidden="true">+</i>
      <i class="mark bl" aria-hidden="true">+</i><i class="mark br" aria-hidden="true">+</i>
      <div class="comp-info">
        <div class="comp-label">Aktuelno takmičenje</div>
        <div class="comp-name">${esc(competition.name)}</div>
        <div class="comp-when">${esc(dateLabel(competition.date))} · ${esc(competition.place)} ·
          <span class="cal-tag is-${esc(calendarOf(competition).toLowerCase())}">${
            esc(calendarOf(competition))}</span>
          ${calendarOf(competition) === 'A' ? 'lista — ulazi u bodovanje' : 'lista — ne ulazi u bodovanje'}
        </div>
        <div class="comp-state">
          <span class="comp-status">${esc(competition.status)}</span>
          ${statusActions(competition.status).map((a) => `
            <button type="button" class="btn-status${a.strong ? ' is-strong' : ''}"
                    data-status="${esc(a.to)}">${esc(a.label)}</button>`).join('')}
        </div>
      </div>
      <div class="comp-actions">
        <button type="button" class="btn-app is-primary" data-go="uvoz">Uvezi Excel</button>
        <button type="button" class="btn-app" data-go="novo-takmicenje">Novo takmičenje</button>
        <button type="button" class="btn-app" data-go="takmicenja">Sva takmičenja</button>
        <a class="btn-app" href="documents.html">Štampaj liste</a>
      </div>
    </div>

    <div class="stats">${statTiles}</div>

    <div class="panels">
      <section>
        <div class="panel-title">Poslednja aktivnost</div>
        <div class="empty">Dnevnik događaja još nije u upotrebi.</div>
      </section>
      <section>
        <div class="panel-title">Zahteva pažnju</div>
        ${checkList}
      </section>
    </div>`;
}

// === Competitions =============================================

function competitionsHtml({ competitions, activeId, counts }) {
  if (!competitions.length) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Evidencija je prazna</h2>
        <p class="soon-note">Nijedno takmičenje još nije kreirano.</p>
        <div class="soon-links">
          <button type="button" class="btn-app is-primary" data-go="novo-takmicenje">+ Novo takmičenje</button>
        </div>
      </div>`;
  }

  const rows = competitions.map((c) => `
    <tr data-print-id="${esc(c.id)}"${c.id === activeId ? ' class="is-active"' : ''}>
      <td class="col-name">
        <button type="button" class="link-cell" data-open="${esc(c.id)}">${esc(c.name)}</button>
        ${c.id === activeId ? '<span class="badge-active">aktuelno</span>' : ''}
      </td>
      <td class="col-num">${esc(dateLabel(c.date))}</td>
      <td>${esc(c.place)}</td>
      <td>${esc(c.level)}</td>
      <td class="col-num"><span class="cal-tag is-${esc(calendarOf(c).toLowerCase())}"
        title="${calendarOf(c) === 'A' ? 'Ulazi u bodovanje' : 'Ne ulazi u bodovanje'}">${
        esc(calendarOf(c))}</span></td>
      <td class="col-num">${esc(num(counts.get(c.id) ?? 0))}</td>
      <td><span class="pill">${esc(c.status)}</span></td>
      <td class="col-actions">
        <button type="button" class="link-cell" data-open="${esc(c.id)}">Otvori</button>
        <button type="button" class="link-cell is-danger" data-delete="${esc(c.id)}">Obriši</button>
      </td>
    </tr>`).join('');

  return `
    <table class="grid">
      <thead>
        <tr>
          <th>Takmičenje</th><th>Datum</th><th>Mesto</th><th>Nivo</th>
          <th class="col-num" title="A lista ulazi u bodovanje, B ne">Lista</th>
          <th class="col-num">Prijave</th><th>Status</th><th class="col-actions">Akcije</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// === COmpetitors =============================================

/**
 * Competitors in the current competition, with medals and points.
 *
 * "Bodovi" shows the result from this competition.
 * "Ukupno" shows points across all stored seasons.
 * Competitors are matched by license number, even if they change clubs.
 */
function competitorsHtml({ competition, registry, tally }) {
  if (!competition) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema aktuelnog takmičenja</h2>
        <p class="soon-note">Nema izabranog takmičenja.</p>
        <div class="soon-links">
          <button type="button" class="btn-app is-primary" data-go="takmicenja">Takmičenja</button>
        </div>
      </div>`;
  }
  if (!registry.competitors.length) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Još nema prijavljenih</h2>
        <p class="soon-note">Na takmičenju „${esc(competition.name)}" nema nijedne prijave.</p>
        ${entriesOpen(competition) ? `
        <div class="soon-links">
          <button type="button" class="btn-app is-primary" data-new-entry>+ Nova prijava</button>
          <button type="button" class="btn-app" data-go="uvoz">Uvoz prijava</button>
        </div>` : ''}
      </div>`;
  }

  const entriesByCompetitor = new Map();
  registry.entries.forEach((e) => {
    if (!entriesByCompetitor.has(e.competitorId)) entriesByCompetitor.set(e.competitorId, []);
    entriesByCompetitor.get(e.competitorId).push(e);
  });

// Points stay empty on the B list, so the UI explains why
// instead of making it look like results are missing.
  const notice = calendarOf(competition) === 'B' ? `
    <div class="notice">Takmičenje je na <b>B listi</b> — plasmani i medalje se
    beleže kao i svuda, ali ne nose bodove, pa su kolone „Bodovi" i „Ukupno"
    prazne za ovo takmičenje.</div>` : '';

// Entries can only be corrected while registration is open.
// After that, the column is hidden and a note explains how to reopen it.
  const open = entriesOpen(competition);
  const frozen = open ? '' : `
    <div class="notice">Prijave su zatvorene — podaci se više ne menjaju.
    Vrati prijave na kontrolnoj tabli ako treba ispravka.</div>`;

  const blank = { zlato: 0, srebro: 0, bronza: 0, ucesce: 0, medalje: 0, bodovi: 0 };
  const rows = [...registry.competitors]
    .sort((a, b) => a.name.localeCompare(b.name, 'sr'))
    .map((c, i) => {
      const row = tally.get(c.personId);
      const here = row?.here || blank;
      const total = row?.total || blank;
      const mine = entriesByCompetitor.get(c.id) || [];
      const age = ageByCode(c.group);
      const { first, last } = nameParts(c);
      // Searchable either way round — "Petrović Petar" finds Petar Petrović.
      const words = [first, last, c.club, c.fssId || '', `${last} ${first}`];
      return `
      <tr data-print-id="${esc(c.id)}" data-search="${esc(words.join(' ').toLowerCase())}">
        <td class="col-num">${i + 1}</td>
        <td class="col-id">${c.fssId ? esc(c.fssId) : '<span class="text-muted">—</span>'}</td>
        <td class="col-name">
          <button type="button" class="link-cell" data-person="${esc(c.personId)}">${esc(first)}</button>
        </td>
        <td class="col-name">
          <button type="button" class="link-cell" data-person="${esc(c.personId)}">${esc(last)}</button>
        </td>
        <td>${esc(c.club)}</td>
        <td title="${esc(age ? age.name : '')}">${esc(c.group)}</td>
        <td class="col-num">${esc(c.year)}</td>
        <td>${esc(c.belt)}</td>
        <td class="col-num">${mine.length}</td>
        <td class="col-num${here.zlato ? ' is-medal' : ''}">${here.zlato || '·'}</td>
        <td class="col-num${here.srebro ? ' is-medal' : ''}">${here.srebro || '·'}</td>
        <td class="col-num${here.bronza ? ' is-medal' : ''}">${here.bronza || '·'}</td>
        <td class="col-num">${here.ucesce || '·'}</td>
        <td class="col-num is-strong">${here.bodovi ? num(here.bodovi) : '·'}</td>
        <td class="col-num is-total" title="${total.competitions || 0} ${plural(total.competitions || 0, 'takmičenje', 'takmičenja', 'takmičenja')}">${total.bodovi ? num(total.bodovi) : '·'}</td>${open ? `
        <td class="col-edit"><button type="button" class="link-cell"
            data-edit-entry="${esc(c.id)}">Izmeni</button></td>` : ''}
      </tr>`;
    }).join('');

  return `
    ${notice}${frozen}
    <div class="list-tools">
      <input class="control search" id="competitor-search" type="search"
             placeholder="Pretraga po imenu, klubu ili FSS ID-u" aria-label="Pretraga takmičara">
      <span class="list-count" id="competitor-count">${registry.competitors.length} ${plural(registry.competitors.length, 'takmičar', 'takmičara', 'takmičara')}</span>
      ${open ? '<button type="button" class="btn-app is-quiet" data-new-entry>+ Nova prijava</button>' : ''}
    </div>
    <table class="grid is-dense">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th title="Godišnji ID takmičara za ${esc(seasonOf(competition))}. godinu">FSS ID</th>
          <th>Ime</th>
          <th>Prezime</th>
          <th>Klub</th>
          <th title="Uzrasna grupa">Grupa</th>
          <th class="col-num">Godište</th>
          <th>Pojas</th>
          <th class="col-num" title="Broj prijava na ovom takmičenju">Prijave</th>
          <th class="col-num" title="Zlato — ${PLACEMENTS[0].points} bodova">Zlato</th>
          <th class="col-num" title="Srebro — ${PLACEMENTS[1].points} bodova">Srebro</th>
          <th class="col-num" title="Bronza — ${PLACEMENTS[2].points} bodova">Bronza</th>
          <th class="col-num" title="Učešće — ${PLACEMENTS[3].points} bodova">Učešće</th>
          <th class="col-num" title="Bodovi na ovom takmičenju">Bodovi</th>
          <th class="col-num" title="Zbir sa zatvorenih takmičenja koja baza pamti">Ukupno</th>${open ? `
          <th class="col-edit"><span class="sr-only">Ispravka</span></th>` : ''}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Edit a single entry while registration is open.
 *
 * Age group is calculated from birth year, and available disciplines
 * and weight classes are limited to valid options for that competitor.
 * Changing birth year or gender updates the available choices automatically.
 */
  function editEntryModal({ competition, competitor, entries, isNew = false }) {
  const season = seasonOf(competition);
  const years = Array.from({ length: 101 }, (unused, i) => season - i);
  const picked = new Set(entries.map((e) => e.discipline));

  const clubs = [...new Set(CLUBS.map((c) => c.name).concat(competitor.club || []))]
    .sort((a, b) => a.localeCompare(b, 'sr'));

  modalRoot.innerHTML = `
    <div class="backdrop" data-close>
      <form class="modal is-wide" id="edit-entry-form" novalidate>
        <i class="mark tl" aria-hidden="true">+</i><i class="mark tr" aria-hidden="true">+</i>
        <i class="mark bl" aria-hidden="true">+</i><i class="mark br" aria-hidden="true">+</i>
        <h2 class="modal-title">${isNew ? 'Nova prijava' : 'Ispravka prijave'}</h2>
        ${season >= FSS_ID_SINCE ? `
        <p class="modal-note is-lead">FSS ID za ${season}: ${isNew
    ? 'dodeljuje se pri upisu'
    : `<b>${esc(competitor.fssId || '—')}</b> — ID se ne menja ručno`}</p>` : ''}

        <div class="form-grid">
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="e-first">Ime</label>
              <input class="control" id="e-first" name="firstName" value="${esc(nameParts(competitor).first)}">
            </div>
            <div class="field">
              <label class="field-label" for="e-last">Prezime</label>
              <input class="control" id="e-last" name="lastName" value="${esc(nameParts(competitor).last)}">
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label class="field-label" for="e-year">Godište</label>
              <select class="control" id="e-year" name="year">${years.map((y) => `
                <option value="${y}"${y === Number(competitor.year) ? ' selected' : ''}>${y}</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="e-sex">Pol</label>
              <select class="control" id="e-sex" name="sex">
                <option value="M"${competitor.sex === 'M' ? ' selected' : ''}>muški</option>
                <option value="Ž"${competitor.sex === 'Ž' ? ' selected' : ''}>ženski</option>
              </select>
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label class="field-label" for="e-belt">Pojas</label>
              <select class="control" id="e-belt" name="belt">${BELTS.map((b) => `
                <option value="${esc(b)}"${b === competitor.belt ? ' selected' : ''}>${esc(b)}</option>`).join('')}
              </select>
            </div>
            <div class="field" id="e-weight-field"></div>
          </div>

          <div class="field-row">
            <div class="field">
              <label class="field-label" for="e-club">Klub</label>
              <select class="control" id="e-club" name="club">${clubs.map((c) => `
                <option value="${esc(c)}"${c === competitor.club ? ' selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="field">
            <span class="field-label">Discipline</span>
            <div class="picks" id="e-disciplines"></div>
          </div>

          <p class="modal-note" id="e-derived"></p>
        </div>

        <p class="form-error" id="e-error" hidden></p>

        <div class="modal-actions" id="e-actions">
          ${isNew ? '' : '<button type="button" class="btn-app is-danger" id="e-remove">Ukloni prijavu</button>'}
          <span class="modal-spacer"></span>
          <button type="button" class="btn-app" data-close>Otkaži</button>
          <button type="submit" class="btn-app is-primary">${
  isNew ? 'Upiši prijavu' : 'Sačuvaj ispravku'}</button>
        </div>
      </form>
    </div>`;

  const form = document.getElementById('edit-entry-form');
  const derived = document.getElementById('e-derived');
  const box = document.getElementById('e-error');

  /** Update everything that depends on birth year or gender whenever either changes. */
  function paint() {
    const year = Number(form.year.value);
    const sex = form.sex.value;
    const group = groupOfYear(year, season);
    const age = ageByCode(group);
    const possible = group ? disciplinesForGroup(group).filter((d) => !d.team) : [];

    const chosen = new Set([...form.querySelectorAll('[name="disciplines"]:checked')]
      .map((input) => input.value));
    // The first render takes what the entry holds; every later one what
    // the user has ticked since.
    const keep = chosen.size || form.dataset.painted ? chosen : picked;

    document.getElementById('e-disciplines').innerHTML = possible.map((d) => `
      <label class="pick">
        <input type="checkbox" name="disciplines" value="${esc(d.name)}"${
  keep.has(d.name) ? ' checked' : ''}>
        <span>${esc(d.name)}</span>
      </label>`).join('') || '<span class="modal-note">Za taj uzrast nema nijedne discipline.</span>';

    const allowed = WEIGHTS[group]?.[sex] || [];
    const wanted = possible.some((d) => d.drawBy === 'weight' && keep.has(d.name));
    document.getElementById('e-weight-field').innerHTML = allowed.length ? `
      <label class="field-label" for="e-weight">Telesna težina${wanted ? '' : ' (nije obavezna)'}</label>
      <select class="control" id="e-weight" name="weight">
        <option value="">—</option>${allowed.map((w) => `
        <option value="${esc(w)}"${w === competitor.weight ? ' selected' : ''}>${esc(w)}</option>`).join('')}
      </select>` : '';

    derived.textContent = group
      ? `Uzrast: grupa ${group} · ${age.name.toLowerCase()} · ${levelOfBelt(form.belt.value)}`
      : `Godište ${year} nije obuhvaćeno uzrasnom tabelom.`;
    form.dataset.painted = '1';
  }

  paint();
  form.querySelector('#e-year').addEventListener('change', paint);
  form.querySelector('#e-sex').addEventListener('change', paint);
  form.querySelector('#e-belt').addEventListener('change', paint);
  form.querySelector('#e-disciplines').addEventListener('change', paint);
  form.querySelector('#e-first').focus();

  const fail = (message) => {
    box.textContent = message;
    box.hidden = false;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    box.hidden = true;
    const patch = {
      firstName: form.querySelector('#e-first').value,
      lastName: form.querySelector('#e-last').value,
      club: form.club.value,
      sex: form.sex.value,
      year: Number(form.year.value),
      belt: form.belt.value,
      weight: form.querySelector('#e-weight')?.value || '',
      disciplines: [...form.querySelectorAll('[name="disciplines"]:checked')]
        .map((input) => input.value),
    };
    const ime = `${patch.firstName.trim()} ${patch.lastName.trim()}`.trim();

    try {
      if (isNew) {
        const done = await store.addCompetitor(competition.id, patch);
        closeModal();
    // The message agrees with the competitor's sex — "upisana", not "upisan".
        const ona = patch.sex === 'Ž';
        toast([
          `${ime} — ${ona ? 'upisana' : 'upisan'}, uzrast ${done.group}`,
          done.fssId ? `FSS ID ${done.fssId}` : '',
          `${done.entries} ${plural(done.entries, 'disciplina', 'discipline', 'disciplina')}`,
          done.elsewhere ? 'isto ime i godište postoji pod drugim klubom — upisan kao nov takmičar'
            : (done.known ? `${ona ? 'prepoznata' : 'prepoznat'} iz ranijih takmičenja` : ''),
        ].filter(Boolean).join(' · ') + '.');
      } else {
        const done = await store.editCompetitor(competition.id, competitor.id, patch);
        closeModal();
        toast([
          `${ime} — ispravljeno, uzrast ${done.group}`,
          done.added ? `${done.added} ${plural(done.added, 'disciplina dodata', 'discipline dodate', 'disciplina dodato')}` : '',
          done.removed ? `${done.removed} ${plural(done.removed, 'uklonjena', 'uklonjene', 'uklonjeno')}` : '',
          done.teams ? `ispravljeno i u ${done.teams} ${plural(done.teams, 'ekipi', 'ekipe', 'ekipa')}` : '',
          done.merged ? `spojeno sa licem koje već postoji u bazi${
            done.fssId ? `, važeći FSS ID ${done.fssId}` : ''}` : '',
        ].filter(Boolean).join(' · ') + '.');
      }
      render();
    } catch (err) {
      fail(err.message);
    }
  });

  document.getElementById('e-remove')?.addEventListener('click', () => {
    const actions = document.getElementById('e-actions');
    actions.innerHTML = `
      <span class="modal-note">Ukloniti ${esc(competitor.name)} sa takmičenja,
        sa svim disciplinama i ekipama u kojima je član?</span>
      <span class="modal-spacer"></span>
      <button type="button" class="btn-app" data-close>Otkaži</button>
      <button type="button" class="btn-app is-danger" id="e-remove-yes">Ukloni</button>`;
    document.getElementById('e-remove-yes').addEventListener('click', async () => {
      try {
        const done = await store.removeCompetitor(competition.id, competitor.id);
        closeModal();
        toast(`${competitor.name} je ${competitor.sex === 'Ž' ? 'uklonjena' : 'uklonjen'} — ${
          done.entries} ${plural(done.entries, 'prijava', 'prijave', 'prijava')}`
          + (done.teams ? ` i ${done.teams} ${plural(done.teams, 'ekipa', 'ekipe', 'ekipa')}` : '') + '.');
        render();
      } catch (err) {
        closeModal();
        toast(err.message);
      }
    });
  });
}

/**
 * The competitor's record card — where they competed and what they won.
 * Display only: placements are entered on the Rezultati screen, so
 * reviewing and recording do not mix in one place.
 */
function careerModal({ person, career }) {
  const blank = { zlato: 0, srebro: 0, bronza: 0, ucesce: 0, medalje: 0, bodovi: 0 };
  const grand = { ...blank };
  // One ID per year, the newest first — last year's stays as history.
  const ids = fssHistory(person);

  const sections = career.map(({ competition, competitor, entries }) => {
    const tally = { ...blank };
    entries.forEach((e) => {
      if (!e.placement) return;
      tally[e.placement] += 1;
      if (placementByKey(e.placement)?.medal) tally.medalje += 1;
      tally.bodovi += pointsFor(e.placement);
    });
    ['zlato', 'srebro', 'bronza', 'ucesce', 'medalje', 'bodovi']
      .forEach((k) => { grand[k] += tally[k]; });

    const rows = entries.map((e) => {
      const pl = placementByKey(e.placement);
      return `
      <tr>
        <td>${esc(e.discipline)}</td>
        <td class="col-num">${esc(e.group)}${e.weight ? ' · ' + esc(e.weight) + ' kg' : ''}</td>
        <td class="${pl?.medal ? 'is-medal' : ''}">${pl ? esc(pl.label) : '<span class="text-muted">nije uneto</span>'}</td>
        <td class="col-num">${pl ? num(pl.points) : '·'}</td>
      </tr>`;
    }).join('');

    return `
      <section class="career-comp">
        <div class="career-head">
          <div>
            <div class="career-name">${esc(competition.name)}</div>
            <div class="career-meta">
              ${esc(dateLabel(competition.date))} · ${esc(competition.place)} ·
              ${esc(competitor.club)} · ${esc(competitor.belt)} pojas${
  fssIdOf(person, seasonOf(competition)) ? ` · ${esc(fssIdOf(person, seasonOf(competition)))}` : ''}
            </div>
          </div>
          <div class="career-score">
            <span class="career-points">${num(tally.bodovi)}</span>
            <span class="career-points-label">${plural(tally.bodovi, 'bod', 'boda', 'bodova')}</span>
          </div>
        </div>
        <table class="grid is-dense career-table">
          <thead>
            <tr><th>Disciplina</th><th class="col-num">Kategorija</th><th>Plasman</th><th class="col-num">Bodovi</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  }).join('');

  const summary = career.length ? `
    <div class="career-total">
      <div class="career-total-medals">
        <span><b>${grand.zlato}</b> zlato</span>
        <span><b>${grand.srebro}</b> srebro</span>
        <span><b>${grand.bronza}</b> bronza</span>
        <span class="text-muted"><b>${grand.ucesce}</b> učešće</span>
      </div>
      <div class="career-total-points">
        Ukupno <b>${num(grand.bodovi)}</b> ${plural(grand.bodovi, 'bod', 'boda', 'bodova')}
        sa ${career.length} ${plural(career.length, 'takmičenja', 'takmičenja', 'takmičenja')}
      </div>
    </div>` : '<p class="modal-body">Nema nijednog zabeleženog nastupa.</p>';

  modalRoot.innerHTML = `
    <div class="backdrop" data-close>
      <div class="modal is-wide">
        <i class="mark tl" aria-hidden="true">+</i><i class="mark tr" aria-hidden="true">+</i>
        <i class="mark bl" aria-hidden="true">+</i><i class="mark br" aria-hidden="true">+</i>
        <h2 class="modal-title">${esc(person.name)}</h2>
        <p class="modal-body">
          ${esc(person.year)}. godište · ${esc(person.sex === 'M' ? 'muški' : 'ženski')}
          ${person.licence ? ' · licenca ' + esc(person.licence) : ''}
        </p>
        ${ids.length ? `
        <p class="modal-body career-ids">FSS ID po godinama: ${ids.map((x) => `
          <span>${esc(x.year)} — <b>${esc(x.id)}</b></span>`).join(' · ')}</p>` : ''}
        ${summary}
        <div class="career-list">${sections}</div>
        <div class="modal-actions">
          <button type="button" class="btn-app" data-close>Zatvori</button>
        </div>
      </div>
    </div>`;
}

// === Clubs =============================================

/**
 * The club register with results across all seasons. A medal belongs to
 * the club the competitor represented that day, so a transfer moves
 * nothing. Sorted by points — the only order that means anything here.
 */
function clubsHtml({ clubs }) {
  if (!clubs.length) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema nijednog kluba</h2>
        <p class="soon-note">Nema nijedne prijave.</p>
      </div>`;
  }

  const rows = clubs.map((c, i) => `
    <tr data-print-id="${esc(c.name)}" data-search="${esc((c.name + ' ' + c.city).toLowerCase())}">
      <td class="col-num">${i + 1}</td>
      <td class="col-name">${esc(c.name)}</td>
      <td>${esc(c.city) || '<span class="text-muted">—</span>'}</td>
      <td class="col-num" title="jedinstvenih lica koja su nastupala za klub">${num(c.people)}</td>
      <td class="col-num is-strong">${c.medalje ? num(c.medalje) : '·'}</td>
      <td class="col-num${c.zlato ? ' is-medal' : ''}">${c.zlato || '·'}</td>
      <td class="col-num${c.srebro ? ' is-medal' : ''}">${c.srebro || '·'}</td>
      <td class="col-num${c.bronza ? ' is-medal' : ''}">${c.bronza || '·'}</td>
      <td class="col-num is-total">${c.bodovi ? num(c.bodovi) : '·'}</td>
    </tr>`).join('');

  return `
    <div class="list-tools">
      <input class="control search" id="club-search" type="search"
             placeholder="Pretraga po klubu ili gradu" aria-label="Pretraga klubova">
      <span class="list-count" id="club-count">${clubs.length} ${plural(clubs.length, 'klub', 'kluba', 'klubova')}</span>
    </div>
    <table class="grid is-dense">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th>Klub</th>
          <th>Grad</th>
          <th class="col-num">Takmičari</th>
          <th class="col-num" title="Zlato, srebro i bronza zajedno — učešće se ne broji">Medalje</th>
          <th class="col-num" title="${PLACEMENTS[0].points} bodova">Zlato</th>
          <th class="col-num" title="${PLACEMENTS[1].points} bodova">Srebro</th>
          <th class="col-num" title="${PLACEMENTS[2].points} bodova">Bronza</th>
          <th class="col-num" title="Zbir bodova svih takmičara kluba, kroz sve sezone">Bodovi</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
`;
}

// === Results =============================================

/** What each competition state means for the user, when switching. */
const STATUS_TOAST = {
  'Prijave otvorene': 'prijave su otvorene',
  'Prijave zatvorene': 'prijave su zatvorene',
  'Završeno': 'takmičenje je zatvoreno',
  'Nacrt': 'vraćeno u nacrt',
};

/**
 * Placement entry. Sorted by discipline, then by category — the way it is
 * judged and the way official results are named.
 *
 * A discipline is an accordion (<details>): closed it shows counts, open
 * it lists entrants by category. Search matches discipline, category,
 * name and club, and opens what it finds.
 *
 * A closed competition is untouchable: selects are disabled until it is
 * reopened, so an official result cannot change by accident.
 */
function resultsHtml({ competition, registry, results }) {
  if (!competition) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema aktuelnog takmičenja</h2>
        <p class="soon-note">Nema izabranog takmičenja.</p>
        <div class="soon-links">
          <button type="button" class="btn-app is-primary" data-go="takmicenja">Takmičenja</button>
        </div>
      </div>`;
  }
  if (!registry.entries.length && !registry.teams.length) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema prijava</h2>
        <p class="soon-note">Na takmičenju „${esc(competition.name)}" nema nijedne prijave.</p>
      </div>`;
  }

  const locked = competition.status === 'Završeno';
  const byEntry = new Map(results.map((r) => [r.entryId, r]));

  // Discipline → category → entries. Discipline order comes from the
  // rulebook (DISCIPLINES.order), not the alphabet.
  const byDiscipline = new Map();
  registry.entries.forEach((e) => {
    if (!byDiscipline.has(e.discipline)) byDiscipline.set(e.discipline, new Map());
    const cats = byDiscipline.get(e.discipline);
    const key = categoryKey(e);
    if (!cats.has(key)) cats.set(key, []);
    cats.get(key).push(e);
  });

  const options = (selected) => placementOptions(selected, ALL_PLACEMENTS);

  const disciplines = [...byDiscipline.entries()]
    .sort((a, b) => (disciplineByName(a[0])?.order || 99) - (disciplineByName(b[0])?.order || 99))
    .map(([discipline, cats]) => {
      const entries = [...cats.values()].flat();
      const done = entries.filter((e) => byEntry.has(e.id)).length;

      const categories = [...cats.values()]
        .sort((a, b) => categoryFullLabel(a[0]).localeCompare(categoryFullLabel(b[0]), 'sr'))
        .map((group) => {
          const first = group[0];
          const rows = group
            .sort((a, b) => a.name.localeCompare(b.name, 'sr'))
            .map((e) => {
              const placement = byEntry.get(e.id)?.placement || '';
              const pl = placementByKey(placement);
              return `
            <div class="result-row" data-print-id="${esc(e.id)}" data-year="${esc(e.year)}">
              <div class="result-who">
                <div class="result-disc">${esc(e.name)}</div>
                <div class="result-meta">${esc(e.club)} · ${esc(e.belt)} pojas</div>
              </div>
              <span class="result-points${pl?.medal ? ' is-medal' : ''}">${pl ? pl.points + ' bodova' : '—'}</span>
              <select class="control result-pick" data-entry="${esc(e.id)}"
                      data-prev="${esc(placement)}"${locked ? ' disabled' : ''}
                      aria-label="Plasman — ${esc(e.name)}">${options(placement)}</select>
            </div>`;
            }).join('');

          return `
        <section class="cat" data-disc="${esc(discipline)}" data-key="${esc(categoryKey(first))}"
                 data-cat="${esc(categoryLabel(first))}" data-sex="${esc(first.sex)}">
          <div class="cat-head">
            <span class="cat-name">${esc(categoryFullLabel(first))}</span>
            <span class="cat-slots"></span>
            <span class="cat-count">${group.length} ${plural(group.length, 'prijava', 'prijave', 'prijava')}</span>
            <button type="button" class="btn-app is-quiet" data-print-cat>Štampaj</button>
          </div>
          ${rows}
        </section>`;
        }).join('');

      return `
      <details class="disc" data-disc="${esc(discipline)}">
        <summary class="disc-head">
          <span class="disc-name">${esc(discipline)}</span>
          <span class="disc-meta">${cats.size} ${plural(cats.size, 'kategorija', 'kategorije', 'kategorija')} · ${entries.length} ${plural(entries.length, 'prijava', 'prijave', 'prijava')}${
            disciplineByName(discipline)?.note ? ' · ' + esc(disciplineByName(discipline).note) : ''}</span>
          <span class="disc-progress">${done} / ${entries.length}</span>
          <button type="button" class="btn-app is-quiet" data-print-disc="${esc(discipline)}">Štampaj</button>
        </summary>
        <div class="disc-body">${categories}</div>
      </details>`;
    }).join('');

  // Team categories share the screen, the menu and the slot counting:
  // the row is a team instead of a competitor, one placement per team.
  const teamsByDisc = new Map();
  registry.teams.forEach((t) => {
    if (!teamsByDisc.has(t.discipline)) teamsByDisc.set(t.discipline, new Map());
    const cats = teamsByDisc.get(t.discipline);
    const key = teamKeyOf(t);
    if (!cats.has(key)) cats.set(key, []);
    cats.get(key).push(t);
  });

  const teamSections = [...teamsByDisc.entries()]
    .sort((a, b) => (disciplineByName(a[0])?.order || 99) - (disciplineByName(b[0])?.order || 99))
    .map(([discipline, cats]) => {
      const list = [...cats.values()].flat();
      const entered = list.filter((t) => byEntry.has(t.id)).length;

      const categories = [...cats.values()]
        .sort((a, b) => teamCategoryLabel(a[0]).localeCompare(teamCategoryLabel(b[0]), 'sr'))
        .map((group) => {
          const first = group[0];
          const rows = group
            .sort((a, b) => a.label.localeCompare(b.label, 'sr'))
            .map((t) => {
              const placement = byEntry.get(t.id)?.placement || '';
              const pl = placementByKey(placement);
              return `
            <div class="result-row" data-print-id="${esc(t.id)}" data-year="">
              <div class="result-who">
                <div class="result-disc">${esc(t.label)}</div>
                <div class="result-meta">${esc((t.members || []).map((m) => m.name).join(', '))}</div>
              </div>
              <span class="result-points${pl?.medal ? ' is-medal' : ''}">${pl ? pl.points + ' bodova' : '—'}</span>
              <select class="control result-pick" data-team="${esc(t.id)}"
                      data-prev="${esc(placement)}"${locked ? ' disabled' : ''}
                      aria-label="Plasman — ${esc(t.label)}">${options(placement)}</select>
            </div>`;
            }).join('');

          return `
        <section class="cat" data-disc="${esc(discipline)}" data-key="${esc(teamKeyOf(first))}"
                 data-cat="${esc(teamCategoryLabel(first))}" data-sex="${esc(first.sex || '')}">
          <div class="cat-head">
            <span class="cat-name">${esc(teamCategoryLabel(first))}</span>
            <span class="cat-slots"></span>
            <span class="cat-count">${group.length} ${plural(group.length, 'ekipa', 'ekipe', 'ekipa')}</span>
            <button type="button" class="btn-app is-quiet" data-print-cat>Štampaj</button>
          </div>
          ${rows}
        </section>`;
        }).join('');

      return `
      <details class="disc" data-disc="${esc(discipline)}">
        <summary class="disc-head">
          <span class="disc-name">${esc(discipline)}</span>
          <span class="disc-meta">${cats.size} ${plural(cats.size, 'kategorija', 'kategorije', 'kategorija')} · ${list.length} ${plural(list.length, 'ekipa', 'ekipe', 'ekipa')}</span>
          <span class="disc-progress">${entered} / ${list.length}</span>
          <button type="button" class="btn-app is-quiet" data-print-disc="${esc(discipline)}">Štampaj</button>
        </summary>
        <div class="disc-body">${categories}</div>
      </details>`;
    }).join('');

  const total = registry.entries.length + registry.teams.length;
  const done = registry.entries.filter((e) => byEntry.has(e.id)).length
    + registry.teams.filter((t) => byEntry.has(t.id)).length;

  // The filter menus fill from what actually exists at this competition,
  // so no choice produces zero rows.
  resultsIndex = buildResultsIndex(registry.entries, registry.teams);

  return `
    ${locked ? `<div class="notice">Takmičenje je zatvoreno — plasmani se više ne menjaju.
      Otvori ga ponovo na kontrolnoj tabli ako treba ispravka.</div>` : ''}
    ${calendarOf(competition) === 'B' ? `<div class="notice">Takmičenje je na
      <b>B listi</b> — plasman se upisuje i medalja se broji, ali bodovi iz njega
      ne ulaze u rang listu.</div>` : ''}
    ${calendarOf(competition) === 'A' && !pointsCounted(competition) ? `<div class="notice">
      Bodovi se knjiže kad se takmičenje zatvori. Do tada se plasmani i medalje
      unose i vide, ali u ukupan zbir, na ekran Klubovi i na rang listu ulaze tek
      <b>zatvaranjem takmičenja</b> na kontrolnoj tabli.</div>` : ''}
    <div class="filters">
      <label class="filter">
        <span class="filter-label">Disciplina</span>
        <select class="control" id="f-disc">
          <option value="">sve discipline</option>
          ${resultsIndex.disciplines.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join('')}
        </select>
      </label>
      <label class="filter">
        <span class="filter-label">Kategorija</span>
        <select class="control is-wide" id="f-cat">${categoryOptions(resultsIndex, '')}</select>
      </label>
      <label class="filter">
        <span class="filter-label">Pol</span>
        <select class="control is-narrow" id="f-sex">
          <option value="">svi</option>
          ${resultsIndex.sexes.map((x) => `<option value="${esc(x)}">${esc(sexLabel(x))}</option>`).join('')}
        </select>
      </label>
      <label class="filter">
        <span class="filter-label">Godište</span>
        <select class="control is-narrow" id="f-year">
          <option value="">sva godišta</option>
          ${resultsIndex.years.map((y) => `<option value="${y}">${y}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="btn-app is-quiet" id="f-reset" hidden>Poništi filtere</button>
      ${!locked && done < total
    ? '<button type="button" class="btn-app is-quiet" data-fill-ucesce>Svima učešće</button>' : ''}
      <span class="list-count" id="results-progress">${done} od ${total} plasmana uneto</span>
    </div>
    <div class="disc-list" id="results-list">${disciplines}${teamSections}</div>`;
}

/** Team category key — tagged so it can never mix with individual ones. */
const teamKeyOf = (team) => `team:${team.discipline}|${team.group}|${team.variant || team.sex}`;

/** What exists at this competition — feeds the filter menus. */
let resultsIndex = { disciplines: [], byDiscipline: new Map(), years: [] };

function buildResultsIndex(entries, teams = []) {
  const byDiscipline = new Map();
  const years = new Set();
  const sexes = new Set();
  entries.forEach((e) => {
    if (!byDiscipline.has(e.discipline)) byDiscipline.set(e.discipline, new Set());
    byDiscipline.get(e.discipline).add(categoryLabel(e));
    years.add(e.year);
    sexes.add(e.sex);
  });
  teams.forEach((t) => {
    if (!byDiscipline.has(t.discipline)) byDiscipline.set(t.discipline, new Set());
    byDiscipline.get(t.discipline).add(teamCategoryLabel(t));
    if (t.sex) sexes.add(t.sex);
  });
  const disciplines = [...byDiscipline.keys()]
    .sort((a, b) => (disciplineByName(a)?.order || 99) - (disciplineByName(b)?.order || 99));
  return {
    disciplines,
    byDiscipline: new Map(disciplines.map((d) =>
      [d, [...byDiscipline.get(d)].sort((a, b) => a.localeCompare(b, 'sr'))])),
    years: [...years].sort((a, b) => b - a),
    sexes: ['M', 'Ž'].filter((x) => sexes.has(x)),
  };
}

/**
 * Categories for the dropdown. With a discipline chosen only its own
 * show; otherwise they group by discipline, because the same category
 * name appears in several disciplines.
 */
function categoryOptions(index, discipline) {
  const head = '<option value="">sve kategorije</option>';
  if (discipline) {
    return head + (index.byDiscipline.get(discipline) || [])
      .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  return head + index.disciplines.map((d) => `
    <optgroup label="${esc(d)}">
      ${index.byDiscipline.get(d).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
    </optgroup>`).join('');
}

/** "68 kg", "+76 kg" — but "apsolutna" stays as is, it is not a weight. */
const weightLabel = (weight) => {
  if (!weight) return '';
  return /^[+\d]/.test(weight) ? `${weight} kg` : weight;
};

/**
 * Category name without the sex — that is what the filter shows, since
 * sex is its own filter. Follows categoryKey otherwise: kumite splits by
 * weight, kata by level, the rest by group.
 */
function categoryLabel(entry) {
  const age = ageByCode(entry.group);
  const parts = [`Grupa ${entry.group}`, age ? age.name.toLowerCase() : null];
  // What splits a category comes from the rulebook, not the discipline
  // name: traditional kumite is open, sport kumite splits by weight.
  const drawBy = disciplineByName(entry.discipline)?.drawBy;
  if (drawBy === 'weight') parts.push(weightLabel(entry.weight) || 'bez telesne težine');
  else if (drawBy === 'level') parts.push(entry.level || 'bez nivoa');
  return parts.filter(Boolean).join(' · ');
}

const sexLabel = (sex) => (sex === 'M' ? 'muškarci' : 'žene');

/** Full category name, with sex — for headings and print. */
function categoryFullLabel(entry) {
  const parts = categoryLabel(entry).split(' · ');
  parts.splice(2, 0, sexLabel(entry.sex));
  return parts.join(' · ');
}

/** All placements — the menu before category slots are known. */
const ALL_PLACEMENTS = new Set(PLACEMENTS.map((pl) => pl.key));

/**
 * The placement menu for one row: empty, then what is still free in the
 * category. A row's own placement always stays, so it can be changed or
 * withdrawn.
 */
const placementOptions = (selected, allowed) => ['<option value="">— nije uneto —</option>']
  .concat(PLACEMENTS.filter((pl) => allowed.has(pl.key) || pl.key === selected).map((pl) => `
    <option value="${esc(pl.key)}"${pl.key === selected ? ' selected' : ''}>${esc(
    pl.place ? `${pl.place} — ${pl.label.toLowerCase()}` : pl.label)}</option>`))
  .join('');

/**
 * Slot usage in one category: count, display and lock. A category has one
 * first, one second and two thirds; a taken place stops being offered in
 * the other rows — a third gold is not an error to report, it is a choice
 * not offered. Scored/measured disciplines have no limit and no fraction.
 */
function updateCategoryState(cat) {
  const discipline = cat.dataset.disc;
  const picks = [...cat.querySelectorAll('.result-pick')];
  const counts = {};
  picks.forEach((p) => { if (p.value) counts[p.value] = (counts[p.value] || 0) + 1; });

  let over = false;
  const parts = PLACEMENTS.filter((pl) => pl.slots).map((pl) => {
    const used = counts[pl.key] || 0;
    const slots = placementSlots(discipline, pl.key);
    if (slots === null) return `<span>${pl.short} ${used}</span>`;
    if (used > slots) over = true;
    return `<span class="${used > slots ? 'is-over' : used === slots ? 'is-full' : ''}">${pl.short} ${used}/${slots}</span>`;
  });

  // A place taken by other rows disappears from this row's menu — not
  // greyed out, simply gone. A row's own pick is not counted, so it can
  // always be changed or withdrawn.
  picks.forEach((pick) => {
    const allowed = new Set(PLACEMENTS.filter((pl) => {
      const slots = placementSlots(discipline, pl.key);
      if (slots === null) return true;
      return (counts[pl.key] || 0) - (pick.value === pl.key ? 1 : 0) < slots;
    }).map((pl) => pl.key));

    // The menu is rewritten only when it actually changed — otherwise
    // every entry would rebuild every menu in the category.
    const want = ['', ...PLACEMENTS.map((pl) => pl.key)
      .filter((k) => allowed.has(k) || k === pick.value)].join('|');
    if (want !== [...pick.options].map((o) => o.value).join('|')) {
      const value = pick.value;
      pick.innerHTML = placementOptions(value, allowed);
      pick.value = value;
    }
  });

  const box = cat.querySelector('.cat-slots');
  if (box) box.innerHTML = parts.join(' · ');
  cat.classList.toggle('is-over', over);
}

/** Placement counters — per discipline and total, with no re-render. */
function updateResultsProgress() {
  document.querySelectorAll('.cat').forEach(updateCategoryState);

  document.querySelectorAll('details.disc').forEach((disc) => {
    const picks = [...disc.querySelectorAll('.result-pick')];
    const done = picks.filter((p) => p.value).length;
    const box = disc.querySelector('.disc-progress');
    if (box) {
      box.textContent = `${done} / ${picks.length}`;
      box.classList.toggle('is-done', done === picks.length && picks.length > 0);
    }
    disc.classList.toggle('has-over', !!disc.querySelector('.cat.is-over'));
  });

  const total = document.getElementById('results-progress');
  if (total) {
    // With a filter on, only what is on screen is counted, so the
    // counter does not talk about rows the user cannot see.
    const filtered = !!document.querySelector('.result-row[hidden]');
    const picks = [...document.querySelectorAll('.result-row:not([hidden]) .result-pick')];
    const done = picks.filter((p) => p.value).length;
    total.textContent = `${done} od ${picks.length} plasmana uneto${filtered ? ' (filtrirano)' : ''}`;
  }
}

/**
 * Filtering by discipline, category and year. Hides rows instead of
 * re-rendering — open placement menus must not vanish mid-use. Filtered
 * disciplines open themselves; clearing the filters closes them again.
 */
function applyResultsFilter() {
  const disc = document.getElementById('f-disc')?.value || '';
  const cat = document.getElementById('f-cat')?.value || '';
  const sex = document.getElementById('f-sex')?.value || '';
  const year = document.getElementById('f-year')?.value || '';
  const active = !!(disc || cat || sex || year);

  const reset = document.getElementById('f-reset');
  if (reset) reset.hidden = !active;

  document.querySelectorAll('details.disc').forEach((details) => {
    let visibleCats = 0;

    details.querySelectorAll('.cat').forEach((catEl) => {
      const matchDisc = !disc || catEl.dataset.disc === disc;
      const matchCat = !cat || catEl.dataset.cat === cat;
      const matchSex = !sex || catEl.dataset.sex === sex;
      let visibleRows = 0;

      catEl.querySelectorAll('.result-row').forEach((row) => {
        const show = matchDisc && matchCat && matchSex && (!year || row.dataset.year === year);
        row.hidden = !show;
        if (show) visibleRows += 1;
      });

      catEl.hidden = visibleRows === 0;
      if (!catEl.hidden) visibleCats += 1;
    });

    details.hidden = visibleCats === 0;
    details.open = active && !details.hidden;
  });

  const count = document.getElementById('results-progress');
  if (count) {
    const picks = [...document.querySelectorAll('.result-row:not([hidden]) .result-pick')];
    const done = picks.filter((x) => x.value).length;
    count.textContent = active
      ? `${done} od ${picks.length} plasmana uneto (filtrirano)`
      : `${done} od ${picks.length} plasmana uneto`;
  }
}

/** Categories narrow to the picked discipline, then the filter applies. */
function onDisciplineFilterChange() {
  const disc = document.getElementById('f-disc').value;
  const catSelect = document.getElementById('f-cat');
  const previous = catSelect.value;
  catSelect.innerHTML = categoryOptions(resultsIndex, disc);
  // If the chosen category also exists in the new list, keep it.
  catSelect.value = [...catSelect.options].some((o) => o.value === previous) ? previous : '';
  applyResultsFilter();
}


// === Settings =============================================

/**
 * The fee price list — the only part of the rulebook edited from the app
 * so far; the rest still lives in data.js.
 *
 * Fees are paid per entry: three disciplines, three fees. A team pays as
 * a whole, enbu at its own price. Older groups get their first three
 * disciplines free — except the ones marked always paid.
 */
/** MB below a gigabyte, whole GB above — information, not measurement. */
const storageSize = (bytes) => bytes >= 1073741824
  ? `${num(Math.round(bytes / 1073741824))} GB`
  : `${num(Math.max(1, Math.round(bytes / 1048576)))} MB`;

/** Persistent-storage state for Podešavanja — requested on every launch. */
function storageHtml(storage) {
  if (!storage.supported) {
    return `
        <p class="field-note">Ovaj pregledač ne ume da odobri trajno skladište,
        pa baza deli sudbinu ostalih podataka sajtova. Ne brisati podatke
        sajta za adresu na kojoj aplikacija radi.</p>`;
  }
  const status = storage.persisted
    ? `
        <p><strong>Baza je zaštićena od automatskog brisanja.</strong>
        Pregledač je odobrio trajno skladište, pa je neće obrisati kad bude
        oslobađao prostor na disku.</p>`
    : `
        <div class="notice">Pregledač još nije odobrio trajno skladište, pa
        bazu sme da obriše kad mu zatreba prostor na disku. Odobrenje se traži
        pri svakom pokretanju; obično ga donosi instaliranje aplikacije
        (dugme „Instaliraj“ u traci pregledača).</div>`;
  return `${status}
        <p class="field-note">${storage.quota
    ? `Zauzeto: ${storageSize(storage.usage)} od ${storageSize(storage.quota)} na raspolaganju. `
    : ''}Ručno brisanje podataka sajta u pregledaču i dalje briše bazu —
        zaštita važi samo za automatsko oslobađanje prostora.</p>`;
}

function settingsHtml({ fees, storage }) {
  const groups = AGES.map((age) => `
        <label class="pick">
          <input type="checkbox" data-fee-group="${esc(age.code)}"${
  fees.free.groups.indexOf(age.code) >= 0 ? ' checked' : ''}>
          <span>${esc(age.code)} · ${esc(age.name.toLowerCase())}</span>
        </label>`).join('');

  const always = DISCIPLINES.filter((d) => !d.team).map((d) => `
        <label class="pick">
          <input type="checkbox" data-fee-always="${esc(d.name)}"${
  fees.free.always.indexOf(d.name) >= 0 ? ' checked' : ''}>
          <span>${esc(d.name)}</span>
        </label>`).join('');

  const amount = (key, label, value, note = '') => `
      <label class="field">
        <span class="field-label">${esc(label)}</span>
        <input type="number" class="control is-narrow" min="0" step="1"
               data-fee="${esc(key)}" value="${esc(value)}">
        ${note ? `<span class="field-note">${esc(note)}</span>` : ''}
      </label>`;

  return `
    ${fees.individual ? '' : `
    <div class="notice">Iznos kotizacije još nije unet, pa list kotizacija
    izlazi sa nulama.</div>`}

    <section class="dip-setup" open>
      <div class="dip-setup-head is-static">
        <span class="dip-setup-title">Kotizacije</span>
        <span class="dip-setup-actions">
          <button type="button" class="btn-app is-quiet" id="fee-reset">Vrati podrazumevano</button>
        </span>
      </div>
      <div class="dip-setup-body">
        <div class="fee-row">
          ${amount('individual', 'Po disciplini (din)', fees.individual)}
          ${amount('team', 'Po ekipi (din)', fees.team)}
          ${amount('enbu', 'Enbu, po paru (din)', fees.enbu)}
          ${amount('coachRefund', 'Povrat treneru (%)', fees.coachRefund)}
        </div>

        <div class="fee-block">
          <div class="fee-row">
            ${amount('free.count', 'Besplatnih disciplina', fees.free.count)}
            <div class="field is-grow">
              <span class="field-label">Uzrasne grupe sa besplatnim disciplinama</span>
              <div class="picks">${groups}</div>
            </div>
          </div>
          <div class="field">
            <span class="field-label">Discipline koje se plaćaju uvek</span>
            <div class="picks">${always}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="dip-setup" open>
      <div class="dip-setup-head is-static">
        <span class="dip-setup-title">Baza podataka</span>
      </div>
      <div class="dip-setup-body">${storageHtml(storage)}
      </div>
    </section>

    <div class="empty-screen is-quiet">
      <h2 class="soon-title">Ostalo iz pravilnika — uskoro</h2>
      <p class="soon-note">Uzrasne grupe, discipline i telesne težine i dalje se
        menjaju u pravilniku (<code>assets/js/data.js</code>), pa ista izmena
        važi za sve — i za aplikaciju i za formular koji klubovi popunjavaju.</p>
    </div>`;
}

// === Diplomas =============================================

/**
 * Diplomas are printed in advance with blank lines; after the
 * competition the lines are filled in, category by category as they
 * finish. This screen makes the writing, not the diploma: where the
 * name goes, the club, the place and discipline. The paper is given, so
 * what is set here is measurement, not looks.
 */

/** Sheet size in millimetres — drives the ruler and the line widths. */
const slipSize = (setup) => (setup.orientation === 'landscape'
  ? { width: 297, height: 210 } : { width: 210, height: 297 });

/** Default content of each written line. */
const diplomaText = {
  ime: ({ entry }) => entry.name,
  klub: ({ entry }) => entry.club,
  mesto: ({ placement }) => placement.place || placement.label,
  disciplina: ({ entry }) => entry.discipline,
  // A team diploma carries the team's category; member names go nowhere.
  kategorija: ({ entry }) => entry.teamCategory || categoryFullLabel(entry),
};

/** The same, with made-up data — for the test sheet. */
const DIPLOMA_SAMPLE = {
  entry: {
    name: 'Petar Petrović', club: 'KK Fudokan Beograd', discipline: 'Kate',
    group: 'C', sex: 'M', level: '1. nivo', weight: '',
  },
  placement: placementByKey('zlato'),
};

/**
 * Who gets a diploma: medallists only, by category, in award order —
 * gold, silver, two bronzes. A category with no medal yet is not shown:
 * nothing to print.
 */
function diplomaCategories({ registry, results }) {
  const byEntry = new Map(results.map((r) => [r.entryId, r]));
  const cats = new Map();

  registry.entries.forEach((entry) => {
    const placement = placementByKey(byEntry.get(entry.id)?.placement || '');
    if (!placement?.medal) return;
    const key = categoryKey(entry);
    if (!cats.has(key)) cats.set(key, { key, first: entry, winners: [] });
    cats.get(key).winners.push({ entry, placement });
  });

  // A team diploma: the team's name (club, with a roman numeral when the
  // club has several in the category) where the name goes — no members.
  registry.teams.forEach((team) => {
    const placement = placementByKey(byEntry.get(team.id)?.placement || '');
    if (!placement?.medal) return;
    const entry = {
      name: team.label, club: team.club, discipline: team.discipline,
      group: team.group, sex: team.sex || '', level: '', weight: '',
      teamCategory: teamCategoryLabel(team),
    };
    const key = teamKeyOf(team);
    if (!cats.has(key)) cats.set(key, { key, first: entry, winners: [] });
    cats.get(key).winners.push({ entry, placement });
  });

  const rank = (placement) => PLACEMENTS.findIndex((pl) => pl.key === placement.key);
  const list = [...cats.values()];
  list.forEach((cat) => cat.winners.sort((a, b) =>
    rank(a.placement) - rank(b.placement) || a.entry.name.localeCompare(b.entry.name, 'sr')));

  const labelOf = (entry) => entry.teamCategory || categoryFullLabel(entry);
  return list.sort((a, b) =>
    (disciplineByName(a.first.discipline)?.order || 99)
      - (disciplineByName(b.first.discipline)?.order || 99)
    || labelOf(a.first).localeCompare(labelOf(b.first), 'sr'));
}

/** One setup field — millimetres and points, nothing else. */
const diplomaField = (key, field, label, value, step = 1) => `
      <label class="dip-field">
        <span class="filter-label">${esc(label)}</span>
        <input type="number" class="control is-narrow" step="${step}"
               data-dip="${esc(key)}" data-dip-field="${esc(field)}"
               value="${esc(value)}">
      </label>`;

function diplomasHtml({ competition, cats, setup }) {
  if (!competition) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema aktuelnog takmičenja</h2>
        <p class="soon-note">Nema izabranog takmičenja.</p>
        <div class="soon-links">
          <button type="button" class="btn-app is-primary" data-go="takmicenja">Takmičenja</button>
        </div>
      </div>`;
  }

  const ukupno = cats.reduce((sum, cat) => sum + cat.winners.length, 0);

  // Measures are set once and then only printed for years — so the box
  // is open until measured, and folded afterwards.
  const setupHtml = `
    <details class="dip-setup"${setup.savedAt ? '' : ' open'}>
      <summary class="dip-setup-head">
        <span class="dip-setup-title">Mere upisa</span>
        <span class="dip-setup-actions">
          <button type="button" class="btn-app is-quiet" id="dip-ruler">Probni list sa lenjirom</button>
          <button type="button" class="btn-app is-quiet" id="dip-sample">Probna diploma</button>
          <button type="button" class="btn-app is-quiet" id="dip-reset">Vrati podrazumevano</button>
        </span>
      </summary>
      <div class="dip-setup-body">
      <div class="filters">
        <label class="filter">
          <span class="filter-label">Položaj lista</span>
          <select class="control is-narrow" id="dip-orientation">
            <option value="portrait"${setup.orientation === 'portrait' ? ' selected' : ''}>uspravno</option>
            <option value="landscape"${setup.orientation === 'landscape' ? ' selected' : ''}>položeno</option>
          </select>
        </label>
      </div>
      <div class="dip-rows">${DIPLOMA_LINES.map((line) => {
    const cur = setup.lines[line.key];
    return `
        <div class="dip-row${cur.on ? '' : ' is-off'}">
          <label class="pick">
            <input type="checkbox" data-dip="${esc(line.key)}" data-dip-field="on"${cur.on ? ' checked' : ''}>
            <span>${esc(line.label)}</span>
          </label>
          ${diplomaField(line.key, 'top', 'Odozgo (mm)', cur.top, 0.5)}
          ${diplomaField(line.key, 'x', 'Levo − / desno + (mm)', cur.x, 0.5)}
          ${diplomaField(line.key, 'size', 'Slovo (pt)', cur.size, 0.5)}
        </div>`;
  }).join('')}
      </div>
      </div>
    </details>`;

  if (!ukupno) {
    return `${setupHtml}
      <div class="empty-screen">
        <h2 class="soon-title">Nema unetih medalja</h2>
        <p class="soon-note">Diploma se štampa za osvajače medalja, a na takmičenju
          „${esc(competition.name)}" nijedan plasman sa medaljom još nije unet.</p>
        <div class="soon-links">
          <button type="button" class="btn-app is-primary" data-go="rezultati">Rezultati</button>
        </div>
      </div>`;
  }

  const list = cats.map((cat) => `
      <section class="cat" data-dip-cat="${esc(cat.key)}">
        <div class="cat-head">
          <span class="cat-name">${esc(cat.first.discipline)} · ${esc(cat.first.teamCategory || categoryFullLabel(cat.first))}</span>
          <span class="cat-count">${cat.winners.length} ${
  plural(cat.winners.length, 'diploma', 'diplome', 'diploma')}</span>
          <button type="button" class="btn-app is-quiet" data-print-diplomas="${esc(cat.key)}">Štampaj</button>
        </div>${cat.winners.map(({ entry, placement }) => `
        <div class="result-row">
          <div class="result-who">
            <div class="result-disc">${esc(entry.name)}</div>
            <div class="result-meta">${esc(entry.club)}</div>
          </div>
          <span class="result-points is-medal">${esc(placement.place || placement.label)}</span>
        </div>`).join('')}
      </section>`).join('');

  return `${setupHtml}
    <div class="filters">
      <span class="list-count">${cats.length} ${
  plural(cats.length, 'kategorija', 'kategorije', 'kategorija')} · ${ukupno} ${
  plural(ukupno, 'diploma', 'diplome', 'diploma')}</span>
    </div>
    ${list}`;
}

/**
 * Written lines for one winner, at the measured positions. A disabled
 * line is not printed — a diploma that already says the discipline does
 * not need it twice.
 */
const diplomaLines = (winner, setup) => DIPLOMA_LINES
  .filter((line) => setup.lines[line.key].on)
  .map((line) => {
    const mera = setup.lines[line.key];
    return slipLine(diplomaText[line.key](winner), {
      top: mera.top, x: mera.x, size: mera.size, caps: line.caps, strong: line.caps,
    });
  });

/** One sheet per winner, nothing on it but the writing. */
function diplomaSpec({ competition, winners, setup, title }) {
  if (!winners.length) return null;
  return {
    orientation: setup.orientation,
    context: competitionContext(competition),
    spec: {
      kicker: 'Diplome',
      title: title || 'Diplome',
      docCode: 'Upis na diplome',
      slips: winners.map((winner) => ({
        size: slipSize(setup),
        lines: diplomaLines(winner, setup),
      })),
      rows: [],
    },
  };
}

/**
 * The test sheet: a ruler, a made-up writing at the measured spots, and
 * instructions. Printed on plain paper and held against the diploma to
 * the light; what the ruler shows goes into the fields. The instructions
 * are on the paper because that is what the person is holding.
 */
function diplomaTestSpec({ competition, setup }) {
  const size = slipSize(setup);

  return {
    orientation: setup.orientation,
    context: competitionContext(competition),
    spec: {
      kicker: 'Diplome',
      title: 'Probni list',
      docCode: 'Probni list za diplome',
      slips: [{
        size,
        ruler: size,
        note: 'PROBNI LIST ZA UPIS NA DIPLOME — štampati u razmeri 100 %, bez '
          + 'uklapanja u stranu i bez margina koje štampač sam dodaje. Brojevi uz '
          + 'ivice su milimetri od gornje ivice lista, brojevi u vrhu su milimetri '
          + 'levo (−) i desno (+) od sredine. Prisloniti ovaj list uz diplomu prema '
          + 'svetlu, očitati mere za ime, klub, mesto i disciplinu i upisati ih u '
          + 'polja na ekranu Diplome.',
        lines: diplomaLines(DIPLOMA_SAMPLE, setup),
      }],
      rows: [],
    },
  };
}

// === Rankings =============================================

/**
 * One season's rankings. Clubs are one list, then one per age group split
 * by sex — the way cups are awarded and the way they print: every
 * category its own sheet. A season is not hard-coded: the open one lasts
 * until the editor closes it.
 */

/** Which list is currently picked — `klubovi` or e.g. `C-Ž`. */
let rankPick = 'klubovi';

/** Which season is picked; empty means the open one. */
let seasonPick = 'open';

/** What the "Završetak sezone" button does on the current screen. */
let closeSeasonAction = null;

/** The mat plan while that screen is open — changes save immediately. */
let tatamiState = null;

/** Draw categories while that screen is open. */
let drawState = null;

/** Winners and measures while the Diplome screen is open. */
let diplomaState = null;

/** Entries while the competitor list is open — corrections read from here. */
let competitorsState = null;

/** The price list while Podešavanja is open; saved on field blur. */
let feesState = null;

async function updateFees(mutate) {
  if (!feesState) return;
  mutate(feesState);
  await store.saveFees(feesState);
}

/**
 * A measure saves as soon as the field is left, no save button — like the
 * mat schedule. The screen is not re-rendered: only the fields depend on
 * the measures, and a re-render would steal focus mid-setup.
 */
async function updateDiploma(mutate) {
  if (!diplomaState) return;
  mutate(diplomaState.setup);
  await store.saveDiplomaSetup(diplomaState.setup);
}

/** Which competition the import goes into; empty means the active one. */
let importPick = '';

const MEDAL_COLUMNS = ['zlato', 'srebro', 'bronza', 'ucesce'];

const seasonSpan = (season) => (season.to
  ? `${dateLabel(season.from)} – ${dateLabel(season.to)}`
  : `od ${dateLabel(season.from)} · u toku`);

function rankingsHtml({ seasons, season, data }) {
  // The season picker renders always, even over an empty season. A just-
  // closed season leaves an empty new one behind; without the picker the
  // editor could not get back to what they just closed — or reopen it.
  const seasonPicker = `
    <div class="filters">
      <label class="filter">
        <span class="filter-label">Sezona</span>
        <select class="control is-wide" id="f-season">${seasons.map((x) => `
          <option value="${esc(x.id)}"${x.id === season.id ? ' selected' : ''}>${
            esc(x.name)} · ${esc(seasonSpan(x))}${x.open ? '' : ' · zatvorena'}</option>`).join('')}
        </select>
      </label>
      %REST%
    </div>`;

  const reopenNotice = season.open ? '' : `<div class="notice">
    Sezona je zatvorena ${esc(dateLabel((season.closedAt || '').slice(0, 10)))}.
    Rang lista se i dalje računa iz rezultata, pa ispravka u zatvorenoj sezoni
    pomera i nju — <button type="button" class="link-cell" data-reopen="${esc(season.id)}">otvori
    ponovo</button> ako treba.</div>`;

  // Points are booked when a competition closes. One played but not
  // closed is silently missing from the rankings — so it must say so.
  const pendingNotice = data.pending?.length ? `<div class="notice">
    ${data.pending.length === 1 ? 'Jedno takmičenje u ovoj sezoni nije zatvoreno'
    : `${data.pending.length} takmičenja u ovoj sezoni nisu zatvorena`} — bodovi sa
    ${data.pending.length === 1 ? 'njega' : 'njih'} još nisu knjiženi:
    ${data.pending.map((c) => esc(c.name)).join(', ')}. Medalje se broje odmah,
    bodovi ulaze u rang listu kad se takmičenje zatvori.</div>` : '';

  if (!data.competitions.length) {
    return `
      ${seasonPicker.replace('%REST%', '')}
      ${reopenNotice}${pendingNotice}
      <div class="empty-screen">
        <h2 class="soon-title">U ovoj sezoni nema takmičenja</h2>
        <p class="soon-note">Sezona ${esc(season.name)} (${esc(seasonSpan(season))}) nema nijedno takmičenje.</p>
      </div>`;
  }

  const lists = [{ id: 'klubovi', name: 'Klubovi', count: data.clubs.length }]
    .concat(data.groups.map((g) => ({ id: g.id, name: g.name, count: g.rows.length })));
  const chosen = lists.some((l) => l.id === rankPick) ? rankPick : 'klubovi';
  const group = data.groups.find((g) => g.id === chosen);

  const medalCells = (row) => MEDAL_COLUMNS.map((key) => `
    <td class="col-num${row[key] && key !== 'ucesce' ? ' is-medal' : ''}">${row[key] || '·'}</td>`).join('');

  const table = group ? `
    <table class="grid is-dense">
      <thead>
        <tr>
          <th class="col-num" title="Deljeno mesto kad su bodovi isti">Mesto</th>
          <th>Ime i prezime</th>
          <th>Klub</th>
          <th class="col-num">Godište</th>
          <th class="col-num" title="Broj takmičenja u ovoj sezoni">Nastupa</th>
          <th class="col-num">Zlato</th><th class="col-num">Srebro</th>
          <th class="col-num">Bronza</th><th class="col-num">Učešće</th>
          <th class="col-num">Bodovi</th>
        </tr>
      </thead>
      <tbody>${group.rows.map((row) => `
        <tr data-print-id="${esc(row.personId)}">
          <td class="col-num is-strong">${row.place}.</td>
          <td class="col-name">
            <button type="button" class="link-cell" data-person="${esc(row.personId)}">${esc(row.name)}</button>
          </td>
          <td${row.moved ? ' title="U sezoni je nastupao i za: ' + esc(row.clubs.join(', ')) + '"' : ''}>${
            esc(row.club)}${row.moved ? ' <span class="tag-moved">promena kluba</span>' : ''}</td>
          <td class="col-num">${esc(row.year)}</td>
          <td class="col-num">${row.nastupa}</td>
          ${medalCells(row)}
          <td class="col-num is-total">${row.bodovi ? num(row.bodovi) : '·'}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : `
    <table class="grid is-dense">
      <thead>
        <tr>
          <th class="col-num">Mesto</th>
          <th>Klub</th>
          <th>Grad</th>
          <th class="col-num">Takmičari</th>
          <th class="col-num">Medalje</th>
          <th class="col-num">Zlato</th><th class="col-num">Srebro</th>
          <th class="col-num">Bronza</th><th class="col-num">Učešće</th>
          <th class="col-num">Bodovi</th>
        </tr>
      </thead>
      <tbody>${data.clubs.map((row) => `
        <tr data-print-id="${esc(row.name)}">
          <td class="col-num is-strong">${row.place}.</td>
          <td class="col-name">${esc(row.name)}</td>
          <td>${esc(row.city) || '<span class="text-muted">—</span>'}</td>
          <td class="col-num">${row.people}</td>
          <td class="col-num is-strong">${row.medalje || '·'}</td>
          ${medalCells(row)}
          <td class="col-num is-total">${row.bodovi ? num(row.bodovi) : '·'}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;

  return `
    ${seasonPicker.replace('%REST%', `
      <label class="filter">
        <span class="filter-label">Lista</span>
        <select class="control is-wide" id="f-rank">${lists.map((l) => `
          <option value="${esc(l.id)}"${l.id === chosen ? ' selected' : ''}>${
            esc(l.name)} (${l.count})</option>`).join('')}
        </select>
      </label>
      <span class="list-count">${lists.length} ${plural(lists.length, 'lista', 'liste', 'lista')} ·
        ${data.totals.competitions} ${plural(data.totals.competitions, 'takmičenje', 'takmičenja', 'takmičenja')} ·
        ${data.totals.people} ${plural(data.totals.people, 'takmičar', 'takmičara', 'takmičara')}</span>`)}

    ${reopenNotice}${pendingNotice}

    ${table}
`;
}

/**
 * The season-closing modal. Name and both dates are fields, not text —
 * the editor decides when a season starts and ends, the app suggests.
 */
function closeSeasonModal({ season, data }) {
  const today = new Date().toISOString().slice(0, 10);
  const last = data.competitions[data.competitions.length - 1]?.date || today;
  const lists = 1 + data.groups.length;

  modalRoot.innerHTML = `
    <div class="backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="close-season-title">
        <h2 class="modal-title" id="close-season-title">Završetak sezone</h2>
        <p class="modal-note">
          Štampa se ${lists} ${plural(lists, 'lista', 'liste', 'lista')} — klubovi
          i svaka uzrasna kategorija posebno, svaka na svom listu. Sezona se
          zatim zatvara, a sledeća se otvara od sutradan.
        </p>
        <form class="form" id="close-season-form">
          <label class="field">
            <span class="field-label">Naziv sezone</span>
            <input class="control" name="name" value="${esc(season.name)}" required>
          </label>
          <div class="field-row">
            <label class="field">
              <span class="field-label">Počela</span>
              <input class="control" type="date" name="from" value="${esc(season.from)}" required>
            </label>
            <label class="field">
              <span class="field-label">Završava se</span>
              <input class="control" type="date" name="to" value="${esc(last)}" required>
            </label>
          </div>
          <p class="form-error" id="close-season-error" hidden></p>
          <div class="modal-actions">
            <button type="button" class="btn-app is-quiet" data-close>Otkaži</button>
            <button type="submit" class="btn-app is-primary">Odštampaj i zatvori sezonu</button>
          </div>
        </form>
      </div>
    </div>`;

  document.getElementById('close-season-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = String(form.get('name')).trim();
    const from = String(form.get('from'));
    const to = String(form.get('to'));
    const error = document.getElementById('close-season-error');

    if (to < from) {
      error.textContent = 'Kraj sezone ne može da bude pre početka.';
      error.hidden = false;
      return;
    }

    // The print covers exactly the range the editor confirmed, not what
    // was on screen — the date may have changed here.
    const finalSeason = { ...season, name, from, to };
    const finalData = await store.rankings(finalSeason);
    const done = printStack(seasonStack({ season: finalSeason, data: finalData }));
    if (!done.documents) {
      error.textContent = 'U ovom rasponu nema nijednog rezultata za štampu.';
      error.hidden = false;
      return;
    }

    await store.closeSeason({ name, from, to });
    closeModal();
    toast(`Sezona „${name}" je zatvorena — odštampano ${done.documents} ${
      plural(done.documents, 'lista', 'liste', 'lista')} na ${done.pages} ${
      plural(done.pages, 'strani', 'strane', 'strana')}.`);
    render();
  });
}

// === Draw =============================================

/*
 * The draw, by category. The screen is a list: discipline, its categories
 * with entry counts, and next to each a button that draws a fresh bracket
 * and sends it straight to print. Nothing is stored — every press is a
 * new draw, because a remembered draw is worse than none: nobody would
 * know if they are looking at the one drawn before the judges.
 *
 * The paper is two pages or more: the bracket with places to write the
 * results and the head referee's signature, then the category's list of
 * competitors — names and clubs only, for calling out at the mat.
 */

/** One competition's categories, grouped by discipline, with entries. */
function drawIndex(registry) {
  const byDiscipline = new Map();
  const catsOf = (discipline) => {
    if (!byDiscipline.has(discipline)) byDiscipline.set(discipline, new Map());
    return byDiscipline.get(discipline);
  };

  registry.entries.forEach((e) => {
    const cats = catsOf(e.discipline);
    const key = categoryKey(e);
    if (!cats.has(key)) {
      cats.set(key, { key, discipline: e.discipline, first: e, entries: [], teams: [] });
    }
    cats.get(key).entries.push(e);
  });

  // Team disciplines have no individual entries, but they do have
  // competitors — the team. For the bracket the only difference is who
  // stands in the box, so team categories slot in with the individual.
  registry.teams.forEach((t) => {
    const cats = catsOf(t.discipline);
    const key = `${t.discipline}|${t.group}|${t.variant || t.sex}`;
    if (!cats.has(key)) {
      cats.set(key, { key, discipline: t.discipline, team: t, entries: [], teams: [] });
    }
    cats.get(key).teams.push(t);
  });

  return [...byDiscipline.entries()]
    .sort((a, b) => (disciplineByName(a[0])?.order || 99) - (disciplineByName(b[0])?.order || 99))
    .map(([discipline, cats]) => ({
      discipline,
      categories: [...cats.values()]
        .map((c) => ({
          ...c,
          label: c.team ? teamCategoryLabel(c.team) : categoryFullLabel(c.first),
          count: c.team ? c.teams.length : c.entries.length,
          isTeam: !!c.team,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'sr')),
    }));
}

function drawHtml({ competition, index }) {
  if (!competition) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema aktuelnog takmičenja</h2>
        <p class="soon-note">Nema izabranog takmičenja.</p>
        <div class="soon-links">
          <button type="button" class="btn-app is-primary" data-go="takmicenja">Takmičenja</button>
        </div>
      </div>`;
  }
  if (!index.length) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema prijava</h2>
        <p class="soon-note">Na takmičenju „${esc(competition.name)}" nema nijedne prijave.</p>
      </div>`;
  }

  const total = index.reduce((a, d) => a + d.categories.length, 0);

  // A rulebook discipline with no category at this competition does not
  // appear in the list — and that used to stay silent. The absence is now
  // named instead of hunted for on the screen.
  const missing = DISCIPLINES
    .filter((d) => !index.some((x) => x.discipline === d.name))
    .map((d) => d.name);

  const teamCount = index.reduce((a, d) => a + d.categories.filter((c) => c.isTeam).length, 0);

  return `
    <div class="filters">
      <input class="control search" id="draw-search" type="search"
             placeholder="Pretraga po disciplini ili kategoriji" aria-label="Pretraga kategorija">
      <label class="filter">
        <span class="filter-label">Vrsta</span>
        <select class="control" id="f-kind">
          <option value="">sve kategorije</option>
          <option value="solo">pojedinačno (${total - teamCount})</option>
          <option value="team">ekipno (${teamCount})</option>
        </select>
      </label>
      <span class="list-count" id="draw-count">${total} ${
        plural(total, 'kategorija', 'kategorije', 'kategorija')}</span>
    </div>

    <div class="draw-list">${index.map((d) => `
      <section class="draw-disc">
        <h2 class="draw-disc-name">${esc(d.discipline)}<span class="draw-disc-count">${
          d.categories.length} ${plural(d.categories.length, 'kategorija', 'kategorije', 'kategorija')}</span></h2>
        <ul class="draw-cats">${d.categories.map((c) => {
          const n = c.count;
          const unit = c.isTeam
            ? plural(n, 'ekipa', 'ekipe', 'ekipa')
            : plural(n, 'prijava', 'prijave', 'prijava');
          const parts = n > MAX_BRACKET
            ? `${n} ${unit} · dve grane + završna`
            : `${n} ${unit} · grana od ${bracketOf(n)}`;
          // The search also matches words people type that are not in
          // the name: "ekipno", "ekipa", "tim", "par" — whoever types
          // "ekipno" wants team categories found.
          const words = [d.discipline, c.label,
            c.isTeam ? 'ekipno ekipa ekipe tim timovi par parovi' : 'pojedinačno pojedinac']
            .join(' ').toLowerCase();
          return `
          <li class="draw-cat" data-search="${esc(words)}" data-kind="${c.isTeam ? 'team' : 'solo'}">
            <span class="draw-cat-name">${esc(c.label)}${c.isTeam
              ? '<span class="draw-tag">ekipno</span>' : ''}</span>
            <span class="draw-cat-note">${esc(parts)}</span>
            <button type="button" class="btn-app is-quiet" data-draw="${esc(c.key)}">Štampaj</button>
          </li>`;
        }).join('')}
        </ul>
      </section>`).join('')}
    </div>

    ${missing.length ? `<div class="notice">
      <b>${missing.length} ${plural(missing.length, 'disciplina', 'discipline', 'disciplina')}
      iz pravilnika nema nijednu kategoriju na ovom takmičenju:</b>
      ${esc(missing.join(', '))}.
      Prijave se upisuju pri pravljenju takmičenja i posle se ne dopunjuju same,
      pa takmičenje napravljeno pre nego što je disciplina uvedena nema njene
      prijave. Napravi novo takmičenje ili uvezi prijave za njih.
    </div>` : ''}

`;
}

/** Prva stepenica dvojke koja primi toliko prijavljenih. */
const bracketOf = (n) => Math.max(2, 2 ** Math.ceil(Math.log2(Math.max(n, 2))));

// === Entry import =============================================

/*
 * Entries are made by clubs, outside the app: the federation sends
 * form/FSS-Entry-Form.xlsx, coaches fill it in Excel and send it back.
 * The app's one job is to read the file, show what it carries and write
 * it into the chosen competition.
 *
 * The screen therefore shows every row from the file, including bad
 * ones. Valid rows import; every rejected row carries its Excel row
 * number and a sentence saying what is missing — the federation relays
 * that to the club. A file rejected whole tells nobody anything.
 */

/**
 * Files currently open on the Uvoz screen — read, not yet imported.
 * Every club sends its own file, so all are picked at once: `files` are
 * the picked files, `read` what was read from each, same order. Each
 * file stays its own, so an error is reported per club.
 */
let importState = { files: [], read: [], done: null };

const resetImport = () => { importState = { files: [], read: [], done: null }; };

/**
 * Reads the picked files for the picked competition. Age group depends on
 * the competition's season, not today's date — so files are re-read when
 * the target competition changes: the same birth year can be a pionir at
 * one and a stariji pionir at another.
 */
async function readImportFiles(competition) {
  const season = seasonOf(competition);
  // Who holds which FSS ID — so an ID that belongs to somebody else is
  // caught here, before the import, with its Excel row number.
  const owners = await store.fssOwners();
  importState.read = [];
  for (const file of importState.files) {
    const read = await readEntryFile(file, season, owners);
    importState.read.push({
      fileName: file.name,
      payload: read.payload || null,
      summary: read.summary || null,
      people: read.people || [],
      teams: read.teams || [],
      error: read.error || '',
    });
  }
  importState.done = null;
}

/** What all the picked files carry together. */
function importTotals() {
  const dobri = importState.read.filter((r) => r.payload);
  return {
    fajlova: importState.read.length,
    citljivih: dobri.length,
    entries: dobri.reduce((a, r) => a + r.summary.entries, 0),
    competitors: dobri.reduce((a, r) => a + r.summary.competitors, 0),
    teams: dobri.reduce((a, r) => a + r.summary.teams, 0),
    losih: dobri.reduce((a, r) => a + r.summary.badPeople + r.summary.badTeams, 0),
  };
}

function importHtml({ competitions, activeId }) {
  const s = importState;
  const target = competitions.find((c) => c.id === (importPick || activeId)) || competitions[0];
  const zbir = importTotals();
  // Closed entries mean closed for everything — corrections and import.
  const open = !target || entriesOpen(target);
  const ready = !!target && open && zbir.entries + zbir.teams > 0;
  const koliko = `${zbir.entries} ${plural(zbir.entries, 'prijavu', 'prijave', 'prijava')}`
    + (zbir.teams ? ` i ${zbir.teams} ${plural(zbir.teams, 'ekipu', 'ekipe', 'ekipa')}` : '');

  return `
    ${open ? '' : `
    <div class="notice">Na takmičenju „${esc(target.name)}" su prijave zatvorene —
    uvoz je zaustavljen. Vrati prijave na kontrolnoj tabli ako je stigla
    zakasnela prijava kluba.</div>`}
    <div class="filters">
      <label class="filter">
        <span class="filter-label">Uvozi u takmičenje</span>
        <select class="control is-wide" id="import-target" ${competitions.length ? '' : 'disabled'}>
          ${competitions.map((c) => `<option value="${esc(c.id)}"${c.id === target?.id ? ' selected' : ''}>
            ${esc(c.name)} · ${esc(dateLabel(c.date))}</option>`).join('')}
        </select>
      </label>
      <label class="filter">
        <span class="filter-label">Popunjeni formulari klubova (.xlsx)</span>
        <input type="file" class="control is-wide" id="import-file" multiple
               accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">
      </label>
      <button type="button" class="btn-app is-primary" data-import-run ${ready ? '' : 'disabled'}>
        ${ready ? `Uvezi ${esc(koliko)}` : 'Uvezi prijave'}</button>
      <button type="button" class="btn-app is-quiet" data-entry-form
        title="Jedan fajl za sve klubove, sa spiskom takmičara: trener upiše FSS ID i red se popuni sam">
        Formular za klubove</button>
      ${s.files.length ? '<button type="button" class="btn-app is-quiet" data-import-clear>Isprazni</button>' : ''}
    </div>

    ${s.read.length ? importFilesCard(zbir, target) : `
    <div class="empty-screen">
      <p class="empty">Nije izabran nijedan fajl.</p>
    </div>`}

    ${s.read.map((r) => importFileBlock(r, target)).join('')}

    ${s.done ? `
    <section class="pf-card is-done">
      <h2 class="pf-title">Uvezeno u „${esc(s.done.competition)}"</h2>
      <dl class="pf-facts">
        <div><dt>Fajlova</dt><dd>${s.done.files}</dd></div>
        <div><dt>Nove prijave</dt><dd>${s.done.entries}</dd></div>
        <div><dt>Novi takmičari</dt><dd>${s.done.competitors}</dd></div>
        <div><dt>Nove ekipe</dt><dd>${s.done.teams}</dd></div>
        <div><dt>Već upisano ranije</dt><dd>${s.done.skipped + s.done.teamsSkipped}</dd></div>
        <div><dt>Prepoznato po FSS ID-u</dt><dd>${s.done.recognized}</dd></div>
        <div><dt>Novih FSS ID-eva</dt><dd>${s.done.granted}</dd></div>
      </dl>
      ${s.done.rejected.length ? `
      <p class="pf-warn">${s.done.rejected.length} ${plural(s.done.rejected.length,
    'red nije uvezen', 'reda nisu uvezena', 'redova nije uvezeno')} zbog FSS ID-a:
        ${s.done.rejected.map((n) => `
        <b>${esc(n.club)}, red ${esc(n.row)}</b> ${esc(n.name)} (${esc(n.message)})`).join('; ')}.
        Klub treba da proveri ID ili ime.</p>` : ''}
      ${s.done.moved.length ? `
      <p class="pf-note">Prelazak u drugi klub, prepoznat po FSS ID-u — ID i bodovi idu
        za takmičarem: ${s.done.moved.map((n) => `
        <b>${esc(n.name)}</b> (${esc(n.id)}, ${esc(n.from)} → ${esc(n.to)})`).join(', ')}.</p>` : ''}
      ${s.done.transfers.length ? `
      <p class="pf-note">Isto ime i godište već postoji pod drugim klubom, pa su
        ovde upisani kao novi takmičari: ${s.done.transfers.map((n) => `
        <b>${esc(n.name)}</b> (${esc(n.year)}, ${esc(n.from)} → ${esc(n.to)})`).join(', ')}.
        Ako je imenjak — sve je kako treba. Ako je isti čovek koji je prešao klub,
        bodovi mu kreću od nule; sa FSS ID-em u formularu bio bi prepoznat.</p>` : ''}
      ${s.done.notes.length ? `
      <p class="pf-note">FSS ID: ${s.done.notes.map((n) => `
        <b>${esc(n.club)}, red ${esc(n.row)}</b> ${esc(n.name)} — ${esc(n.message)}`).join('; ')}.</p>` : ''}
    </section>` : ''}`;
}

/** Zbirni pregled svih izabranih fajlova — jedan red po klubu. */
function importFilesCard(zbir, target) {
  const redovi = importState.read.map((r) => {
    const bad = r.payload ? r.summary.badPeople + r.summary.badTeams : 0;
    const stranoTakmicenje = r.payload && r.summary.competition && target
      && r.summary.competition !== target.name;
    return `
      <tr class="${r.payload ? '' : 'is-bad'}">
        <td class="col-name">${esc(r.payload ? r.summary.club : r.fileName)}</td>
        <td>${esc(r.payload ? r.summary.coach || '—' : '')}</td>
        <td class="col-num">${r.payload ? r.summary.competitors : ''}</td>
        <td class="col-num">${r.payload ? r.summary.entries : ''}</td>
        <td class="col-num">${r.payload ? r.summary.teams : ''}</td>
        <td class="${r.payload ? (bad ? 'is-bad-cell' : 'is-ok') : 'is-bad-cell'}">${
  r.payload
    ? (bad ? `${bad} ${plural(bad, 'red se ne uvozi', 'reda se ne uvoze', 'redova se ne uvozi')}` : 'prijava je kompletna')
      + (stranoTakmicenje ? ` · popunjen za „${esc(r.summary.competition)}"` : '')
    : esc(r.error)}</td>
      </tr>`;
  }).join('');

  const nepoznati = importState.read
    .filter((r) => r.payload && !clubByName(r.summary.club))
    .map((r) => r.summary.club);

  return `
    <section class="pf-card">
      <h2 class="pf-title">${zbir.fajlova} ${
  plural(zbir.fajlova, 'fajl', 'fajla', 'fajlova')} · ${zbir.competitors} ${
  plural(zbir.competitors, 'takmičar', 'takmičara', 'takmičara')}</h2>
      <table class="grid is-dense import-grid">
        <thead><tr>
          <th>Klub</th><th>Trener</th><th class="col-num">Takmičari</th>
          <th class="col-num">Prijave</th><th class="col-num">Ekipe</th><th>Stanje</th>
        </tr></thead>
        <tbody>${redovi}</tbody>
      </table>
      ${zbir.losih ? `<p class="pf-warn">${zbir.losih} ${
  plural(zbir.losih, 'red se ne uvozi', 'reda se ne uvoze', 'redova se ne uvozi')}.</p>` : ''}
      ${nepoznati.length ? `<p class="table-note">${
  nepoznati.length === 1 ? 'Klub' : 'Klubovi'} ${esc(nepoznati.join(', '))} ${
  nepoznati.length === 1 ? 'nije' : 'nisu'} na spisku u aplikaciji.</p>` : ''}

    </section>`;
}

/**
 * One file, broken down. Opens itself when it contains a row that will
 * not import — the only reason the editor looks here; the rest stays
 * folded.
 */
function importFileBlock(r, target) {
  if (!r.payload) return '';
  const bad = r.summary.badPeople + r.summary.badTeams;
  return `
    <details class="pf-file"${bad ? ' open' : ''}>
      <summary class="pf-file-head">
        <span class="pf-file-club">${esc(r.summary.club)}</span>
        <span class="pf-file-meta">${r.people.length} ${
  plural(r.people.length, 'red', 'reda', 'redova')}${
  r.teams.length ? ` · ${r.teams.length} ${plural(r.teams.length, 'ekipa', 'ekipe', 'ekipa')}` : ''}
          · ${esc(r.fileName)}</span>
        ${bad ? `<span class="pf-file-bad">${bad} ${
  plural(bad, 'red ne ulazi', 'reda ne ulaze', 'redova ne ulazi')}</span>` : ''}
      </summary>
      <div class="pf-file-body">
        ${importRows(r.people, 'solo')}
        ${r.teams.length ? importRows(r.teams, 'team') : ''}
      </div>
    </details>`;
}

/**
 * Every row from the file, valid or not. An invalid one carries its Excel
 * row number and a sentence about what is missing — that is what gets
 * relayed to the club.
 */
function importRows(rows, kind) {
  // The same order as the form, so a row on screen reads like the row in Excel.
  const columns = kind === 'solo'
    ? [['Red', 'num'], ['FSS ID', ''], ['Ime', 'name'], ['Prezime', 'name'], ['Pol', 'num'],
      ['Godište', 'num'], ['Grupa', 'num'], ['Pojas', ''], ['Discipline', ''], ['Stanje', '']]
    : [['Red', 'num'], ['Ekipna disciplina', 'name'], ['Vrsta', ''], ['Grupa', 'num'],
      ['Sastav', 'num'], ['Članovi', ''], ['Stanje', '']];

  const body = rows.map((r) => {
    const ok = !r.problem;
    let cells;
    if (!ok) {
      cells = kind === 'solo'
        ? [r.excelRow, r.fss || '', r.first || (r.last ? '' : r.raw), r.last || '',
          ...Array(columns.length - 5).fill('')]
        : [r.excelRow, r.raw, ...Array(columns.length - 3).fill('')];
    } else if (kind === 'solo') {
      const c = r.competitor;
      cells = [r.excelRow, r.fss || '', c.firstName, c.lastName, c.sex, c.year, c.group, c.belt,
        c.disciplines.map((d) => (d.weight ? `${d.name} (${weightLabel(d.weight)})` : d.name)).join(' · ')];
    } else {
      const x = r.team;
      cells = [r.excelRow, x.discipline, x.variantLabel, x.group,
        `${x.members.length} člana`,
        x.members.map((m) => `${m.name} (${m.year})`).join(' · ')];
    }

    return `
      <tr class="${ok ? '' : 'is-bad'}">
        ${cells.map((v, i) => {
    const cls = columns[i][1];
    return `<td class="${cls === 'num' ? 'col-num' : cls === 'name' ? 'col-name' : ''}">${esc(v)}</td>`;
  }).join('')}
        <td class="${ok ? (r.fssNote ? 'is-note' : 'is-ok') : 'is-bad-cell'}">${
  ok ? `kompletno${r.fssNote ? ` · ${esc(r.fssNote)}` : ''}` : esc(r.problem)}</td>
      </tr>`;
  }).join('');

  return `
    <table class="grid is-dense import-grid">
      <thead><tr>${columns.map(([label, cls]) =>
    `<th class="${cls === 'num' ? 'col-num' : ''}">${esc(label)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// === Calendar =============================================

/*
 * The season calendar — a list, not a grid of squares. What the editor
 * asks a calendar is "what do we have in March", and that is a line of
 * text. Every competition year has an A and a B calendar — two lists over
 * the same competitions, shown as two blocks, not as a filter hiding half
 * the year. A competition entered here is the same record as in the
 * register: one record, two views.
 */

/** One season's competitions, grouped by month, oldest first. */
function byMonth(competitions) {
  const months = new Map();
  competitions
    .filter((c) => c.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .forEach((c) => {
      const key = c.date.slice(0, 7);
      if (!months.has(key)) {
        const [year, month] = key.split('-');
        months.set(key, {
          key,
          label: `${MONTHS[Number(month) - 1]} ${year}.`,
          items: [],
        });
      }
      months.get(key).items.push(c);
    });
  return [...months.values()];
}

function calendarHtml({ seasons, season, competitions, counts }) {
  const seasonPicker = (rest) => `
    <div class="filters">
      <label class="filter">
        <span class="filter-label">Takmičarska godina</span>
        <select class="control is-wide" id="f-season">${seasons.map((x) => `
          <option value="${esc(x.id)}"${x.id === season.id ? ' selected' : ''}>${
            esc(x.name)} · ${esc(seasonSpan(x))}${x.open ? '' : ' · zatvorena'}</option>`).join('')}
        </select>
      </label>
      ${rest}
    </div>`;

  if (!competitions.length) {
    return `
      ${seasonPicker('')}
      <div class="empty-screen">
        <h2 class="soon-title">Godina je prazna</h2>
        <p class="soon-note">U sezoni ${esc(season.name)} (${esc(seasonSpan(season))}) nema nijednog takmičenja.</p>
      </div>`;
  }

  const list = (rows) => (rows.length
    ? byMonth(rows).map((m) => `
      <section class="cal-month">
        <h3 class="cal-month-name">${esc(m.label)}<span class="cal-month-count">${
          m.items.length} ${plural(m.items.length, 'takmičenje', 'takmičenja', 'takmičenja')}</span></h3>
        <ul class="cal-list">${m.items.map((c) => `
          <li class="cal-item">
            <span class="cal-date">${esc(dateLabel(c.date))}</span>
            <span class="cal-name">
              <button type="button" class="link-cell" data-open="${esc(c.id)}">${esc(c.name)}</button>
            </span>
            <span class="cal-place">${esc(c.place)}</span>
            <span class="cal-level">${esc(c.level)}</span>
            <span class="cal-entries">${counts.get(c.id)
              ? `${num(counts.get(c.id))} ${plural(counts.get(c.id), 'prijava', 'prijave', 'prijava')}`
              : '<span class="text-muted">bez prijava</span>'}</span>
            <span class="pill">${esc(c.status)}</span>
          </li>`).join('')}
        </ul>
      </section>`).join('')
    : '<p class="cal-empty">Nema takmičenja na ovoj listi.</p>');

  const blocks = CALENDARS.map((cal) => {
    const rows = competitions.filter((c) => calendarOf(c) === cal.key);
    return `
      <section class="cal-block${cal.scores ? ' is-scoring' : ''}">
        <header class="cal-block-head">
          <h2 class="cal-block-name">${esc(cal.label)}</h2>
          <span class="cal-block-note">${esc(cal.note)}</span>
          <span class="cal-block-count">${rows.length} ${
            plural(rows.length, 'takmičenje', 'takmičenja', 'takmičenja')}</span>
        </header>
        ${list(rows)}
      </section>`;
  }).join('');

  const a = competitions.filter((c) => calendarOf(c) === 'A').length;
  return `
    ${seasonPicker(`
      <span class="list-count">${competitions.length} ${
        plural(competitions.length, 'takmičenje', 'takmičenja', 'takmičenja')} ·
        ${a} na A listi · ${competitions.length - a} na B</span>`)}
    <div class="cal-body">${blocks}</div>`;
}

// === Mats =============================================

/*
 * The mat schedule — the same sheet the federation used to make by hand
 * in Word, assembled here from the entries that already exist.
 *
 * The unit is a block: one age group of one sex, with the disciplines it
 * runs — the unit the official attachment uses, and the unit by which it
 * is judged. Blocks are derived from entries, never entered: a group with
 * no entries has no block, so the schedule cannot invent a category that
 * will not step on a mat.
 */

const SEX_WORD = {
  M: { A: 'dečaci', B: 'dečaci', C: 'dečaci', D: 'dečaci', E: 'dečaci' },
  'Ž': { A: 'devojčice', B: 'devojčice', C: 'devojčice', D: 'devojčice', E: 'devojčice' },
};

/** "dečaci" for younger groups, "muškarci" for older — as the federation writes. */
const blockSexWord = (sex, code) =>
  SEX_WORD[sex]?.[code] || (sex === 'M' ? 'muškarci' : 'žene');

/**
 * All blocks of this competition, in rulebook order (age, then M/Ž).
 * Disciplines inside a block follow DISCIPLINES order, not the alphabet.
 */
/**
 * One schedule row is one discipline of one age group — exactly what is
 * played on one mat in one slot. The unit used to be a whole age group,
 * which forced all its disciplines onto one mat; now each (group,
 * discipline) pair is placed on its own, and the screen only groups them
 * — so "sport kumite of all ages on one mat" is a few clicks.
 */
function tatamiPairs(registry) {
  const map = new Map();
  registry.entries.forEach((e) => {
    const id = `${e.group}-${e.sex}|${e.discipline}`;
    if (!map.has(id)) {
      map.set(id, {
        id, group: e.group, sex: e.sex, discipline: e.discipline,
        entries: 0, people: new Set(),
      });
    }
    const pair = map.get(id);
    pair.entries += 1;
    pair.people.add(e.competitorId);
  });
  return [...map.values()].map((pair) => ({ ...pair, people: pair.people.size }));
}

const AGE_ORDER = 'ABCDEFGHIJ'.split('');

/**
 * Dva pogleda na isti raspored. Kartica je grupa parova: po uzrastu su to
 * discipline jedne grupe, po disciplini uzrasne grupe jedne discipline.
 */
const TATAMI_AXES = {
  uzrast: {
    label: 'po uzrastu',
    key: (pair) => `${pair.group}-${pair.sex}`,
    name: (pair) => `Grupa ${pair.group} (${blockSexWord(pair.sex, pair.group)})`,
    long: (pair) => `Grupa ${pair.group} · ${ageByCode(pair.group)?.name.toLowerCase() || ''}`
      + ` · ${blockSexWord(pair.sex, pair.group)}`,
    rank: (pair) => AGE_ORDER.indexOf(pair.group) * 2 + (pair.sex === 'M' ? 0 : 1),
    item: (pair) => pair.discipline,
    itemRank: (pair) => disciplineByName(pair.discipline)?.order || 99,
  },
  disciplina: {
    label: 'po disciplini',
    key: (pair) => pair.discipline,
    name: (pair) => pair.discipline,
    long: (pair) => pair.discipline,
    rank: (pair) => disciplineByName(pair.discipline)?.order || 99,
    item: (pair) => `Grupa ${pair.group} (${blockSexWord(pair.sex, pair.group)})`,
    itemRank: (pair) => AGE_ORDER.indexOf(pair.group) * 2 + (pair.sex === 'M' ? 0 : 1),
  },
};

const axisOf = (plan) => TATAMI_AXES[plan.axis] || TATAMI_AXES.uzrast;

/**
 * Plans made before pairs existed stored a mat per age group. Translated
 * once, on first open: what was placed stays placed.
 */
function migrateTatamiPlan(plan, pairs) {
  if (!plan.blocks || plan.migrated) return false;
  pairs.forEach((pair) => {
    const old = plan.blocks[`${pair.group}-${pair.sex}`];
    if (!old?.tatami) return;
    if (old.disciplines && !old.disciplines.includes(pair.discipline)) return;
    plan.pairs[pair.id] = old.tatami;
    plan.order[`uzrast|${pair.group}-${pair.sex}`] = old.order || 0;
  });
  plan.migrated = true;
  return true;
}

/**
 * Cards per mat, plus the unplaced ones. A card is drawn on every mat
 * that has its pairs: a group whose two disciplines go to different mats
 * appears on both, with what actually happens there. Paper says the same.
 */
function tatamiCards(pairs, plan) {
  const axis = axisOf(plan);
  const columns = Array.from({ length: plan.count }, () => new Map());
  const pool = new Map();

  const put = (bucket, pair) => {
    const key = axis.key(pair);
    if (!bucket.has(key)) {
      bucket.set(key, {
        key, name: axis.name(pair), long: axis.long(pair),
        rank: axis.rank(pair), pairs: [], people: 0, entries: 0,
      });
    }
    const card = bucket.get(key);
    card.pairs.push(pair);
    card.people += pair.people;
    card.entries += pair.entries;
  };

  pairs.forEach((pair) => {
    const mat = plan.pairs[pair.id] || 0;
    put(mat >= 1 && mat <= plan.count ? columns[mat - 1] : pool, pair);
  });

  const finish = (bucket) => [...bucket.values()].map((card) => ({
    ...card,
    order: plan.order[`${plan.axis}|${card.key}`] || 0,
    items: card.pairs
      .sort((a, b) => axis.itemRank(a) - axis.itemRank(b))
      .map((pair) => axis.item(pair)),
  }));

  const cols = columns.map((bucket) => finish(bucket)
    .sort((a, b) => a.order - b.order || a.rank - b.rank));
  cols.forEach((list) => list.forEach((card, i) => { card.order = i + 1; }));
  return { columns: cols, pool: finish(pool).sort((a, b) => a.rank - b.rank) };
}

/** "(M/Ž)" — which sexes appear on that mat, for the column header. */
const matSexLabel = (list) => {
  const sexes = [...new Set(list.flatMap((card) => card.pairs.map((p) => p.sex)))];
  if (!sexes.length) return '';
  return sexes.length > 1 ? '(M/Ž)' : `(${sexes[0] === 'M' ? 'M' : 'Ž'})`;
};

function tatamiHtml({ competition, pairs, plan }) {
  if (!competition) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema aktuelnog takmičenja</h2>
        <p class="soon-note">Nema izabranog takmičenja.</p>
        <div class="soon-links">
          <button type="button" class="btn-app is-primary" data-go="takmicenja">Takmičenja</button>
        </div>
      </div>`;
  }
  if (!pairs.length) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema prijava</h2>
        <p class="soon-note">Na takmičenju „${esc(competition.name)}" nema nijedne prijave.</p>
      </div>`;
  }

  const { columns, pool } = tatamiCards(pairs, plan);
  const raspored = pairs.length - pool.reduce((a, c) => a + c.pairs.length, 0);

  const card = (c, mat) => `
    <article class="mat-block" data-block="${esc(c.key)}" data-mat="${mat}">
      <header class="mat-block-head">
        <span class="mat-block-name">${esc(c.name)}</span>
        <span class="mat-block-count">${c.people} ${plural(c.people, 'takmičar', 'takmičara', 'takmičara')} ·
          ${c.entries} ${plural(c.entries, 'prijava', 'prijave', 'prijava')}</span>
      </header>
      <div class="mat-block-discs">${c.items.map((item) => `
        <span class="mat-disc is-on">${esc(item)}</span>`).join('')}
      </div>
      <footer class="mat-block-foot">
        <label class="mat-move">
          <span class="mat-move-label">Borilište</span>
          <select class="control is-narrow" data-move>
            <option value="0"${!mat ? ' selected' : ''}>—</option>
            ${Array.from({ length: plan.count }, (unused, i) => `
              <option value="${i + 1}"${mat === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('')}
          </select>
        </label>
        ${mat ? `
        <span class="mat-order">
          <button type="button" class="link-cell" data-bump="-1" aria-label="Pomeri gore">▲</button>
          <b>${c.order}.</b>
          <button type="button" class="link-cell" data-bump="1" aria-label="Pomeri dole">▼</button>
        </span>` : ''}
      </footer>
    </article>`;

  return `
    <div class="filters">
      <label class="filter">
        <span class="filter-label">Broj borilišta</span>
        <select class="control is-narrow" id="f-mats">${
  [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `
            <option value="${n}"${n === plan.count ? ' selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>
      <label class="filter">
        <span class="filter-label">Raspoređuje se</span>
        <select class="control" id="f-axis">${Object.entries(TATAMI_AXES).map(([key, ax]) => `
          <option value="${key}"${key === plan.axis ? ' selected' : ''}>${esc(ax.label)}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="btn-app is-quiet" id="mats-spread">Rasporedi ravnomerno</button>
      <button type="button" class="btn-app is-quiet" id="mats-clear">Skloni sve</button>
      <span class="list-count">${raspored} od ${pairs.length} ${
  plural(pairs.length, 'stavka raspoređena', 'stavke raspoređene', 'stavki raspoređeno')}</span>
    </div>

    ${pool.length ? `
    <section class="mat-pool">
      <h2 class="mat-pool-title">Nije raspoređeno — ${pool.reduce((a, c) => a + c.pairs.length, 0)} ${
  plural(pool.reduce((a, c) => a + c.pairs.length, 0), 'stavka', 'stavke', 'stavki')}</h2>
      <div class="mat-pool-list">${pool.map((c) => card(c, 0)).join('')}</div>
    </section>` : ''}

    <div class="mat-board" style="--mats:${plan.count}">${columns.map((list, i) => `
      <section class="mat-col">
        <header class="mat-col-head">
          <span class="mat-col-name">Borilište ${i + 1}</span>
          <span class="mat-col-sex">${esc(matSexLabel(list))}</span>
        </header>
        <div class="mat-col-body">${list.length
    ? list.map((c) => card(c, i + 1)).join('')
    : '<p class="mat-empty">Prazno.</p>'}
        </div>
      </section>`).join('')}
    </div>
`;
}

// === List printing =============================================

/*
 * One spec per screen, one rule for all: what is on screen goes on
 * paper. A filter that hides a row drops it from the print, and the
 * active filter is named in the header. None of these sheets are signed
 * — they are working lists; official documents live in documents.html.
 */

/** The right header block: which competition. */
const competitionContext = (c) => (c
  ? { name: c.name, sub: `${dateLabel(c.date)} · ${c.place}` }
  : { name: FEDERATION.name, sub: FEDERATION.subtitle });

/** For lists not tied to one competition (clubs, rankings). */
const ALL_SEASONS = { name: 'Sve sezone', sub: 'Zbirno kroz sva takmičenja u bazi' };

/** Zero is not printed — an empty cell reads faster than a zero column. */
const numCell = (n, align = 'center', strong = false) =>
  cell(n ? num(n) : null, align, strong);

/**
  * "Disciplina: Kate · Godište: 2010" when a filter is on, else nothing.
  * With a filter on, the paper must say what it left out; without one
  * there is nothing to say.
  */
const filterNote = (pairs) => filterLabel(pairs);

/** Everything that passed the filter, in screen order. */
const keepVisible = (items, key) => {
  const shown = new Set(visibleIds());
  return items.filter((item) => shown.has(String(key(item))));
};

/** Zaglavlje svake rang liste: koja sezona i koji raspon. */
const seasonContext = (season) => ({
  name: `Sezona ${season.name}`,
  sub: seasonSpan(season),
});

/**
 * One ranking list on paper — clubs or one age category. The same
 * function for both on purpose: only two columns differ, and one shape
 * makes the whole stack read as one document.
 */
function rankingSpec({ season, group, clubs, totals }) {
  const rows = group ? group.rows : clubs;
  const who = group
    ? [col('Ime i prezime'), col('Klub'), col('God.', '46px', 'center')]
    : [col('Klub'), col('Grad'), col('Takmičari', '62px', 'center')];

  return {
    orientation: 'portrait',
    context: seasonContext(season),
    spec: {
      kicker: group ? 'Rang lista · uzrasna kategorija' : 'Rang lista · klubovi',
      title: group ? group.name : 'Klubovi',
      meta1: group
        ? `${rows.length} ${plural(rows.length, 'takmičar', 'takmičara', 'takmičara')} · ${
          season.name}`
        : `${rows.length} ${plural(rows.length, 'klub', 'kluba', 'klubova')} · ${season.name}`,
      meta2: `${totals.competitions} ${plural(totals.competitions, 'takmičenje', 'takmičenja', 'takmičenja')} u sezoni`,
      // The ranking list is official — cups follow it, so it is signed.
      signatures: ['Predsednik saveza', 'Sekretar saveza'],
      docCode: group ? `Rang lista ${group.id} · ${season.name}` : `Rang lista klubova · ${season.name}`,
      columns: [
        col('Mesto', '48px', 'center'), ...who,
        col('Nastupa', '56px', 'center'),
        col('Zlato', '46px', 'center'), col('Srebro', '48px', 'center'),
        col('Bronza', '48px', 'center'), col('Učešće', '48px', 'center'),
        col('Bodovi', '58px', 'center'),
      ],
      rows: rows.map((r, i) => ({
        zebra: i % 2 === 1,
        cells: [
          cell(`${r.place}.`, 'center', r.place <= 3),
          ...(group
            ? [cell(r.name, 'left', true), cell(r.club), cell(r.year, 'center')]
            : [cell(r.name, 'left', true), cell(r.city), numCell(r.people)]),
          numCell(group ? r.nastupa : r.entries),
          numCell(r.zlato), numCell(r.srebro), numCell(r.bronza), numCell(r.ucesce),
          numCell(r.bodovi, 'center', true),
        ],
      })),
      // No totals row. A point is somebody's — the competitor's, and
      // through them the club's; a sum of everybody's belongs to nobody.
      summary: '',
      summaryRight: '',
    },
  };
}

/**
 * The whole season-closing stack: clubs, then every age category, each
 * its own sheet with its own page numbering.
 */
const seasonStack = ({ season, data }) => [
  rankingSpec({ season, group: null, clubs: data.clubs, totals: data.totals }),
  ...data.groups.map((group) => rankingSpec({ season, group, totals: data.totals })),
];

/**
 * The mat schedule on paper, shaped like the federation's own sheet: a
 * column per mat, a row per slot. Columns read top down; a row with
 * nothing for some mat stays empty there — correct, that mat has no slot.
 */
function tatamiSpec({ competition, pairs, plan }) {
  const { columns, pool } = tatamiCards(pairs, plan);

  const assigned = columns.flat();
  const people = assigned.reduce((a, c) => a + c.people, 0);
  const nerasporedjeno = pool.reduce((a, c) => a + c.pairs.length, 0);

  // More than two mats portrait makes columns narrower than discipline
  // names, so landscape is tried first; portrait is taller and takes a
  // longer column, so it stays as the fallback. The renderer picks the
  // one where everything fits one sheet.
  const orientations = plan.count > 2 ? ['landscape', 'portrait'] : ['portrait', 'landscape'];

  return {
    orientation: orientations[0],
    context: competitionContext(competition),
    spec: {
      kicker: 'Raspored',
      title: 'Raspored takmičara na borilištima',
      meta1: `${plan.count} ${plural(plan.count, 'borilište', 'borilišta', 'borilišta')} · ${
        assigned.reduce((a, c) => a + c.pairs.length, 0)} ${
        plural(assigned.reduce((a, c) => a + c.pairs.length, 0), 'stavka', 'stavke', 'stavki')} · ${
        people} ${plural(people, 'takmičar', 'takmičara', 'takmičara')}`,
      meta2: '',
      // Bez potpisa — raspored je radni list koji se lepi na zid i menja
      // tokom dana, a ne protokol koji neko overava.
      docCode: 'Raspored na borilištima',
      // A board, not a table: a column is a mat and flows on its own, so
      // one busy mat still fits the sheet.
      board: {
        orientations,
        columns: columns.map((list, i) => ({
          label: `Borilište ${i + 1} ${matSexLabel(list)}`.trim(),
          cards: list.map((card) => boardCard(card.order, card.long, card.items)),
        })),
      },
      rows: [],
      summary: nerasporedjeno
        ? `Nije raspoređeno: ${nerasporedjeno} ${
          plural(nerasporedjeno, 'stavka', 'stavke', 'stavki')}`
        : '',
      summaryRight: '',
    },
  };
}

/**
 * The calendar on paper: month as a row heading, competitions under it.
 * A and B lists one after the other — they are read together.
 */
function calendarSpec({ season, competitions, counts }) {
  const rows = [];
  let groupIndex = 0;

  CALENDARS.forEach((cal) => {
    const mine = competitions.filter((c) => calendarOf(c) === cal.key);
    if (!mine.length) return;
    byMonth(mine).forEach((month) => {
      groupIndex += 1;
      month.items.forEach((c, i) => {
        const last = i === month.items.length - 1;
        rows.push({
          groupId: groupIndex,
          zebra: groupIndex % 2 === 0,
          groupInner: !last,
          groupEnd: last,
          cells: [
            cell(i === 0 ? cal.key : null, 'center', true),
            cell(i === 0 ? month.label : null, 'left', i === 0),
            cell(dateLabel(c.date), 'center'),
            cell(c.name, 'left', true), cell(c.place), cell(c.level),
            numCell(counts.get(c.id) ?? 0), cell(c.status),
          ],
        });
      });
    });
  });

  const a = competitions.filter((c) => calendarOf(c) === 'A').length;
  return {
    orientation: 'portrait',
    context: { name: `Sezona ${season.name}`, sub: seasonSpan(season) },
    spec: {
      kicker: 'Kalendar takmičarske godine',
      title: `Kalendar ${season.name}`,
      meta1: `${competitions.length} ${plural(competitions.length, 'takmičenje', 'takmičenja', 'takmičenja')} · ${a} na A listi · ${competitions.length - a} na B`,
      meta2: '',
      docCode: `Kalendar ${season.name}`,
      columns: [
        col('Lista', '40px', 'center'), col('Mesec', '96px'), col('Datum', '76px', 'center'),
        col('Takmičenje'), col('Mesto'), col('Nivo'),
        col('Prijave', '54px', 'center'), col('Status', '96px'),
      ],
      rows,
      summary: '',
      summaryRight: `Meseci sa takmičenjem: ${groupIndex}`,
    },
  };
}

/**
 * The draw bracket on paper. The first page (or three, when a category
 * splits) is the bracket with places for results and the head referee's
 * signature — the referee is who certifies the draw. Then the category's
 * competitor list: name and club only, for calling out at the mat.
 */
/**
 * A team in the bracket stands under the name it was entered with — the
 * club, numbered when the club has several in the category. The name
 * comes from the record (labelTeams in data.js), so bracket, list and
 * entry all say the same.
 */
const teamEntrants = (teams) => teams.map((t) => ({
  name: t.label || t.club, club: t.club, team: t,
}));

function drawSpec({ competition, category }) {
  const people = category.isTeam
    ? teamEntrants(category.teams)
    : category.entries.map((e) => ({ name: e.name, club: e.club }));
  const brackets = drawCategory(people);
  const clash = brackets.reduce((a, b) => a + b.clubClash, 0);

  const leads = brackets.map((bracket) => {
    const drawn = bracketHtml(bracket);
    const places = `
      <div class="br-places">${['1. mesto', '2. mesto', '3. mesto', '3. mesto'].map((label) => `
        <div class="br-place">
          <div class="br-place-label">${label}</div>
          <div class="br-place-rule"></div>
        </div>`).join('')}
      </div>`;

    return {
      html: drawn.html + places,
      kicker: `Žreb · ${competition.name}`,
      title: bracket.title ? `${category.label} — ${bracket.title}` : category.label,
      meta1: `${bracket.entries} ${category.isTeam
        ? plural(bracket.entries, 'ekipa', 'ekipe', 'ekipa')
        : plural(bracket.entries, 'takmičar', 'takmičara', 'takmičara')} · grana od ${bracket.size}`
        + (bracket.byes ? ` · ${bracket.byes} ${plural(bracket.byes, 'slobodan prolaz', 'slobodna prolaza', 'slobodnih prolaza')}` : ''),
      // Only the warning stays — not an explanation but a fact the head
      // referee must see before signing.
      meta2: clash
        ? `PAŽNJA: ${clash} ${plural(clash, 'par', 'para', 'parova')} iz istog kluba`
        : '',
      signatures: ['Glavni sudija'],
      summary: '',
    };
  });

  // The list behind the bracket. For teams it is a row per member, and a
  // team's members stay together (groupId) — a team cut across two pages
  // is a puzzle, not a list.
  const rows = [];
  if (category.isTeam) {
    [...people]
      .sort((a, b) => a.name.localeCompare(b.name, 'sr'))
      .forEach((entrant, i) => {
        entrant.team.members.forEach((m, mi) => {
          const last = mi === entrant.team.members.length - 1;
          rows.push({
            groupId: entrant.team.id,
            zebra: i % 2 === 1,
            groupInner: !last,
            groupEnd: last,
            cells: [
              cell(mi === 0 ? i + 1 : null, 'center'),
              cell(m.name, 'left', true),
              cell(mi === 0 ? entrant.name : null),
            ],
          });
        });
      });
  } else {
    [...people]
      .sort((a, b) => a.name.localeCompare(b.name, 'sr'))
      .forEach((p, i) => rows.push({
        zebra: i % 2 === 1,
        cells: [cell(i + 1, 'center'), cell(p.name, 'left', true), cell(p.club)],
      }));
  }

  const discipline = disciplineByName(category.discipline);
  return {
    orientation: 'portrait',
    context: competitionContext(competition),
    spec: {
      leads,
      kicker: `Žreb · ${category.discipline}`,
      title: category.label,
      meta1: category.isTeam
        ? `${people.length} ${plural(people.length, 'ekipa', 'ekipe', 'ekipa')} · ${teamSizeLabel(discipline)}`
        : `${rows.length} ${plural(rows.length, 'prijavljen', 'prijavljena', 'prijavljenih')}`,
      meta2: '',
      docCode: `Žreb ${category.discipline}`,
      columns: [
        col('#', '30px', 'center'),
        col(category.isTeam ? 'Takmičar' : 'Ime i prezime'),
        col(category.isTeam ? 'Ekipa' : 'Klub'),
      ],
      rows,
      summary: '',
    },
  };
}

function competitionsSpec({ competitions, counts, activeId }) {
  const rows = competitions;
  return {
    orientation: 'portrait',
    context: ALL_SEASONS,
    spec: {
      kicker: 'Evidencija',
      title: 'Takmičenja',
      meta1: `Ukupno u bazi: ${rows.length} ${plural(rows.length, 'takmičenje', 'takmičenja', 'takmičenja')}`,
      meta2: '',
      docCode: 'Evidencija takmičenja',
      columns: [
        col('#', '26px', 'center'), col('Takmičenje'), col('Datum', '76px', 'center'),
        col('Mesto'), col('Nivo'), col('Lista', '40px', 'center'),
        col('Prijave', '58px', 'center'), col('Status', '104px'),
      ],
      rows: rows.map((c, i) => ({
        zebra: i % 2 === 1,
        cells: [
          cell(i + 1, 'center'),
          cell(c.id === activeId ? `${c.name} ★` : c.name, 'left', true),
          cell(dateLabel(c.date), 'center'), cell(c.place), cell(c.level),
          cell(calendarOf(c), 'center', true),
          numCell(counts.get(c.id) ?? 0), cell(c.status),
        ],
      })),
      summary: `Ukupno takmičenja: ${rows.length}`,
      summaryRight: `Prijava ukupno: ${num([...counts.values()].reduce((a, b) => a + b, 0))}`,
    },
  };
}

function competitorsSpec({ competition, registry, tally }) {
  const perCompetitor = new Map();
  registry.entries.forEach((e) => {
    perCompetitor.set(e.competitorId, (perCompetitor.get(e.competitorId) || 0) + 1);
  });

  const blank = { zlato: 0, srebro: 0, bronza: 0, ucesce: 0, medalje: 0, bodovi: 0 };
  const all = [...registry.competitors].sort((a, b) => a.name.localeCompare(b.name, 'sr'));
  const rows = keepVisible(all, (c) => c.id);
  const search = document.getElementById('competitor-search')?.value.trim() || '';

  return {
    // Fifteen columns do not fit upright without names breaking.
    orientation: 'landscape',
    context: competitionContext(competition),
    spec: {
      kicker: 'Evidencija',
      title: 'Spisak takmičara',
      meta1: `${rows.length} ${plural(rows.length, 'takmičar', 'takmičara', 'takmičara')}`,
      meta2: `${filterNote([['Pretraga', search]])}${
        calendarOf(competition) === 'B' ? ' · B lista — bez bodovanja' : ''}`,
      docCode: 'Spisak takmičara',
      columns: [
        col('#', '26px', 'center'), col('FSS ID', '74px'), col('Ime'), col('Prezime'), col('Klub'),
        col('Grupa', '46px', 'center'), col('God.', '44px', 'center'), col('Pojas', '54px'),
        col('Prijave', '50px', 'center'), col('Zlato', '46px', 'center'),
        col('Srebro', '48px', 'center'), col('Bronza', '48px', 'center'),
        col('Učešće', '48px', 'center'), col('Bodovi', '52px', 'center'),
        col('Ukupno', '54px', 'center'),
      ],
      rows: rows.map((c, i) => {
        const here = tally.get(c.personId)?.here || blank;
        const total = tally.get(c.personId)?.total || blank;
        const { first, last } = nameParts(c);
        return {
          zebra: i % 2 === 1,
          cells: [
            cell(i + 1, 'center'), cell(c.fssId || '—'), cell(first, 'left', true),
            cell(last, 'left', true), cell(c.club),
            cell(c.group, 'center'), cell(c.year, 'center'), cell(c.belt),
            numCell(perCompetitor.get(c.id) || 0),
            numCell(here.zlato), numCell(here.srebro), numCell(here.bronza), numCell(here.ucesce),
            numCell(here.bodovi, 'center', true), numCell(total.bodovi),
          ],
        };
      }),
      summary: `Klubova: ${uniqueCount(rows, (c) => c.club)} · gradova: ${uniqueCount(rows, (c) => c.city)}`,
      summaryRight: '',
    },
  };
}

function clubsSpec({ clubs }) {
  const rows = keepVisible(clubs, (c) => c.name);
  const search = document.getElementById('club-search')?.value.trim() || '';

  return {
    orientation: 'portrait',
    context: ALL_SEASONS,
    spec: {
      kicker: 'Evidencija',
      title: 'Klubovi — medalje i bodovi',
      meta1: `${rows.length} ${plural(rows.length, 'klub', 'kluba', 'klubova')}`,
      meta2: filterNote([['Pretraga', search]]),
      docCode: 'Tabela klubova',
      columns: [
        col('#', '26px', 'center'), col('Klub'), col('Grad'),
        col('Takmičari', '64px', 'center'), col('Medalje', '58px', 'center'),
        col('Zlato', '48px', 'center'), col('Srebro', '50px', 'center'),
        col('Bronza', '50px', 'center'), col('Bodovi', '58px', 'center'),
      ],
      rows: rows.map((c, i) => ({
        zebra: i % 2 === 1,
        cells: [
          cell(i + 1, 'center'), cell(c.name, 'left', true), cell(c.city),
          numCell(c.people), numCell(c.medalje, 'center', true),
          numCell(c.zlato), numCell(c.srebro), numCell(c.bronza),
          numCell(c.bodovi, 'center', true),
        ],
      })),
      summary: '',
      summaryRight: '',
    },
  };
}

/**
 * Results are read from the screen, not the database: discipline order,
 * what passed the filter and which placement is picked all sit in the
 * DOM exactly as the user sees them — including a pick made a second ago.
 */
/**
 * One category's results, ordered for writing diplomas. Diplomas are
 * written as each category finishes, so each has its own sheet. Order is
 * place order — first, second, two thirds, then the rest.
 */
function resultsCategorySpec({ competition, registry, results, key }) {
  const byEntry = new Map(results.map((r) => [r.entryId, r]));
  if (key.startsWith('team:')) {
    return teamCategorySpec({ competition, registry, byEntry, key });
  }
  const entries = registry.entries.filter((e) => categoryKey(e) === key);
  if (!entries.length) return null;

  const order = (e) => {
    const at = PLACEMENTS.findIndex((pl) => pl.key === byEntry.get(e.id)?.placement);
    return at < 0 ? PLACEMENTS.length : at;
  };
  const sorted = [...entries].sort((a, b) =>
    order(a) - order(b) || a.name.localeCompare(b.name, 'sr'));

  const first = entries[0];
  const upisano = entries.filter((e) => byEntry.has(e.id)).length;

  return {
    orientation: 'portrait',
    context: competitionContext(competition),
    spec: {
      kicker: `Rezultati · ${first.discipline}`,
      title: categoryFullLabel(first),
      meta1: `${entries.length} ${plural(entries.length, 'prijava', 'prijave', 'prijava')}`
        + ` · ${upisano} ${plural(upisano, 'plasman unet', 'plasmana uneta', 'plasmana uneto')}`,
      meta2: '',
      docCode: `Rezultati ${first.discipline}`,
      columns: [
        col('Mesto', '76px', 'center'), col('Ime i prezime'), col('Ime kluba'),
        col('Grad'), col('Bodovi', '58px', 'center'),
      ],
      rows: sorted.map((e, i) => {
        const pl = placementByKey(byEntry.get(e.id)?.placement || '');
        return {
          zebra: i % 2 === 1,
          cells: [
            cell(pl ? (pl.place || pl.label) : null, 'center', !!pl?.medal),
            cell(e.name, 'left', true), cell(e.club), cell(e.city),
            cell(pl ? pl.points : null, 'center'),
          ],
        };
      }),
      summary: '',
    },
  };
}

/** One team category's results — a row per team, members listed. */
function teamCategorySpec({ competition, registry, byEntry, key }) {
  const teams = registry.teams.filter((t) => teamKeyOf(t) === key);
  if (!teams.length) return null;

  const order = (t) => {
    const at = PLACEMENTS.findIndex((pl) => pl.key === byEntry.get(t.id)?.placement);
    return at < 0 ? PLACEMENTS.length : at;
  };
  const sorted = [...teams].sort((a, b) =>
    order(a) - order(b) || a.label.localeCompare(b.label, 'sr'));
  const first = teams[0];
  const upisano = teams.filter((t) => byEntry.has(t.id)).length;

  return {
    orientation: 'portrait',
    context: competitionContext(competition),
    spec: {
      kicker: `Rezultati · ${first.discipline}`,
      title: teamCategoryLabel(first),
      meta1: `${teams.length} ${plural(teams.length, 'ekipa', 'ekipe', 'ekipa')}`
        + ` · ${upisano} ${plural(upisano, 'plasman unet', 'plasmana uneta', 'plasmana uneto')}`,
      meta2: '',
      docCode: `Rezultati ${first.discipline}`,
      columns: [
        col('Mesto', '76px', 'center'), col('Naziv tima'), col('Članovi'),
        col('Bodovi', '58px', 'center'),
      ],
      rows: sorted.map((t, i) => {
        const pl = placementByKey(byEntry.get(t.id)?.placement || '');
        return {
          zebra: i % 2 === 1,
          cells: [
            cell(pl ? (pl.place || pl.label) : null, 'center', !!pl?.medal),
            cell(t.label, 'left', true),
            cell((t.members || []).map((m) => m.name).join(', ')),
            cell(pl ? pl.points : null, 'center'),
          ],
        };
      }),
      summary: '',
    },
  };
}

/** Sve kategorije jedne discipline, svaka na svom listu. */
function resultsDisciplineSpecs({ competition, registry, results, discipline }) {
  const keys = [];
  registry.entries
    .filter((e) => e.discipline === discipline)
    .forEach((e) => { if (!keys.includes(categoryKey(e))) keys.push(categoryKey(e)); });
  registry.teams
    .filter((t) => t.discipline === discipline)
    .forEach((t) => { if (!keys.includes(teamKeyOf(t))) keys.push(teamKeyOf(t)); });
  return keys
    .map((key) => resultsCategorySpec({ competition, registry, results, key }))
    .filter(Boolean);
}

function resultsSpec({ competition, registry }) {
  const byId = new Map(registry.entries.map((e) => [e.id, e]));
  // A team on the full results sheet: team name where the name goes, no year.
  registry.teams.forEach((t) => byId.set(t.id, { name: t.label, club: t.club, year: '' }));
  const rows = [];
  let groupIndex = 0;

  document.querySelectorAll('details.disc').forEach((disc) => {
    if (!onScreen(disc)) return;
    disc.querySelectorAll('.cat').forEach((cat) => {
      if (!onScreen(cat)) return;
      const picked = [...cat.querySelectorAll('.result-row')].filter(onScreen);
      if (!picked.length) return;

      groupIndex += 1;
      picked.forEach((row, i) => {
        const entry = byId.get(row.dataset.printId);
        if (!entry) return;
        const pl = placementByKey(row.querySelector('.result-pick')?.value || '');
        const last = i === picked.length - 1;
        rows.push({
          groupId: groupIndex,
          zebra: groupIndex % 2 === 0,
          groupInner: !last,
          groupEnd: last,
          cells: [
            cell(i === 0 ? disc.dataset.disc : null, 'left', i === 0),
            cell(i === 0 ? cat.querySelector('.cat-name').textContent.trim() : null),
            cell(entry.name, 'left', true), cell(entry.club),
            cell(entry.year, 'center'),
            cell(pl ? (pl.place || pl.label) : null, 'center', !!pl?.medal),
            cell(pl ? pl.points : null, 'center'),
          ],
        });
      });
    });
  });

  const done = rows.filter((r) => r.cells[5].value).length;

  return {
    // Landscape: category names are long ("Grupa A · poletarci · žene ·
    // 0. nivo") and wrapping them breaks the table in half.
    orientation: 'landscape',
    context: competitionContext(competition),
    spec: {
      kicker: 'Rezultati',
      title: 'Plasmani po disciplinama i kategorijama',
      meta1: `${done} od ${rows.length} ${plural(rows.length, 'plasmana', 'plasmana', 'plasmana')} uneto`,
      meta2: `${calendarOf(competition) === 'B' ? 'B lista — bez bodovanja · ' : ''}${filterNote([
        ['Disciplina', document.getElementById('f-disc')?.value],
        ['Kategorija', document.getElementById('f-cat')?.value],
        ['Pol', document.getElementById('f-sex')?.value ? sexLabel(document.getElementById('f-sex').value) : ''],
        ['Godište', document.getElementById('f-year')?.value],
      ])}`,
      // A result is official once signed, so this sheet has signature
      // lines. (The B-list note sits in meta2 above.)
      signatures: ['Glavni sudija', 'Delegat saveza'],
      docCode: 'Rezultati po kategorijama',
      columns: [
        col('Disciplina', '104px'), col('Kategorija', '208px'), col('Takmičar'),
        col('Klub'), col('God.', '46px', 'center'),
        col('Plasman', '78px', 'center'), col('Bodovi', '52px', 'center'),
      ],
      rows,
      // No totals row — the count of entered placements is in the
      // header, and a sum of everybody's points is nobody's number.
      summary: `${groupIndex} ${plural(groupIndex, 'kategorija', 'kategorije', 'kategorija')}`,
      summaryRight: '',
    },
  };
}

/**
 * One schedule change: apply to the plan, save, redraw. No save button —
 * the schedule is made in the hall while entries are still coming, and
 * every change must survive the laptop lid closing.
 */
async function updateTatami(change) {
  if (!tatamiState) return;
  const plan = JSON.parse(JSON.stringify(tatamiState.plan));
  change(plan);
  await store.saveTatamiPlan(tatamiState.competitionId, plan);
  render();
}

/** The pairs one card covers on a given mat. */
function cardPairs(plan, key, mat) {
  const axis = axisOf(plan);
  return tatamiState.pairs.filter((pair) =>
    axis.key(pair) === key && (plan.pairs[pair.id] || 0) === mat);
}

// === Modals =============================================

const modalRoot = document.getElementById('modal');

function closeModal() { modalRoot.innerHTML = ''; }

function newCompetitionModal() {
  const levels = COMPETITION_LEVELS.map((l) =>
    `<option value="${esc(l)}">${esc(l)}</option>`).join('');
  const disciplines = DISCIPLINES.map((d) => `
    <label class="pick">
      <input type="checkbox" name="disciplines" value="${esc(d.name)}" checked>
      ${esc(d.name)}
    </label>`).join('');

  modalRoot.innerHTML = `
    <div class="backdrop" data-close>
      <form class="modal" id="new-comp-form" novalidate>
        <i class="mark tl" aria-hidden="true">+</i><i class="mark tr" aria-hidden="true">+</i>
        <i class="mark bl" aria-hidden="true">+</i><i class="mark br" aria-hidden="true">+</i>
        <h2 class="modal-title">Novo takmičenje</h2>

        <div class="form-grid">
          <div class="field">
            <label class="field-label" for="f-name">Naziv takmičenja</label>
            <input class="control" id="f-name" name="name" placeholder="npr. Kup Srbije 2026" required>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="f-date">Datum</label>
              <input class="control" id="f-date" name="date" type="date" required>
            </div>
            <div class="field">
              <label class="field-label" for="f-level">Nivo</label>
              <select class="control" id="f-level" name="level">${levels}</select>
            </div>
          </div>
          <div class="field">
            <span class="field-label">Kalendar</span>
            <div class="picks">${CALENDARS.map((c, i) => `
              <label class="pick">
                <input type="radio" name="calendar" value="${esc(c.key)}"${i === 0 ? ' checked' : ''}>
                ${esc(c.label)} — ${esc(c.note)}
              </label>`).join('')}
            </div>
          </div>
          <div class="field">
            <label class="field-label" for="f-place">Mesto održavanja</label>
            <input class="control" id="f-place" name="place" placeholder="Hala, grad" required>
          </div>
          <div class="field">
            <span class="field-label">Aktivne discipline</span>
            <div class="picks">${disciplines}</div>
          </div>
          <div class="field">
            <label class="field-label" for="f-desc">Opis (opciono)</label>
            <textarea class="control" id="f-desc" name="description" rows="2"></textarea>
          </div>
          <div class="field">
            <span class="field-label">Prijave</span>
            <div class="picks">
              <label class="pick">
                <input type="checkbox" name="withRegistry" value="1">
                Popuni demo prijavama — oko 500 takmičara u 124 kategorije,
                svaka sa 10–15 prijavljenih
              </label>
            </div>
          </div>
        </div>

        <p class="form-error" id="f-error" hidden></p>

        <div class="modal-actions">
          <button type="button" class="btn-app" data-close>Otkaži</button>
          <button type="submit" class="btn-app is-primary">Sačuvaj takmičenje</button>
        </div>
      </form>
    </div>`;

  const form = document.getElementById('new-comp-form');
  form.querySelector('#f-name').focus();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const values = {
      name: (data.get('name') || '').trim(),
      date: data.get('date') || '',
      place: (data.get('place') || '').trim(),
      level: data.get('level'),
      calendar: data.get('calendar') || 'A',
      withRegistry: !!data.get('withRegistry'),
      description: data.get('description') || '',
      disciplines: data.getAll('disciplines'),
    };

    const problem =
      !values.name ? 'Unesi naziv takmičenja.'
        : !values.date ? 'Izaberi datum.'
          : !values.place ? 'Unesi mesto održavanja.'
            : !values.disciplines.length ? 'Izaberi bar jednu disciplinu.'
              : null;
    if (problem) {
      const box = document.getElementById('f-error');
      box.textContent = problem;
      box.hidden = false;
      return;
    }

    // Filling writes over a thousand records — the button must say it is
    // working, or it looks like nothing happened.
    const submit = event.target.querySelector('button[type="submit"]');
    if (values.withRegistry) {
      submit.disabled = true;
      submit.textContent = 'Upisujem prijave…';
    }

    const competition = await store.createCompetition(values);
    await store.setActiveCompetition(competition.id);
    closeModal();
    toast(competition.entries
      ? `Takmičenje „${competition.name}" je napravljeno sa ${num(competition.entries)} `
        + `prijava (${num(competition.competitors)} takmičara) i postavljeno kao aktuelno.`
      : `Takmičenje „${competition.name}" (${competition.calendar} lista) je sačuvano `
        + 'i stoji i u kalendaru i u evidenciji.');
    // Stay where you are: the calendar enters a date, the register opens
    // a competition. Jumping screens would interrupt both.
    if (routeOf().id !== 'kalendar') location.hash = 'takmicenja';
    render();
  });
}

function confirmResetModal() {
  modalRoot.innerHTML = `
    <div class="backdrop" data-close>
      <div class="modal is-narrow" role="alertdialog" aria-labelledby="reset-title">
        <h2 class="modal-title" id="reset-title">Vraćanje demo podataka</h2>
        <p class="modal-body">
          Briše se <strong>sve</strong> — sva takmičenja, prijave, takmičari i
          rezultati — pa se baza puni ispočetka demo podacima po važećem
          pravilniku. Ovo se ne može opozvati.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn-app" data-close>Odustani</button>
          <button type="button" class="btn-app is-danger" id="do-reset">Vrati demo podatke</button>
        </div>
      </div>
    </div>`;
  modalRoot.querySelector('#do-reset').addEventListener('click', async () => {
    await store.resetDemo();
    closeModal();
    toast('Baza je vraćena na demo podatke.');
    render();
  });
}

function confirmDeleteModal(competition) {
  modalRoot.innerHTML = `
    <div class="backdrop" data-close>
      <div class="modal is-narrow" role="alertdialog" aria-labelledby="del-title">
        <h2 class="modal-title" id="del-title">Brisanje takmičenja</h2>
        <p class="modal-body">
          Trajno se briše <strong>${esc(competition.name)}</strong> i sve što uz njega ide —
          prijave, takmičari i ekipe. Ovo se ne može opozvati.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn-app" data-close>Odustani</button>
          <button type="button" class="btn-app is-danger" data-confirm-delete="${esc(competition.id)}">Obriši</button>
        </div>
      </div>
    </div>`;
  modalRoot.querySelector('[data-confirm-delete]').focus();
}

// === Toast =============================================

let toastTimer = null;
function toast(message) {
  const box = document.getElementById('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 4000);
}

// === Rendering =============================================

const app = document.getElementById('app');

const navHtml = (currentId) => NAV_MAIN.map((id) => {
  const s = screenById(id);
  const soon = !s.view && !s.href;
  const tag = s.href ? 'a' : 'button';
  const attrs = s.href ? `href="${esc(s.href)}"` : `type="button" data-go="${esc(s.id)}"`;
  const current = id === currentId ? ' aria-current="page"' : '';
  return `<${tag} class="nav-item"${current} ${attrs}>
      <span>${esc(s.label)}</span>
      ${soon ? '<span class="nav-soon">uskoro</span>' : ''}
    </${tag}>`;
}).join('');

function soonHtml(screen) {
  return `
    <div class="soon">
      <span class="soon-badge">Uskoro</span>
      <h2 class="soon-title">${esc(screen.title)}</h2>
      <div class="soon-links">
        <button type="button" class="btn-app" data-go="kontrolna-tabla">Kontrolna tabla</button>
        <a class="btn-app" href="documents.html">Zvanični dokumenti</a>
      </div>
    </div>`;
}

const routeOf = () => {
  const id = decodeURIComponent(location.hash.slice(1));
  const screen = screenById(id);
  return screen && !screen.href ? screen : screenById('kontrolna-tabla');
};

async function render() {
  const screen = routeOf();
  const competition = await store.activeCompetition();

  // What this screen prints. Built only when the button is pressed, over
  // data already here — and it reads the filters off the screen at that
  // moment, so paper always follows what the user sees.
  let printable = null;
  /** Exists only on the rankings — season closing takes its data from here. */
  let seasonAction = null;
  tatamiState = null;
  drawState = null;
  diplomaState = null;
  competitorsState = null;
  feesState = null;

  let body = '';
  if (screen.view === 'dashboard') {
    const [registry, demoStale] = await Promise.all([
      store.registryFor(competition?.id), store.demoIsStale(),
    ]);
    body = dashboardHtml({ competition, registry, demoStale });
  } else if (screen.view === 'competitors') {
    const [registry, tally] = await Promise.all([
      store.registryFor(competition?.id),
      store.tallyByPerson(competition?.id),
    ]);
    body = competitorsHtml({ competition, registry, tally });
    competitorsState = { competition, registry };
    if (registry.competitors.length) {
      printable = () => competitorsSpec({ competition, registry, tally });
    }
  } else if (screen.view === 'clubs') {
    const tally = await store.clubTally();
    body = clubsHtml(tally);
    if (tally.clubs.length) printable = () => clubsSpec(tally);
  } else if (screen.view === 'results') {
    const [registry, results] = await Promise.all([
      store.registryFor(competition?.id),
      store.resultsFor(competition?.id),
    ]);
    body = resultsHtml({ competition, registry, results });
    if (competition && registry.entries.length) {
      printable = () => resultsSpec({ competition, registry });
    }
  } else if (screen.view === 'settings') {
    const [fees, storage] = await Promise.all([store.fees(), store.storageProtection()]);
    feesState = fees;
    body = settingsHtml({ fees, storage });
  } else if (screen.view === 'diplomas') {
    const [registry, results, setup] = await Promise.all([
      store.registryFor(competition?.id),
      store.resultsFor(competition?.id),
      store.diplomaSetup(),
    ]);
    const cats = competition ? diplomaCategories({ registry, results }) : [];
    body = diplomasHtml({ competition, cats, setup });
    diplomaState = { competition, cats, setup };
    if (cats.length) {
      printable = () => diplomaSpec({
        competition, setup, title: 'Diplome',
        winners: cats.flatMap((cat) => cat.winners),
      });
    }
  } else if (screen.view === 'draw') {
    const registry = await store.registryFor(competition?.id);
    const index = drawIndex(registry);
    body = drawHtml({ competition, index });
    // The draw prints per category, not from the header button, so this
    // screen deliberately has no printable — Cmd+P has nothing to print.
    drawState = { competition, index };
  } else if (screen.view === 'import') {
    const competitions = await store.listCompetitions();
    body = importHtml({ competitions, activeId: competition?.id });
  } else if (screen.view === 'calendar') {
    const seasons = await store.listSeasons();
    const season = seasons.find((x) => x.id === seasonPick) || seasons[0];
    const all = await store.listCompetitions();
    const competitions = all.filter((c) => c.date >= season.from
      && (!season.to || c.date <= season.to));
    const counts = new Map();
    for (const c of competitions) {
      counts.set(c.id, (await store.registryFor(c.id)).entries.length);
    }
    body = calendarHtml({ seasons, season, competitions, counts });
    if (competitions.length) printable = () => calendarSpec({ season, competitions, counts });
  } else if (screen.view === 'tatami') {
    const registry = await store.registryFor(competition?.id);
    const plan = await store.tatamiPlan(competition?.id);
    const pairs = tatamiPairs(registry);
    if (migrateTatamiPlan(plan, pairs)) await store.saveTatamiPlan(competition.id, plan);
    body = tatamiHtml({ competition, pairs, plan });
    if (pairs.length) {
      tatamiState = { competitionId: competition.id, pairs, plan };
      printable = () => tatamiSpec({ competition, pairs, plan });
    }
  } else if (screen.view === 'rankings') {
    const seasons = await store.listSeasons();
    const season = seasons.find((x) => x.id === seasonPick) || seasons[0];
    const data = await store.rankings(season);
    body = rankingsHtml({ seasons, season, data });
    if (data.competitions.length) {
      printable = () => {
        const group = data.groups.find((g) => g.id === rankPick);
        return rankingSpec({ season, group, clubs: data.clubs, totals: data.totals });
      };
      seasonAction = () => closeSeasonModal({ season, data });
    }
  } else if (screen.view === 'competitions') {
    const competitions = await store.listCompetitions();
    const counts = new Map();
    for (const c of competitions) {
      counts.set(c.id, (await store.registryFor(c.id)).entries.length);
    }
    body = competitionsHtml({ competitions, activeId: competition?.id, counts });
    if (competitions.length) {
      printable = () => competitionsSpec({ competitions, counts, activeId: competition?.id });
    }
  } else {
    body = soonHtml(screen);
  }

  setPrintable(printable);
  closeSeasonAction = seasonAction;

  const kicker = screen.kicker ? screen.kicker() : (competition?.name || FEDERATION.name);
  // The Štampaj button appears only where there is something to print,
  // and always first — other actions are rarer, printing is daily.
  const actions = [...(printable ? [{ label: 'Štampaj', go: 'print', quiet: true }] : []),
    ...(seasonAction ? [{ label: 'Završetak sezone', go: 'zavrsi-sezonu', primary: true }] : []),
    ...(screen.actions || [])];
  const action = actions.map((a) => `
    <button type="button" class="btn-app${a.primary ? ' is-primary' : ''}${a.quiet ? ' is-quiet' : ''}"
            data-go="${esc(a.go)}">${esc(a.label)}</button>`).join('');

  app.innerHTML = `
    <aside class="side">
      <a class="side-brand" href="#kontrolna-tabla">
        <img class="side-crest" src="${esc(FEDERATION.crest.src)}" alt="${esc(FEDERATION.crest.alt)}">
        <span>
          <span class="side-brand-name">Fudokan savez</span>
          <span class="side-brand-sub">Srbije</span>
        </span>
      </a>
      <nav class="side-nav" aria-label="Glavna navigacija">${navHtml(screen.id)}</nav>
      <div class="side-foot">
        <button type="button" class="nav-item"${screen.id === 'podesavanja' ? ' aria-current="page"' : ''}
                data-go="podesavanja">
          <span>Podešavanja</span>
        </button>
        <div class="side-version">${esc(APP_VERSION)}</div>
      </div>
    </aside>

    <main class="main">
      <header class="page-head">
        <div>
          <div class="page-kicker">${esc(kicker)}</div>
          <h1 class="page-title">${esc(screen.title)}</h1>
        </div>
        <div class="page-actions">${action}</div>
      </header>
      <div class="page-body">${body}</div>
    </main>`;

  const drawSearch = document.getElementById('draw-search');
  if (drawSearch) {
    drawSearch.addEventListener('input', applyDrawFilter);
    document.getElementById('f-kind').addEventListener('change', applyDrawFilter);
  } else {
    const search = document.getElementById('competitor-search') || document.getElementById('club-search');
    if (search) search.addEventListener('input', filterList);
  }

  if (document.querySelector('[data-fee]')) {
    document.querySelectorAll('[data-fee]').forEach((input) => {
      input.addEventListener('change', () => updateFees((fees) => {
        const value = Math.max(0, Number(input.value) || 0);
        if (input.dataset.fee === 'free.count') fees.free.count = value;
        else fees[input.dataset.fee] = value;
      }));
    });

    document.querySelectorAll('[data-fee-group]').forEach((input) => {
      input.addEventListener('change', () => updateFees((fees) => {
        const code = input.dataset.feeGroup;
        const codes = new Set(fees.free.groups.split(''));
        if (input.checked) codes.add(code); else codes.delete(code);
        // Redosled je redosled uzrasne tabele, ne redosled klikanja.
        fees.free.groups = AGE_ORDER.filter((c) => codes.has(c)).join('');
      }));
    });

    document.querySelectorAll('[data-fee-always]').forEach((input) => {
      input.addEventListener('change', () => updateFees((fees) => {
        const name = input.dataset.feeAlways;
        const names = new Set(fees.free.always);
        if (input.checked) names.add(name); else names.delete(name);
        fees.free.always = DISCIPLINES.filter((d) => names.has(d.name)).map((d) => d.name);
      }));
    });

    document.getElementById('fee-reset').addEventListener('click', async () => {
      await updateFees((fees) => {
        Object.assign(fees, structuredClone(FEES_DEFAULT));
      });
      render();
    });
  }

  const dipOrientation = document.getElementById('dip-orientation');
  if (dipOrientation) {
    dipOrientation.addEventListener('change', () =>
      updateDiploma((setup) => { setup.orientation = dipOrientation.value; }));

    document.querySelectorAll('[data-dip]').forEach((input) => {
      input.addEventListener('change', () => updateDiploma((setup) => {
        const mera = setup.lines[input.dataset.dip];
        if (input.dataset.dipField === 'on') {
          mera.on = input.checked;
          input.closest('.dip-row').classList.toggle('is-off', !input.checked);
        } else {
          mera[input.dataset.dipField] = Number(input.value) || 0;
        }
      }));
    });

    document.getElementById('dip-reset').addEventListener('click', async (event) => {
      event.preventDefault();
      await updateDiploma((setup) => {
        setup.orientation = DIPLOMA_DEFAULT.orientation;
        setup.lines = structuredClone(DIPLOMA_DEFAULT.lines);
      });
      render();
    });

    document.getElementById('dip-ruler').addEventListener('click', (event) => {
      event.preventDefault();
      const { competition, setup } = diplomaState;
      printStack([diplomaTestSpec({ competition, setup })], setup.orientation);
    });

    document.getElementById('dip-sample').addEventListener('click', (event) => {
      event.preventDefault();
      const { competition, setup, cats } = diplomaState;
      const winner = cats[0]?.winners[0] || DIPLOMA_SAMPLE;
      printStack([diplomaSpec({
        competition, setup, winners: [winner], title: 'Probna diploma',
      })], setup.orientation);
    });
  }

  const mats = document.getElementById('f-mats');
  if (mats) {
    mats.addEventListener('change', () => updateTatami((plan) => {
      const count = Number(mats.value);
      // An item placed on a mat that no longer exists returns to the
      // pool instead of quietly vanishing from the schedule.
      Object.keys(plan.pairs).forEach((id) => {
        if (plan.pairs[id] > count) plan.pairs[id] = 0;
      });
      plan.count = count;
    }));
    document.getElementById('f-axis').addEventListener('change', (event) =>
      updateTatami((plan) => { plan.axis = event.target.value; }));
    document.getElementById('mats-spread').addEventListener('click', () => updateTatami((plan) => {
      // Balanced by competitor count, not item count: a mat with two big
      // groups works longer than one with four small ones. Split by card
      // of the chosen grouping, so what belongs together stays together.
      const axis = axisOf(plan);
      const cards = new Map();
      tatamiState.pairs.forEach((pair) => {
        const key = axis.key(pair);
        if (!cards.has(key)) cards.set(key, { people: 0, ids: [] });
        const card = cards.get(key);
        card.people += pair.people;
        card.ids.push(pair.id);
      });
      const load = Array.from({ length: plan.count }, () => 0);
      [...cards.values()].sort((a, b) => b.people - a.people).forEach((card) => {
        const lightest = load.indexOf(Math.min(...load));
        load[lightest] += card.people;
        card.ids.forEach((id) => { plan.pairs[id] = lightest + 1; });
      });
      plan.order = {};
    }));
    document.getElementById('mats-clear').addEventListener('click', () => updateTatami((plan) => {
      plan.pairs = {};
      plan.order = {};
    }));
  }

  const seasonFilter = document.getElementById('f-season');
  if (seasonFilter) {
    seasonFilter.addEventListener('change', () => {
      seasonPick = seasonFilter.value;
    // Another season has other categories, so the list pick resets to clubs.
      rankPick = 'klubovi';
      render();
    });
    // An empty season has no list to pick — only the season picker.
    document.getElementById('f-rank')?.addEventListener('change', (event) => {
      rankPick = event.target.value;
      render();
    });
  }

  const discFilter = document.getElementById('f-disc');
  if (discFilter) {
    discFilter.addEventListener('change', onDisciplineFilterChange);
    document.getElementById('f-cat').addEventListener('change', applyResultsFilter);
    document.getElementById('f-sex').addEventListener('change', applyResultsFilter);
    document.getElementById('f-year').addEventListener('change', applyResultsFilter);
    document.getElementById('f-reset').addEventListener('click', () => {
      // The category menu is rebuilt, not just cleared — otherwise the
      // discipline change would restore the previously picked category.
      discFilter.value = '';
      document.getElementById('f-cat').innerHTML = categoryOptions(resultsIndex, '');
      document.getElementById('f-sex').value = '';
      document.getElementById('f-year').value = '';
      applyResultsFilter();
    });
    // Medal slot usage is read from the selects themselves, so it is
    // computed after render instead of writing the logic twice.
    updateResultsProgress();
  }

  document.title = `${screen.title} · ${FEDERATION.name}`;
}

/**
 * The draw has two filters working together: text and category kind
 * (individual / team). Hence its own function — two conditions on the
 * same row cannot be assembled from two independent searches.
 */
function applyDrawFilter() {
  const needle = (document.getElementById('draw-search')?.value || '').trim().toLowerCase();
  const kind = document.getElementById('f-kind')?.value || '';
  let shown = 0;

  const rows = [...document.querySelectorAll('.draw-cat')];
  rows.forEach((row) => {
    const match = (!needle || row.dataset.search.includes(needle))
      && (!kind || row.dataset.kind === kind);
    row.hidden = !match;
    if (match) shown += 1;
  });
  document.querySelectorAll('.draw-disc').forEach((disc) => {
    disc.hidden = !disc.querySelector('.draw-cat:not([hidden])');
  });

  const count = document.getElementById('draw-count');
  if (count) {
    count.textContent = (needle || kind)
      ? `${shown} od ${rows.length}`
      : `${shown} ${plural(shown, 'kategorija', 'kategorije', 'kategorija')}`;
  }
}

/**
 * Pretraga skriva redove umesto da ponovo iscrtava tabelu — kucanje ne sme da
 * izgubi fokus ni poziciju kursora, a spisak zna da ima i hiljadu redova.
 */
function filterList(event) {
  const needle = event.target.value.trim().toLowerCase();
  let shown = 0;
  // The same filter serves tables and the draw's category list — both
  // carry data-search, so the selector does not care which screen it is.
  const rows = [...document.querySelectorAll('[data-search]')];
  rows.forEach((row) => {
    const match = !needle || row.dataset.search.includes(needle);
    row.hidden = !match;
    if (match) shown += 1;
  });
  // A discipline with no matching category hides whole.
  document.querySelectorAll('.draw-disc').forEach((disc) => {
    disc.hidden = !disc.querySelector('.draw-cat:not([hidden])');
  });

  const count = document.getElementById('competitor-count')
    || document.getElementById('club-count') || document.getElementById('draw-count');
  if (!count) return;
  const noun = count.id === 'club-count' ? plural(shown, 'klub', 'kluba', 'klubova')
    : count.id === 'draw-count' ? plural(shown, 'kategorija', 'kategorije', 'kategorija')
      : plural(shown, 'takmičar', 'takmičara', 'takmičara');
  count.textContent = needle ? `${shown} od ${rows.length}` : `${shown} ${noun}`;
}

// === Events =============================================

document.addEventListener('click', async (event) => {
  // Closed by the Otkaži button or a click on the dimmed backdrop — but
  // not by a click anywhere inside the dialog itself.
  if (event.target.closest('button[data-close]') || event.target.classList.contains('backdrop')) {
    closeModal();
    return;
  }

  const del = event.target.closest('[data-confirm-delete]');
  if (del) {
    const id = del.dataset.confirmDelete;
    const competition = await store.getCompetition(id);
    await store.deleteCompetition(id);
    closeModal();
    toast(`Takmičenje „${competition?.name || ''}" je obrisano.`);
    render();
    return;
  }

  if (event.target.closest('[data-new-entry]') && competitorsState) {
    const { competition } = competitorsState;
    const season = seasonOf(competition);
    editEntryModal({
      competition,
      isNew: true,
      entries: [],
      // A blank entry, with the values one would pick anyway: a year in
      // the middle of the age table, a white belt, the first club.
      competitor: {
        id: null, name: '', firstName: '', lastName: '', sex: 'M', year: season - 12,
        belt: 'beli', club: CLUBS[0].name, weight: null,
      },
    });
    return;
  }

  const edit = event.target.closest('[data-edit-entry]');
  if (edit && competitorsState) {
    const { competition, registry } = competitorsState;
    const competitor = registry.competitors.find((c) => c.id === edit.dataset.editEntry);
    if (!competitor) return;
    editEntryModal({
      competition,
      competitor,
      entries: registry.entries.filter((e) => e.competitorId === competitor.id),
    });
    return;
  }

  const openCard = event.target.closest('[data-person]');
  if (openCard) {
    const personId = openCard.dataset.person;
    const [people, career] = await Promise.all([store.listPeople(), store.careerFor(personId)]);
    const person = people.find((x) => x.id === personId);
    if (person) careerModal({ person, career });
    return;
  }

  const status = event.target.closest('[data-status]');
  if (status) {
    const competition = await store.activeCompetition();
    if (!competition) return;
    const next = status.dataset.status;
    await store.setCompetitionStatus(competition.id, next);
    toast(`„${competition.name}" — ${STATUS_TOAST[next] || 'stanje promenjeno'}.`);
    render();
    return;
  }

  // Most entrants get participation; only the medallists change. So
  // participation is written in one go, only where no placement stands.
  if (event.target.closest('[data-fill-ucesce]')) {
    const competition = await store.activeCompetition();
    if (!competition) return;
    // The filter applies here as in print: what is on screen changes.
    const ids = visibleIds('.result-row[data-print-id]');
    const upisano = await store.fillPlacement(competition.id, ids, 'ucesce');
    toast(upisano
      ? `Učešće je upisano na ${upisano} ${plural(upisano, 'prijavu', 'prijave', 'prijava')}.`
      : 'Sve prijave na ekranu već imaju plasman.');
    render();
    return;
  }

  // Results print per category and per discipline — diplomas are written
  // as each category finishes, not when the whole competition does.
  const printDip = event.target.closest('[data-print-diplomas]');
  if (printDip && diplomaState) {
    const cat = diplomaState.cats.find((c) => c.key === printDip.dataset.printDiplomas);
    if (!cat) return;
    printStack([diplomaSpec({
      competition: diplomaState.competition,
      setup: diplomaState.setup,
      winners: cat.winners,
      title: `${cat.first.discipline} · ${categoryFullLabel(cat.first)}`,
    })], diplomaState.setup.orientation);
    return;
  }

  const printCat = event.target.closest('[data-print-cat]');
  const printDisc = event.target.closest('[data-print-disc]');
  if (printCat || printDisc) {
    event.preventDefault();          // dugme u <summary> inače sklapa disciplinu
    const competition = await store.activeCompetition();
    if (!competition) return;
    const [registry, results] = await Promise.all([
      store.registryFor(competition.id), store.resultsFor(competition.id),
    ]);
    const jobs = printCat
      ? [resultsCategorySpec({ competition, registry, results,
        key: printCat.closest('.cat').dataset.key })].filter(Boolean)
      : resultsDisciplineSpecs({ competition, registry, results,
        discipline: printDisc.dataset.printDisc });
    if (!jobs.length) toast('Nema nijedne prijave za štampu.');
    else printStack(jobs);
    return;
  }

  const draw = event.target.closest('[data-draw]');
  if (draw) {
    const category = drawState?.index.flatMap((d) => d.categories)
      .find((c) => c.key === draw.dataset.draw);
    if (!category) return;
    // The bracket is drawn at the moment of the press and goes straight
    // to print — nothing is stored, every draw is new.
    printStack([drawSpec({ competition: drawState.competition, category })]);
    return;
  }

  const bump = event.target.closest('[data-bump]');
  if (bump) {
    const card = bump.closest('[data-block]');
    const key = card.dataset.block;
    const mat = Number(card.dataset.mat);
    const step = Number(bump.dataset.bump);
    await updateTatami((plan) => {
      const { columns } = tatamiCards(tatamiState.pairs, plan);
      const list = columns[mat - 1] || [];
      const at = list.findIndex((c) => c.key === key);
      const to = at + step;
      if (at < 0 || to < 0 || to >= list.length) return;
      // Order is written over the whole column, not just the two moved
      // cards — otherwise the column grows gaps after a few moves.
      const next = [...list];
      [next[at], next[to]] = [next[to], next[at]];
      next.forEach((c, i) => { plan.order[`${plan.axis}|${c.key}`] = i + 1; });
    });
    return;
  }

  const reopen = event.target.closest('[data-reopen]');
  if (reopen) {
    const season = await store.reopenSeason(reopen.dataset.reopen);
    seasonPick = 'open';
    toast(season ? `Sezona „${season.name}" je vraćena u rad.` : 'Nema zatvorene sezone.');
    render();
    return;
  }

  const askDelete = event.target.closest('[data-delete]');
  if (askDelete) {
    confirmDeleteModal(await store.getCompetition(askDelete.dataset.delete));
    return;
  }

  const open = event.target.closest('[data-open]');
  if (open) {
    await store.setActiveCompetition(open.dataset.open);
    location.hash = 'kontrolna-tabla';
    render();
    return;
  }

  // === Entry import =============================================
  // The form for clubs carries today's list, so it is built on the click,
  // not stored — one file for every club.
  const formButton = event.target.closest('[data-entry-form]');
  if (formButton) {
    formButton.disabled = true;
    try {
      const { blob, listed, left } = await buildEntryForm(await store.entryFormRoster());
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `FSS-Entry-Form-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
      toast(`Formular je preuzet — na spisku ${listed} ${plural(listed, 'FSS ID', 'FSS ID-a', 'FSS ID-eva')}`
        + (left ? `, ${left} nije stalo` : '') + '. Isti fajl ide svim klubovima.');
    } catch (err) {
      toast(`Formular nije napravljen: ${err.message}`);
    }
    formButton.disabled = false;
    return;
  }

  if (event.target.closest('[data-import-clear]')) {
    resetImport();
    render();
    return;
  }

  if (event.target.closest('[data-import-run]')) {
    const target = document.getElementById('import-target')?.value;
    const fajlovi = importState.read.filter((r) => r.payload);
    if (!fajlovi.length || !target) return;

    // All files go into one database, one after another. Person matching
    // and skip-already-imported work across all of them — two clubs that
    // both enter the same person do not create two records.
    const zbir = {
      files: 0, competitors: 0, entries: 0, teams: 0, skipped: 0, teamsSkipped: 0,
      granted: 0, recognized: 0, transfers: [], moved: [], rejected: [], notes: [],
    };
    try {
      for (const r of fajlovi) {
        const done = await store.importClubEntry(target, r.payload);
        zbir.files += 1;
        ['competitors', 'entries', 'teams', 'skipped', 'teamsSkipped', 'granted', 'recognized']
          .forEach((k) => { zbir[k] += done[k]; });
        // These are named, not counted — the editor decides for each
        // whether it is a namesake or a club change.
        done.transfers.forEach((n) => (n.recognized ? zbir.moved : zbir.transfers).push(n));
        // Rows are named with their club and Excel row — that is what the
        // club is told.
        const club = r.payload.club;
        done.rejected.forEach((n) => zbir.rejected.push({ ...n, club }));
        done.notes.forEach((n) => zbir.notes.push({ ...n, club }));
      }
      const into = await store.getCompetition(target);
      importState.done = { ...zbir, competition: into?.name || '' };
      toast(`Uvezeno iz ${zbir.files} ${plural(zbir.files, 'fajla', 'fajla', 'fajlova')}: `
        + `${zbir.entries} ${plural(zbir.entries, 'prijava', 'prijave', 'prijava')}`
        + `, ${zbir.teams} ${plural(zbir.teams, 'ekipa', 'ekipe', 'ekipa')}`
        + (zbir.skipped + zbir.teamsSkipped
          ? ` · preskočeno već upisanih: ${zbir.skipped + zbir.teamsSkipped}` : '')
        + (zbir.granted ? ` · novih FSS ID-eva: ${zbir.granted}` : '')
        + (zbir.rejected.length ? ` · nije uvezeno zbog FSS ID-a: ${zbir.rejected.length}` : ''));
    } catch (err) {
      importState.done = null;
      toast(`Uvoz je prekinut: ${err.message}`);
    }
    render();
    return;
  }

  const go = event.target.closest('[data-go]');
  if (go) {
    if (go.dataset.go === 'novo-takmicenje') newCompetitionModal();
    else if (go.dataset.go === 'print') {
      // A filter that lets no row through would print an empty sheet, so
      // it says what is going on instead.
      if (!printNow()) toast('Nema nijednog reda za štampu — poništi filter pa probaj ponovo.');
    }
    else if (go.dataset.go === 'zavrsi-sezonu') closeSeasonAction?.();
    else if (go.dataset.go === 'reset-demo') confirmResetModal();
    else location.hash = go.dataset.go;
  }
});

document.addEventListener('change', async (event) => {
  // === Entry import =============================================
  if (event.target.id === 'import-target') {
    importPick = event.target.value;
    // Age groups depend on the picked competition's season, so files are
    // re-read — and the warning about a different competition with them.
    if (importState.files.length) {
      await readImportFiles(await store.getCompetition(importPick));
    }
    render();
    return;
  }

  if (event.target.id === 'import-file') {
    const files = [...(event.target.files || [])];
    if (!files.length) return;
    importPick = document.getElementById('import-target')?.value || importPick;
    resetImport();
    // The browser hands files over in arbitrary order; by file name it
    // is at least the same every time.
    importState.files = files.sort((x, y) => x.name.localeCompare(y.name, 'sr'));
    await readImportFiles(await store.getCompetition(importPick)
      || await store.activeCompetition());
    render();
    return;
  }

  const move = event.target.closest('[data-move]');
  if (move) {
    const card = move.closest('[data-block]');
    const key = card.dataset.block;
    const from = Number(card.dataset.mat);
    const to = Number(move.value);
    await updateTatami((plan) => {
      // Moves exactly what that card on that mat contains — a group with
      // disciplines on two mats moves only what is here.
      cardPairs(plan, key, from).forEach((pair) => { plan.pairs[pair.id] = to; });
      // To the bottom of the column: a new card goes after the placed ones.
      plan.order[`${plan.axis}|${key}`] = to ? 999 : 0;
    });
    return;
  }

  const pick = event.target.closest('.result-pick');
  if (!pick) return;

  // The menu does not offer taken places, but a pick can arrive past the
  // menu — keyboard, browser autofill. Overflow is reverted before the
  // database write.
  const cat = pick.closest('.cat');
  const slots = placementSlots(cat?.dataset.disc, pick.value);
  if (pick.value && slots !== null) {
    const used = [...cat.querySelectorAll('.result-pick')]
      .filter((p) => p.value === pick.value).length;
    if (used > slots) {
      const pl = placementByKey(pick.value);
      pick.value = pick.dataset.prev || '';
      toast(`U kategoriji je već dodeljeno ${slots} ${plural(slots, 'mesto', 'mesta', 'mesta')} — ${pl.label.toLowerCase()}.`);
      updateResultsProgress();
      return;
    }
  }
  pick.dataset.prev = pick.value;

  const competition = await store.activeCompetition();
  const registry = await store.registryFor(competition.id);
  if (pick.dataset.team) {
    const team = registry.teams.find((t) => t.id === pick.dataset.team);
    await store.setTeamResult(team, pick.value);
  } else {
    const entry = registry.entries.find((e) => e.id === pick.dataset.entry);
    await store.setResult(entry, pick.value);
  }

  // No re-render: a long list must not jump to the top after every
  // entry. Only what actually changed is updated.
  pick.classList.add('is-saved');
  setTimeout(() => pick.classList.remove('is-saved'), 1200);
  const row = pick.closest('.result-row');
  const cell = row?.querySelector('.result-points');
  if (cell) {
    const points = pointsFor(pick.value);
    cell.textContent = points ? `${points} bodova` : '—';
    cell.classList.toggle('is-medal', !!placementByKey(pick.value)?.medal);
  }
  updateResultsProgress();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && modalRoot.firstElementChild) closeModal();
});

window.addEventListener('hashchange', render);

store.ready()
  .then(render)
  .catch((err) => {
    app.innerHTML = `<div class="fatal">
      <h1>Podaci se ne mogu otvoriti</h1>
      <p>${esc(err.message)}</p>
      <p>Ako je aplikacija otvorena u više prozora, zatvori ostale pa osveži ovaj.</p>
    </div>`;
  });

// Storage protection is requested right at launch, not when somebody
// opens Podešavanja — by then the browser could have swept the database.
store.ready().then(() => store.storageProtection()).catch(() => {});
