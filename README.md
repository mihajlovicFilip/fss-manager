# FSS Manager

Competition management for the Fudokan Karate Federation of Serbia (Fudokan
savez Srbije): from the season calendar and club entries, through the draw and
mat scheduling, to results, ranking points and official printouts.

It runs **in a browser, from a local folder, with no internet connection**. No
installation, no server, no accounts, and not a single network request — not
even for fonts. A laptop carried into a sports hall with no signal behaves
exactly as it does in the office.

> **The application interface is in Serbian**, as is the Excel entry form the
> clubs fill in. Code, file names and documentation are in English.

---

## Contents

- [Running the application](#running-the-application)
- [Running a competition](#running-a-competition)
- [Screens](#screens)
- [The rulebook](#the-rulebook)
- [The Excel entry form](#the-excel-entry-form)
- [Seasonal maintenance](#seasonal-maintenance)
- [Where the data lives](#where-the-data-lives)
- [For developers](#for-developers)
- [Not built yet](#not-built-yet)

---

## Running the application

Double-click **`start.command`**. The script starts a small local server and
opens the application in the default browser.

```
Desktop/FSS-Manager/fss-manager/start.command
```

A server is needed because browsers refuse, for security reasons, to run ES
modules and the offline cache when `index.html` is opened by double-click (a
`file://` address). The script always targets **the same port (8787)**: if the
application is already running it simply opens it; if another program holds the
port it moves to the next one and says so explicitly — data is bound to the
address, so competitions entered earlier will not appear on a different port.

The first run fills the database with **demo data** (two competitions, one of
them with recorded results from the previous season) so that no screen is empty
without explanation. Removing the demo before the first real season is covered
under [Seasonal maintenance](#seasonal-maintenance).

---

## Running a competition

The order in which the work actually happens.

### 1. Enter the competition in the calendar

Screen **Kalendar** (calendar) or **Takmičenja** (competitions), button *+ Novo
takmičenje*. Name, date, place, level and **list: A or B**.

> **A-list competitions carry ranking points; B-list ones do not.** A medal won
> at a B competition is still a medal and is counted in the medal column, but it
> earns no points. A competition with no list set counts as A.

One record, two views: a competition entered in the calendar appears in the
register immediately, and the other way round.

### 2. Send the form to the clubs

The blank form is downloaded with the **Prazan formular za klubove** button on
the *Uvoz prijava* screen, or taken from `form/FSS-Entry-Form.xlsx`. Clubs fill
it in Excel on their own machines — they never open the application and do not
need to have it.

### 3. Import the entries

Screen **Uvoz prijava** (entry import): pick the competition, then select **all
club forms at once** in the file dialog.

The screen shows a summary table with one row per club — coach, competitors,
entries, teams and status. Below it sits one collapsible block per file; a block
opens by itself when it contains a row that will not be imported.

Import rules:

- **Nothing is taken on trust.** Age group, permitted disciplines and body
  weight are recomputed from the rulebook, regardless of what the form's derived
  columns say.
- **A bad row does not sink the others.** Every rejected row carries its Excel
  row number and a sentence stating what is missing — that is what gets relayed
  to the club.
- **The same person is recognised across seasons**, by name and year of birth,
  so points land on the same ranking row as earlier appearances.
- **Importing the same file twice creates no duplicates**, so a club may send a
  corrected form.
- **A file that is not a form does not abort the import** — it appears in the
  summary table with its own message while the rest import normally.

### 4. The draw

Screen **Žreb / Tabele** (draw) lists the disciplines and, under each, the
categories with the number of entries and the bracket size. The button next to a
category **draws a fresh bracket and sends it straight to print**; nothing is
stored, so every press is a new draw.

- Bracket size is the first power of two that accommodates all entries; the
  remainder are byes, distributed evenly.
- **At most 32 competitors per bracket.** Beyond that the category splits into
  two brackets, with four advancing from each into a final bracket of eight.
- Pairing is random, with one rule: no two competitors from the same club may
  meet in the first round. Where separation proves impossible, the number of
  unseparated pairs is printed in the sheet header.

Printing produces two pages: the bracket, with lines for first, second and two
third places and the chief referee's signature, followed by the list of
competitors in that category.

### 5. Mats

Screen **Tatami**: choose the number of mats, then assign categories to them —
by hand, or with the button that spreads them evenly by competitor count.
Printing produces the schedule in the shape of the official document, unsigned.

### 6. Results

Screen **Rezultati** (results) groups entries by category. A placement is picked
from a menu and saved immediately, without confirmation. Points are never
entered — they are derived from the placement.

### 7. Ranking

Screen **Rang lista** (ranking) produces the club ranking and the competitor
ranking per age group, split by sex. Points won by a club's members belong to
the club.

**Završetak sezone** (close season) locks the season, opens the next one and
prints every list in a single job — each category as its own sheet. A closed
season can be reopened; nothing is frozen, so correcting a result still moves
the list afterwards.

### 8. Documents

A separate page (`documents.html`) holds four official documents laid out for A4:

| Document              | Orientation | Contents                                        |
| --------------------- | ----------- | ----------------------------------------------- |
| Lista po kategoriji   | portrait    | one drawn category, with a placement column      |
| Prijava kluba         | portrait    | one club's entries, with a confirmation column   |
| Ekipne prijave        | portrait    | teams as blocks, members under the leading row   |
| Pun spisak takmičara  | landscape   | all entries, by club then by surname             |

Beyond those, **every list in the application has a Štampaj (print) button**.
The rule is single: what reaches the paper is what is on the screen. A filter
that hides a row drops it from the printout as well, and whichever filter was
active is named in the sheet header — a list that conceals what it left out is
worse than no list at all.

---

## Screens

| Screen                  | Purpose                                                                     |
| ----------------------- | --------------------------------------------------------------------------- |
| **Kontrolna tabla**     | dashboard: current competition, figures derived from the entry register, and checks that find what needs correcting |
| **Takmičenja**          | competition register: create, select the current one, delete                 |
| **Uvoz prijava**        | read completed club forms and write them into the chosen competition         |
| **Takmičari**           | competitor list with medals and points; a name opens that person's record across all seasons |
| **Kategorije**          | *planned* — merging small categories and assigning entries by hand           |
| **Klubovi**             | competitors, medals and points per club                                      |
| **Žreb / Tabele**       | brackets per category, random draw and printing                              |
| **Tatami**              | assignment of categories to mats                                             |
| **Rezultati**           | placement entry, grouped by category                                         |
| **Rang lista**          | club and age-group rankings, closing the season                              |
| **Kalendar**            | competitions by month, A and B lists                                         |
| **Dokumenti**           | the four official documents for print                                        |
| **Podešavanja**         | *planned* — editing the rulebook from the application                        |

Screens are selected by hash route (`#zreb`, `#uvoz` …), so each is linkable and
survives a reload. An unknown route falls back to the dashboard.

---

## The rulebook

The federation's entire rulebook lives in **`assets/js/data.js`**. No other part
of the application knows the list of disciplines, age groups or body weight
classes — everything reads from there, so a rule change happens in one place.

### Age groups are computed, not transcribed

The official table is written in years of birth ("2019 and younger =
poletarci"), but the whole table **shifts by exactly one year every season**.
What does not change is the age: a *poletarac* is someone turning at most seven
that year.

So `AGES` holds ages, and years of birth are derived:

```js
{ code: 'A', name: 'Poletarci',     from: 0,  to: 7 },
{ code: 'H', name: 'Mlađi seniori', from: 21, to: 34 },
{ code: 'J', name: 'Veterani',      from: 50, to: 120 },
```

| Group | Age   | Season 2026      | Season 2027      |
| ----- | ----- | ---------------- | ---------------- |
| A     | 0–7   | 2019 and younger | 2020 and younger |
| B     | 8–9   | 2018/2017        | 2019/2018        |
| C     | 10–11 | 2016/2015        | 2017/2016        |
| D     | 12–13 | 2014/2013        | 2015/2014        |
| E     | 14–15 | 2012/2011        | 2013/2012        |
| F     | 16–18 | 2010–2008        | 2011–2009        |
| G     | 19–20 | 2007/2006        | 2008/2007        |
| H     | 21–34 | 2005–1992        | 2006–1993        |
| I     | 35–49 | 1991–1977        | 1992–1978        |
| J     | 50+   | 1976 and older   | 1977 and older   |

**A season is the year of the competition, not today's date.** A competition
held in 2025 still sorts by the 2025 table, so old results do not migrate into
other categories when the new year arrives. Importing an entry computes groups
from the season of the target competition, and says so above the file preview.

Group codes are written in Latin script (A–J) although the rulebook prints them
in Cyrillic (А Б Ц Д Е Ф Г Х И Ј): Barlow carries no Cyrillic, so on paper those
ten capitals fell back to a system font and set about twice as wide as the text
around them. The letters and their order are unchanged — only the script.

### Disciplines

Nineteen disciplines in two families. **Traditional** ones are the default and
carry no marker; **Fudokan sport** disciplines carry `style: 'sport'` and are
named accordingly, so they are distinguishable on every list without an extra
column.

An easily missed distinction: **traditional kumite is an absolute category**
with no weight classes, while **sport kumite has them**. That is why the basis
for splitting a category sits on the discipline itself (`drawBy`) rather than
being inferred from its name.

A new discipline is one object in `DISCIPLINES`:

```js
{ name: 'Kihon kata', kind: 'P', system: 'Bodovanje (flag system)',
  drawBy: null, groups: 'CDE', order: 13 }
```

| Field      | Meaning                                                                    |
| ---------- | -------------------------------------------------------------------------- |
| `name`     | the name used on official lists; also the identifier, so it must be unique  |
| `kind`     | `P` individual, `E` team, `P/E` both                                        |
| `system`   | competition system — printed as the subtitle of the category list           |
| `drawBy`   | how a category is split: `'weight'`, `'level'`, `'variant'` or `null`       |
| `style`    | `'sport'` for Fudokan sport disciplines                                     |
| `team`     | `{ min, max }` for team disciplines                                         |
| `variants` | kinds of team competing separately (enbu: male pair and mixed pair)         |
| `groups`   | codes of the age groups the discipline is open to                           |
| `order`    | position on lists and in menus                                              |

Nothing else changes — the dashboard, the checks, the filters, the draw and the
printed lists all pick the new discipline up on their own.

### Points

| Placement | Points |
| --------- | ------ |
| Gold      | 100    |
| Silver    | 75     |
| Bronze    | 50     |
| Taking part | 25   |

**Points are never stored as a number.** They are always derived from the
placement, so when the federation changes the scale, one edit recomputes every
earlier table as well. Only A-list competitions carry points.

---

## The Excel entry form

`form/FSS-Entry-Form.xlsx` is a **standalone file**: the federation sends it to
the clubs, coaches fill it in Excel and send it back. Two visible sheets —
**Prijava** (individual) and **Ekipno** (team) — plus a hidden **Pravilnik**
sheet holding the lookup lists.

The form walks the coach through the rulebook instead of expecting them to
remember it:

- **Club, city and coach are entered once**, in the header of the first sheet;
  the team sheet picks them up by formula.
- **Entry starts with the year of birth.** The *Grupa* and *Uzrast* columns are
  formulas and are not filled by hand, and the dropdown offers **only the
  disciplines possible for that age** — kumite never appears for a *poletarac*.
- **Body weight** depends on age group and sex and is entered only alongside
  Fudokan sport kumite.
- **Year of birth** is a dropdown covering one hundred years, computed for the
  requested season.
- **The name field accepts letters only**, plus space, hyphen and apostrophe;
  digits are rejected on entry.
- **The Provera column** verifies that the entry is complete and states in a
  full sentence what is missing.
- **Writing is possible only where intended** — both sheets are protected
  without a password, and only the input cells are unlocked.

The number of discipline columns is **computed** from the rulebook: as many as
the most permissive age group allows. The same holds for team member slots.

### Rebuilding the form

```bash
python3 form/build-entry-form.py          # current season
python3 form/build-entry-form.py 2027     # a given season
```

Requires `python3` with **XlsxWriter** (`pip install xlsxwriter`) and **node**.
The script does not transcribe the rulebook; it reads it from
`assets/js/data.js`, so the application and the form cannot drift apart. Before
finishing it inspects the raw XML of the generated file and aborts if it finds
anything Excel rejects.

> **Why XlsxWriter.** Three editions of this form were declared corrupt by Excel,
> which on "repair" stripped every data validation — the coach would receive a
> bare table with no dropdowns at all, while the identical file opened silently
> in LibreOffice. The causes were, in turn: an equals sign in `formula1`, a cell
> range inside a validation criterion, and a rewrite through LibreOffice which
> adds `operator` and a second formula to list validations. Hence the rule: **a
> file verified only in LibreOffice is not verified.**

---

## Seasonal maintenance

### Before the first real season: removing the demo data

The demo competitions sit in the same database as real ones, so **Klubovi** and
**Rang lista**, which aggregate across seasons, mix invented figures with actual
ones. Delete both demo competitions on the *Takmičenja* screen before starting
work — deleting a competition also removes its entries, competitors and teams.

### A new season

Nothing to do. The age table shifts on its own, because it is derived from ages.
The form for the new season is one command (see above).

### Changing the rulebook

Edit `assets/js/data.js`, then rebuild the form. If anything cached changes,
raise the version as well.

### Version and the offline cache

The version marker sits at the foot of the navigation (`APP_VERSION` in
`data.js`), kept in step with `CACHE` in `sw.js`. **Both are raised on every
change.** If the folder is refreshed and the old marker still shows on screen,
the browser is serving a stale version from cache — that marker is the only way
to notice without opening developer tools.

---

## Where the data lives

Data lives in the browser's **IndexedDB**, on the machine running the
application. It goes nowhere and nobody else has access to it.

Three consequences worth knowing:

1. **Data is bound to the address.** To a browser, `localhost:8787` and
   `localhost:8788` are two different places with two different databases. This
   is why `start.command` always targets the same port.
2. **Data is bound to the browser.** Opening the application in a different
   browser, or in a private window, yields an empty database.
3. **Clearing site data deletes the competitions.** There is no backup yet —
   exporting the database is on the list of unbuilt work. Until then, do not
   clear site data for the address the application runs on.

The database is named `fss-manager`. An earlier misspelling (`fss-menager`) is
migrated automatically on first launch and then removed.

---

## For developers

### File layout

```
index.html                    application shell and dashboard
documents.html                print module (its own view, its own rules)
start.command                 double-click launcher (local server + browser)
sw.js                         offline cache — raise CACHE on every change
manifest.webmanifest          PWA metadata

assets/css/fonts.css          local @font-face declarations
assets/css/industry.css       Industry design-system tokens
assets/css/app.css            shell, navigation, screens
assets/css/doc-sheet.css      the sheet itself — shared by app and documents
assets/css/documents.css      the documents page

assets/js/data.js             rulebook and demo register
assets/js/store.js            IndexedDB — the only seam to the data
assets/js/app.js              router and every screen
assets/js/import.js           reading a completed form into entries
assets/js/xlsx.js             .xlsx (zip + XML) with no library
assets/js/draw.js             draw rules
assets/js/doc-render.js       measuring, pagination and letterhead — shared renderer
assets/js/doc-page.js         the <doc-page> component (from the design project)
assets/js/documents.js        the four official documents
assets/js/print.js            the Štampaj button and the end-of-season print job

form/FSS-Entry-Form.xlsx      the form clubs fill in
form/build-entry-form.py      builds that form from the rulebook in data.js
```

No build step and no dependencies: HTML, CSS and ES modules, served as the
browser loads them. `industry.css` carries exactly one local change against the
design project — its Google Fonts `@import` was deleted, as that was the last
thing on the page reaching the network.

Code comments are currently in Serbian; they document decisions taken in
Serbian. Everything else — file names, folders, functions and constants — is in
English.

### Data model

```
people        one person, once. Lives above competitions and is how points
              accumulate across seasons.
competitors   that person at one competition (club, belt, age on the day)
entries       one entry = one competitor in one discipline
results       a placement on one entry; points are derived from it
teams         team entries
competitions  the competitions themselves
meta          current competition, mat plan, seasons
```

`assets/js/store.js` is the **only seam** between the application and its data.
Screens and documents do not know where data comes from; they call functions
there. The day a hall needs more than one device, a small server slots in behind
those same functions and nothing else changes.

### Printing

The application and the documents share one sheet (`doc-sheet.css`) and one
renderer (`doc-render.js`), so a list printed from a screen and an official
document come out of the printer as though the same federation produced them.

A new screen gains printing in one step: write a function returning
`{ spec, context, orientation }` and hand it to `setPrintable()` inside
`render()`. The button appears by itself. `print.js` knows nothing about
competitors or clubs.

Pagination is **measured, not assumed**: content is drawn into a probe sheet at
true A4 width and broken where it genuinely stops fitting.

### Reading .xlsx without a library

`assets/js/xlsx.js` opens a foreign Excel file in two steps, since .xlsx is a
zip full of XML: the zip is inflated with the built-in
`DecompressionStream('deflate-raw')`, and the XML is read with `DOMParser`.
Formulas are not evaluated — only cached values are read, and everything derived
is derived by the application anyway.

### Verification

`offline-check.js` (kept outside the package) is the standing check: it runs
headless Chromium through every screen, imports a form, prints the documents to
PDF and measures whether anything is clipped, whether the figures add up and
whether a single request went to the network.

```bash
node offline-check.js
```

The import fixture is built **from the same form** that is distributed to clubs,
which incidentally verifies that its sheets and column headers are where the
reader expects them. Years of birth in the check are computed from ages rather
than hard-coded — otherwise the fixture would drift into another age group
within months and fail on its own.

---

## Not built yet

In order of how much each one hurts:

1. **Teams have no placements or points.** They import, appear on lists and can
   be drawn and printed — but the results screen has no team categories, so they
   can win neither medals nor points.
2. **A single row cannot be corrected.** An imported entry cannot be edited or
   deleted individually; the only way out is deleting the whole competition and
   importing again.
3. **Sport kumite weight classes are provisional** — until the official table
   arrives they mirror the traditional ones.
4. **There is no backup.** Exporting and importing the whole database (or a
   single competition) does not exist yet.
5. **The П/П marker** for competitors with special needs, required by the
   official table, has not been introduced.
6. **The Kategorije and Podešavanja screens** remain plans, each with a
   description of what belongs there.
7. **Excel still reports a repair** when the form is opened. The file works
   correctly afterwards — dropdowns, derived columns and checks are all in
   place — but the cause has not been established.
