#!/usr/bin/env python3
"""
Lokalni server za FSS Manager.

Postoji zbog jednog jedinog razloga: **pregledač ne sme da služi jučerašnju
verziju iz sopstvenog keša.**

`python3 -m http.server` uz svaki fajl šalje njegov datum, ali nijedno uputstvo
o kešu. Pregledač tada sam procenjuje koliko dugo sme da ga drži — i ume da
mesecima služi zapamćenu kopiju, a da server o tome ne sazna ništa. To se u
praksi videlo ovako: aplikacija na disku je bila nova, u dnu navigacije je i
dalje stajala stara oznaka verzije, a u dnevniku servera nije bilo nijednog
zahteva za `app.js` — jer ga pregledač nije ni tražio.

Ovaj server zato uz svaki odgovor kaže **no-store**: ništa se ne pamti između
otvaranja. Uz to briše uslovna zaglavlja iz zahteva, pa nema ni odgovora „304,
nema ništa novo" na osnovu datuma koji pregledač pamti od ranije.

Offline rad time nije ugrožen — o njemu se stara service worker, koji svoj keš
puni sam i koristi ga kad server ne odgovara.

    python3 server.py [port] [folder]
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        # Bez uslovnih zaglavlja nema ni „304 Not Modified" na osnovu datuma
        # koji je pregledač zapamtio pre nekoliko verzija.
        del self.headers['If-Modified-Since']
        del self.headers['If-None-Match']
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Isti oblik kao kod ugrađenog servera — dnevnik ostaje čitljiv.
        sys.stderr.write('%s - - [%s] %s\n'
                         % (self.address_string(), self.log_date_time_string(), fmt % args))


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    folder = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    os.chdir(folder)
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'Serving HTTP on 127.0.0.1 port {port} (http://127.0.0.1:{port}/) ...')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
