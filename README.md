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
`file://` address).

The script always targets **the same port (8787)**, because data is bound to the
address: competitions entered on 8787 do not exist on 8788. On startup it asks
the port what it is serving:

- **this same version** — the application is already running, so it just opens it;
- **an older version of ours** — a server left behind by an earlier copy of the
  folder. It is stopped and this one takes over the same port, so the data stays
  where it was. Without this the browser keeps showing the old build while the
  folder on disk is current.
- **another program** — the script moves to the next free port and says so
  explicitly, warning that earlier competitions will not be visible there.

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
- **Names are written the way names are written.** However a club types it —
  `MARKO MARKOVIĆ`, `marko marković` — it is stored with only the first letter
  of each part capitalised, hyphenated surnames included. This is about how the
  name reads on a list, a diploma and a bill; recognising the person never
  depended on capitalisation, since identity compares in lower case.
- **A person is identified by name, year of birth and club.** The federation
  issues licence numbers and the database prefers one when present, but until
  they are in hand this is the most precise identification available, and it is
  what the import matches on. Somebody entered again by the same club — this
  season or three seasons ago — is recognised, and their points accumulate on one
  ranking row.
- **The same name and year under a different club is a different person.** That
  is the point of having the club in there: two clubs really do enter two
  different children of the same name and birth year, and nothing else can tell
  them apart. The cost is deliberate and stated: somebody who changes clubs
  starts a new record, with points from zero. The import never decides that
  quietly — it names every such case with both clubs, so the editor knows whether
  they are looking at a namesake or a transfer.
- **Importing the same file twice creates no duplicates**, so a club may send a
  corrected form.
- **A file that is not a form does not abort the import** — it appears in the
  summary table with its own message while the rest import normally.

### 4. Correcting an entry

Clubs make mistakes: a wrong sex, a mistyped year of birth, a discipline entered
for an age that does not run it. Screen **Takmičari** carries an *Izmeni* button
on every row while entries are open, and it corrects the whole entry — name,
club, sex, year, belt, body weight and the disciplines themselves, or removes
the competitor from the competition altogether.

**Disciplines are ticked, not typed.** The dialog lists every discipline the age
group runs; ticking one adds that entry, unticking removes it — which is what
somebody wanting one more discipline, or having entered one too many, actually
needs. Removing an entry removes any placement recorded on it.

**+ Nova prijava** writes a competitor who is not on the list at all — the club
that turns up on the day with one more child. It takes the same path as the
import, down to recognising somebody who has competed before, so an entry means
the same thing however it arrived. Somebody already entered is refused with the
club they are entered for: that is a correction, not a second entry.

**Nothing is corrected in isolation.** The dialog re-derives everything that
follows from what changed: the age group from the year, the level from the belt,
the disciplines from the age group, the weight classes from group and sex. A
discipline that does not exist for the new age group is dropped from the offer as
the year is changed, rather than staying quietly recorded. Corrections take the
same path as the import, so an entry means the same thing however it arrived.

The correction reaches everywhere the entry is repeated: the competitor record,
every one of their entry rows, their placements, and their details inside any
team they are a member of. If the correction turns them into somebody the
database already knows — which is exactly what fixing a mistyped year does — the
entry is re-linked to that person, so the points land on the right ranking row.

> **Entries freeze when they close.** Moving the competition to *Prijave
> zatvorene* (entries closed) on the dashboard ends both correcting and importing:
> what has been printed and what is in the database are then the same thing.
> Returning it to *Prijave otvorene* unlocks both.

### 5. The draw

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

### 6. Mats

Screen **Tatami**: choose the number of mats, then assign the programme to them.

The unit being scheduled is **one discipline of one age group** — exactly what
runs on a mat in one slot. The screen groups those units two ways, and the
switch decides which:

- **po uzrastu** — a card is an age group, holding its disciplines;
- **po disciplini** — a card is a discipline, holding its age groups.

Assigning a card moves everything it contains, so *sport kumite for every age
group on mat 1, everything else on mat 2* is a handful of clicks in the
discipline view. An age group whose disciplines end up on different mats appears
on each of them, showing only what runs there — and the printed schedule says
the same. The **Rasporedi ravnomerno** button splits the cards of the current
view evenly by competitor count.

Printing produces the schedule in the shape of the official document, unsigned,
and aims at **one sheet**. Each mat is a column that flows on its own, so a mat
carrying sixteen slots no longer stretches the ones carrying six; the renderer
then picks the paper — landscape first for three mats or more, portrait when the
tallest column needs the height — and tightens the schedule's own type a little
if neither orientation fits. Only when a schedule genuinely cannot fit does it
continue on a second sheet, each mat resuming under its own heading.

### 7. Results

Screen **Rezultati** (results) groups entries by category. A placement is picked
from a menu and saved immediately, without confirmation. Points are never
entered — they are derived from the placement.

**A category awards one first place, one second and two thirds.** Once a place
is taken it **disappears from the menu** in the remaining rows of that category —
it is not greyed out, it is simply not offered — so a second gold cannot be
recorded at all. The row holding a place keeps seeing it, so a placement can
always be changed or withdrawn. Two disciplines are exempt, since they are
scored rather than drawn: **Kihon u mestu** and **Tamashiwari** accept any
number of identical placements.

**Most competitors take part without placing**, so the screen offers a
**Svima učešće** button: it records *taking part* on every entry on screen that
has no placement yet, leaving existing placements untouched. With a filter
active it applies only to what the filter shows. From there, only the medallists
are changed. The button disappears once every entry has a placement.

Because taking part is worth points, press it on competition day rather than
when the entries are imported — otherwise the ranking credits points for a
competition that has not been held.

**Results print per category and per discipline.** Diplomas are written as each
category finishes, not when the whole competition does, so each category has its
own Štampaj button and each discipline has one that prints all of its categories,
each on its own sheet. Rows are ordered by place — first, second, two thirds,
then the rest — which is the order the diplomas are filled in.

### 8. Diplomas

Diplomas are printed in advance, in bulk, with the wording already on them and
the lines left blank. Screen **Diplome** fills those blanks: it prints **only
the text**, on paper that is otherwise the federation's own pre-printed
diploma — no letterhead, no title, no footer, one sheet per medallist.

Five fields can be written: name, club, place, discipline and category. Each has
its own **measurements in millimetres** — how far down from the top edge of the
sheet, how far left (−) or right (+) of centre — and its own type size in points,
because the blank being filled is the printer's, not the application's. Any field
can be switched off: a diploma that already says *Kate* in print does not need it
written again. Two fields set at the same height sit side by side, which is what a
line reading *…osvaja ___ mesto u disciplini ___* needs; neither can run into the
other, because each is held to half the gap between them.

The measurements are a property of the blank, not of the competition, so they are
measured once and kept. Two buttons do the measuring:

- **Probni list sa lenjirom** prints a plain sheet ruled in millimetres down both
  edges and across the centre, with a sample entry at the current measurements
  and the instructions printed on the sheet itself. Hold it against a diploma up
  to the light, read off where each line sits, type those numbers in.
- **Probna diploma** prints one real medallist at the current measurements — one
  blank spent to confirm the aim before the rest go through.

Then each category prints on its own, as it finishes, exactly like the results
lists: only the medallists, in the order the diplomas are handed out — first,
second, two thirds.

Print at **100 % scale with no page fitting**; anything else moves every
measurement. The test sheet says so in print, where it is read.

### 9. Ranking

Screen **Rang lista** (ranking) produces the club ranking and the competitor
ranking per age group, split by sex. Points won by a club's members belong to
the club.

> **Points are posted when the competition is closed.** A competition that is
> still running contributes medals — they are counted the moment a placement is
> recorded — but no points: not to a competitor's total, not to the club screen,
> not to the ranking. Closing it on the dashboard posts them, and the competitors
> whose first appearance this was join the ranking at that moment. The ranking
> names any competition in the season that is still waiting, so nothing goes
> missing quietly.

**Završetak sezone** (close season) locks the season, opens the next one and
prints every list in a single job — each category as its own sheet. A closed
season can be reopened; nothing is frozen, so correcting a result still moves
the list afterwards.

### 10. Entry fees

Screen **Podešavanja** (settings) holds the price list: the fee **per entry**
(somebody in three disciplines pays three), the fee **per team**, a separate one
for **enbu** since it is a pair, and the percentage refunded to the coach.

The older age groups get an allowance: the first three disciplines free, for the
groups ticked there — but **not every discipline can be free.** Tamashiwari and
Tsumeai are always paid, as is every team entry, so the allowance only ever
consumes disciplines that are allowed to be free. Both the count, the groups and
the always-paid list are settings, not code.

Document **Kotizacije** turns that into a bill, one per club: a row per
competitor — the name appears once, not once per discipline — with how many
entries they have, how many were free, how many fees they owe and the amount.
Teams follow as their own rows, each naming its members, since a team is paid as
a whole. The totals row adds the columns up, and reads straight: entries minus
free equals fees. Under it, the coach's refund and the amount actually payable,
above the club's and the federation's signatures.

Amounts start at zero on purpose — the application does not invent a price. Until
they are entered, the sheet says so in its header.

### 11. Documents

A separate page (`documents.html`) holds the official documents laid out for A4:

| Document                 | Orientation | Contents                                                    |
| ------------------------ | ----------- | ----------------------------------------------------------- |
| Prijave po klubovima     | portrait    | one document per club — its entries and teams, with a confirmation column |
| Kotizacije               | portrait    | one bill per club — fees per competitor, teams, refund and amount payable |
| Prijave po kategorijama  | portrait    | one document per category, with a placement column           |
| Prijave po disciplinama  | portrait    | one document per discipline, its categories one after another |
| Ekipne prijave           | portrait    | teams as blocks, members under the leading row               |
| Pun spisak takmičara     | landscape   | all entries, by club then by surname                         |

On competition day this page stays open in its own window while corrections are
made in the application, so it **re-reads the register whenever you come back to
it** and re-lays the sheet only when something has actually changed. The second
printout is therefore the corrected one — the sheet that gets signed says what
the database says.

The first three print **each part on its own sheet, with its own page
numbering** — *Strana 1 / 4* starts again at every club, because whoever holds
the sheet for one club wants to know how long that list is, not where it happens
to sit in a stack of forty. The picker beside the document tabs switches between
*sve odvojeno* (all of them, one after another) and a single club, category or
discipline, and the choice is part of the address, so a particular club's entry
sheet is a link.

**A club's entry sheet is signed by two parties** — *Predstavnik kluba* and
*Predstavnik saveza* — since the club hands the list over and the federation
receives it. Everything else carries the referees' block: *Glavni sudija* and
*Delegat saveza*. Signatures print on the last sheet of each document, never in
the middle of one.

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
| **Takmičari**           | competitor list with medals and points; a name opens that person's record across all seasons, *Izmeni* corrects an entry and *+ Nova prijava* writes a new one, while entries are open |
| **Klubovi**             | competitors, medals and points per club                                      |
| **Žreb / Tabele**       | brackets per category, random draw and printing                              |
| **Tatami**              | assignment of categories to mats                                             |
| **Rezultati**           | placement entry, grouped by category                                         |
| **Diplome**             | overprinting medallists' details onto pre-printed blank diplomas             |
| **Rang lista**          | club and age-group rankings, closing the season                              |
| **Kalendar**            | competitions by month, A and B lists                                         |
| **Dokumenti**           | entry sheets per club, category and discipline, plus the team and full lists |
| **Podešavanja**         | entry-fee price list and the free-discipline rule, plus the storage-protection status of the database; the rest of the rulebook still lives in `data.js` |

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
change.**

The service worker serves **network-first with a cache fallback**. For this
application that is the only sane order: the server is on localhost, so the
network costs nothing and the browser can never show yesterday's build. The
cache answers only when the server is not running — the genuinely offline case.
`start.command` closes the other half of the same problem by refusing to reuse a
port held by an older copy of the application.

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

On every launch the application asks the browser to treat its storage as
**persistent**, so the database is not swept away when the browser frees disk
space on its own. Whether the browser has granted this — and how much space
the database takes — is shown under **Podešavanja**. Manually clearing site
data still deletes everything; persistence only guards against automatic
eviction.

The database is named `fss-manager`. An earlier misspelling (`fss-menager`) is
migrated automatically on first launch and then removed.

---

## For developers

### File layout

```
index.html                    application shell and dashboard
documents.html                print module (its own view, its own rules)
start.command                 double-click launcher (local server + browser)
offline-check.js              the standing check (see Verification)
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

`offline-check.js` in the repository root is the standing check. In the spirit
of the application it has **no dependencies**: the .xlsx fixture is written by
patching the zip through Node's `zlib`, and headless Chrome is driven over the
raw DevTools protocol. It needs Node 22+, python3 and Google Chrome — nothing
is installed.

```bash
node offline-check.js
node offline-check.js --keep   # keep the working folder with the printed PDFs
```

What it asserts: every screen opens without a console error; a club form filled
from the same `form/FSS-Entry-Form.xlsx` that is distributed to clubs imports
correctly — and **imports twice without creating a duplicate**; the dashboard
figures equal what is actually in the database; every document type prints to
PDF with nothing clipped on any sheet; and not a single request leaves the
local server.

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
   can win neither medals nor points, and no diploma is printed for them.
2. **Sport kumite weight classes are provisional** — until the official table
   arrives they mirror the traditional ones.
3. **There is no backup.** Exporting and importing the whole database (or a
   single competition) does not exist yet.
4. **The П/П marker** for competitors with special needs, required by the
   official table, has not been introduced.
5. **The rulebook has no screen.** **Podešavanja** holds the fee price list,
   but the rest of the rulebook — age groups, disciplines, weight classes — is
   still edited in `data.js`.
6. **Excel still reports a repair** when the form is opened. The file works
   correctly afterwards — dropdowns, derived columns and checks are all in
   place — but the cause has not been established.
