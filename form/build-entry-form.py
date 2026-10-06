#!/usr/bin/env python3
"""
Builds the Excel entry form the clubs fill in.

Three rules hold the form together:

- Nothing that can be a menu is typed: year, sex, belt, discipline,
  weight and team variant are dropdowns. Only club, city, coach and
  names are typed, because the rulebook does not know them.
- Age is computed, not entered: group and age name are formulas from the
  birth year, and the discipline menu depends on the group.
- Writing goes only where intended: the sheet is locked except for the
  input fields.

=== Why XlsxWriter, not openpyxl ========================================

Three editions of this form Excel declared corrupted and, in "repairing"
them, dropped every validation rule — while LibreOffice opened the same
file without a word. The causes, in order: an equals sign in formula1, a
range inside a rule, and a "safety" re-save through LibreOffice that
adds an operator and a second formula to lists. Hence XlsxWriter, and
verify() at the end reads the raw XML and stops on any known trap.

=== Maintenance =========================================================

The rulebook must live in two places at once — the app and this file's
menus. To keep them from drifting, the script copies nothing: it reads
disciplines, groups and weights from assets/js/data.js through Node.
Birth years are computed per season, so next year's form is one command:

    python3 form/build-entry-form.py          # current season
    python3 form/build-entry-form.py 2027     # next one

Needs: python3 + XlsxWriter (pip install xlsxwriter) and node.
"""

import datetime
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import xlsxwriter

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = Path(__file__).resolve().parent / 'FSS-Entry-Form.xlsx'

ROWS = 120          # how many blank rows the form offers
SPISAK = 5000       # how many FSS IDs the list sheet can hold (entry-form.js writes it)
KLUBOVI = 500       # how many clubs the header's menu can offer

# === The rulebook from the app =============================================


def rulebook(season):
    """
    Reads the rulebook from data.js for the given season. Age groups are
    stored as age ranges, so birth years come out computed — next year's
    form takes one command and no retyped years.
    """
    kod = (
        "import('./assets/js/data.js').then(m => console.log(JSON.stringify({"
        f"AGES: m.AGES.map(a => ({{code: a.code, name: a.name,"
        f" od: m.yearsOf(a, {season}).najstarije, oznaka: m.yearsLabel(a, {season})}})),"
        "BELTS: m.BELTS, WEIGHTS: m.WEIGHTS, CLUBS: m.CLUBS.map(c => c.name),"
        "DISCIPLINES: m.DISCIPLINES.map(d => ({name: d.name, groups: d.groups,"
        " drawBy: d.drawBy, team: d.team || null, variants: d.variants || null}))"
        "})))"
    )
    out = subprocess.run(['node', '-e', kod], cwd=ROOT, capture_output=True, text=True)
    if out.returncode:
        sys.exit(f'Ne mogu da pročitam data.js:\n{out.stderr}')
    p = json.loads(out.stdout)
    p['pojedinacne'] = [d for d in p['DISCIPLINES'] if not d['team']]
    p['ekipne'] = [d for d in p['DISCIPLINES'] if d['team']]
    return p


def discipline_columns(p):
    """As many discipline columns as the biggest age group may enter."""
    return max(len([d for d in p['pojedinacne'] if a['code'] in d['groups']])
               for a in p['AGES'])


def team_slots(p):
    """The largest team in the rulebook — that many member slots."""
    return max(d['team']['max'] for d in p['ekipne'])


def column_letter(i):
    """0 → A, 25 → Z, 26 → AA."""
    ime = ''
    i += 1
    while i:
        i, o = divmod(i - 1, 26)
        ime = chr(65 + o) + ime
    return ime


# === Formula checks =============================================

# What a name may contain: our Latin letters, space, hyphen, apostrophe.
ALLOWED_CHARS = ("ABCDEFGHIJKLMNOPQRSTUVWXYZ"
              "abcdefghijklmnopqrstuvwxyz"
              "ČĆĐŠŽčćđšž -'")
NAME_LENGTH = 60


def letters_only(cell):
    """
    True when the cell holds nothing but letters, spaces, hyphens and
    apostrophes. The name is padded to a fixed length first, because
    FIND("") behaves differently in Excel and LibreOffice. Goes only in
    the "Provera" column — arrays are not allowed in validation rules.
    """
    return (f'SUMPRODUCT(--ISERROR(FIND(MID({cell}&REPT("a",{NAME_LENGTH}),'
            f'ROW($A$1:$A${NAME_LENGTH}),1),"{ALLOWED_CHARS}")))=0')


def no_digits(cell):
    """
    A check that may live in a validation rule: no digits. Excel accepts
    neither ranges nor arrays there and caps formulas at 255 characters,
    so this is ten separate FINDs over one cell. Other characters are
    left to the "Provera" column and the app's import.
    """
    checks = ','.join(f'ISERROR(FIND("{d}",{cell}))' for d in range(10))
    return f'AND({checks})'


def fss_format(cell):
    """
    True when the cell reads FSS-<number>/<two digits>, the way the
    federation's list prints it. Only the shape is checked — whose ID it
    is, the app checks on import. IFERROR because Excel's AND does not
    stop at the first FALSE, and VALUE of a non-number is an error.
    """
    number = f'MID({cell},5,LEN({cell})-7)'
    return (f'IFERROR(AND(UPPER(LEFT({cell},4))="FSS-",MID({cell},LEN({cell})-2,1)="/",'
            f'ISNUMBER(VALUE(RIGHT({cell},2))),VALUE({number})>=1,'
            f'VALUE({number})=INT(VALUE({number}))),FALSE)')


def first_failing(checks, ok):
    """
    The "Provera" sentence: the message of the first check that holds,
    else `ok`. Built as nested IFs from a list, so adding a check never
    means counting closing brackets. A message is a formula expression —
    a quoted text, or text joined with &.
    """
    formula = f'"{ok}"'
    for condition, message in reversed(checks):
        formula = f'IF({condition},{message},{formula})'
    return formula


def group_formula(birth_year):
    return f'IF({birth_year}="","",LOOKUP({birth_year},INDEX(grupe,0,1),INDEX(grupe,0,2)))'


def age_name_formula(group):
    return f'IF({group}="","",VLOOKUP({group},INDEX(grupe,0,2):INDEX(grupe,0,3),2,FALSE))'


# === Styles =============================================

def styles(wb):
    """Everything both sheets use, in one place."""
    return {
        'naslov': wb.add_format({'bold': True, 'font_size': 14, 'font_name': 'Calibri'}),
        'sitno': wb.add_format({'italic': True, 'font_size': 9, 'font_color': '#6B6B70',
                                'font_name': 'Calibri'}),
        'uputstvo': wb.add_format({'italic': True, 'font_size': 9, 'font_color': '#6B6B70',
                                   'font_name': 'Calibri', 'text_wrap': True, 'valign': 'top'}),
        'polje': wb.add_format({'bold': True, 'font_size': 10, 'font_name': 'Calibri'}),
        'zaglavlje': wb.add_format({
            'bold': True, 'font_size': 9, 'font_color': 'white', 'bg_color': '#5980A6',
            'border': 1, 'border_color': '#D4D4D7', 'align': 'center', 'valign': 'vcenter',
            'text_wrap': True, 'font_name': 'Calibri'}),
        # Only the fields written into are unlocked.
        'unos': wb.add_format({'locked': False, 'border': 1, 'border_color': '#D4D4D7',
                               'font_size': 10, 'font_name': 'Calibri'}),
        'izvedeno': wb.add_format({'border': 1, 'border_color': '#D4D4D7', 'bg_color': '#EEF6FF',
                                   'align': 'center', 'font_size': 10, 'font_name': 'Calibri'}),
        'provera': wb.add_format({'border': 1, 'border_color': '#D4D4D7', 'font_size': 9,
                                  'font_name': 'Calibri'}),
    }


def lock_sheet(ws, header_row):
    """
    Locks the sheet, leaving only what makes sense to touch. No password
    — a fence, not a lock: it keeps text out of cells nobody will look
    in, and the federation can still open the sheet.
    """
    ws.protect('', {'format_columns': True, 'format_rows': True,
                    'select_locked_cells': True, 'select_unlocked_cells': True})
    ws.set_landscape()
    ws.fit_to_pages(1, 0)
    ws.repeat_rows(header_row)


# === Hidden rulebook sheet =============================================

def write_rulebook(wb, p):
    """The lists the dropdown menus live on, as named ranges."""
    ws = wb.add_worksheet('Pravilnik')
    ws.hide()

    # Age groups: lower year bound → code and name. LOOKUP wants
    # ascending bounds, so they go oldest to youngest.
    ws.write_row(0, 0, ['od godišta', 'grupa', 'uzrast'])
    for i, age in enumerate(sorted(p['AGES'], key=lambda a: a['od']), start=1):
        ws.write_row(i, 0, [age['od'], age['code'], age['name'].lower()])
    wb.define_name('grupe', f"=Pravilnik!$A$2:$C${len(p['AGES']) + 1}")

    kolona = [4]  # from column E on

    def spisak(ime, vrednosti):
        c = kolona[0]
        ws.write(0, c, ime)
        for i, v in enumerate(vrednosti, start=1):
            ws.write(i, c, v)
        if vrednosti:
            s = column_letter(c)
            wb.define_name(ime, f'=Pravilnik!${s}$2:${s}${len(vrednosti) + 1}')
        kolona[0] += 1

    spisak('godista', [p['sezona'] - i for i in range(100)])
    spisak('pojasevi', p['BELTS'])
    spisak('polovi', ['muški', 'ženski'])

    # Fallback lists: until a year is picked the menu must offer
    # something — Excel reports an empty list source as an error.
    spisak('sve_discipline', [d['name'] for d in p['pojedinacne']])
    spisak('sve_ekipne', [d['name'] for d in p['ekipne']])
    sve_kilaze = []
    for age in p['AGES']:
        for sex in ('M', 'Ž'):
            for w in p['WEIGHTS'][age['code']][sex]:
                if w not in sve_kilaze:
                    sve_kilaze.append(w)
    spisak('sve_kilaze', sve_kilaze)

    for age in p['AGES']:
        code = age['code']
        spisak(f'disc_{code}', [d['name'] for d in p['pojedinacne'] if code in d['groups']])
        spisak(f'tdisc_{code}', [d['name'] for d in p['ekipne'] if code in d['groups']])
        for sex, kljuc in (('M', 'M'), ('Ž', 'Z')):
            spisak(f'kg_{code}_{kljuc}', p['WEIGHTS'][code][sex])

    # Team size per discipline — for the member-count check.
    c = kolona[0]
    ws.write_row(0, c, ['ekipa', 'min', 'max'])
    for i, d in enumerate(p['ekipne'], start=1):
        ws.write_row(i, c, [d['name'], d['team']['min'], d['team']['max']])
    wb.define_name('ekipe',
                   f'=Pravilnik!${column_letter(c)}$2:${column_letter(c + 2)}${len(p["ekipne"]) + 1}')
    kolona[0] += 3

    # Team variants: enbu has men's and mixed pairs, the rest one sex.
    vrste = ['muškarci', 'žene']
    for d in p['ekipne']:
        for v in (d['variants'] or []):
            if v['label'] not in vrste:
                vrste.append(v['label'])
    spisak('vrste', vrste)

    ws.protect()
    return ws


# === Hidden list of competitors =============================================

SPISAK_KOLONE = ('id', 'ime', 'prezime', 'godiste', 'pol', 'pojas', 'klub')


def write_roster(wb, p):
    """
    The federation's list of competitors by FSS ID — what a row on the
    Prijava sheet fills itself from once the coach types an ID. Empty in
    this file: the app writes the current list into a copy before it is
    sent (Uvoz prijava → Formular za klubove, assets/js/entry-form.js).
    Column I holds the clubs the header's menu offers — those from
    data.js, until the app writes its own.
    """
    ws = wb.add_worksheet('Spisak')
    ws.hide()
    ws.write_row(0, 0, ['FSS ID', 'Ime', 'Prezime', 'Godište', 'Pol', 'Pojas', 'Klub'])
    ws.write(0, 8, 'Klubovi')
    for i, klub in enumerate(p['CLUBS'], start=1):
        ws.write(i, 8, klub)

    for k, ime in enumerate(SPISAK_KOLONE):
        s = column_letter(k)
        wb.define_name(f'spisak_{ime}', f'=Spisak!${s}$2:${s}${SPISAK + 1}')
    # Only as long as the list, so the menu shows no empty lines.
    wb.define_name('klubovi',
                   f'=OFFSET(Spisak!$I$2,0,0,MAX(1,COUNTA(Spisak!$I$2:$I${KLUBOVI + 1})),1)')

    ws.protect()
    return ws


# === Sheet: individual entries =============================================

def sheet_individual(wb, p, s):
    ws = wb.add_worksheet('Prijava')
    n_disc = discipline_columns(p)

    # Who it is comes first — FSS ID, first name, surname, each in its own
    # column, so a row is checked at a glance — then everything else.
    K_FSS, K_IME, K_PREZIME, K_GOD, K_POL, K_POJAS, K_GRUPA, K_UZRAST = range(8)
    K_DISC = 8
    K_KILAZA = K_DISC + n_disc
    K_PROVERA = K_KILAZA + 1
    K_POMOC_D = K_PROVERA + 1
    K_POMOC_K = K_PROVERA + 2
    # The typed ID's row on the list, or 0; and the same only when that
    # competitor is of the club in the header — only then does a row fill.
    K_NADJEN = K_PROVERA + 3
    K_SVOJ = K_PROVERA + 4

    kolone = [('FSS ID', 13), ('Ime', 16), ('Prezime', 18), ('Godište', 10), ('Pol', 10),
              ('Pojas', 11), ('Grupa', 8), ('Uzrast', 16)]
    kolone += [(f'Disciplina {i + 1}', 20) for i in range(n_disc)]
    kolone += [('Telesna težina', 12), ('Provera', 34)]
    for i, (naslov, sirina) in enumerate(kolone):
        ws.set_column(i, i, sirina)
    ws.set_column(K_POMOC_D, K_SVOJ, 14, None, {'hidden': True})

    ws.write(0, 0, 'PRIJAVA TAKMIČARA', s['naslov'])
    # The edition in plain sight — it tells a fresh file from an old one
    # left in the mail or in Downloads.
    ws.write(1, 0, 'Fudokan savez Srbije · popunjava klub i dostavlja savezu · '
                   f'takmičarska sezona {p["sezona"]}. · '
                   f'izdanje {datetime.date.today().strftime("%d.%m.%Y.")}', s['sitno'])
    ws.set_row(2, 52)
    ws.merge_range(2, 0, 2, K_PROVERA, (
        'Klub se bira u zaglavlju. Za takmičara koji već ima FSS ID dovoljno je upisati ID — '
        f'za {p["sezona"]}. godinu, a dok ga takmičar nema, prošlogodišnji: ime, prezime, '
        'godište, pol i pojas popunjavaju se sami sa spiska saveza, a bira se samo disciplina. '
        'Pojas treba ispraviti ako je takmičar u međuvremenu polagao. Takmičar koji nastupa '
        'prvi put nema ID: njemu se upisuju ime i prezime, svako u svoju kolonu, i ostali '
        'podaci, a nov ID dodeljuje savez. Uzrasna grupa i naziv uzrasta izvode se iz godišta, '
        'a padajući meni nudi discipline koje su moguće u odnosu na uzrast. Telesna težina '
        'unosi se isključivo uz Fudokan sport kumite, budući da je tradicionalni kumite '
        'apsolutna kategorija. Kolona „Provera" služi za proveru kompletnosti prijave. Ekipne '
        'prijave se unose na listu „Ekipno".'),
        s['uputstvo'])

    for red, ime, napomena in ((3, 'Klub', 'bira se sa spiska; nov klub upisuje pun naziv, '
                                           'onako kako se navodi u rezultatima'),
                               (4, 'Grad', ''),
                               (5, 'Trener', ''),
                               (6, 'Takmičenje', 'naziv takmičenja za koje se prijava podnosi')):
        ws.write(red, 0, ime, s['polje'])
        ws.write_blank(red, 1, None, s['unos'])
        if napomena:
            ws.write(red, 3, napomena, s['sitno'])
    # The club decides whose rows fill, so it is picked, not retyped. A club
    # not on the list is still accepted — with a question first.
    ws.data_validation(3, 1, 3, 1, {
        'validate': 'list', 'source': '=klubovi', 'ignore_blank': True, 'dropdown': True,
        'error_type': 'warning', 'error_title': 'Klub',
        'error_message': 'Ovog kluba nema na spisku saveza. Ako je klub nov, potvrdi upis.'})

    ZAGLAVLJE = 9                      # Excel row 10
    ws.set_row(ZAGLAVLJE, 30)
    for i, (naslov, _) in enumerate(kolone):
        ws.write(ZAGLAVLJE, i, naslov, s['zaglavlje'])

    prvi, posl = ZAGLAVLJE + 1, ZAGLAVLJE + ROWS
    fss, ime, prezime, god, pol, pojas, grupa = (
        column_letter(k) for k in (K_FSS, K_IME, K_PREZIME, K_GOD, K_POL, K_POJAS, K_GRUPA))
    disc_od, disc_do = column_letter(K_DISC), column_letter(K_DISC + n_disc - 1)
    kg, pomoc_d, pomoc_k = column_letter(K_KILAZA), column_letter(K_POMOC_D), column_letter(K_POMOC_K)
    nadjen, svoj = column_letter(K_NADJEN), column_letter(K_SVOJ)
    primer = f'FSS-12/{p["sezona"] % 100:02d}'

    for r in range(prvi, posl + 1):
        e = r + 1                      # the row number as Excel sees it
        for c in [K_FSS] + list(range(K_DISC, K_KILAZA + 1)):
            ws.write_blank(r, c, None, s['unos'])

        # The ID looked up on the list. A competitor of another club does
        # not fill the row: a mistyped number then lands on a stranger, and
        # the import would take it for a transfer. Such a row is written
        # by hand, and the import checks the name against the ID.
        ws.write_formula(r, K_NADJEN,
                         f'=IF(${fss}{e}="",0,IFERROR(MATCH(TRIM(${fss}{e}),spisak_id,0),0))', None, 0)
        ws.write_formula(r, K_SVOJ, (
            f'=IF(${nadjen}{e}=0,0,'
            f'IF(TRIM(INDEX(spisak_klub,${nadjen}{e}))=TRIM($B$4),${nadjen}{e},0))'), None, 0)
        # What fills itself is a formula in a cell open for typing: a
        # newcomer's row is simply typed over it.
        for k, polje in ((K_IME, 'ime'), (K_PREZIME, 'prezime'), (K_POL, 'pol'), (K_POJAS, 'pojas')):
            ws.write_formula(r, k, f'=IF(${svoj}{e}=0,"",INDEX(spisak_{polje},${svoj}{e})&"")',
                             s['unos'], '')
        ws.write_formula(r, K_GOD, f'=IF(${svoj}{e}=0,"",INDEX(spisak_godiste,${svoj}{e}))',
                         s['unos'], '')

        ws.write_formula(r, K_GRUPA, f'={group_formula(f"${god}{e}")}', s['izvedeno'], '')
        ws.write_formula(r, K_UZRAST, f'={age_name_formula(f"${grupa}{e}")}', s['izvedeno'], '')

        disc = f'{disc_od}{e}:{disc_do}{e}'
        # In the order of the columns, so the sentence names the first
        # thing a coach meets that is wrong.
        provera = first_failing([
            (f'AND(${fss}{e}<>"",NOT({fss_format(f"${fss}{e}")}))',
             f'"FSS ID se upisuje u obliku {primer}"'),
            (f'AND(${fss}{e}<>"",TRIM($B$4)="")',
             '"Klub nije izabran u zaglavlju — bez njega se red ne popunjava"'),
            (f'AND(${fss}{e}<>"",${nadjen}{e}=0,${ime}{e}="")',
             '"FSS ID nije na spisku saveza — upiši ime, prezime i ostale podatke"'),
            (f'AND(${nadjen}{e}>0,${svoj}{e}=0,${ime}{e}="")',
             f'"FSS ID pripada takmičaru kluba "&INDEX(spisak_klub,${nadjen}{e})'
             f'&" — ako je prešao u vaš klub, upiši ime i prezime"'),
            (f'${ime}{e}=""', '"Nedostaje ime"'),
            (f'NOT({letters_only(f"${ime}{e}")})', '"Ime sadrži znakove koji nisu slova"'),
            (f'${prezime}{e}=""', '"Nedostaje prezime"'),
            (f'NOT({letters_only(f"${prezime}{e}")})', '"Prezime sadrži znakove koji nisu slova"'),
            (f'${god}{e}=""', '"Nedostaje godište"'),
            (f'${grupa}{e}=""', '"Godište nije obuhvaćeno uzrasnom tabelom"'),
            (f'${pol}{e}=""', '"Nedostaje pol"'),
            (f'${pojas}{e}=""', '"Nedostaje pojas"'),
            (f'COUNTA({disc})=0', '"Nije izabrana nijedna disciplina"'),
            # A discipline outside the age: the menu does not offer it,
            # but it can arrive typed or before the year was picked.
            (f'SUMPRODUCT(--({disc}<>""),--(COUNTIF(INDIRECT("disc_"&${grupa}{e}),{disc})=0))>0',
             f'"Izabrana disciplina nije moguća za uzrast "&${grupa}{e}'),
            (f'AND(COUNTIF({disc},"Fudokan sport kumite")>0,{kg}{e}="")',
             '"Nedostaje telesna težina za Fudokan sport kumite"'),
            (f'AND(COUNTIF({disc},"Fudokan sport kumite")=0,{kg}{e}<>"")',
             '"Telesna težina se unosi isključivo uz Fudokan sport kumite"'),
        ], 'prijava je kompletna')
        # Empty means nothing written: COUNTA would count the fill-in
        # formulas, LEN counts only what shows.
        prazno = f'SUMPRODUCT(LEN(${fss}{e}:${pojas}{e}))+SUMPRODUCT(LEN({disc}))+LEN({kg}{e})=0'
        ws.write_formula(r, K_PROVERA, f'=IF({prazno},"",{provera})', s['provera'], '')

        # The named range the menu fills from. The whole calculation
        # sits here in a cell, so the validation rule stays simplest.
        ws.write_formula(r, K_POMOC_D, f'=IF(${grupa}{e}="","sve_discipline","disc_"&${grupa}{e})', None, '')
        ws.write_formula(r, K_POMOC_K, (
            f'=IF(OR(${grupa}{e}="",${pol}{e}=""),"sve_kilaze",'
            f'"kg_"&${grupa}{e}&"_"&IF(${pol}{e}="ženski","Z","M"))'), None, '')

    pe = prvi + 1                      # first data row in Excel terms
    meni = {'validate': 'list', 'ignore_blank': True, 'dropdown': True, 'error_type': 'stop'}
    ws.data_validation(prvi, K_GOD, posl, K_GOD, dict(
        meni, source='=godista', error_title='Godište',
        error_message='Godište se bira iz padajućeg menija.'))
    ws.data_validation(prvi, K_POL, posl, K_POL, dict(
        meni, source='=polovi', error_title='Pol',
        error_message='Pol se bira iz padajućeg menija.'))
    ws.data_validation(prvi, K_POJAS, posl, K_POJAS, dict(
        meni, source='=pojasevi', error_title='Pojas',
        error_message='Pojas se bira iz padajućeg menija.'))
    ws.data_validation(prvi, K_DISC, posl, K_KILAZA - 1, dict(
        meni, source=f'=INDIRECT(${pomoc_d}{pe})', error_title='Disciplina',
        error_message='Godište se unosi pre discipline. Padajući meni nudi discipline '
                      'koje su moguće u odnosu na uzrast.'))
    ws.data_validation(prvi, K_KILAZA, posl, K_KILAZA, dict(
        meni, source=f'=INDIRECT(${pomoc_k}{pe})', error_title='Telesna težina',
        error_message='Godište i pol unose se pre telesne težine. Telesna težina unosi se '
                      'isključivo uz Fudokan sport kumite, budući da je tradicionalni '
                      'kumite apsolutna kategorija.'))
    for kolona, slovo, naslov in ((K_IME, ime, 'Ime'), (K_PREZIME, prezime, 'Prezime')):
        ws.data_validation(prvi, kolona, posl, kolona, {
            'validate': 'custom', 'value': f'={no_digits(f"{slovo}{pe}")}',
            'ignore_blank': True, 'error_type': 'stop', 'error_title': naslov,
            'error_message': 'Polje prima isključivo slova, razmak, crticu i apostrof; '
                             'cifre nisu dozvoljene.'})

    # ID and name stay in view while the coach scrolls to the disciplines.
    ws.freeze_panes(prvi, K_PREZIME + 1)
    lock_sheet(ws, ZAGLAVLJE)
    return ws


# === Sheet: team entries =============================================

def sheet_teams(wb, p, s):
    ws = wb.add_worksheet('Ekipno')
    n_clan = team_slots(p)

    K_DISC, K_VRSTA, K_GRUPA, K_UZRAST = range(4)
    K_CLAN = 4
    PO_CLANU = 4                       # first name, surname, year, sex
    K_PROVERA = K_CLAN + PO_CLANU * n_clan
    K_POMOC = K_PROVERA + 1

    kolone = [('Disciplina', 24), ('Vrsta', 16), ('Grupa', 8), ('Uzrast', 15)]
    for i in range(n_clan):
        kolone += [(f'{i + 1}. ime', 14), (f'{i + 1}. prezime', 16),
                   (f'{i + 1}. godište', 11), (f'{i + 1}. pol', 10)]
    kolone.append(('Provera', 36))
    for i, (naslov, sirina) in enumerate(kolone):
        ws.set_column(i, i, sirina)
    ws.set_column(K_POMOC, K_POMOC, 14, None, {'hidden': True})

    ws.write(0, 0, 'EKIPNE PRIJAVE', s['naslov'])
    ws.write(1, 0, 'Popunjava se samo ako klub prijavljuje ekipe', s['sitno'])
    ws.set_row(2, 40)
    ws.merge_range(2, 0, 2, K_PROVERA, (
        'Jedan red predstavlja jednu ekipu; klub može prijaviti više ekipa u istoj '
        'disciplini, svaku u zasebnom redu. Za svakog člana upisuju se ime i prezime, svako '
        'u svoju kolonu, zatim godište i pol. Uzrasna grupa izvodi se iz godišta prvog člana, '
        'pa padajući meni nudi ekipne discipline koje su moguće u odnosu na taj uzrast. Svi '
        'članovi ekipe moraju pripadati istoj uzrasnoj grupi.'),
        s['uputstvo'])

    # Club and coach are not asked twice — pulled from the first sheet.
    for red, ime, izvor in ((3, 'Klub', 'B4'), (4, 'Grad', 'B5'), (5, 'Trener', 'B6')):
        ws.write(red, 0, ime, s['polje'])
        ws.write_formula(red, 1, f'=Prijava!{izvor}', s['izvedeno'], '')
    ws.write(3, 3, 'preuzima se sa lista „Prijava"', s['sitno'])

    ZAGLAVLJE = 8                      # Excel row 9
    ws.set_row(ZAGLAVLJE, 30)
    for i, (naslov, _) in enumerate(kolone):
        ws.write(ZAGLAVLJE, i, naslov, s['zaglavlje'])

    prvi, posl = ZAGLAVLJE + 1, ZAGLAVLJE + ROWS
    imena, prezimena, godista, polovi = (
        [column_letter(K_CLAN + PO_CLANU * i + k) for i in range(n_clan)] for k in range(PO_CLANU))
    disciplina, vrsta, grupa = (column_letter(k) for k in (K_DISC, K_VRSTA, K_GRUPA))
    pomoc = column_letter(K_POMOC)

    for r in range(prvi, posl + 1):
        e = r + 1
        for c in [K_DISC, K_VRSTA] + list(range(K_CLAN, K_PROVERA)):
            ws.write_blank(r, c, None, s['unos'])

        # The team's group is the first member's; the check reports
        # members from different groups.
        ws.write_formula(r, K_GRUPA, f'={group_formula(f"${godista[0]}{e}")}', s['izvedeno'], '')
        ws.write_formula(r, K_UZRAST, f'={age_name_formula(f"${grupa}{e}")}', s['izvedeno'], '')

        sva_imena, sva_prezimena, sva_godista, svi_polovi = (
            ','.join(f'${k}{e}' for k in kolone) for kolone in (imena, prezimena, godista, polovi))
        razidjeni = '+'.join(
            f'IF(${g}{e}="",0,IF(LOOKUP(${g}{e},INDEX(grupe,0,1),INDEX(grupe,0,2))=${grupa}{e},0,1))'
            for g in godista)
        losa_imena = '+'.join(f'IF({letters_only(f"${k}{e}")},0,1)' for k in imena + prezimena)
        broj = f'COUNTA({sva_imena})'
        najmanje = f'VLOOKUP(${disciplina}{e},ekipe,2,FALSE)'
        najvise = f'VLOOKUP(${disciplina}{e},ekipe,3,FALSE)'

        provera = first_failing([
            (f'${disciplina}{e}=""', '"Nedostaje disciplina"'),
            (f'${godista[0]}{e}=""', '"Nedostaje godište prvog člana"'),
            (f'${grupa}{e}=""', '"Godište nije obuhvaćeno uzrasnom tabelom"'),
            (f'COUNTIF(INDIRECT("tdisc_"&${grupa}{e}),${disciplina}{e})=0',
             f'"Disciplina nije moguća za uzrast "&${grupa}{e}'),
            (f'{razidjeni}>0', '"Članovi ekipe nisu iz iste uzrasne grupe"'),
            (f'OR({broj}<>COUNTA({sva_prezimena}),{broj}<>COUNTA({sva_godista}))',
             '"Za svakog člana potrebni su ime, prezime i godište"'),
            (f'{losa_imena}>0', '"Ime ili prezime sadrži znakove koji nisu slova"'),
            (f'COUNTA({svi_polovi})<>{broj}', '"Nedostaje pol za nekog od članova"'),
            (f'{broj}<{najmanje}', f'"Ekipa mora imati najmanje "&{najmanje}&" člana"'),
            (f'{broj}>{najvise}', f'"Ekipa može imati najviše "&{najvise}&" člana"'),
            (f'${vrsta}{e}=""', '"Nedostaje vrsta ekipe"'),
        ], 'prijava je kompletna')
        ws.write_formula(r, K_PROVERA, (
            f'=IF(COUNTA(${disciplina}{e}:${vrsta}{e},{sva_imena},{sva_prezimena},'
            f'{sva_godista})=0,"",{provera})'), s['provera'], '')

        ws.write_formula(r, K_POMOC, f'=IF(${grupa}{e}="","sve_ekipne","tdisc_"&${grupa}{e})', None, '')

    pe = prvi + 1
    meni = {'validate': 'list', 'ignore_blank': True, 'dropdown': True, 'error_type': 'stop'}
    ws.data_validation(prvi, K_DISC, posl, K_DISC, dict(
        meni, source=f'=INDIRECT(${pomoc}{pe})', error_title='Disciplina',
        error_message='Godište prvog člana unosi se pre discipline. Padajući meni nudi '
                      'ekipne discipline koje su moguće u odnosu na uzrast.'))
    ws.data_validation(prvi, K_VRSTA, posl, K_VRSTA, dict(
        meni, source='=vrste', error_title='Vrsta ekipe',
        error_message='Vrsta ekipe: muškarci ili žene. Enbu se takmiči u muškom i '
                      'mešovitom paru.'))
    for i in range(n_clan):
        prva = K_CLAN + PO_CLANU * i
        for k, slovo, naslov in ((prva, imena[i], 'Ime'), (prva + 1, prezimena[i], 'Prezime')):
            ws.data_validation(prvi, k, posl, k, {
                'validate': 'custom', 'value': f'={no_digits(f"{slovo}{pe}")}',
                'ignore_blank': True, 'error_type': 'stop', 'error_title': naslov,
                'error_message': 'Polje prima isključivo slova, razmak, crticu i apostrof; '
                                 'cifre nisu dozvoljene.'})
        ws.data_validation(prvi, prva + 2, posl, prva + 2, dict(
            meni, source='=godista', error_title='Godište',
            error_message='Godište se bira iz padajućeg menija.'))
        ws.data_validation(prvi, prva + 3, posl, prva + 3, dict(
            meni, source='=polovi', error_title='Pol',
            error_message='Pol se bira iz padajućeg menija.'))

    ws.freeze_panes(prvi, 0)
    lock_sheet(ws, ZAGLAVLJE)
    return ws


# === Verifying the finished file =============================================

def verify(path):
    """
    The last check before delivery — over the raw XML, not the looks.
    One bad validation rule and Excel declares the file corrupted,
    dropping the whole rules block in "repair" — the coach then gets a
    bare table with no menus. Every item on this list cost one edition
    of the form.
    """
    greske = []
    with zipfile.ZipFile(path) as z:
        for ime in [n for n in z.namelist() if n.startswith('xl/worksheets/')]:
            x = z.read(ime).decode('utf-8')
            for m in re.finditer(r'<dataValidation ([^>]*)>(.*?)</dataValidation>', x, re.S):
                attrs, telo = m.group(1), m.group(2)
                tip = re.search(r'type="([^"]+)"', attrs)
                tip = tip.group(1) if tip else 'list'
                f1 = re.search(r'<formula1>(.*?)</formula1>', telo, re.S)
                f1 = f1.group(1) if f1 else ''
                sq = re.search(r'sqref="([^"]+)"', attrs)
                gde = f'{ime} {sq.group(1) if sq else "?"}'

                if f1.startswith('='):
                    greske.append(f'{gde}: formula1 počinje znakom jednakosti')
                if tip != 'list' and (re.search(r'\$?[A-Z]+\$?\d+:\$?[A-Z]+\$?\d+', f1)
                                      or '{' in f1):
                    greske.append(f'{gde}: opseg ili niz u pravilu tipa {tip}')
                if len(f1) > 255:
                    greske.append(f'{gde}: formula duža od 255 znakova ({len(f1)})')
                if tip == 'list' and '<formula2>' in telo:
                    greske.append(f'{gde}: spisak ima drugu formulu')
                if tip == 'list' and 'operator=' in attrs:
                    greske.append(f'{gde}: spisak ima operator')

            red = [e for e in ('sheetData', 'sheetProtection', 'mergeCells',
                               'dataValidations', 'pageMargins', 'pageSetup')
                   if f'<{e}' in x]
            mesta = [x.index(f'<{e}') for e in red]
            if mesta != sorted(mesta):
                greske.append(f'{ime}: elementi nisu po redosledu sheme')

    if greske:
        print('  FAJL NIJE ISPRAVAN:')
        for g in greske:
            print('   ·', g)
        sys.exit(1)
    print('  provera sirovog XML-a: prošla')


def main():
    # The season is the competition year; defaults to the current one,
    # next year's is passed: python3 form/build-entry-form.py 2027.
    season = int(sys.argv[1]) if len(sys.argv) > 1 else datetime.date.today().year
    p = rulebook(season)
    p['sezona'] = season
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    wb = xlsxwriter.Workbook(str(OUTPUT))
    s = styles(wb)
    sheet_individual(wb, p, s)
    sheet_teams(wb, p, s)
    write_rulebook(wb, p)
    write_roster(wb, p)
    wb.close()

    verify(OUTPUT)
    print(f'{OUTPUT.relative_to(ROOT)} — takmičarska {season}. · '
          f'{len(p["pojedinacne"])} pojedinačnih i {len(p["ekipne"])} ekipnih disciplina, '
          f'{discipline_columns(p)} kolona za discipline, {team_slots(p)} u ekipi')
    print('  uzrasti: ' + ' · '.join(f'{a["code"]} {a["oznaka"]}' for a in p['AGES']))


if __name__ == '__main__':
    main()
