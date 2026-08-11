#!/usr/bin/env python3
"""Static file server for local UI work.

Identical to `python3 -m http.server` except it sends no-cache headers, so a
plain reload always shows your latest edit — no hard-refresh needed.

    ./dev.py          -> http://localhost:8000
    ./dev.py 3000     -> http://localhost:3000
"""

import functools
import http.server
import os
import socket
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One tidy line per request; the default logs the whole request line.
        status = args[1] if len(args) > 1 else ""
        sys.stderr.write(f"  {status}  {self.path}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

    with socket.socket() as probe:
        if probe.connect_ex(("127.0.0.1", port)) == 0:
            sys.exit(f"Port {port} is already in use. Try: ./dev.py {port + 1}")

    handler = functools.partial(NoCacheHandler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)

    url = f"http://localhost:{port}"
    print(f"Absolute Cinema → {url}")
    print("Ctrl-C to stop.\n")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.shutdown()


if __name__ == "__main__":
    main()
