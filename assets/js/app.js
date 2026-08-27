/**
 * Ljuska aplikacije: navigacija, kontrolna tabla i evidencija takmičenja.
 *
 * Ekrani se biraju hash rutom (#kontrolna-tabla, #takmicenja …), pa je svaki
 * linkabilan i preživljava osvežavanje. Modul za dokumenta je zasebna strana
 * (documents.html) jer je štampani prikaz sa svojim pravilima.
 *
 * Podaci dolaze isključivo iz store.js. Ništa na ekranu nije upisano rukom:
 * ono što se još ne može izračunati prikazano je kao prazno stanje, a ne kao
 * izmišljen broj.
 */

import {
  FEDERATION, DISCIPLINES, COMPETITION_LEVELS, PLACEMENTS, CALENDARS, MONTHS, APP_VERSION, AGES,
  categoryKey, disciplinesForGroup, disciplineByName, dateLabel, ageByCode, clubByName,
  placementByKey, placementSlots, pointsFor, calendarOf, teamCategoryLabel, teamSizeLabel,
  seasonOf, yearsLabel, DIPLOMA_LINES, DIPLOMA_DEFAULT, entriesOpen, pointsCounted,
  BELTS, CLUBS, WEIGHTS, groupOfYear, levelOfBelt, FEES_DEFAULT,
} from './data.js';
import { store } from './store.js';
import { cell, col, boardCard, slipLine, uniqueCount, bracketHtml } from './doc-render.js';
import { drawCategory, MAX_BRACKET } from './draw.js';
import { setPrintable, printNow, printStack, visibleIds, onScreen, filterLabel } from './print.js';
import { readEntryFile } from './import.js';

// ── Sitni pomoćnici ────────────────────────────────────────────────────

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

/** 1486 → "1 486" — razmak kao separator hiljada, kako se piše kod nas. */
const num = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const plural = (n, one, few, many) => {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
};

const uniq = (items, key) => new Set(items.map(key));

// ── Ekrani ─────────────────────────────────────────────────────────────

/**
 * Redosled je redosled u navigaciji. Ekran bez `view` postoji kao plan, ne kao
 * zaslon — klik vodi na opis šta tu dolazi, umesto u ćorsokak.
 */
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

  { id: 'kategorije', label: 'Kategorije', title: 'Kategorije',
    note: 'Formiranje kategorija po grupi, polu i telesnoj težini, spajanje malih kategorija i raspoređivanje prijava.' },

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
  'kategorije', 'klubovi', 'zreb', 'tatami', 'rezultati', 'diplome', 'rang',
  'kalendar', 'dokumenti'];

const screenById = (id) => SCREENS.find((s) => s.id === id);

// ── Izvedene brojke ────────────────────────────────────────────────────

/**
 * Sve što kontrolna tabla prikazuje, izračunato iz registra. `pending: true`
 * označava brojku koja se još ne može dobiti — prikazuje se kao crta, ne kao
 * nula, jer nula ovde znači nešto sasvim drugo.
 */
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

/**
 * Provere nad registrom. Vraća samo ono što je zaista sporno — kad je sve
 * čisto, tabla to i kaže umesto da izmišlja stavke.
 */
function checks(registry) {
  const { entries } = registry;
  const found = [];

  const byCategory = new Map();
  entries.forEach((e) => byCategory.set(categoryKey(e), (byCategory.get(categoryKey(e)) || 0) + 1));
  const singles = [...byCategory.values()].filter((n) => n === 1).length;
  if (singles) {
    found.push({
      title: `${singles} ${plural(singles, 'kategorija', 'kategorije', 'kategorija')} sa jednim takmičarem`,
      action: 'Pregled kategorija →', go: 'kategorije',
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

// ── Stanje takmičenja ──────────────────────────────────────────────────

/**
 * Prelazi kroz koje takmičenje prolazi, i nazad. Svaki je povratan namerno —
 * prijava koja stigne posle roka i ispravka rezultata su svakodnevica, pa
 * zatvaranje ne sme da bude jednosmerna ulica.
 */
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

// ── Kontrolna tabla ────────────────────────────────────────────────────

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

  // Baza sa starijim demoom se sama osveži samo dok je netaknuta. Kad
  // korisnik već ima svoj rad u njoj, ne dira se — nego se ovde ponudi.
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

// ── Takmičenja ─────────────────────────────────────────────────────────

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

// ── Takmičari ──────────────────────────────────────────────────────────

/**
 * Spisak pojedinačnih takmičara na aktuelnom takmičenju, sa osvojenim
 * medaljama i bodovima.
 *
 * Dve kolone bodova rade dva različita posla: „Bodovi" su učinak na ovom
 * takmičenju, „Ukupno" je zbir kroz sve sezone koje baza pamti. Isti čovek se
 * prepoznaje po broju licence, pa se bodovi sabiraju i kad promeni klub.
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

  // Na B listi kolona bodova ostaje prazna, pa mora da se kaže zašto —
  // inače izgleda kao da plasmani nisu upisani.
  const notice = calendarOf(competition) === 'B' ? `
    <div class="notice">Takmičenje je na <b>B listi</b> — plasmani i medalje se
    beleže kao i svuda, ali ne nose bodove, pa su kolone „Bodovi" i „Ukupno"
    prazne za ovo takmičenje.</div>` : '';

  // Ispravka prijave ima svoj rok: dok su prijave otvorene. Posle toga se
  // kolona i ne iscrtava, a napomena kaže gde se rok vraća.
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
      return `
      <tr data-print-id="${esc(c.id)}" data-search="${esc((c.name + ' ' + c.club).toLowerCase())}">
        <td class="col-num">${i + 1}</td>
        <td class="col-name">
          <button type="button" class="link-cell" data-person="${esc(c.personId)}">${esc(c.name)}</button>
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
             placeholder="Pretraga po imenu ili klubu" aria-label="Pretraga takmičara">
      <span class="list-count" id="competitor-count">${registry.competitors.length} ${plural(registry.competitors.length, 'takmičar', 'takmičara', 'takmičara')}</span>
      ${open ? '<button type="button" class="btn-app is-quiet" data-new-entry>+ Nova prijava</button>' : ''}
    </div>
    <table class="grid is-dense">
      <thead>
        <tr>
          <th class="col-num">#</th>
          <th>Ime i prezime</th>
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
 * Ispravka jedne prijave.
 *
 * Klubovi šalju formulare, formulari se uvoze — i tu se s vremena na vreme
 * nađe pogrešan pol ili promašeno godište. Dok su prijave otvorene, to mora
 * da se ispravi ovde: posle zatvaranja je spisak zamrznut, jer ono što je
 * odštampano i ono što je u bazi mora da bude ista stvar.
 *
 * Dijalog **ne pušta da se upiše nemoguće**: uzrasna grupa se računa iz
 * godišta, ponuđene su samo discipline moguće za tu grupu, a telesne težine
 * samo one koje pravilnik za tu grupu i pol poznaje. Kad se godište ili pol
 * promeni, ponuda se prekraja pred očima — disciplina koja u novom uzrastu ne
 * postoji ispada sama, a ne ostane tiho upisana.
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

        <div class="form-grid">
          <div class="field-row">
            <div class="field">
              <label class="field-label" for="e-name">Ime i prezime</label>
              <input class="control" id="e-name" name="name" value="${esc(competitor.name)}">
            </div>
            <div class="field">
              <label class="field-label" for="e-club">Klub</label>
              <select class="control" id="e-club" name="club">${clubs.map((c) => `
                <option value="${esc(c)}"${c === competitor.club ? ' selected' : ''}>${esc(c)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label class="field-label" for="e-sex">Pol</label>
              <select class="control" id="e-sex" name="sex">
                <option value="M"${competitor.sex === 'M' ? ' selected' : ''}>muški</option>
                <option value="Ž"${competitor.sex === 'Ž' ? ' selected' : ''}>ženski</option>
              </select>
            </div>
            <div class="field">
              <label class="field-label" for="e-year">Godište</label>
              <select class="control" id="e-year" name="year">${years.map((y) => `
                <option value="${y}"${y === Number(competitor.year) ? ' selected' : ''}>${y}</option>`).join('')}
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

  /** Sve što zavisi od godišta i pola — prekraja se na svaku njihovu izmenu. */
  function paint() {
    const year = Number(form.year.value);
    const sex = form.sex.value;
    const group = groupOfYear(year, season);
    const age = ageByCode(group);
    const possible = group ? disciplinesForGroup(group).filter((d) => !d.team) : [];

    const chosen = new Set([...form.querySelectorAll('[name="disciplines"]:checked')]
      .map((input) => input.value));
    // Prvo iscrtavanje uzima ono što na prijavi stoji; svako sledeće ono što
    // je čovek u međuvremenu čekirao.
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
  form.querySelector('#e-name').focus();

  const fail = (message) => {
    box.textContent = message;
    box.hidden = false;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    box.hidden = true;
    const patch = {
      name: form.name.value,
      club: form.club.value,
      sex: form.sex.value,
      year: Number(form.year.value),
      belt: form.belt.value,
      weight: form.querySelector('#e-weight')?.value || '',
      disciplines: [...form.querySelectorAll('[name="disciplines"]:checked')]
        .map((input) => input.value),
    };
    const ime = patch.name.trim();

    try {
      if (isNew) {
        const done = await store.addCompetitor(competition.id, patch);
        closeModal();
        // Poruka se slaže sa polom takmičara — „upisana", ne „upisan".
        const ona = patch.sex === 'Ž';
        toast([
          `${ime} — ${ona ? 'upisana' : 'upisan'}, uzrast ${done.group}`,
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
          done.merged ? 'spojeno sa licem koje već postoji u bazi' : '',
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
 * Karton takmičara — gde je nastupao i šta je osvojio. Samo prikaz: plasmani
 * se unose na ekranu „Rezultati", da se pregled učinka i upisivanje rezultata
 * ne mešaju na istom mestu.
 */
function careerModal({ person, career }) {
  const blank = { zlato: 0, srebro: 0, bronza: 0, ucesce: 0, medalje: 0, bodovi: 0 };
  const grand = { ...blank };

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
              ${esc(competitor.club)} · ${esc(competitor.belt)} pojas
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
        ${summary}
        <div class="career-list">${sections}</div>
        <div class="modal-actions">
          <button type="button" class="btn-app" data-close>Zatvori</button>
        </div>
      </div>
    </div>`;
}

// ── Klubovi ────────────────────────────────────────────────────────────

/**
 * Evidencija klubova sa učinkom kroz sve sezone. Medalja se pripisuje klubu
 * koji je takmičar tada predstavljao, pa prelazak u drugi klub ne premešta
 * ranije osvojeno.
 *
 * Poređani su po bodovima — to je jedini redosled koji na ovakvoj tabeli išta
 * znači; azbučni red bi sakrio ono zbog čega se tabela i gleda.
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

// ── Rezultati ──────────────────────────────────────────────────────────

/** Šta koje stanje takmičenja znači za korisnika, kad se prebaci. */
const STATUS_TOAST = {
  'Prijave otvorene': 'prijave su otvorene',
  'Prijave zatvorene': 'prijave su zatvorene',
  'Završeno': 'takmičenje je zatvoreno',
  'Nacrt': 'vraćeno u nacrt',
};

/**
 * Unos plasmana. Glavno sortiranje je po disciplini, unutar nje po kategoriji —
 * onako kako se i sudi i kako se zovu zvanični rezultati.
 *
 * Disciplina je harmonika (`<details>`): zatvorena pokazuje koliko ima
 * kategorija, prijava i koliko je plasmana uneto; otvorena izlista učesnike po
 * kategorijama. Pretraga hvata i disciplinu, i kategoriju, i ime, i klub, pa
 * sama otvara ono što je našla.
 *
 * Zatvoreno takmičenje se ne dira: izbori su onemogućeni dok se ne otvori
 * ponovo, da se zvaničan rezultat ne promeni slučajno.
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
  if (!registry.entries.length) {
    return `
      <div class="empty-screen">
        <h2 class="soon-title">Nema prijava</h2>
        <p class="soon-note">Na takmičenju „${esc(competition.name)}" nema nijedne prijave.</p>
      </div>`;
  }

  const locked = competition.status === 'Završeno';
  const byEntry = new Map(results.map((r) => [r.entryId, r]));

  // Disciplina → kategorija → prijave. Redosled disciplina je onaj iz
  // pravilnika (DISCIPLINES.order), ne azbučni.
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

  const done = registry.entries.filter((e) => byEntry.has(e.id)).length;

  // Padajući filteri se pune iz onoga što na takmičenju zaista postoji, pa
  // nema izbora koji ne daje nijedan red.
  resultsIndex = buildResultsIndex(registry.entries);

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
      ${!locked && done < registry.entries.length
    ? '<button type="button" class="btn-app is-quiet" data-fill-ucesce>Svima učešće</button>' : ''}
      <span class="list-count" id="results-progress">${done} od ${registry.entries.length} plasmana uneto</span>
    </div>
    <div class="disc-list" id="results-list">${disciplines}</div>`;
}

/** Šta uopšte postoji na ovom takmičenju — punjenje padajućih filtera. */
let resultsIndex = { disciplines: [], byDiscipline: new Map(), years: [] };

function buildResultsIndex(entries) {
  const byDiscipline = new Map();
  const years = new Set();
  const sexes = new Set();
  entries.forEach((e) => {
    if (!byDiscipline.has(e.discipline)) byDiscipline.set(e.discipline, new Set());
    byDiscipline.get(e.discipline).add(categoryLabel(e));
    years.add(e.year);
    sexes.add(e.sex);
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
 * Kategorije za padajući meni. Kad je disciplina izabrana prikazuju se samo
 * njene; inače su grupisane po disciplini, jer se ista kategorija (recimo
 * „Grupa C · pioniri · žene") javlja u više disciplina i bez zaglavlja se ne
 * bi znalo koja je koja.
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

/** „68 kg", „+76 kg", ali „apsolutna" ostaje kako jeste — nije telesna težina. */
const weightLabel = (weight) => {
  if (!weight) return '';
  return /^[+\d]/.test(weight) ? `${weight} kg` : weight;
};

/**
 * Ime kategorije **bez pola** — to je ono što stoji u padajućem filteru, jer
 * je pol zaseban filter. Prati categoryKey u ostalom: kumite razdvaja telesna težina,
 * kate nivo pojasa, ostalo grupa.
 */
function categoryLabel(entry) {
  const age = ageByCode(entry.group);
  const parts = [`Grupa ${entry.group}`, age ? age.name.toLowerCase() : null];
  // Po čemu se kategorija deli govori pravilnik, ne ime discipline:
  // tradicionalni kumite je apsolutan pa mu se telesna težina i ne piše, a sportski
  // se deli po telesnoj težini iako se zove isto.
  const drawBy = disciplineByName(entry.discipline)?.drawBy;
  if (drawBy === 'weight') parts.push(weightLabel(entry.weight) || 'bez telesne težine');
  else if (drawBy === 'level') parts.push(entry.level || 'bez nivoa');
  return parts.filter(Boolean).join(' · ');
}

const sexLabel = (sex) => (sex === 'M' ? 'muškarci' : 'žene');

/** Puno ime kategorije, sa polom — za zaglavlje na ekranu i za štampu. */
function categoryFullLabel(entry) {
  const parts = categoryLabel(entry).split(' · ');
  parts.splice(2, 0, sexLabel(entry.sex));
  return parts.join(' · ');
}

/** Svi plasmani — meni pre nego što se zna šta je u kategoriji zauzeto. */
const ALL_PLACEMENTS = new Set(PLACEMENTS.map((pl) => pl.key));

/**
 * Meni plasmana za jedan red: prazno, pa ono što je u kategoriji još slobodno.
 * Sopstveni plasman uvek ostaje u meniju, da se izbor može promeniti ili povući.
 */
const placementOptions = (selected, allowed) => ['<option value="">— nije uneto —</option>']
  .concat(PLACEMENTS.filter((pl) => allowed.has(pl.key) || pl.key === selected).map((pl) => `
    <option value="${esc(pl.key)}"${pl.key === selected ? ' selected' : ''}>${esc(
    pl.place ? `${pl.place} — ${pl.label.toLowerCase()}` : pl.label)}</option>`))
  .join('');

/**
 * Popunjenost mesta u jednoj kategoriji: prebroji, ispiše i **zaključa**.
 *
 * Po pravilniku kategorija ima jedno prvo, jedno drugo i dva treća mesta. Kada
 * se mesto popuni, ono se u ostalim redovima te kategorije više ne nudi — treće
 * zlato ne treba prijaviti kao grešku posle unosa, nego ga ne pustiti unutra.
 *
 * Discipline koje se mere ili boduju umesto da se izvlače (kihon u mestu,
 * tamashiwari) nemaju ograničenje, pa im se ni brojač ne ispisuje kao razlomak.
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

  // Mesto koje su zauzeli drugi redovi **nestaje iz menija** ovog reda — ne
  // stoji zatamnjeno nego ga nema. Sopstveni izbor se ne računa, pa se plasman
  // uvek može promeniti ili povući.
  picks.forEach((pick) => {
    const allowed = new Set(PLACEMENTS.filter((pl) => {
      const slots = placementSlots(discipline, pl.key);
      if (slots === null) return true;
      return (counts[pl.key] || 0) - (pick.value === pl.key ? 1 : 0) < slots;
    }).map((pl) => pl.key));

    // Meni se prepisuje samo kad se zaista promenio — inače bi svaki upis
    // izgradio sve menije u kategoriji iznova.
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

/** Brojači unetih plasmana — po disciplini i ukupno, bez ponovnog iscrtavanja. */
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
    // Kroz filter se broji samo ono što je na ekranu, da brojač ne priča o
    // redovima koje korisnik trenutno ne vidi.
    const filtered = !!document.querySelector('.result-row[hidden]');
    const picks = [...document.querySelectorAll('.result-row:not([hidden]) .result-pick')];
    const done = picks.filter((p) => p.value).length;
    total.textContent = `${done} od ${picks.length} plasmana uneto${filtered ? ' (filtrirano)' : ''}`;
  }
}

/**
 * Filtriranje po disciplini, kategoriji i godištu. Skriva redove umesto da
 * ponovo iscrtava spisak — izbori plasmana koje je korisnik već otvorio ne
 * smeju da se izgube pod rukom.
 *
 * Kad je bilo šta filtrirano, discipline se same otvaraju; kad se filteri
 * ponište, vraćaju se u zatvoreno stanje.
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

/** Kategorije se sužavaju na izabranu disciplinu, pa se filter primeni. */
function onDisciplineFilterChange() {
  const disc = document.getElementById('f-disc').value;
  const catSelect = document.getElementById('f-cat');
  const previous = catSelect.value;
  catSelect.innerHTML = categoryOptions(resultsIndex, disc);
  // Ako izabrana kategorija postoji i u novoj listi, zadrži je.
  catSelect.value = [...catSelect.options].some((o) => o.value === previous) ? previous : '';
  applyResultsFilter();
}


// ── Podešavanja ────────────────────────────────────────────────────────

/**
 * Cenovnik kotizacija.
 *
 * Jedini deo pravilnika koji se za sada menja iz aplikacije — ostalo (uzrasne
 * grupe, discipline, telesne težine) i dalje stoji u data.js, jer se menja
 * jednom u nekoliko godina i menja ga onaj ko dira kod.
 *
 * Kotizacija se plaća **po prijavi**: ko je prijavljen u tri discipline plaća
 * tri. Ekipa se plaća kao celina, enbu po svojoj ceni. Starijim uzrastima se
 * prve tri discipline opraštaju — osim onih koje su ovde označene kao one
 * koje se plaćaju uvek.
 */
function settingsHtml({ fees }) {
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

    <div class="empty-screen is-quiet">
      <h2 class="soon-title">Ostalo iz pravilnika — uskoro</h2>
      <p class="soon-note">Uzrasne grupe, discipline i telesne težine i dalje se
        menjaju u pravilniku (<code>assets/js/data.js</code>), pa ista izmena
        važi za sve — i za aplikaciju i za formular koji klubovi popunjavaju.</p>
    </div>`;
}

// ── Diplome ────────────────────────────────────────────────────────────

/**
 * Diplome se štampaju unapred, u tiražu, sa gotovim tekstom i praznim
 * linijama. Posle takmičenja u te linije treba upisati ko je šta osvojio —
 * i to onim redom kojim se kategorije završavaju, jer se dodeljuju odmah.
 *
 * Zato ovaj ekran ne pravi diplomu nego **upis na nju**: gde na listu stoji
 * ime, gde klub, gde mesto i disciplina. Papir je tuđi i zadat, pa se ovde
 * ne bira izgled nego mera.
 */

/** Mera lista u milimetrima — po njoj se računa i lenjir i širina upisa. */
const slipSize = (setup) => (setup.orientation === 'landscape'
  ? { width: 297, height: 210 } : { width: 210, height: 297 });

/** Podrazumevani sadržaj svakog reda upisa. */
const diplomaText = {
  ime: ({ entry }) => entry.name,
  klub: ({ entry }) => entry.club,
  mesto: ({ placement }) => placement.place || placement.label,
  disciplina: ({ entry }) => entry.discipline,
  kategorija: ({ entry }) => categoryFullLabel(entry),
};

/** Isto to, sa izmišljenim podacima — za probni list. */
const DIPLOMA_SAMPLE = {
  entry: {
    name: 'Petar Petrović', club: 'KK Fudokan Beograd', discipline: 'Kate',
    group: 'C', sex: 'M', level: '1. nivo', weight: '',
  },
  placement: placementByKey('zlato'),
};

/**
 * Ko dobija diplomu: **samo osvajači medalja**, po kategorijama, redom kojim
 * se i dodeljuju — zlato, srebro, pa dve bronze.
 *
 * Kategorija bez ijedne medalje se ne prikazuje: dok plasman nije unet, nema
 * se šta ni odštampati.
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

  const rank = (placement) => PLACEMENTS.findIndex((pl) => pl.key === placement.key);
  const list = [...cats.values()];
  list.forEach((cat) => cat.winners.sort((a, b) =>
    rank(a.placement) - rank(b.placement) || a.entry.name.localeCompare(b.entry.name, 'sr')));

  return list.sort((a, b) =>
    (disciplineByName(a.first.discipline)?.order || 99)
      - (disciplineByName(b.first.discipline)?.order || 99)
    || categoryFullLabel(a.first).localeCompare(categoryFullLabel(b.first), 'sr'));
}

/** Jedno polje podešavanja — milimetri i tačke, ništa drugo se ne upisuje. */
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

  // Mere se podese jednom, pa se godinama samo štampa — zato je okvir otvoren
  // dok nije izmereno, a posle sklopljen, na jedan klik.
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
          <span class="cat-name">${esc(cat.first.discipline)} · ${esc(categoryFullLabel(cat.first))}</span>
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
 * Redovi upisa za jednog osvajača, po izmerenim merama. Isključen red se ne
 * štampa — na diplomi na kojoj disciplina već piše, ne treba je pisati opet.
 */
const diplomaLines = (winner, setup) => DIPLOMA_LINES
  .filter((line) => setup.lines[line.key].on)
  .map((line) => {
    const mera = setup.lines[line.key];
    return slipLine(diplomaText[line.key](winner), {
      top: mera.top, x: mera.x, size: mera.size, caps: line.caps, strong: line.caps,
    });
  });

/** Po jedan list na svakog osvajača, bez ičega osim upisa. */
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
 * Probni list: lenjir, izmišljen upis na izmerenim mestima i uputstvo.
 *
 * Štampa se na običan papir i prisloni uz diplomu prema svetlu — sa lenjira
 * se pročita koliko je milimetara do svake linije i to se upiše u polja.
 * Uputstvo stoji na papiru, a ne na ekranu, jer ga čita onaj ko taj papir
 * drži u ruci.
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

// ── Rang lista ─────────────────────────────────────────────────────────

/**
 * Rang liste jedne sezone. Klubovi su jedna lista, pa po jedna za svaku
 * uzrasnu grupu podeljenu na muškarce i žene — onako kako se i dodeljuju
 * pehari, i onako kako se štampaju: **svaka kategorija je zaseban list**.
 *
 * Sezona nije zakucana. Otvorena traje dok je urednik ne zatvori, a
 * zatvaranje upisuje datume koje on potvrdi.
 */

/** Koja je lista trenutno izabrana na ekranu — `klubovi` ili npr. `C-Ž`. */
let rankPick = 'klubovi';

/** Koja je sezona izabrana; prazno znači otvorena. */
let seasonPick = 'open';

/** Šta radi dugme „Završetak sezone" na trenutnom ekranu. */
let closeSeasonAction = null;

/** Plan borilišta dok je taj ekran otvoren — izmene se upisuju odmah. */
let tatamiState = null;

/** Kategorije za žreb dok je taj ekran otvoren. */
let drawState = null;

/** Osvajači i mere upisa dok je otvoren ekran Diplome. */
let diplomaState = null;

/** Prijave dok je otvoren spisak takmičara — odatle ih uzima ispravka. */
let competitorsState = null;

/** Cenovnik dok su otvorena Podešavanja; upisuje se čim se polje napusti. */
let feesState = null;

async function updateFees(mutate) {
  if (!feesState) return;
  mutate(feesState);
  await store.saveFees(feesState);
}

/**
 * Mera se upiše čim se polje napusti, bez „sačuvaj" — kao i raspored po
 * borilištima. Ekran se pri tome **ne iscrtava ponovo**: jedino što od mera
 * zavisi su sama polja, a ponovno iscrtavanje bi odnelo fokus usred
 * podešavanja.
 */
async function updateDiploma(mutate) {
  if (!diplomaState) return;
  mutate(diplomaState.setup);
  await store.saveDiplomaSetup(diplomaState.setup);
}

/** U koje takmičenje ide uvoz; prazno znači aktuelno. */
let importPick = '';

const MEDAL_COLUMNS = ['zlato', 'srebro', 'bronza', 'ucesce'];

const seasonSpan = (season) => (season.to
  ? `${dateLabel(season.from)} – ${dateLabel(season.to)}`
  : `od ${dateLabel(season.from)} · u toku`);

function rankingsHtml({ seasons, season, data }) {
  // Birač sezona se iscrtava **uvek**, i kad u sezoni nema ničega. Tek
  // zatvorena sezona ostavlja iza sebe praznu novu; da birač nestane sa
  // njom, urednik ne bi imao odakle da se vrati na ono što je upravo
  // zatvorio — ni da to ponovo otvori.
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

  // Bodovi se knjiže zatvaranjem takmičenja. Takmičenje koje je odigrano a
  // nije zatvoreno zato tiho nedostaje na rang listi — i to mora da piše,
  // jer se sa same liste ne vidi da nešto čeka.
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
 * Modal za završetak sezone. Ime i oba datuma su polja, ne tekst — urednik
 * određuje kad sezona počinje i kad se završava, aplikacija samo predlaže.
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

    // Štampa ide nad tačno onim rasponom koji je urednik potvrdio, a ne nad
    // onim što je bilo na ekranu — datum je mogao da se promeni ovde.
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

// ── Žreb ───────────────────────────────────────────────────────────────

/*
 * Žreb po kategorijama. Ekran je spisak: disciplina, pod njom kategorije sa
 * brojem prijavljenih, i uz svaku dugme koje **odmah izvuče novu granu i
 * pošalje je na štampu**. Ništa se ne čuva — svaki pritisak je nov žreb, jer
 * je žreb koji se pamti između dva pritiska gori od nikakvog: niko ne bi
 * znao da li gleda onaj koji je izvučen pred sudijama ili neki raniji.
 *
 * Papir su dve strane (ili više): prva je grana sa mestom za upis osvojenih
 * mesta i potpisom glavnog sudije, ostale su spisak takmičara te kategorije
 * — samo ime, prezime i klub, jer se na tatamiju proziva, ne boduje.
 */

/** Kategorije jednog takmičenja, grupisane po disciplini, sa prijavama. */
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

  // Ekipne discipline nemaju pojedinačne prijave, ali imaju takmičare —
  // učesnik je ekipa. Za granu je razlika samo u tome ko stoji u kutiji, pa
  // se ekipne kategorije slažu uz pojedinačne, ne pored njih.
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

  // Disciplina iz pravilnika koja na ovom takmičenju nema nijednu kategoriju
  // ne pojavi se u spisku — i to je do sad ćutalo. Prijave se upisuju pri
  // pravljenju takmičenja; ono napravljeno pre nego što je disciplina uvedena
  // nema njene prijave i nikad ih neće ni dobiti samo od sebe. Zato se
  // izostanak sad **imenuje**, umesto da se traži po ekranu.
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
          // U pretragu ulaze i reči kojima se ovo traži, a ne stoje u imenu:
          // „ekipno", „ekipa", „tim", „par". Ko kuca „ekipno" traži ekipne
          // kategorije, i treba da ih nađe iako se nijedna tako ne zove.
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

// ── Uvoz prijava iz Excela ─────────────────────────────────────────────

/*
 * Prijave ne unosi savez nego klubovi, i to **van aplikacije**: savez im
 * pošalje `form/FSS-Entry-Form.xlsx`, treneri ga popune u Excelu i vrate.
 * Aplikaciji ostaje jedan posao — da tuđi fajl pročita, pokaže šta nosi i
 * upiše ga u izabrano takmičenje.
 *
 * Zato ovaj ekran pokazuje **svaki red iz fajla**, i onaj koji ne valja.
 * Uvozi se ono što je ispravno, a uz svaki odbačen red stoji broj reda iz
 * Excela i rečenica šta mu fali — savez to prepiše klubu i klub zna šta da
 * popravi. Fajl koji se odbije u celini ne kaže ništa nikome.
 */

/**
 * Fajlovi koji su trenutno otvoreni na ekranu Uvoz — pročitani, još ne uvezeni.
 *
 * Klubova ima trinaest i svaki šalje svoj fajl, pa se biraju **svi odjednom**:
 * `files` su izabrani fajlovi, `read` je ono što je iz svakog pročitano, u
 * istom redosledu. Svaki fajl ostaje svoj i posle uvoza — greška se prijavljuje
 * klubu, a klub se prepoznaje po fajlu iz kog je red došao.
 */
let importState = { files: [], read: [], done: null };

const resetImport = () => { importState = { files: [], read: [], done: null }; };

/**
 * Čita izabrane fajlove za izabrano takmičenje.
 *
 * Uzrasna grupa zavisi od **sezone takmičenja**, a ne od današnjeg datuma —
 * tabela saveza se svake godine pomeri za jednu. Zato se fajlovi čitaju iznova
 * kad se promeni takmičenje u koje se uvozi: isto godište ume da bude pionir na
 * jednom, a stariji pionir na drugom.
 */
async function readImportFiles(competition) {
  const season = seasonOf(competition);
  importState.read = [];
  for (const file of importState.files) {
    const read = await readEntryFile(file, season);
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

/** Šta svi izabrani fajlovi zajedno nose. */
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
  // Zatvorene prijave znače zatvoreno za sve — i za ispravku i za uvoz.
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
      <a class="btn-app is-quiet" href="form/FSS-Entry-Form.xlsx" download>Prazan formular za klubove</a>
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
      </dl>
      ${s.done.transfers?.length ? `
      <p class="pf-note">Isto ime i godište već postoji pod drugim klubom, pa su
        ovde upisani kao novi takmičari: ${s.done.transfers.map((n) => `
        <b>${esc(n.name)}</b> (${esc(n.year)}, ${esc(n.from)} → ${esc(n.to)})`).join(', ')}.
        Ako je imenjak — sve je kako treba. Ako je isti čovek koji je prešao klub,
        bodovi mu kreću od nule.</p>` : ''}
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
 * Jedan fajl, razložen. Otvoren je sam od sebe kad u njemu ima reda koji ne
 * ulazi — to je jedino zbog čega urednik ovde i gleda; ostalo stoji sklopljeno.
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
 * Svaki red iz fajla, i ispravan i neispravan. Neispravan nosi broj reda iz
 * Excela i rečenicu šta mu fali — to je ono što savez prepiše klubu.
 */
function importRows(rows, kind) {
  const columns = kind === 'solo'
    ? [['Red', 'num'], ['Ime i prezime', 'name'], ['Pol', 'num'], ['Godište', 'num'],
      ['Grupa', 'num'], ['Pojas', ''], ['Discipline', ''], ['Stanje', '']]
    : [['Red', 'num'], ['Ekipna disciplina', 'name'], ['Vrsta', ''], ['Grupa', 'num'],
      ['Sastav', 'num'], ['Članovi', ''], ['Stanje', '']];

  const body = rows.map((r) => {
    const ok = !r.problem;
    let cells;
    if (!ok) {
      cells = [r.excelRow, r.raw, ...Array(columns.length - 3).fill('')];
    } else if (kind === 'solo') {
      const c = r.competitor;
      cells = [r.excelRow, c.name, c.sex, c.year, c.group, c.belt,
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
        <td class="${ok ? 'is-ok' : 'is-bad-cell'}">${ok ? 'kompletno' : esc(r.problem)}</td>
      </tr>`;
  }).join('');

  return `
    <table class="grid is-dense import-grid">
      <thead><tr>${columns.map(([label, cls]) =>
    `<th class="${cls === 'num' ? 'col-num' : ''}">${esc(label)}</th>`).join('')}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// ── Kalendar ───────────────────────────────────────────────────────────

/*
 * Kalendar sezone — spisak, ne tabela sa kvadratićima. Ono što urednik
 * traži od kalendara je „šta imamo u martu", a to je red teksta, ne mreža.
 *
 * Svaka takmičarska godina ima **A i B kalendar**. A lista ulazi u
 * bodovanje, B ne. To su dva spiska nad istim takmičenjima, pa se ovde i
 * prikazuju kao dva bloka — ne kao filter koji sakriva pola godine.
 *
 * Takmičenje upisano ovde je isto ono takmičenje koje stoji u evidenciji:
 * jedan zapis, dva pogleda. Zato se ništa ne prepisuje ni ne sinhronizuje.
 */

/** Takmičenja jedne sezone, grupisana po mesecu, najstarije napred. */
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

// ── Borilišta ──────────────────────────────────────────────────────────

/*
 * Raspored takmičara na borilištima — onaj isti list koji savez i danas
 * pravi rukom u Wordu, samo što se ovde ne kuca nego se sastavlja iz
 * prijava koje već postoje.
 *
 * Jedinica rasporeda je **blok**: jedna uzrasna grupa jednog pola, sa
 * spiskom disciplina koje se za nju rade. To je jedinica u prilogu koji je
 * Filip poslao („ГРУПА А (ДЕЧАЦИ) — кате појединачно — кате екипно…"), i
 * to je jedinica po kojoj se sudi.
 *
 * Blokovi se **izvode iz prijava**, ne unose. Grupa koja nema nijednu
 * prijavu nema ni blok; disciplina koja se ne pojavljuje ni na jednoj
 * prijavi te grupe ne stoji u spisku. Raspored tako ne ume da izmisli
 * kategoriju koja neće izaći na tatami.
 */

const SEX_WORD = {
  M: { A: 'dečaci', B: 'dečaci', C: 'dečaci', D: 'dečaci', E: 'dečaci' },
  'Ž': { A: 'devojčice', B: 'devojčice', C: 'devojčice', D: 'devojčice', E: 'devojčice' },
};

/** „dečaci" za mlađe uzraste, „muškarci" za starije — kako savez i piše. */
const blockSexWord = (sex, code) =>
  SEX_WORD[sex]?.[code] || (sex === 'M' ? 'muškarci' : 'žene');

/**
 * Svi blokovi ovog takmičenja, redom iz pravilnika (uzrast, pa muški/ženski).
 * Discipline u bloku idu redosledom iz `DISCIPLINES`, ne azbučnim — tako se
 * i sudi i tako stoji u prilogu.
 */
/**
 * Jedan red rasporeda je **jedna disciplina jedne uzrasne grupe** — tačno ono
 * što se odigra na jednom borilištu u jednom terminu.
 *
 * Ranije je jedinica bila cela uzrasna grupa, pa su sve njene discipline morale
 * na isto borilište. Sada se par (grupa, disciplina) raspoređuje sam, a ekran
 * ih samo grupiše — po uzrastu ili po disciplini, kako je organizatoru
 * potrebno. Otuda „sportski kumite svih uzrasta na jedno borilište, ostalo na
 * drugo" jeste nekoliko klikova, a ne nemoguć zahtev.
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
 * Raspored pre uvođenja parova čuvao je borilište po uzrasnoj grupi. Prevodi se
 * jednom, pri prvom otvaranju: ono što je bilo raspoređeno ostaje raspoređeno.
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
 * Kartice po borilištima i one neraspoređene.
 *
 * Kartica se crta **na svakom borilištu na kom ima svoje parove**: uzrasna
 * grupa čije dve discipline idu na različita borilišta pojaviće se na oba, sa
 * onim što se tu zaista radi. Isto piše i na papiru.
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

/** „(M/Ž)" — koji polovi izlaze na to borilište, za zaglavlje kolone. */
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

// ── Štampa lista ───────────────────────────────────────────────────────

/*
 * Jedan spec po ekranu. Pravilo je isto za sve četiri: na papir ide ono
 * što je na ekranu. Filter koji sakrije red sa ekrana skida ga i sa
 * papira, a koji je filter bio uključen piše u zaglavlju lista — spisak
 * koji ćuti o tome šta je izostavio je gori nego nikakav.
 *
 * Ni jedan od ovih listova se ne potpisuje. To su radne liste; potpisuju
 * se zvanična dokumenta iz documents.html, gde stoje mesta za glavnog
 * sudiju i delegata.
 */

/** Desni blok zaglavlja: koje takmičenje. */
const competitionContext = (c) => (c
  ? { name: c.name, sub: `${dateLabel(c.date)} · ${c.place}` }
  : { name: FEDERATION.name, sub: FEDERATION.subtitle });

/** Za liste koje nisu vezane za jedno takmičenje (klubovi, rang). */
const ALL_SEASONS = { name: 'Sve sezone', sub: 'Zbirno kroz sva takmičenja u bazi' };

/** Nula se na papiru ne piše — prazno polje se brže čita od kolone nula. */
const numCell = (n, align = 'center', strong = false) =>
  cell(n ? num(n) : null, align, strong);

/**
  * „Disciplina: Kate · Godište: 2010" kad je filter uključen, inače ništa.
  *
  * Kad je filter uključen, papir mora da kaže šta je izostavio. Kad nije,
  * nema šta da se kaže — a red „bez filtera" je objašnjenje, ne podatak.
  */
const filterNote = (pairs) => filterLabel(pairs);

/** Sve što je prošlo kroz filter, u redosledu u kom stoji na ekranu. */
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
 * Jedna rang lista na papiru — klubovi ili jedna uzrasna kategorija.
 * Namerno ista funkcija za oba: razlika je samo u dve kolone, a jedan oblik
 * lista znači da ceo štos izgleda kao jedan dokument.
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
      // Rang lista je zvanična — po njoj se dele pehari, pa se potpisuje.
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
      // Bez zbirnog reda. Bod je nečiji — takmičarev, i preko njega klupski;
      // zbir bodova svih na listi ne pripada nikome i ne znači ništa.
      summary: '',
      summaryRight: '',
    },
  };
}

/**
 * Ceo štos za završetak sezone: klubovi pa svaka uzrasna kategorija, svaka
 * kao zaseban list sa svojom numeracijom strana.
 */
const seasonStack = ({ season, data }) => [
  rankingSpec({ season, group: null, clubs: data.clubs, totals: data.totals }),
  ...data.groups.map((group) => rankingSpec({ season, group, totals: data.totals })),
];

/**
 * Raspored takmičara na borilištima — list koji izlazi iz štampača izgleda
 * kao onaj koji savez i danas pravi: **kolona je borilište**, a red je
 * termin. Prvi red su prve kategorije na svakom borilištu, drugi red druge,
 * i tako dok se najduža kolona ne isprazni.
 *
 * Kolone se čitaju odozgo naniže, pa red koji negde nema šta da stavi
 * ostaje prazan — i to je tačno, jer to borilište tada nema termin više.
 */
function tatamiSpec({ competition, pairs, plan }) {
  const { columns, pool } = tatamiCards(pairs, plan);

  const assigned = columns.flat();
  const people = assigned.reduce((a, c) => a + c.people, 0);
  const nerasporedjeno = pool.reduce((a, c) => a + c.pairs.length, 0);

  // Više od dva borilišta uspravno daje kolone uže od imena discipline, pa
  // se prvo pokušava položen list. Uspravan je viši i primi dužu kolonu, pa
  // ostaje kao druga mogućnost — renderer bira onaj na kom ceo raspored
  // staje na jedan list.
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
      // Tabla, a ne tabela: kolona je borilište i teče sama za sebe, pa
      // raspored u kom jedno borilište ima mnogo više stavki od ostalih i
      // dalje staje na jedan list.
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
 * Kalendar na papiru: mesec kao naslov reda, pa takmičenja pod njim. A i B
 * lista jedna za drugom, jer se i gledaju zajedno — koliko toga ima u martu
 * je pitanje na koje se odgovara bez obzira na listu.
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
 * Grana žreba na papiru.
 *
 * Prva strana (ili prve tri, kad se kategorija deli) je grana sa mestom za
 * upis osvojenih mesta i potpisom **glavnog sudije** — on je taj ko žreb
 * overava. Iza toga ide spisak takmičara te kategorije: ime, prezime, klub i
 * ništa više, jer se sa tog papira proziva na tatamiju.
 */
/**
 * Ekipa u grani stoji pod imenom pod kojim je i prijavljena — klub, sa
 * brojem kad ih klub ima više u istoj kategoriji. Ime se ne izmišlja ovde
 * nego dolazi sa zapisa (`labelTeams` u data.js), da grana, spisak i prijava
 * govore isto.
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
      // Ostaje samo upozorenje — ono nije objašnjenje nego podatak koji
      // glavni sudija mora da vidi pre nego što potpiše.
      meta2: clash
        ? `PAŽNJA: ${clash} ${plural(clash, 'par', 'para', 'parova')} iz istog kluba`
        : '',
      signatures: ['Glavni sudija'],
      summary: '',
    };
  });

  // Spisak iza grane. Kod ekipa je red po članu, a članovi jedne ekipe stoje
  // zajedno (`groupId`) — ekipa presečena na dve strane nije spisak nego
  // zagonetka.
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
    // Trinaest kolona ne stane uspravno a da se imena ne prelome.
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
        col('#', '26px', 'center'), col('Ime i prezime'), col('Klub'),
        col('Grupa', '46px', 'center'), col('God.', '44px', 'center'), col('Pojas', '54px'),
        col('Prijave', '50px', 'center'), col('Zlato', '46px', 'center'),
        col('Srebro', '48px', 'center'), col('Bronza', '48px', 'center'),
        col('Učešće', '48px', 'center'), col('Bodovi', '52px', 'center'),
        col('Ukupno', '54px', 'center'),
      ],
      rows: rows.map((c, i) => {
        const here = tally.get(c.personId)?.here || blank;
        const total = tally.get(c.personId)?.total || blank;
        return {
          zebra: i % 2 === 1,
          cells: [
            cell(i + 1, 'center'), cell(c.name, 'left', true), cell(c.club),
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
 * Rezultati se čitaju iz samog ekrana, a ne iz baze: redosled disciplina i
 * kategorija, koje su prošle kroz filter i koji je plasman izabran — sve
 * to već stoji u DOM-u, tačno onako kako korisnik gleda. Plasman se uzima
 * iz izbora, pa i ono što je upravo uneto a još nije osveženo ide na papir.
 */
/**
 * Rezultati jedne kategorije, poređani za pisanje diploma.
 *
 * Diplome se pišu čim se kategorija završi, a ne kad se završi celo takmičenje,
 * pa svaka kategorija ima svoj list. Redosled je redosled mesta — prvo, drugo,
 * dva treća, pa ostali — jer se tim redom i popunjavaju.
 */
function resultsCategorySpec({ competition, registry, results, key }) {
  const byEntry = new Map(results.map((r) => [r.entryId, r]));
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

/** Sve kategorije jedne discipline, svaka na svom listu. */
function resultsDisciplineSpecs({ competition, registry, results, discipline }) {
  const keys = [];
  registry.entries
    .filter((e) => e.discipline === discipline)
    .forEach((e) => { if (!keys.includes(categoryKey(e))) keys.push(categoryKey(e)); });
  return keys
    .map((key) => resultsCategorySpec({ competition, registry, results, key }))
    .filter(Boolean);
}

function resultsSpec({ competition, registry }) {
  const byId = new Map(registry.entries.map((e) => [e.id, e]));
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
    // Položeno: ime kategorije je dugačko („Grupa A · poletarci · žene ·
    // 0. nivo"), a prelomljeno u dva reda razbija tabelu na pola.
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
      // Rezultat je zvaničan čim se potpiše, pa ovaj list ima mesta za potpis.
      // (Oznaka liste stoji u meta2 iznad kad je takmičenje na B listi.)
      signatures: ['Glavni sudija', 'Delegat saveza'],
      docCode: 'Rezultati po kategorijama',
      columns: [
        col('Disciplina', '104px'), col('Kategorija', '208px'), col('Takmičar'),
        col('Klub'), col('God.', '46px', 'center'),
        col('Plasman', '78px', 'center'), col('Bodovi', '52px', 'center'),
      ],
      rows,
      // Bez zbirnog reda — koliko je plasmana uneto stoji u zaglavlju, a zbir
      // bodova svih takmičara na listi nije ničiji podatak.
      summary: `${groupIndex} ${plural(groupIndex, 'kategorija', 'kategorije', 'kategorija')}`,
      summaryRight: '',
    },
  };
}

/**
 * Jedna izmena rasporeda: primeni je na plan, upiši i iscrtaj.
 *
 * Nema dugmeta „sačuvaj". Raspored se pravi u hali, uz sto, dok se prijave
 * još slažu — svaka izmena mora da preživi zatvaranje poklopca laptopa.
 */
async function updateTatami(change) {
  if (!tatamiState) return;
  const plan = JSON.parse(JSON.stringify(tatamiState.plan));
  change(plan);
  await store.saveTatamiPlan(tatamiState.competitionId, plan);
  render();
}

/** Parovi koje jedna kartica obuhvata na datom borilištu. */
function cardPairs(plan, key, mat) {
  const axis = axisOf(plan);
  return tatamiState.pairs.filter((pair) =>
    axis.key(pair) === key && (plan.pairs[pair.id] || 0) === mat);
}

// ── Modali ─────────────────────────────────────────────────────────────

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

    // Popunjavanje piše hiljadu i po zapisa — dugme mora da kaže da radi,
    // inače izgleda kao da se ništa nije desilo.
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
    // Ostani gde si i bio: iz kalendara se upisuje datum, iz evidencije se
    // otvara takmičenje. Skok na drugi ekran bi prekinuo oba posla.
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

// ── Poruka ─────────────────────────────────────────────────────────────

let toastTimer = null;
function toast(message) {
  const box = document.getElementById('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 4000);
}

// ── Iscrtavanje ────────────────────────────────────────────────────────

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

  // Šta ovaj ekran štampa. Gradi se tek kad se pritisne dugme, nad podacima
  // koji su ionako već ovde — a filtere pročita sa ekrana u tom trenutku,
  // pa papir uvek prati ono što korisnik gleda.
  let printable = null;
  /** Postoji samo na rang listi — završetak sezone traži podatke odavde. */
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
    const fees = await store.fees();
    feesState = fees;
    body = settingsHtml({ fees });
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
    // Žreb se ne štampa dugmetom u zaglavlju nego po kategoriji, pa ovaj
    // ekran namerno nema `printable` — Cmd+P ovde nema šta da odštampa.
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
  // Dugme „Štampaj" stoji samo tamo gde stvarno ima šta da se odštampa, i
  // uvek prvo — ostale akcije su ređe, a štampa je svakodnevna.
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
      // Stavka koja je stajala na borilištu kojeg više nema vraća se u spisak
      // umesto da tiho nestane sa rasporeda.
      Object.keys(plan.pairs).forEach((id) => {
        if (plan.pairs[id] > count) plan.pairs[id] = 0;
      });
      plan.count = count;
    }));
    document.getElementById('f-axis').addEventListener('change', (event) =>
      updateTatami((plan) => { plan.axis = event.target.value; }));
    document.getElementById('mats-spread').addEventListener('click', () => updateTatami((plan) => {
      // Ravnomerno po broju takmičara, a ne po broju stavki: borilište sa dve
      // velike grupe radi duže od onog sa četiri male. Deli se po kartici
      // izabrane podele, da ono što ide zajedno i ostane zajedno.
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
      // Druga sezona ima druge kategorije, pa izbor liste kreće iz klubova.
      rankPick = 'klubovi';
      render();
    });
    // Prazna sezona nema izbor liste — samo birač sezona.
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
      // Meni kategorija se gradi iznova, ne samo prazni — inače bi
      // onDisciplineFilterChange vratio ranije izabranu kategoriju.
      discFilter.value = '';
      document.getElementById('f-cat').innerHTML = categoryOptions(resultsIndex, '');
      document.getElementById('f-sex').value = '';
      document.getElementById('f-year').value = '';
      applyResultsFilter();
    });
    // Popunjenost medalja se čita iz samih izbora, pa se računa posle
    // iscrtavanja umesto da se dva puta piše ista logika u HTML-u.
    updateResultsProgress();
  }

  document.title = `${screen.title} · ${FEDERATION.name}`;
}

/**
 * Žreb ima dva filtera koja rade zajedno: tekst i vrsta kategorije
 * (pojedinačno / ekipno). Zato ima svoju funkciju umesto zajedničke — dva
 * uslova nad istim redom se ne daju složiti iz dve nezavisne pretrage.
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
  // Isti filter služi i tabelama i spisku kategorija za žreb — sve nosi
  // `data-search`, pa selektor ne mora da zna o kom je ekranu reč.
  const rows = [...document.querySelectorAll('[data-search]')];
  rows.forEach((row) => {
    const match = !needle || row.dataset.search.includes(needle);
    row.hidden = !match;
    if (match) shown += 1;
  });
  // Disciplina bez ijedne pogođene kategorije se sklanja cela.
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

// ── Događaji ───────────────────────────────────────────────────────────

document.addEventListener('click', async (event) => {
  // Zatvara ga dugme „Otkaži" ili klik na zatamnjenu pozadinu — ali ne i klik
  // bilo gde unutar samog prozorčeta, iako mu je pozadina roditelj.
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
      // Prazna prijava, sa merama koje se ionako biraju: godište u sredini
      // uzrasne tabele, beli pojas, prvi klub po azbuci.
      competitor: {
        id: null, name: '', sex: 'M', year: season - 12,
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

  // Većina prijavljenih dobija učešće; menja se samo šačica sa medaljom. Zato
  // se učešće upisuje odjednom, i to samo tamo gde plasman još ne stoji.
  if (event.target.closest('[data-fill-ucesce]')) {
    const competition = await store.activeCompetition();
    if (!competition) return;
    // Filter važi i ovde, kao i pri štampi: menja se ono što je na ekranu.
    const ids = visibleIds('.result-row[data-print-id]');
    const upisano = await store.fillPlacement(competition.id, ids, 'ucesce');
    toast(upisano
      ? `Učešće je upisano na ${upisano} ${plural(upisano, 'prijavu', 'prijave', 'prijava')}.`
      : 'Sve prijave na ekranu već imaju plasman.');
    render();
    return;
  }

  // Štampa rezultata po kategoriji i po disciplini — diplome se pišu čim se
  // kategorija završi, ne kad se završi celo takmičenje.
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
    // Grana se izvlači u trenutku pritiska i odmah ide na štampu — ništa se
    // ne čuva, pa je svaki žreb nov.
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
      // Redosled se piše nad celom kolonom, ne samo nad dve kartice koje se
      // menjaju — inače bi kolona posle nekoliko pomeranja imala rupe.
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

  // ── Uvoz prijava ───────────────────────────────────────────────────
  if (event.target.closest('[data-import-clear]')) {
    resetImport();
    render();
    return;
  }

  if (event.target.closest('[data-import-run]')) {
    const target = document.getElementById('import-target')?.value;
    const fajlovi = importState.read.filter((r) => r.payload);
    if (!fajlovi.length || !target) return;

    // Svi fajlovi ulaze u jednu istu bazu, jedan za drugim. Prepoznavanje
    // lica i preskakanje već upisanih rade preko svih — pa dva kluba koja
    // greškom prijave istog čoveka ne prave dva zapisa.
    const zbir = {
      files: 0, competitors: 0, entries: 0, teams: 0, skipped: 0, teamsSkipped: 0,
      transfers: [],
    };
    try {
      for (const r of fajlovi) {
        const done = await store.importClubEntry(target, r.payload);
        zbir.files += 1;
        ['competitors', 'entries', 'teams', 'skipped', 'teamsSkipped']
          .forEach((k) => { zbir[k] += done[k]; });
        // Ovi se ne sabiraju u broj nego se imenuju — o svakom od njih
        // urednik treba da odluči je li imenjak ili čovek koji je prešao klub.
        done.transfers.forEach((n) => zbir.transfers.push(n));
      }
      const into = await store.getCompetition(target);
      importState.done = { ...zbir, competition: into?.name || '' };
      toast(`Uvezeno iz ${zbir.files} ${plural(zbir.files, 'fajla', 'fajla', 'fajlova')}: `
        + `${zbir.entries} ${plural(zbir.entries, 'prijava', 'prijave', 'prijava')}`
        + `, ${zbir.teams} ${plural(zbir.teams, 'ekipa', 'ekipe', 'ekipa')}`
        + (zbir.skipped + zbir.teamsSkipped
          ? ` · preskočeno već upisanih: ${zbir.skipped + zbir.teamsSkipped}` : ''));
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
      // Filter koji ne pušta nijedan red bi odštampao prazan list, pa se
      // umesto toga kaže šta je posredi.
      if (!printNow()) toast('Nema nijednog reda za štampu — poništi filter pa probaj ponovo.');
    }
    else if (go.dataset.go === 'zavrsi-sezonu') closeSeasonAction?.();
    else if (go.dataset.go === 'reset-demo') confirmResetModal();
    else location.hash = go.dataset.go;
  }
});

document.addEventListener('change', async (event) => {
  // ── Uvoz prijava ───────────────────────────────────────────────────
  if (event.target.id === 'import-target') {
    importPick = event.target.value;
    // Uzrasne grupe zavise od sezone izabranog takmičenja, pa se fajlovi
    // čitaju iznova — a i upozorenje da nose drugo takmičenje.
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
    // Redosled kojim ih pregledač preda ume da bude proizvoljan; po imenu
    // fajla je bar isti svaki put.
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
      // Premešta se tačno ono što ta kartica na tom borilištu i sadrži — grupa
      // čije dve discipline stoje na dva borilišta seli samo ono odavde.
      cardPairs(plan, key, from).forEach((pair) => { plan.pairs[pair.id] = to; });
      // Na dno kolone: nova kartica ide iza onih koje su već raspoređene.
      plan.order[`${plan.axis}|${key}`] = to ? 999 : 0;
    });
    return;
  }

  const pick = event.target.closest('.result-pick');
  if (!pick) return;

  // Meni popunjena mesta i ne nudi, ali izbor ume da stigne i mimo menija —
  // tastaturom, dopunom pregledača. Prekoračenje se vraća pre upisa u bazu.
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
  const entry = registry.entries.find((e) => e.id === pick.dataset.entry);
  await store.setResult(entry, pick.value);

  // Bez ponovnog iscrtavanja: dugačak spisak ne sme da skoči na vrh posle
  // svakog upisa. Menja se samo ono što se zaista promenilo.
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
