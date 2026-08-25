#!/bin/bash
# Pokreće FSS Manager lokalno i otvara ga u pregledaču.
# Dvoklik na ovaj fajl u Finderu je dovoljan — internet nije potreban.
#
# Zašto server, a ne dvoklik na index.html: pregledači iz bezbednosnih razloga
# ne učitavaju ES module ni offline keš sa file:// adrese.

cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"

echo "FSS Manager"
echo "Folder: $DIR"

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
ours() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/manifest.webmanifest" 2>/dev/null \
    | grep -q "FSS Manager"
}

# VAŽNO: podaci (takmičenja, prijave) žive u pregledaču vezani za tačnu
# adresu — localhost:8787 i localhost:8788 su za pregledač dva različita
# mesta. Zato uvek ciljamo isti port, a menjamo ga samo ako ga drži nešto
# tuđe; tada se to i kaže naglas, jer se na novom portu neće videti ranije
# sačuvana takmičenja.
PORT=8787
ALREADY_RUNNING=0

if port_busy "$PORT"; then
  if ours "$PORT"; then
    echo "Aplikacija je već pokrenuta na portu $PORT — samo je otvaram."
    ALREADY_RUNNING=1
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

# Otvara pregledač tek kad server zaista odgovori — bez ovoga se dešava da
# se prozor otvori pre nego što se server podigne.
open_when_ready() {
  for _ in $(seq 1 60); do
    if port_busy "$PORT"; then
      open "$ADDRESS" 2>/dev/null || xdg-open "$ADDRESS" 2>/dev/null || true
      return
    fi
    sleep 0.25
  done
  echo "Server se nije podigao na vreme. Otvori ručno: $ADDRESS"
}

echo "Adresa: $ADDRESS"

if [ "$ALREADY_RUNNING" = "1" ]; then
  open "$ADDRESS" 2>/dev/null || xdg-open "$ADDRESS" 2>/dev/null || echo "Otvori ručno: $ADDRESS"
  exit 0
fi

echo "Za gašenje: zatvori ovaj prozor ili pritisni Ctrl+C."
echo

open_when_ready &

# --bind 127.0.0.1: samo ovaj računar. Time nema ni upozorenja macOS zaštitnog
# zida o dolaznim vezama. Kad zatreba da se drugi uređaji u hali kače na ovaj
# laptop, ovde se skida ograničenje.
if command -v python3 >/dev/null 2>&1; then
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
