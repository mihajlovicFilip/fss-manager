#!/bin/bash
# Pokreće FSS Manager lokalno i otvara ga u pregledaču.
# Dvoklik na ovaj fajl u Finderu je dovoljan — internet nije potreban.
#
# Zašto server, a ne dvoklik na index.html: pregledači iz bezbednosnih razloga
# ne učitavaju ES module ni offline keš sa file:// adrese.

cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"

# Sve što skripta ispiše ide i u start.log pored nje. Prozor Terminala se
# zatvori i ono što je pisalo u njemu nestane; zapis ostaje, pa se posle može
# videti šta je zatečeno na portu i šta je od toga urađeno.
exec > >(tee "$DIR/start.log") 2>&1

echo "FSS Manager · $(date '+%d.%m.%Y. %H:%M:%S')"
echo "Folder: $DIR"

# Pregledač pamti datum svakog fajla i pri sledećem otvaranju pita „ima li
# nešto novije". Python-ov server na to odgovara sa 304 i ne šalje ništa — pa
# ako su datumi ostali stari, service worker nikad ne dobije novi sw.js i
# aplikacija se zauvek drži zatečene verzije. Osvežavanje datuma to prekida.
find "$DIR" -type f ! -name 'start.log' -exec touch {} + 2>/dev/null

if [ ! -f "$DIR/index.html" ]; then
  echo
  echo "GREŠKA: u ovom folderu nema index.html."
  echo "start.command mora da stoji unutar foldera aplikacije, pored index.html."
  read -r -p "Pritisni Enter za izlaz."
  exit 1
fi

# Da li neko već sluša na portu? Bash /dev/tcp, bez spoljnih alata.
port_busy() { (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

# Da li na tom portu stoji naša aplikacija ili neki tuđi server?
# Namerno i sa starim, pogrešno napisanim imenom: server pokrenut iz neke
# ranije kopije mora da se prepozna kao naš, da bi mogao da se ugasi. Da se ne
# prepozna, skripta bi ga zaobišla prelaskom na drugi port — a tamo pregledač
# vidi praznu bazu.
ours() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/manifest.webmanifest" 2>/dev/null \
    | grep -qE "FSS M[ae]nager"
}

# Koju verziju služi server na portu. Bez ovoga se dešava da stari server —
# pokrenut iz nekog ranijeg foldera, a i dalje živ — bude prosto otvoren, pa se
# u pregledaču vidi stara aplikacija iako je na disku nova.
served_version() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/sw.js" 2>/dev/null \
    | grep -o "fss-manager-v[0-9]*" | head -1
}

# Gasi server na portu. Port se ne menja jer su podaci vezani za njega —
# stara instanca naše aplikacije se sklanja, ne zaobilazi.
stop_server() {
  local pids
  pids="$(lsof -ti "tcp:$1" -sTCP:LISTEN 2>/dev/null)"
  if [ -z "$pids" ]; then
    echo "  (lsof nije našao ko drži port $1)"
    return 1
  fi
  echo "  gasim proces(e): $pids"
  kill $pids 2>/dev/null
  for _ in $(seq 1 20); do port_busy "$1" || return 0; sleep 0.25; done
  kill -9 $pids 2>/dev/null
  for _ in $(seq 1 20); do port_busy "$1" || return 0; sleep 0.25; done
  return 1
}

# VAŽNO: podaci (takmičenja, prijave) žive u pregledaču vezani za tačnu
# adresu — localhost:8787 i localhost:8788 su za pregledač dva različita
# mesta. Zato uvek ciljamo isti port, a menjamo ga samo ako ga drži nešto
# tuđe; tada se to i kaže naglas, jer se na novom portu neće videti ranije
# sačuvana takmičenja.
PORT=8787
ALREADY_RUNNING=0
LOCAL_VERSION="$(grep -o "fss-manager-v[0-9]*" "$DIR/sw.js" | head -1)"

if port_busy "$PORT"; then
  if ours "$PORT"; then
    RUNNING_VERSION="$(served_version "$PORT")"
    if [ -n "$LOCAL_VERSION" ] && [ "$RUNNING_VERSION" != "$LOCAL_VERSION" ]; then
      echo "Na portu $PORT stoji starija verzija (${RUNNING_VERSION:-nepoznata}); ova je $LOCAL_VERSION."
      if stop_server "$PORT"; then
        echo "Stara je ugašena, pokrećem ovu."
      else
        # Radije nova verzija na drugom portu nego stara na ovom. Baza je
        # vezana za port, pa se to izričito kaže — ranija takmičenja ostaju
        # na 8787 i vide se čim se taj port oslobodi.
        echo "Stara verzija se ne da ugasiti sa ovog mesta."
        while port_busy "$PORT"; do
          PORT=$((PORT + 1))
          if [ "$PORT" -gt 8807 ]; then
            echo "Nijedan port od 8787 do 8807 nije slobodan."
            read -r -p "Pritisni Enter za izlaz."
            exit 1
          fi
        done
        echo "PAŽNJA: pokrećem na portu $PORT. Tamo je baza prazna — ranije"
        echo "upisana takmičenja ostaju vezana za 8787. Da bi se opet videla,"
        echo "ugasi program koji drži 8787 pa pokreni ponovo."
      fi
    else
      echo "Aplikacija je već pokrenuta na portu $PORT — samo je otvaram."
      ALREADY_RUNNING=1
    fi
  else
    echo "Port $PORT drži neki drugi program."
    echo "PAŽNJA: na drugom portu pregledač vidi praznu bazu — ranije sačuvana"
    echo "takmičenja ostaju vezana za $PORT. Ako ti trebaju, zatvori taj program"
    echo "(najčešće stari prozor Terminala) pa pokreni ponovo."
    echo
    while port_busy "$PORT"; do
      PORT=$((PORT + 1))
      if [ "$PORT" -gt 8807 ]; then
        echo "Nijedan port od 8787 do 8807 nije slobodan."
        read -r -p "Pritisni Enter za izlaz."
        exit 1
      fi
    done
    echo "Koristim port $PORT."
  fi
fi

ADDRESS="http://localhost:$PORT/"

# Adresa nosi oznaku verzije. Bez nje pregledač, kad mu se kaže da otvori već
# otvorenu adresu, samo prebaci na postojeći jezičak — koji i dalje prikazuje
# ono što je u njemu bilo. Sa oznakom je to nova adresa, pa se strana zaista
# učita. Pretraga u adresi se pri čitanju keša ignoriše, tako da ništa drugo
# ne menja.
OPEN_URL="$ADDRESS?${LOCAL_VERSION:-v}"

# Otvara pregledač tek kad server zaista odgovori — bez ovoga se dešava da
# se prozor otvori pre nego što se server podigne.
open_when_ready() {
  for _ in $(seq 1 60); do
    if port_busy "$PORT"; then
      open "$OPEN_URL" 2>/dev/null || xdg-open "$OPEN_URL" 2>/dev/null || true
      return
    fi
    sleep 0.25
  done
  echo "Server se nije podigao na vreme. Otvori ručno: $ADDRESS"
}

echo "Adresa: $ADDRESS"
echo "Verzija: ${LOCAL_VERSION:-nepoznata}"

if [ "$ALREADY_RUNNING" = "1" ]; then
  open "$OPEN_URL" 2>/dev/null || xdg-open "$OPEN_URL" 2>/dev/null || echo "Otvori ručno: $OPEN_URL"
  exit 0
fi

echo "Za gašenje: zatvori ovaj prozor ili pritisni Ctrl+C."
echo

open_when_ready &

# --bind 127.0.0.1: samo ovaj računar. Time nema ni upozorenja macOS zaštitnog
# zida o dolaznim vezama. Kad zatreba da se drugi uređaji u hali kače na ovaj
# laptop, ovde se skida ograničenje.
if command -v python3 >/dev/null 2>&1; then
  # server.py šalje „no-store", pa pregledač ne može da posluži staru verziju
  # iz sopstvenog keša. Ugrađeni server to ne ume, pa je rezerva.
  if [ -f "$DIR/server.py" ]; then
    exec python3 "$DIR/server.py" "$PORT" "$DIR"
  fi
  exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR"
elif command -v php >/dev/null 2>&1; then
  exec php -S "127.0.0.1:$PORT" -t "$DIR"
elif command -v node >/dev/null 2>&1; then
  # npx prvi put povlači paket sa interneta — zato je poslednji izbor.
  exec npx --yes serve -l "$PORT" "$DIR"
else
  echo "Nije pronađen nijedan način da se pokrene lokalni server."
  echo "Instaliraj Python 3 komandom:  xcode-select --install"
  read -r -p "Pritisni Enter za izlaz."
  exit 1
fi
