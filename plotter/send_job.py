"""Send a CameraCut job, or the built-in speed/force test pattern."""

import argparse
import json
import os
import socket
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from force_card import build_force_card
from pattern import encode_test_pattern
from protocol import encode_job


def send_text(payload, host, port, timeout=5.0):
    sock = socket.create_connection((host, port), timeout)
    try:
        sock.sendall(payload.encode("ascii"))
    finally:
        sock.close()
    return payload


def job_from_document(document):
    return encode_job(
        document["paths"],
        document.get("page_mm", [297, 420]),
        document.get("origin_mm", [0, 0]),
        accurate=document.get("accurate", True),
        blade_offset_mm=document.get("blade_offset_mm", 0.35),
        overcut_mm=document.get("overcut_mm", 0.0),
        turn_knife_mm=document.get("turn_knife_mm", 1.0),
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Send a job to a CameraCut plotter")
    parser.add_argument("job", nargs="?", help="JSON job from the Illustrator script")
    parser.add_argument("--pattern", action="store_true", help="send the built-in test pattern")
    parser.add_argument("--force-card", action="store_true", help="send the force and pass-count card")
    parser.add_argument("--pen-force", type=int, default=10, help="force for the right-holder pen")
    parser.add_argument("--force-min", type=int, default=10)
    parser.add_argument("--force-max", type=int, default=25)
    parser.add_argument("--force-step", type=int, default=1)
    parser.add_argument("--speed-min", type=int, default=10)
    parser.add_argument("--speed-max", type=int, default=50)
    parser.add_argument("--speed-step", type=int, default=10)
    parser.add_argument("--pass-min", type=int, default=1)
    parser.add_argument("--pass-max", type=int, default=3)
    parser.add_argument("--pass-step", type=int, default=1)
    parser.add_argument("--travel", type=int, default=20)
    parser.add_argument("--json-out", help="write the job json and do not connect")
    parser.add_argument("--host", default="172.31.192.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--out", help="also write the plotter text to this file")
    parser.add_argument("--dry-run", action="store_true", help="write the text, do not connect")
    args = parser.parse_args(argv)

    document = None
    if args.force_card:
        document = build_force_card(
            args.pen_force,
            force_min=args.force_min, force_max=args.force_max, force_step=args.force_step,
            speed_min=args.speed_min, speed_max=args.speed_max, speed_step=args.speed_step,
            pass_min=args.pass_min, pass_max=args.pass_max, pass_step=args.pass_step,
            travel=args.travel,
        )
        payload = job_from_document(document)
    elif args.pattern:
        payload = encode_test_pattern()
    elif args.job:
        with open(args.job, "r") as handle:
            document = json.load(handle)
        payload = job_from_document(document)
    else:
        parser.error("pass a job json, --pattern, or --force-card")

    if args.json_out:
        if document is None:
            parser.error("--json-out needs --force-card or a job file")
        with open(args.json_out, "w") as handle:
            json.dump(document, handle)
    if args.out:
        with open(args.out, "w") as handle:
            handle.write(payload)
    if args.dry_run:
        sys.stdout.write(payload)
        return 0
    if args.json_out:
        return 0
    send_text(payload, args.host, args.port)
    sys.stderr.write("sent %d bytes to %s:%d\n" % (len(payload), args.host, args.port))
    return 0


if __name__ == "__main__":
    sys.exit(main())
