#!/bin/bash
# Starts FSS Manager locally and opens it in the browser.
# A double click in Finder is enough — no internet needed.
#
# Why a server and not index.html directly: browsers refuse ES modules
# and the offline cache over file:// addresses.

cd "$(dirname "$0")" || exit 1
DIR="$(pwd)"

# Everything the script prints also goes to start.log next to it — the
# Terminal window closes, the log stays, so what was found on the port
# and what was done about it can be read later.
exec > >(tee "$DIR/start.log") 2>&1

echo "FSS Manager · $(date '+%d.%m.%Y. %H:%M:%S')"
echo "Folder: $DIR"

# The browser remembers each file's date and asks "anything newer?";
# Python's built-in server answers 304 and sends nothing — so with stale
# dates the service worker never receives a new sw.js. Touching the
# files breaks that.
find "$DIR" -type f ! -name 'start.log' -exec touch {} + 2>/dev/null

if [ ! -f "$DIR/index.html" ]; then
  echo
  echo "GREŠKA: u ovom folderu nema index.html."
  echo "start.command mora da stoji unutar foldera aplikacije, pored index.html."
  read -r -p "Pritisni Enter za izlaz."
  exit 1
fi

# Is somebody already listening on the port? Bash /dev/tcp, no tools.
port_busy() { (echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

# Is our app on that port, or some foreign server? The old misspelled
# name matches on purpose: a server left by an earlier copy must be
# recognised as ours so it can be stopped — otherwise the script would
# move to another port, where the browser sees an empty database.
ours() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/manifest.webmanifest" 2>/dev/null \
    | grep -qE "FSS M[ae]nager"
}

# Which version the running server serves. Without this an old server,
# still alive from an earlier folder, would simply be opened — showing
# the old app although the disk holds a new one.
served_version() {
  curl -sf --max-time 2 "http://127.0.0.1:$1/sw.js" 2>/dev/null \
    | grep -o "fss-manager-v[0-9]*" | head -1
}

# Stops the server on the port. The port does not change because the
# data is bound to it — our old instance is removed, not avoided.
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

# IMPORTANT: the data lives in the browser bound to the exact address —
# localhost:8787 and 8788 are two different places. So the same port is
# always targeted, changed only when something foreign holds it — and
# then said out loud, because the new port will not show earlier data.
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
        # Better the new version on another port than the old one here.
        # The database is bound to the port, so this is said explicitly —
        # earlier competitions stay on 8787 until it frees up.
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

# The URL carries the version. Without it the browser, told to open an
# already open address, just switches to the existing tab — still showing
# whatever was there. With the tag it is a new URL, so the page truly
# loads. The query string is ignored by the cache, so nothing else
# changes.
OPEN_URL="$ADDRESS?${LOCAL_VERSION:-v}"

# Opens the browser only once the server answers — otherwise the window
# can open before the server is up.
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

# --bind 127.0.0.1: this machine only — no macOS firewall warnings. If
# other devices in the hall ever need to connect, lift the limit here.
if command -v python3 >/dev/null 2>&1; then
  # server.py sends no-store, so the browser cannot serve an old build
  # from its own cache. The built-in server cannot, so it is the backup.
  if [ -f "$DIR/server.py" ]; then
    exec python3 "$DIR/server.py" "$PORT" "$DIR"
  fi
  exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DIR"
elif command -v php >/dev/null 2>&1; then
  exec php -S "127.0.0.1:$PORT" -t "$DIR"
elif command -v node >/dev/null 2>&1; then
  # npx downloads the package on first run — hence the last choice.
  exec npx --yes serve -l "$PORT" "$DIR"
else
  echo "Nije pronađen nijedan način da se pokrene lokalni server."
  echo "Instaliraj Python 3 komandom:  xcode-select --install"
  read -r -p "Pritisni Enter za izlaz."
  exit 1
fi
