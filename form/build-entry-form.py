#!/usr/bin/env python3
"""
Pravi Excel formular kojim klubovi prijavljuju takmičare.

Formular je **zaseban fajl**: savez ga pošalje klubovima, treneri ga popune u
Excelu i vrate, a aplikacija ih uveze. Klubovi aplikaciju ne otvaraju.

Tri pravila drže formular:

**Sve što ne mora da se kuca — ne kuca se.** Godište, pol, pojas, disciplina,
telesna težina i vrsta ekipe su padajući meniji. Rukom se upisuju samo klub, grad,
trener i imena, jer njih nema u pravilniku.

**Uzrast se ne unosi nego računa.** Grupa i uzrast su formule iz godišta, a
meni sa disciplinama je zavisan — u njemu stoje samo discipline koje ta
uzrasna grupa sme. Trener ne može da pogreši kategoriju.

**Piše se samo tamo gde je predviđeno.** List je zaključan; otključana su
jedino polja za unos.

── Zašto XlsxWriter, a ne openpyxl ────────────────────────────────────

Tri izdanja ovog formulara Excel je proglasio oštećenim i pri „popravci"
izbacio **sva** pravila za unos — trener bi dobio golu tabelu bez ijednog
padajućeg menija, dok se u LibreOfficeu isti fajl otvarao bez reči. Uzroci su
bili redom: znak jednakosti u `formula1`, opseg unutar pravila, i (moj
„sigurnosni") prepis kroz LibreOffice, koji spiskovima dopiše `operator` i
drugu formulu.

Zato fajl više ne piše openpyxl nego **XlsxWriter** — biblioteka koja radi
jedno jedino: piše .xlsx onako kako ga Excel očekuje. Nema prepisa kroz drugi
program, a `verify()` na kraju čita sirov XML i staje ako nađe bilo šta sa
spiska poznatih zamki.

── Održavanje ─────────────────────────────────────────────────────────

Pravilnik mora da bude na dva mesta odjednom — u aplikaciji i u menijima ovog
fajla. Da se ta dva ne raziđu, skripta **ne prepisuje** discipline, uzrasne
grupe ni telesne težine: čita ih iz `assets/js/data.js` preko Node-a. Broj kolona za
discipline se takođe **računa** — toliko koliko ih najbrojnija uzrasna grupa
sme, ni jedna manje.

**Godišta se ne kucaju.** Uzrasna tabela saveza se svake sezone pomeri za
jednu godinu, pa se u `data.js` drži uzrast, a godišta se računaju za traženu
sezonu. Formular za sledeću godinu je jedna komanda:

    python3 form/build-entry-form.py          # tekuća sezona
    python3 form/build-entry-form.py 2027     # sledeća

Traži: python3 + XlsxWriter (`pip install xlsxwriter`) i node.
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

ROWS = 120          # koliko praznih redova formular nudi

# ── Pravilnik iz aplikacije ────────────────────────────────────────────


def rulebook(season):
    """
    Čita pravilnik iz data.js — za **zadatu takmičarsku sezonu**.

    Uzrasne grupe se tamo drže kao raspon uzrasta, pa godišta izlaze
    izračunata: 2026. su poletarci 2019. i mlađi, 2027. su 2020. i mlađi.
    Formular za sledeću godinu se time pravi jednom komandom, bez ijedne
    ručno prekucane godine.
    """
    kod = (
        "import('./assets/js/data.js').then(m => console.log(JSON.stringify({"
        f"AGES: m.AGES.map(a => ({{code: a.code, name: a.name,"
        f" od: m.yearsOf(a, {season}).najstarije, oznaka: m.yearsLabel(a, {season})}})),"
        "BELTS: m.BELTS, WEIGHTS: m.WEIGHTS,"
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
    """Koliko disciplina sme najbrojnija uzrasna grupa — toliko i kolona."""
    return max(len([d for d in p['pojedinacne'] if a['code'] in d['groups']])
               for a in p['AGES'])


def team_slots(p):
    """Najveća ekipa po pravilniku — toliko mesta za članove."""
    return max(d['team']['max'] for d in p['ekipne'])


def column_letter(i):
    """0 → A, 25 → Z, 26 → AA."""
    ime = ''
    i += 1
    while i:
        i, o = divmod(i - 1, 26)
        ime = chr(65 + o) + ime
    return ime


# ── Provere u formulama ────────────────────────────────────────────────

# Šta sme da stoji u imenu: naša latinična slova, razmak, crtica, apostrof.
ALLOWED_CHARS = ("ABCDEFGHIJKLMNOPQRSTUVWXYZ"
              "abcdefghijklmnopqrstuvwxyz"
              "ČĆĐŠŽčćđšž -'")
NAME_LENGTH = 60


def letters_only(cell):
    """
    Tačno kad u ćeliji nema ničega osim slova, razmaka, crtice i apostrofa.

    Ime se **dopunjava** slovima do fiksne dužine pre provere. Bez toga bi
    ostatak reda bio prazan tekst, a `FIND("")` se ne ponaša isto u Excelu
    (vrati 1) i u LibreOfficeu (greška) — pa bi ista provera u dva programa
    davala različit odgovor.

    Ovo ide **samo u kolonu „Provera"**. U pravilu za unos niz nije dozvoljen.
    """
    return (f'SUMPRODUCT(--ISERROR(FIND(MID({cell}&REPT("a",{NAME_LENGTH}),'
            f'ROW($A$1:$A${NAME_LENGTH}),1),"{ALLOWED_CHARS}")))=0')


def no_digits(cell):
    """
    Provera koja sme da stoji u pravilu za unos: nijedna cifra.

    Excel u pravilu za unos ne prima ni opseg ni niz („You may not use
    reference operators or array constants for Data Validation criteria"), a
    formula sme da bude dugačka najviše 255 znakova. Zato ovde stoji deset
    odvojenih `FIND`-ova nad jednom ćelijom. Znakovi (`@`, `.`, `_`) ostaju na
    kolonu „Provera" i na uvoz u aplikaciju.
    """
    checks = ','.join(f'ISERROR(FIND("{d}",{cell}))' for d in range(10))
    return f'AND({checks})'


def group_formula(birth_year):
    return f'IF({birth_year}="","",LOOKUP({birth_year},INDEX(grupe,0,1),INDEX(grupe,0,2)))'


def age_name_formula(group):
    return f'IF({group}="","",VLOOKUP({group},INDEX(grupe,0,2):INDEX(grupe,0,3),2,FALSE))'


# ── Izgled ─────────────────────────────────────────────────────────────

def styles(wb):
    """Sve što se koristi na oba lista, na jednom mestu."""
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
        # Otključano je samo ono u šta se piše.
        'unos': wb.add_format({'locked': False, 'border': 1, 'border_color': '#D4D4D7',
                               'font_size': 10, 'font_name': 'Calibri'}),
        'izvedeno': wb.add_format({'border': 1, 'border_color': '#D4D4D7', 'bg_color': '#EEF6FF',
                                   'align': 'center', 'font_size': 10, 'font_name': 'Calibri'}),
        'provera': wb.add_format({'border': 1, 'border_color': '#D4D4D7', 'font_size': 9,
                                  'font_name': 'Calibri'}),
    }


def lock_sheet(ws, header_row):
    """
    Zaključava list i pušta samo ono što ima smisla dirati.

    Bez lozinke — ovo nije brava nego ograda: sprečava da se tekst nađe tamo
    gde ga niko neće tražiti, a savez i dalje može da otvori list.
    """
    ws.protect('', {'format_columns': True, 'format_rows': True,
                    'select_locked_cells': True, 'select_unlocked_cells': True})
    ws.set_landscape()
    ws.fit_to_pages(1, 0)
    ws.repeat_rows(header_row)


# ── Skriveni list sa pravilnikom ───────────────────────────────────────

def write_rulebook(wb, p):
    """Spiskovi od kojih žive padajući meniji, kao imenovani opsezi."""
    ws = wb.add_worksheet('Pravilnik')
    ws.hide()

    # Uzrasne grupe: donja granica godišta → šifra i naziv. LOOKUP traži
    # rastuće granice, pa idu od najstarijih ka najmlađima.
    ws.write_row(0, 0, ['od godišta', 'grupa', 'uzrast'])
    for i, age in enumerate(sorted(p['AGES'], key=lambda a: a['od']), start=1):
        ws.write_row(i, 0, [age['od'], age['code'], age['name'].lower()])
    wb.define_name('grupe', f"=Pravilnik!$A$2:$C${len(p['AGES']) + 1}")

    kolona = [4]  # od E nadalje

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

    # Rezervni spiskovi: dok godište nije izabrano, meni mora da ponudi
    # **nešto**. Prazan izvor liste Excel prijavljuje kao grešku, pa bi trener
    # pomislio da je fajl pokvaren.
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

    # Sastav ekipe po disciplini — za proveru broja članova.
    c = kolona[0]
    ws.write_row(0, c, ['ekipa', 'min', 'max'])
    for i, d in enumerate(p['ekipne'], start=1):
        ws.write_row(i, c, [d['name'], d['team']['min'], d['team']['max']])
    wb.define_name('ekipe',
                   f'=Pravilnik!${column_letter(c)}$2:${column_letter(c + 2)}${len(p["ekipne"]) + 1}')
    kolona[0] += 3

    # Vrste ekipe: enbu ima muški i mešoviti par, ostale su jednog pola.
    vrste = ['muškarci', 'žene']
    for d in p['ekipne']:
        for v in (d['variants'] or []):
            if v['label'] not in vrste:
                vrste.append(v['label'])
    spisak('vrste', vrste)

    ws.protect()
    return ws


# ── List: pojedinačne prijave ──────────────────────────────────────────

def sheet_individual(wb, p, s):
    ws = wb.add_worksheet('Prijava')
    n_disc = discipline_columns(p)

    K_GOD, K_IME, K_POL, K_POJAS, K_GRUPA, K_UZRAST = range(6)
    K_DISC = 6
    K_KILAZA = K_DISC + n_disc
    K_PROVERA = K_KILAZA + 1
    K_POMOC_D = K_PROVERA + 1
    K_POMOC_K = K_PROVERA + 2

    kolone = [('Godište', 10), ('Ime i prezime', 26), ('Pol', 10), ('Pojas', 11),
              ('Grupa', 8), ('Uzrast', 16)]
    kolone += [(f'Disciplina {i + 1}', 20) for i in range(n_disc)]
    kolone += [('Telesna težina', 12), ('Provera', 34)]
    for i, (naslov, sirina) in enumerate(kolone):
        ws.set_column(i, i, sirina)
    ws.set_column(K_POMOC_D, K_POMOC_K, 14, None, {'hidden': True})

    ws.write(0, 0, 'PRIJAVA TAKMIČARA', s['naslov'])
    # Izdanje na vidnom mestu: po njemu se nov fajl razlikuje od starog koji
    # je ostao u pošti ili u Downloads-u.
    ws.write(1, 0, 'Fudokan savez Srbije · popunjava klub i dostavlja savezu · '
                   f'takmičarska sezona {p["sezona"]}. · '
                   f'izdanje {datetime.date.today().strftime("%d.%m.%Y.")}', s['sitno'])
    ws.set_row(2, 28)
    ws.merge_range(2, 0, 2, K_PROVERA, (
        'Unos počinje godištem: uzrasna grupa i naziv uzrasta popunjavaju se automatski, '
        'a padajući meni nudi discipline koje su moguće u odnosu na uzrast. Telesna težina '
        'unosi se isključivo uz Fudokan sport kumite, budući da je tradicionalni kumite '
        'apsolutna kategorija. Kolona „Provera" služi za proveru kompletnosti prijave. '
        'Ekipne prijave se unose na listu „Ekipno".'),
        s['uputstvo'])

    for red, ime, napomena in ((3, 'Klub', 'pun naziv kluba, onako kako se navodi u rezultatima'),
                               (4, 'Grad', ''),
                               (5, 'Trener', ''),
                               (6, 'Takmičenje', 'naziv takmičenja za koje se prijava podnosi')):
        ws.write(red, 0, ime, s['polje'])
        ws.write_blank(red, 1, None, s['unos'])
        if napomena:
            ws.write(red, 3, napomena, s['sitno'])

    ZAGLAVLJE = 9                      # Excel red 10
    ws.set_row(ZAGLAVLJE, 30)
    for i, (naslov, _) in enumerate(kolone):
        ws.write(ZAGLAVLJE, i, naslov, s['zaglavlje'])

    prvi, posl = ZAGLAVLJE + 1, ZAGLAVLJE + ROWS
    disc_od, disc_do = column_letter(K_DISC), column_letter(K_DISC + n_disc - 1)
    kg, pomoc_d, pomoc_k = column_letter(K_KILAZA), column_letter(K_POMOC_D), column_letter(K_POMOC_K)

    for r in range(prvi, posl + 1):
        e = r + 1                      # broj reda kako ga vidi Excel
        for c in [K_GOD, K_IME, K_POL, K_POJAS] + list(range(K_DISC, K_KILAZA + 1)):
            ws.write_blank(r, c, None, s['unos'])

        ws.write_formula(r, K_GRUPA, f'={group_formula(f"$A{e}")}', s['izvedeno'], '')
        ws.write_formula(r, K_UZRAST, f'={age_name_formula(f"$E{e}")}', s['izvedeno'], '')

        disc = f'{disc_od}{e}:{disc_do}{e}'
        ws.write_formula(r, K_PROVERA, (
            f'=IF(COUNTA($A{e}:$D{e},{disc})=0,"",'
            f'IF($A{e}="","Nedostaje godište",'
            f'IF($E{e}="","Godište nije obuhvaćeno uzrasnom tabelom",'
            f'IF($B{e}="","Nedostaje ime i prezime",'
            f'IF(NOT({letters_only(f"$B{e}")}),"Ime sadrži znakove koji nisu slova",'
            f'IF($C{e}="","Nedostaje pol",'
            f'IF($D{e}="","Nedostaje pojas",'
            f'IF(COUNTA({disc})=0,"Nije izabrana nijedna disciplina",'
            # Disciplina van uzrasta: meni je ne nudi, ali ume da uđe
            # prekucavanjem ili pre nego što je godište izabrano.
            f'IF(SUMPRODUCT(--({disc}<>""),--(COUNTIF(INDIRECT("disc_"&$E{e}),{disc})=0))>0,'
            f'"Izabrana disciplina nije moguća za uzrast "&$E{e},'
            f'IF(AND(COUNTIF({disc},"Fudokan sport kumite")>0,{kg}{e}=""),'
            f'"Nedostaje telesna težina za Fudokan sport kumite",'
            f'IF(AND(COUNTIF({disc},"Fudokan sport kumite")=0,{kg}{e}<>""),'
            f'"Telesna težina se unosi isključivo uz Fudokan sport kumite",'
            f'"prijava je kompletna")))))))))))'), s['provera'], '')

        # Ime opsega iz kog se puni meni. Cela računica sedi ovde, u ćeliji,
        # da bi samo pravilo za unos ostalo najprostije moguće.
        ws.write_formula(r, K_POMOC_D, f'=IF($E{e}="","sve_discipline","disc_"&$E{e})', None, '')
        ws.write_formula(r, K_POMOC_K, (
            f'=IF(OR($E{e}="",$C{e}=""),"sve_kilaze",'
            f'"kg_"&$E{e}&"_"&IF($C{e}="ženski","Z","M"))'), None, '')

    pe = prvi + 1                      # prvi red podataka po Excelu
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
    ws.data_validation(prvi, K_IME, posl, K_IME, {
        'validate': 'custom', 'value': f'={no_digits(f"B{pe}")}',
        'ignore_blank': True, 'error_type': 'stop', 'error_title': 'Ime i prezime',
        'error_message': 'Polje prima isključivo slova, razmak, crticu i apostrof; '
                         'cifre nisu dozvoljene.'})

    ws.freeze_panes(prvi, 0)
    lock_sheet(ws, ZAGLAVLJE)
    return ws


# ── List: ekipne prijave ───────────────────────────────────────────────

def sheet_teams(wb, p, s):
    ws = wb.add_worksheet('Ekipno')
    n_clan = team_slots(p)

    K_DISC, K_VRSTA, K_GRUPA, K_UZRAST = range(4)
    K_CLAN = 4
    K_PROVERA = K_CLAN + 3 * n_clan
    K_POMOC = K_PROVERA + 1

    kolone = [('Disciplina', 24), ('Vrsta', 16), ('Grupa', 8), ('Uzrast', 15)]
    for i in range(n_clan):
        kolone += [(f'{i + 1}. godište', 11), (f'{i + 1}. ime i prezime', 24),
                   (f'{i + 1}. pol', 10)]
    kolone.append(('Provera', 36))
    for i, (naslov, sirina) in enumerate(kolone):
        ws.set_column(i, i, sirina)
    ws.set_column(K_POMOC, K_POMOC, 14, None, {'hidden': True})

    ws.write(0, 0, 'EKIPNE PRIJAVE', s['naslov'])
    ws.write(1, 0, 'Popunjava se samo ako klub prijavljuje ekipe', s['sitno'])
    ws.set_row(2, 28)
    ws.merge_range(2, 0, 2, K_PROVERA, (
        'Jedan red predstavlja jednu ekipu; klub može prijaviti više ekipa u istoj '
        'disciplini, svaku u zasebnom redu. Unos počinje godištem prvog člana, iz kojeg se '
        'izvodi uzrasna grupa, pa padajući meni nudi ekipne discipline koje su moguće u '
        'odnosu na taj uzrast. Svi članovi ekipe moraju pripadati istoj uzrasnoj grupi.'),
        s['uputstvo'])

    # Klub i trener se ne pitaju drugi put — stoje sa prvog lista.
    for red, ime, izvor in ((3, 'Klub', 'B4'), (4, 'Grad', 'B5'), (5, 'Trener', 'B6')):
        ws.write(red, 0, ime, s['polje'])
        ws.write_formula(red, 1, f'=Prijava!{izvor}', s['izvedeno'], '')
    ws.write(3, 3, 'preuzima se sa lista „Prijava"', s['sitno'])

    ZAGLAVLJE = 8                      # Excel red 9
    ws.set_row(ZAGLAVLJE, 30)
    for i, (naslov, _) in enumerate(kolone):
        ws.write(ZAGLAVLJE, i, naslov, s['zaglavlje'])

    prvi, posl = ZAGLAVLJE + 1, ZAGLAVLJE + ROWS
    godista = [column_letter(K_CLAN + 3 * i) for i in range(n_clan)]
    imena = [column_letter(K_CLAN + 3 * i + 1) for i in range(n_clan)]
    polovi = [column_letter(K_CLAN + 3 * i + 2) for i in range(n_clan)]
    pomoc = column_letter(K_POMOC)

    for r in range(prvi, posl + 1):
        e = r + 1
        for c in [K_DISC, K_VRSTA] + list(range(K_CLAN, K_PROVERA)):
            ws.write_blank(r, c, None, s['unos'])

        # Grupa ekipe je grupa prvog člana; provera javlja ako se članovi
        # razilaze po uzrastu.
        ws.write_formula(r, K_GRUPA, f'={group_formula(f"${godista[0]}{e}")}', s['izvedeno'], '')
        ws.write_formula(r, K_UZRAST, f'={age_name_formula(f"$C{e}")}', s['izvedeno'], '')

        sva_godista = ','.join(f'${g}{e}' for g in godista)
        sva_imena = ','.join(f'${i}{e}' for i in imena)
        svi_polovi = ','.join(f'${x}{e}' for x in polovi)
        razidjeni = '+'.join(
            f'IF(${g}{e}="",0,IF(LOOKUP(${g}{e},INDEX(grupe,0,1),INDEX(grupe,0,2))=$C{e},0,1))'
            for g in godista)
        losa_imena = '+'.join(f'IF({letters_only(f"${i}{e}")},0,1)' for i in imena)
        broj = f'COUNTA({sva_imena})'

        ws.write_formula(r, K_PROVERA, (
            f'=IF(COUNTA($A{e}:$B{e},{sva_godista},{sva_imena})=0,"",'
            f'IF($A{e}="","Nedostaje disciplina",'
            f'IF(${godista[0]}{e}="","Nedostaje godište prvog člana",'
            f'IF($C{e}="","Godište nije obuhvaćeno uzrasnom tabelom",'
            f'IF(COUNTIF(INDIRECT("tdisc_"&$C{e}),$A{e})=0,'
            f'"Disciplina nije moguća za uzrast "&$C{e},'
            f'IF({razidjeni}>0,"Članovi ekipe nisu iz iste uzrasne grupe",'
            f'IF({broj}<>COUNTA({sva_godista}),"Za svakog člana potrebni su i godište i ime",'
            f'IF({losa_imena}>0,"Ime sadrži znakove koji nisu slova",'
            f'IF(COUNTA({svi_polovi})<>{broj},"Nedostaje pol za nekog od članova",'
            f'IF({broj}<VLOOKUP($A{e},ekipe,2,FALSE),'
            f'"Ekipa mora imati najmanje "&VLOOKUP($A{e},ekipe,2,FALSE)&" člana",'
            f'IF({broj}>VLOOKUP($A{e},ekipe,3,FALSE),'
            f'"Ekipa može imati najviše "&VLOOKUP($A{e},ekipe,3,FALSE)&" člana",'
            f'IF($B{e}="","Nedostaje vrsta ekipe","prijava je kompletna")))))))))))'), s['provera'], '')

        ws.write_formula(r, K_POMOC, f'=IF($C{e}="","sve_ekipne","tdisc_"&$C{e})', None, '')

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
        ws.data_validation(prvi, K_CLAN + 3 * i, posl, K_CLAN + 3 * i, dict(
            meni, source='=godista', error_title='Godište',
            error_message='Godište se bira iz padajućeg menija.'))
        ws.data_validation(prvi, K_CLAN + 3 * i + 2, posl, K_CLAN + 3 * i + 2, dict(
            meni, source='=polovi', error_title='Pol',
            error_message='Pol se bira iz padajućeg menija.'))
        ws.data_validation(prvi, K_CLAN + 3 * i + 1, posl, K_CLAN + 3 * i + 1, {
            'validate': 'custom', 'value': f'={no_digits(f"{imena[i]}{pe}")}',
            'ignore_blank': True, 'error_type': 'stop', 'error_title': 'Ime i prezime',
            'error_message': 'Polje prima isključivo slova, razmak, crticu i apostrof; '
                         'cifre nisu dozvoljene.'})

    ws.freeze_panes(prvi, 0)
    lock_sheet(ws, ZAGLAVLJE)
    return ws


# ── Provera gotovog fajla ──────────────────────────────────────────────

def verify(path):
    """
    Poslednja provera pre isporuke — nad sirovim XML-om, ne nad izgledom.

    Excel fajl sa jednim jedinim spornim pravilom za unos proglasi oštećenim i
    pri „popravci" izbaci **ceo** blok pravila: trener onda dobije golu tabelu
    bez ijednog padajućeg menija, dok tabela, formule i zaključavanje ostanu —
    pa na prvi pogled izgleda kao da posao nije ni urađen.

    Svaka stavka na ovom spisku plaćena je jednim izdanjem formulara.
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
    # Sezona je godina takmičenja; podrazumeva se tekuća, a za sledeću se
    # zada: `python3 form/build-entry-form.py 2027`.
    season = int(sys.argv[1]) if len(sys.argv) > 1 else datetime.date.today().year
    p = rulebook(season)
    p['sezona'] = season
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    wb = xlsxwriter.Workbook(str(OUTPUT))
    s = styles(wb)
    sheet_individual(wb, p, s)
    sheet_teams(wb, p, s)
    write_rulebook(wb, p)
    wb.close()

    verify(OUTPUT)
    print(f'{OUTPUT.relative_to(ROOT)} — takmičarska {season}. · '
          f'{len(p["pojedinacne"])} pojedinačnih i {len(p["ekipne"])} ekipnih disciplina, '
          f'{discipline_columns(p)} kolona za discipline, {team_slots(p)} u ekipi')
    print('  uzrasti: ' + ' · '.join(f'{a["code"]} {a["oznaka"]}' for a in p['AGES']))


if __name__ == '__main__':
    main()
