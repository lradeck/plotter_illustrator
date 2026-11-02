"""Send a CameraCut job, or the built-in speed/force test pattern."""

import argparse
import json
import os
import socket
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from force_card import build_force_card, join_strokes
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
    paths = document["paths"]
    page = document.get("page_mm", [297, 420])
    origin = document.get("origin_mm", [0, 0])
    if document.get("anchor") == "top-left":
        paths, page = anchor_top_left(paths)
        origin = (0, 0)
    return encode_job(
        paths,
        page,
        origin,
        accurate=document.get("accurate", True),
        blade_offset_mm=document.get("blade_offset_mm", 0.35),
        overcut_mm=document.get("overcut_mm", 0.0),
        turn_knife_mm=document.get("turn_knife_mm", 1.0),
        alternate=bool(document.get("alternate", False)),
    )


def anchor_top_left(paths):
    """Put the drawing's top-left corner on the parked head.

    On this cutter the horizontal axis is Y and the vertical axis is X, so
    Illustrator's right becomes machine Y and Illustrator's down becomes
    machine X. Both run into the negative quadrant, which is where the sheet
    sits to the right and below the head.

    The pen draws first, then the knife. A whole number is finished before
    the next one: a horizontal row left to right, and a speed column from
    the top of one area down before the area below. Cuts follow the layer
    order, and inside a layer they run in a snake from the top left. Each
    path then starts at the end nearest the head.
    """
    points = [pt for path in paths for pt in path.get("points_mm") or []]
    if not points:
        return paths, (1.0, 1.0)
    min_x = min(pt[0] for pt in points)
    max_y = max(pt[1] for pt in points)
    prepared = []
    for index, path in enumerate(paths):
        copy = dict(path)
        copy["points_mm"] = [list(pt) for pt in path["points_mm"]]
        copy["_order"] = path.get("order", index)
        prepared.append(copy)
    anchored = []
    for path in _arrange(prepared):
        moved = []
        for x, y in path["points_mm"]:
            right = x - min_x
            down = max_y - y
            moved.append([round(-down, 3), round(-right, 3)])
        path["points_mm"] = moved
        anchored.append(path)
    _chain(anchored)
    width = max(-pt[0] for path in anchored for pt in path["points_mm"])
    height = max(-pt[1] for path in anchored for pt in path["points_mm"])
    if width <= 0:
        width = 1.0
    if height <= 0:
        height = 1.0
    return anchored, (round(width, 3), round(height, 3))


def _arrange(paths):
    pens = [path for path in paths if path.get("mode") == "pen"]
    cuts = [path for path in paths if path.get("mode") != "pen"]
    return _paint_numbers(pens) + _by_layer(cuts, True)


def _paint_numbers(paths):
    """Finish one number, then the next, from the top of the sheet down.

    Strokes of one glyph stay together. A row of numbers is painted left to
    right. Speed numbers stacked in one area are painted top to bottom
    before the same column in the area below. A tall title is painted as
    one piece and is not woven into the rows.
    """
    if not paths:
        return []
    indexed = []
    for index, path in enumerate(paths):
        path["_i"] = index
        indexed.append(path)
    marks = _cluster_marks(indexed, 1.2)
    titles = []
    numbers = []
    for mark in marks:
        box = _mark_box(mark)
        if box["top"] - box["bottom"] > 8.0:
            titles.append(mark)
        else:
            numbers.append(mark)
    titles.sort(key=lambda mark: (-_mark_box(mark)["top"], _mark_box(mark)["left"]))
    ordered = []
    for mark in titles + _rows_of_marks(numbers):
        ordered.extend(_order_mark(mark))
    return ordered


def _order_mark(mark):
    """Draw one character fully, left to right or top to bottom."""
    characters = _cluster_marks(mark, 0.25)
    characters.sort(key=lambda item: (-_mark_box(item)["top"], _mark_box(item)["left"]))
    ordered = []
    for character in characters:
        character.sort(key=lambda path: (-_box(path)["top"], _box(path)["left"]))
        fused = join_strokes([path["points_mm"] for path in character], 0.4)
        for points in fused:
            copy = dict(character[0])
            copy["points_mm"] = [[round(x, 3), round(y, 3)] for x, y in points]
            copy["closed"] = False
            ordered.append(copy)
    return ordered


def _rows_of_marks(marks):
    pending = sorted(marks, key=lambda mark: (-_mark_box(mark)["top"], _mark_box(mark)["left"]))
    rows = []
    for mark in pending:
        box = _mark_box(mark)
        height = max(box["top"] - box["bottom"], 0.8)
        cy = (box["top"] + box["bottom"]) / 2.0
        if rows and abs(rows[-1]["cy"] - cy) <= rows[-1]["tol"]:
            rows[-1]["marks"].append(mark)
        else:
            rows.append({
                "cy": cy,
                "tol": max(height * 0.55, 1.4),
                "marks": [mark],
            })
    ordered = []
    for row in rows:
        row["marks"].sort(key=lambda mark: _mark_box(mark)["left"])
        ordered.extend(row["marks"])
    return ordered


def _cluster_marks(paths, pad):
    parent = list(range(len(paths)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    boxes = [_box(path) for path in paths]
    for i in range(len(paths)):
        for j in range(i + 1, len(paths)):
            if _boxes_touch(boxes[i], boxes[j], pad) and find(i) != find(j):
                parent[find(j)] = find(i)
    groups = {}
    for index, path in enumerate(paths):
        groups.setdefault(find(index), []).append(path)
    return list(groups.values())


def _boxes_touch(a, b, pad):
    return not (
        a["right"] + pad < b["left"] or b["right"] + pad < a["left"]
        or a["bottom"] - pad > b["top"] or b["bottom"] - pad > a["top"]
    )


def _mark_box(mark):
    boxes = [_box(path) for path in mark]
    return {
        "left": min(box["left"] for box in boxes),
        "right": max(box["right"] for box in boxes),
        "top": max(box["top"] for box in boxes),
        "bottom": min(box["bottom"] for box in boxes),
    }


def _by_layer(paths, snake):
    groups = []
    index_of = {}
    for path in paths:
        name = path.get("layer") or ""
        key = ("layer", name) if name else ("path", path["_order"])
        if key not in index_of:
            index_of[key] = len(groups)
            groups.append({"order": path["_order"], "paths": [path]})
        else:
            group = groups[index_of[key]]
            group["paths"].append(path)
            group["order"] = min(group["order"], path["_order"])
    groups.sort(key=lambda group: group["order"])
    ordered = []
    for group in groups:
        ordered.extend(_within_layer(group["paths"], snake))
    return ordered


def _within_layer(paths, snake):
    if len(paths) <= 1:
        return list(paths)
    rows = _rows(paths)
    ordered = []
    for index, row in enumerate(rows):
        row = sorted(row, key=lambda path: _box(path)["left"])
        if snake and index % 2 == 1:
            row.reverse()
        ordered.extend(row)
    return ordered


def _rows(paths):
    ordered = sorted(paths, key=lambda path: -_box(path)["top"])
    rows = []
    for path in ordered:
        box = _box(path)
        if rows and rows[-1]["top"] - box["top"] <= rows[-1]["tol"]:
            rows[-1]["paths"].append(path)
        else:
            height = box["top"] - box["bottom"]
            rows.append({
                "top": box["top"],
                "tol": max(height * 0.45, 1.2),
                "paths": [path],
            })
    return [row["paths"] for row in rows]


def _box(path):
    xs = [pt[0] for pt in path["points_mm"]]
    ys = [pt[1] for pt in path["points_mm"]]
    return {
        "left": min(xs),
        "right": max(xs),
        "top": max(ys),
        "bottom": min(ys),
    }


def _chain(paths):
    target = (0.0, 0.0)
    for path in paths:
        closed = bool(path.get("closed", True))
        # A closed cut keeps its direction so the knife offset stays outside.
        allow_reverse = (not closed) or path.get("mode") == "pen"
        path["points_mm"] = _start_toward(
            path["points_mm"], closed, target, allow_reverse
        )
        if closed:
            end = path["points_mm"][0]
        else:
            end = path["points_mm"][-1]
        target = (end[0], end[1])


def _start_toward(points, closed, target, allow_reverse):
    pts = [list(pt) for pt in points]
    if len(pts) < 2:
        return pts
    if not closed:
        if _dist2_to(pts[-1], target) < _dist2_to(pts[0], target):
            pts.reverse()
        return pts
    if allow_reverse:
        spun = list(reversed(pts))
        if _best_dist(spun, target) < _best_dist(pts, target):
            pts = spun
    index = min(range(len(pts)), key=lambda i: _dist2_to(pts[i], target))
    return pts[index:] + pts[:index]


def _best_dist(points, target):
    return min(_dist2_to(pt, target) for pt in points)


def _dist2_to(pt, target):
    return (pt[0] - target[0]) ** 2 + (pt[1] - target[1]) ** 2


def main(argv=None):
    parser = argparse.ArgumentParser(description="Send a job to a CameraCut plotter")
    parser.add_argument("job", nargs="?", help="JSON job from the Illustrator script")
    parser.add_argument("--pattern", action="store_true", help="send the built-in test pattern")
    parser.add_argument("--force-card", action="store_true", help="send the force and pass-count card")
    parser.add_argument("--pen-force", type=int, default=20, help="force for the right-holder pen")
    parser.add_argument("--pen-speed", type=int, default=20, help="drawing speed for the pen")
    parser.add_argument("--pen-holder", choices=("left", "right"), default="right",
                        help="pen holder; the knife uses the other one")
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
    parser.add_argument("--offset", type=float, default=0.35,
                        help="blade offset for the cut squares, in mm; the pen stays at 0")
    parser.add_argument("--overcut", type=float, default=0,
                        help="extend each square side past the corners, in mm")
    parser.add_argument("--steg", type=float, default=0.5,
                        help="unbroken gap in the middle of each square side, in mm")
    parser.add_argument("--alternate", action="store_true",
                        help="cut later passes from the other end, knife up in between")
    parser.add_argument("--y-axis", choices=("force", "speed"), default="force",
                        help="which setting runs down the sheet")
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
            travel=args.travel, overcut=args.overcut, y_axis=args.y_axis,
            steg=args.steg, pen_speed=args.pen_speed, pen_holder=args.pen_holder,
            offset=args.offset,
        )
        if args.alternate:
            document["alternate"] = True
        payload = job_from_document(document)
    elif args.pattern:
        payload = encode_test_pattern()
    elif args.job:
        with open(args.job, "r") as handle:
            document = json.load(handle)
        if args.alternate:
            document["alternate"] = True
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
