#!/usr/bin/env python3
"""
Local server for FSS Manager.

It exists for one reason: the browser must never serve yesterday's build
from its own HTTP cache. Every response says no-store, and conditional
headers are stripped from requests, so there is no "304 Not Modified"
based on dates the browser remembered from an older version.

Offline use is not affected — the service worker keeps its own cache and
uses it when the server is not running.

    python3 server.py [port] [folder]
"""

import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        # Without conditional headers there is no "304 Not Modified".
        del self.headers['If-Modified-Since']
        del self.headers['If-None-Match']
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # Same format as the built-in server, so the log stays familiar.
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
