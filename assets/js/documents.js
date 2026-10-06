/**
 * Official documents — entries on paper, as they are handed in and signed.
 *
 * Only the specs and the toolbar live here. Measuring, pagination and the
 * letterhead are in doc-render.js, shared with the app's Štampaj button,
 * so both come out of the printer looking like the same federation.
 *
 * Entries print separately per club, per category and per discipline:
 * each gets its own sheet and its own page numbering, because whoever
 * holds one club's list cares how long that list is, not where it sits
 * in a stack of forty.
 */

import {
  FEDERATION, WEIGHTS,
  ageByCode, clubByName, disciplineByName, categoryKey, dateLabel,
  money, feeCountFor, teamFeeOf, nameParts,
} from './data.js';
import { store } from './store.js';
import {
  esc, cell, col, stamp, uniqueCount, renderAllInto, pageWord,
} from './doc-render.js';

// By surname as it was entered, then by the whole name.
const bySurnameThenName = (a, b) =>
  nameParts(a).last.localeCompare(nameParts(b).last, 'sr') ||
  a.name.localeCompare(b.name, 'sr');

const byClubThenSurname = (a, b) =>
  a.club.localeCompare(b.club, 'sr') || bySurnameThenName(a, b);

const sexLabel = (sex, plural = false) =>
  sex === 'M' ? (plural ? 'muškarci' : 'muški') : (plural ? 'žene' : 'ženski');

/**
 * Who signs what. The club entry sheet is the only two-party document:
 * the club hands the list in, the federation receives it. Everything
 * else is signed by the referee table.
 */
const SIGNATURES = ['Glavni sudija', 'Delegat saveza'];
const CLUB_SIGNATURES = ['Predstavnik kluba', 'Predstavnik saveza'];

/** "68 kg", "+76 kg" — but "apsolutna" stays as is, it is not a weight. */
const weightLabel = (weight) => {
  if (!weight) return '';
  return /^[+\d]/.test(weight) ? `${weight} kg` : weight;
};

/**
 * Category name. What splits a category comes from the rulebook, not the
 * discipline name: traditional kumite is open, sport kumite splits by
 * weight even though the names are similar.
 */
function categoryTitle(entry) {
  const age = ageByCode(entry.group);
  const parts = [`Grupa ${entry.group}`, age ? age.name.toLowerCase() : null,
    sexLabel(entry.sex, true)];
  const drawBy = disciplineByName(entry.discipline)?.drawBy;
  if (drawBy === 'weight') parts.push(weightLabel(entry.weight) || 'bez telesne težine');
  else if (drawBy === 'level') parts.push(entry.level || 'bez nivoa');
  return parts.filter(Boolean).join(' · ');
}

/** Same, for a table row — without sex, which has its own column. */
const categoryCell = (entry) => {
  const parts = categoryTitle(entry).split(' · ');
  parts.splice(2, 1);
  return parts.join(' · ');
};

/** Category order follows the rulebook, not the alphabet. */
const categoryOrder = (a, b) =>
  (disciplineByName(a.discipline)?.order || 99) - (disciplineByName(b.discipline)?.order || 99)
  || a.group.localeCompare(b.group)
  || a.sex.localeCompare(b.sex)
  || String(a.weight || a.level || '').localeCompare(String(b.weight || b.level || ''), 'sr');

/** Which mat the category is assigned to; empty if none. */
function matOf(entry, plan) {
  const mat = plan?.pairs?.[`${entry.group}-${entry.sex}|${entry.discipline}`];
  return mat >= 1 ? `Borilište ${mat}` : '';
}

/** Groups entries in the order they print. */
function groupBy(entries, key) {
  const groups = new Map();
  entries.forEach((entry) => {
    const k = key(entry);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(entry);
  });
  return groups;
}

// === Documents =============================================

/**
 * Every document type returns a list of parts: one part for types that
 * print whole, one per club/category/discipline for those that print
 * separately.
 */
const DOCUMENTS = [
  {
    id: 'klubovi',
    label: 'Prijave po klubovima',
    units: ['klub', 'kluba', 'klubova'],
    orientation: 'portrait',
    parts({ registry }) {
      const clubs = [...new Set(registry.entries.map((e) => e.club))]
        .concat(registry.teams.map((t) => t.club))
        .filter((name, i, all) => all.indexOf(name) === i)
        .sort((a, b) => a.localeCompare(b, 'sr'));

      return clubs.map((name) => {
        const club = clubByName(name);
        const entries = registry.entries.filter((e) => e.club === name)
          .sort(bySurnameThenName);
        const teams = registry.teams.filter((t) => t.club === name);

        // The FSS ID is on the sheet the coach checks and signs — that is
        // how the club learns this year's IDs for its next form. Columns
        // follow the form: ID, first name, surname, then the rest.
        const rows = entries.map((e, i) => ({
          zebra: i % 2 === 1,
          cells: [
            cell(i + 1, 'center'), cell(e.competitor?.fssId || '—'),
            cell(nameParts(e).first, 'left', true), cell(nameParts(e).last, 'left', true),
            cell(e.sex, 'center'), cell(e.year, 'center'), cell(e.belt), cell(e.level),
            cell(e.discipline), cell(e.group, 'center'), cell(null, 'center'),
          ],
        }));

        // Teams go on the same list: the club entered them too, so the
        // sheet it signs must show them. A team's members stay together
        // and never break across two pages.
        teams.forEach((team, ti) => {
          team.members.forEach((m, mi) => {
            const last = mi === team.members.length - 1;
            rows.push({
              groupId: `t${team.id}`,
              zebra: (entries.length + ti) % 2 === 1,
              groupInner: !last,
              groupEnd: last,
              cells: [
                cell(mi === 0 ? entries.length + ti + 1 : null, 'center'), cell(m.fssId || '—'),
                cell(nameParts(m).first, 'left', true), cell(nameParts(m).last, 'left', true),
                cell(m.sex || '', 'center'), cell(m.year, 'center'), cell(m.belt), cell(''),
                cell(mi === 0
                  ? [team.discipline, team.variantLabel].filter(Boolean).join(' · ')
                  : null),
                cell(mi === 0 ? team.group : null, 'center'), cell(null, 'center'),
              ],
            });
          });
        });

        const members = teams.reduce((sum, t) => sum + t.members.length, 0);
        return {
          key: name,
          label: `${name} · ${entries.length + teams.length} ${
            plural(entries.length + teams.length, 'prijava', 'prijave', 'prijava')}`,
          spec: {
            kicker: 'Prijava kluba',
            title: club ? `${club.name} · ${club.city}` : name,
            meta1: club?.coach ? `Trener: ${club.coach}` : '',
            meta2: `${uniqueCount(entries, (e) => e.personId || e.name)} ${
              plural(uniqueCount(entries, (e) => e.personId || e.name),
                'takmičar', 'takmičara', 'takmičara')}`,
            signatures: CLUB_SIGNATURES,
            docCode: `Prijava kluba · ${name}`,
            columns: [
              col('#', '26px', 'center'), col('FSS ID', '70px'), col('Ime'), col('Prezime'),
              col('M/Ž', '36px', 'center'), col('Godište', '50px', 'center'), col('Pojas', '54px'),
              col('Nivo', '50px'), col('Disciplina', '80px'), col('Grupa', '44px', 'center'),
              col('Potvrda', '60px', 'center'),
            ],
            rows,
            summary: `Ukupno prijava kluba: ${entries.length + teams.length}`,
            summaryRight: `Pojedinačno: ${entries.length} · Ekipno: ${teams.length}`
              + (members ? ` (${members} u ekipama)` : ''),
          },
        };
      });
    },
  },

  {
    id: 'kotizacije',
    label: 'Kotizacije',
    units: ['klub', 'kluba', 'klubova'],
    orientation: 'portrait',
    parts({ registry, fees }) {
      const clubs = [...new Set(registry.entries.map((e) => e.club)
        .concat(registry.teams.map((t) => t.club)))]
        .sort((a, b) => a.localeCompare(b, 'sr'));

      return clubs.map((name) => {
        const club = clubByName(name);
        const teams = registry.teams.filter((t) => t.club === name);

        // One row per competitor, not per entry: this is a bill, so a
        // name appears once, with the number of fees it owes.
        const byCompetitor = new Map();
        registry.entries.filter((e) => e.club === name).forEach((e) => {
          if (!byCompetitor.has(e.competitorId)) byCompetitor.set(e.competitorId, []);
          byCompetitor.get(e.competitorId).push(e);
        });

        const people = [...byCompetitor.values()]
          .map((entries) => ({ ...feeCountFor(entries, fees), first: entries[0] }))
          .sort((a, b) => bySurnameThenName(a.first, b.first));

        const zbir = people.reduce((a, p) => ({
          entries: a.entries + p.entries, free: a.free + p.free, paid: a.paid + p.paid,
        }), { entries: 0, free: 0, paid: 0 });

        const teamTotal = teams.reduce((a, t) => a + teamFeeOf(t, fees), 0);
        const iznos = zbir.paid * (fees.individual || 0) + teamTotal;
        const povrat = Math.round(iznos * (fees.coachRefund || 0) / 100);

        const rows = people.map((p, i) => ({
          zebra: i % 2 === 1,
          cells: [
            cell(i + 1, 'center'), cell(p.first.name, 'left', true),
            cell(p.first.year, 'center'), cell(p.first.group, 'center'),
            cell(p.entries, 'center'), cell(p.free || '—', 'center'),
            cell(p.paid, 'center', true),
            cell(money(p.paid * (fees.individual || 0)), 'right'),
          ],
        }));

        // A team is paid as a whole, so it gets its own row — members
        // are just named, so nobody hunts for them on another sheet.
        teams.forEach((team, ti) => {
          rows.push({
            zebra: (people.length + ti) % 2 === 1,
            cells: [
              cell(people.length + ti + 1, 'center'),
              cell([team.discipline, team.variantLabel].filter(Boolean).join(' · ')
                + ` — ${(team.members || []).map((m) => m.name).join(', ')}`, 'left', true),
              cell(null), cell(team.group, 'center'),
              cell(1, 'center'), cell(null), cell(1, 'center', true),
              cell(money(teamFeeOf(team, fees)), 'right'),
            ],
          });
        });

        const kotizacija = zbir.paid + teams.length;
        return {
          key: name,
          label: `${name} · ${money(iznos - povrat)}`,
          spec: {
            kicker: 'Kotizacije',
            title: club ? `${club.name} · ${club.city}` : name,
            meta1: club?.coach ? `Trener: ${club.coach}` : '',
            meta2: fees.individual || fees.team || fees.enbu
              ? `Po disciplini ${money(fees.individual)} · po ekipi ${money(fees.team)}`
                + ` · enbu ${money(fees.enbu)}`
              : 'Iznosi kotizacija nisu uneti u Podešavanjima',
            signatures: CLUB_SIGNATURES,
            docCode: `Kotizacije · ${name}`,
            columns: [
              col('#', '26px', 'center'), col('Ime i prezime'),
              col('Godište', '56px', 'center'), col('Grupa', '48px', 'center'),
              col('Prijava', '54px', 'center'), col('Besplatno', '62px', 'center'),
              col('Kotizacija', '66px', 'center'), col('Iznos', '78px', 'right'),
            ],
            rows,
            // The total must equal what the column shows: a team is one
            // row with one entry, so it counts as one. It reads as
            // entries − free = fees.
            foot: [
              cell(null), cell('Ukupno', 'left', true), cell(null), cell(null),
              cell(zbir.entries + teams.length, 'center'), cell(zbir.free || '—', 'center'),
              cell(kotizacija, 'center'), cell(money(iznos), 'right'),
            ],
            summary: fees.coachRefund
              ? `Povrat treneru (${fees.coachRefund} %): ${money(povrat)}`
              : 'Bez povrata treneru',
            summaryRight: `Za uplatu: ${money(iznos - povrat)}`,
          },
        };
      });
    },
  },

  {
    id: 'kategorije',
    label: 'Prijave po kategorijama',
    units: ['kategorija', 'kategorije', 'kategorija'],
    orientation: 'portrait',
    parts({ registry, plan }) {
      const groups = groupBy(registry.entries, categoryKey);
      return [...groups.values()]
        .sort((a, b) => categoryOrder(a[0], b[0]))
        .map((group) => {
          const first = group[0];
          const rows = [...group].sort(bySurnameThenName);
          const discipline = disciplineByName(first.discipline);

          return {
            key: categoryKey(first),
            label: `${first.discipline} · ${categoryTitle(first)} · ${rows.length} ${
              plural(rows.length, 'prijava', 'prijave', 'prijava')}`,
            spec: {
              kicker: `${first.discipline} · pojedinačno`,
              title: categoryTitle(first),
              meta1: [
                discipline?.system ? `Sistem: ${discipline.system.toLowerCase()}` : '',
                WEIGHTS[first.group]?.bout ? `trajanje meča ${WEIGHTS[first.group].bout}` : '',
              ].filter(Boolean).join(' · '),
              meta2: matOf(first, plan),
              signatures: SIGNATURES,
              docCode: `Lista kategorije · ${first.discipline} · ${categoryTitle(first)}`,
              columns: [
                col('#', '26px', 'center'), col('Ime i prezime'), col('Ime kluba'),
                col('Grad'), col('Godište', '56px', 'center'), col('Pojas', '58px'),
                col('Trener'), col('Plasman', '62px', 'center'),
              ],
              rows: rows.map((e, i) => ({
                zebra: i % 2 === 1,
                cells: [
                  cell(i + 1, 'center'), cell(e.name, 'left', true), cell(e.club),
                  cell(e.city), cell(e.year, 'center'), cell(e.belt), cell(e.coach),
                  cell(null, 'center'),
                ],
              })),
              summary: `Ukupno prijavljenih u kategoriji: ${rows.length}`,
              summaryRight: `Klubova: ${uniqueCount(rows, (e) => e.club)}`,
            },
          };
        });
    },
  },

  {
    id: 'discipline',
    label: 'Prijave po disciplinama',
    units: ['disciplina', 'discipline', 'disciplina'],
    orientation: 'portrait',
    parts({ registry }) {
      const groups = groupBy(registry.entries, (e) => e.discipline);
      return [...groups.entries()]
        .sort((a, b) => (disciplineByName(a[0])?.order || 99)
          - (disciplineByName(b[0])?.order || 99))
        .map(([discipline, entries]) => {
          // Within a discipline it goes category by category — that is
          // how it is judged. A category stays on one page.
          const cats = [...groupBy(entries, categoryKey).values()]
            .sort((a, b) => categoryOrder(a[0], b[0]));

          const rows = [];
          let n = 0;
          cats.forEach((group, gi) => {
            const sorted = [...group].sort(bySurnameThenName);
            sorted.forEach((e, i) => {
              n += 1;
              const last = i === sorted.length - 1;
              rows.push({
                groupId: `c${gi}`,
                zebra: gi % 2 === 1,
                groupInner: !last,
                groupEnd: last,
                cells: [
                  cell(n, 'center'),
                  cell(i === 0 ? categoryCell(e) : null, 'left', i === 0),
                  cell(e.name, 'left', true), cell(e.club), cell(e.sex, 'center'),
                  cell(e.year, 'center'), cell(e.belt), cell(null, 'center'),
                ],
              });
            });
          });

          return {
            key: discipline,
            label: `${discipline} · ${entries.length} ${
              plural(entries.length, 'prijava', 'prijave', 'prijava')}`,
            spec: {
              kicker: 'Zvanični spisak',
              title: discipline,
              meta1: `${cats.length} ${plural(cats.length, 'kategorija', 'kategorije', 'kategorija')}`
                + ` · ${entries.length} ${plural(entries.length, 'prijava', 'prijave', 'prijava')}`,
              meta2: disciplineByName(discipline)?.note || '',
              signatures: SIGNATURES,
              docCode: `Spisak discipline · ${discipline}`,
              columns: [
                col('#', '30px', 'center'), col('Kategorija', '150px'),
                col('Ime i prezime'), col('Ime kluba'), col('M/Ž', '40px', 'center'),
                col('Godište', '56px', 'center'), col('Pojas', '58px'),
                col('Plasman', '62px', 'center'),
              ],
              rows,
              summary: `Ukupno prijava u disciplini: ${entries.length}`,
              summaryRight: `Klubova: ${uniqueCount(entries, (e) => e.club)}`,
            },
          };
        });
    },
  },

  {
    id: 'ekipe',
    label: 'Ekipne prijave',
    orientation: 'portrait',
    parts({ registry }) {
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
              // Team variant next to the discipline name — enbu has a
              // men's and a mixed pair, and the list must show which.
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
      return [{
        key: '',
        label: 'Sve ekipe',
        spec: {
          kicker: 'Ekipne prijave · list Tim',
          title: 'Prijavljene ekipe',
          meta1: '',
          meta2: '',
          signatures: SIGNATURES,
          docCode: 'Ekipne prijave',
          columns: [
            col('#', '26px', 'center'), col('Ekipa', '112px'), col('Ime kluba'), col('Grad'),
            col('Takmičar'), col('Godište', '52px', 'center'), col('Pojas', '52px'),
            col('Grupa', '44px', 'center'), col('Potvrda', '58px', 'center'),
          ],
          rows,
          summary: `Ukupno ekipa: ${teams.length} · takmičara u ekipama: ${members}`,
          summaryRight: `Klubova: ${uniqueCount(teams, (t) => t.club)}`,
        },
      }];
    },
  },

  {
    id: 'pun',
    label: 'Pun spisak takmičara',
    orientation: 'landscape',
    parts({ registry }) {
      const rows = [...registry.entries].sort(byClubThenSurname);
      return [{
        key: '',
        label: 'Svi takmičari',
        spec: {
          kicker: 'Zvanični spisak',
          title: 'Spisak prijavljenih takmičara',
          meta1: '',
          meta2: competition.entriesClosed
            ? `Prijave zaključene ${competition.entriesClosed}`
            : 'Prijave još nisu zaključene',
          signatures: SIGNATURES,
          docCode: 'Spisak takmičara',
          columns: [
            col('#', '26px', 'center'), col('FSS ID', '70px'), col('Ime'), col('Prezime'),
            col('Ime kluba'), col('Grad'),
            col('Trener'), col('M/Ž', '38px', 'center'), col('God.', '44px', 'center'),
            col('Pojas', '52px'), col('Nivo', '52px'), col('Disciplina', '78px'),
            col('Grupa', '46px', 'center'), col('Telesna težina', '50px', 'center'),
          ],
          rows: rows.map((e, i) => ({
            zebra: i % 2 === 1,
            cells: [
              cell(i + 1, 'center'), cell(e.competitor?.fssId || '—'),
              cell(nameParts(e).first, 'left', true), cell(nameParts(e).last, 'left', true),
              cell(e.club), cell(e.city),
              cell(e.coach), cell(e.sex, 'center'), cell(e.year, 'center'), cell(e.belt),
              cell(e.level), cell(e.discipline), cell(e.group, 'center'),
              cell(e.weight ?? '', 'center'),
            ],
          })),
          summary: `Ukupno prijava: ${rows.length}`,
          summaryRight: `Klubova: ${uniqueCount(rows, (e) => e.club)} · Kategorija: ${
            uniqueCount(rows, categoryKey)}`,
        },
      }];
    },
  },
];

/** Serbian plural — same rules as in the app. */
function plural(n, one, few, many) {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

// === Toolbar and rendering =============================================

/** Popunjava ih `start()` iz baze pre prvog iscrtavanja. */
let registry = { competitors: [], entries: [], teams: [] };
let competition = null;
let plan = null;
let fees = null;

const sheet = document.getElementById('doc-sheet');
const typeList = document.getElementById('doc-types');
const pickList = document.getElementById('doc-pick');
const metaLabel = document.getElementById('doc-meta');

const docById = (id) => DOCUMENTS.find((d) => d.id === id) || DOCUMENTS[0];

/** #klubovi or #klubovi/KK Niš — the type and, after the slash, one part. */
const routeOf = () => {
  const [id, key] = decodeURIComponent(location.hash.slice(1)).split('/');
  return { doc: docById(id), key: key || '' };
};

let current = routeOf().doc.id;
let pick = routeOf().key;

function render() {
  if (!competition) {
    sheet.innerHTML = '';
    metaLabel.textContent = 'Nema aktuelnog takmičenja';
    return;
  }

  const doc = docById(current);
  const parts = doc.parts({ registry, plan, fees });
  // A selected part that no longer exists (a club with no entries) must
  // not leave a blank sheet — fall back to all.
  if (pick && !parts.some((p) => p.key === pick)) pick = '';
  const shown = pick ? parts.filter((p) => p.key === pick) : parts;

  const context = {
    name: competition.name,
    sub: `${dateLabel(competition.date)} · ${competition.place}`,
  };
  const done = renderAllInto(sheet, shown.map((p) => ({ spec: p.spec, context })), {
    orientation: doc.orientation,
    printedAt: stamp(),
  });

  const paper = `A4 ${doc.orientation === 'landscape' ? 'položeno' : 'uspravno'}`;
  metaLabel.textContent = done.documents > 1
    ? `${paper} · ${done.documents} ${plural(done.documents, 'dokument', 'dokumenta', 'dokumenata')}`
      + ` · ${done.pages} ${pageWord(done.pages)}`
    : `${paper} · ${done.pages} ${pageWord(done.pages)}`;

  typeList.querySelectorAll('.toolbar-type').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.type === current));
  });

  // The part picker exists only where there is more than one part.
  const many = parts.length > 1;
  pickList.hidden = !many;
  if (many) {
    pickList.innerHTML = `
      <option value="">sve odvojeno — ${parts.length} ${plural(parts.length, ...doc.units)}</option>`
      + parts.map((p) => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('');
    pickList.value = pick;
  }

  document.title = `${shown[0]?.spec.title || doc.label} · ${FEDERATION.name}`;
  printed = fingerprint(registry, competition, fees);
}

/**
 * The category list can be a few hundred documents, each measured before
 * it breaks. The toolbar first gets a frame to say it is working, and the
 * drawing happens on the next one — otherwise the page just freezes.
 */
function scheduleRender() {
  metaLabel.textContent = 'Priprema…';
  requestAnimationFrame(() => requestAnimationFrame(render));
}

typeList.innerHTML = DOCUMENTS.map((d) => (
  `<button type="button" class="toolbar-type" role="tab" data-type="${d.id}"
     aria-selected="false">${esc(d.label)}</button>`
)).join('');

typeList.addEventListener('click', (event) => {
  const btn = event.target.closest('.toolbar-type');
  if (!btn) return;
  current = btn.dataset.type;
  pick = '';
  history.replaceState(null, '', `#${current}`);
  scheduleRender();
});

pickList.addEventListener('change', () => {
  pick = pickList.value;
  history.replaceState(null, '', `#${current}${pick ? '/' + encodeURIComponent(pick) : ''}`);
  scheduleRender();
});

window.addEventListener('hashchange', () => {
  const next = routeOf();
  if (next.doc.id !== current || next.key !== pick) {
    current = next.doc.id;
    pick = next.key;
    scheduleRender();
  }
});

document.getElementById('doc-print').addEventListener('click', () => window.print());

/**
 * Fingerprint of the loaded data — tells whether anything changed since
 * the last render.
 *
 * Exists for one concrete day: a club sheet is printed, a correction is
 * made in the app in another window, and the sheet is printed again for
 * signing. Without this, the second print would come from the stale view.
 */
const fingerprint = (reg, comp, price) => [
  comp?.id, comp?.status, JSON.stringify(price || {}),
  reg.competitors.length, reg.entries.length, reg.teams.length,
  reg.entries.map((e) => `${e.id}${e.name}${e.sex}${e.year}${e.group}${e.club}${e.weight || ''}`
    + (e.competitor?.fssId || '')).join(''),
  reg.teams.map((t) => `${t.id}${(t.members || []).map((m) => m.name + m.year).join('')}`).join(''),
].join('|');

let printed = '';

async function load() {
  competition = await store.activeCompetition();
  [registry, plan, fees] = await Promise.all([
    store.registryFor(competition?.id),
    store.tatamiPlan(competition?.id),
    store.fees(),
  ]);
  return fingerprint(registry, competition, fees);
}

async function start() {
  try {
    await store.ready();
    printed = await load();
  } catch (err) {
    metaLabel.textContent = 'Podaci se ne mogu otvoriti';
    console.error(err);
    return;
  }
  render();

  // Pagination is measured, so it must be measured in the real typeface.
  // The first render can beat the Barlow load — once fonts settle,
  // measure again.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (document.fonts.status === 'loaded') render();
    });
  }
}

/**
 * When the user returns to this page, data is re-read — and the sheet is
 * rebuilt only if something actually changed, because rebuilding every
 * category takes a while.
 */
async function refresh() {
  if (document.hidden || !competition) return;
  try {
    const now = await load();
    if (now === printed) return;
    printed = now;
    scheduleRender();
  } catch (err) {
    console.error(err);
  }
}

document.addEventListener('visibilitychange', refresh);
window.addEventListener('focus', refresh);

window.addEventListener('beforeprint', () => {
  if (competition && !document.querySelector('section.page')) render();
});

start();
