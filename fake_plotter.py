"""Listens like a CameraCut plotter and saves every job it receives."""

import os
import socket
import sys

HOST = "127.0.0.1"
PORT = 8080
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "captures")


def main():
    os.makedirs(OUT, exist_ok=True)
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((HOST, PORT))
    server.listen(5)
    server.settimeout(1.0)
    print("listening on %s:%d" % (HOST, PORT), flush=True)
    n = 0
    while True:
        try:
            conn, addr = server.accept()
        except socket.timeout:
            continue
        except KeyboardInterrupt:
            break
        conn.settimeout(1.5)
        data = b""
        while True:
            try:
                chunk = conn.recv(65536)
            except socket.timeout:
                break
            if not chunk:
                break
            data += chunk
        n += 1
        path = os.path.join(OUT, "job_%02d.bin" % n)
        with open(path, "wb") as handle:
            handle.write(data)
        preview = data[:240].decode("latin1", "replace").replace("\r", " ").replace("\n", " ")
        print("job %d from %s bytes %d" % (n, addr, len(data)), flush=True)
        print(preview, flush=True)
        try:
            conn.sendall(b"0")
        except OSError:
            pass
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
