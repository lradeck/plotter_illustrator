"""Send a CameraCut job, or the built-in speed/force test pattern."""

import argparse
import json
import os
import socket
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from force_card import build_force_card, join_strokes
from pattern import encode_test_pattern
from protocol import describe_sent, encode_job, preview_strokes, sent_segments


def send_text(payload, host, port, timeout=5.0):
    sock = socket.create_connection((host, port), timeout)
    try:
        sock.sendall(payload.encode("ascii"))
    finally:
        sock.close()
    return payload


def sent_view(document):
    """Preview geometry plus the commands a real send would write."""
    raw = []
    for path in document.get("paths") or []:
        copy = dict(path)
        copy["points_mm"] = [list(pt) for pt in path.get("points_mm") or []]
        raw.append(copy)
    preview_paths = []
    for path in raw:
        copy = dict(path)
        copy["points_mm"] = [list(pt) for pt in path["points_mm"]]
        preview_paths.append(copy)
    strokes = preview_strokes(expand_stay_chains(_group_stay(preview_paths)))
    points = [pt for path in raw for pt in path["points_mm"]]
    if not points:
        return {"strokes": strokes, "ticks": [], "segments": [], "sections": []}
    min_x = min(pt[0] for pt in points)
    max_y = max(pt[1] for pt in points)
    paths = raw
    page = document.get("page_mm", [297, 420])
    origin = document.get("origin_mm", [0, 0])
    if document.get("anchor") == "top-left":
        paths, page = anchor_top_left(paths)
        origin = (0, 0)
    payload = encode_job(
        paths,
        page,
        origin,
        accurate=document.get("accurate", True),
        blade_offset_mm=document.get("blade_offset_mm", 0.35),
        overcut_mm=document.get("overcut_mm", 0.0),
        turn_knife_mm=document.get("turn_knife_mm", 1.0),
        alternate=bool(document.get("alternate", False)),
    )
    sections, ticks = describe_sent(payload, paths, min_x, max_y)
    return {
        "strokes": strokes,
        "ticks": ticks,
        "segments": sent_segments(payload, min_x, max_y),
        "sections": sections,
        "blade_offset_mm": float(document.get("blade_offset_mm", 0.35)),
    }


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
    anchored = _group_stay(anchored)
    _chain(anchored)
    anchored = expand_stay_chains(anchored)
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


JOIN_MM = 0.08


def _near_pt(a, b):
    return abs(a[0] - b[0]) <= JOIN_MM and abs(a[1] - b[1]) <= JOIN_MM


def _point_key(pt):
    return (round(pt[0] / JOIN_MM), round(pt[1] / JOIN_MM))


def _is_closed(path):
    return bool(path.get("closed", True))


def _geom_end(path):
    """Where one trip along the path finishes, before extra passes."""
    pts = path["points_mm"]
    if _is_closed(path):
        return pts[0]
    return pts[-1]


def _joint_points(path):
    pts = path["points_mm"]
    if _is_closed(path):
        return pts
    return [pts[0], pts[-1]]


def _touches(a, b):
    if a.get("holder") != b.get("holder"):
        return False
    if (a.get("mode") or "cut") != (b.get("mode") or "cut"):
        return False
    for left in _joint_points(a):
        for right in _joint_points(b):
            if _near_pt(left, right):
                return True
    return False


def _reverse_open(path):
    path["points_mm"] = [list(pt) for pt in reversed(path["points_mm"])]
    forces = path.get("point_forces")
    if forces and len(forces) == len(path["points_mm"]):
        path["point_forces"] = list(reversed(forces))


def _face_open(path, target):
    pts = path["points_mm"]
    if _dist2_to(pts[-1], target) + 1e-9 < _dist2_to(pts[0], target):
        _reverse_open(path)


def _rotate_closed(path, key):
    pts = path["points_mm"]
    index = None
    for i, pt in enumerate(pts):
        if _point_key(pt) == key:
            index = i
            break
    if not index:
        return
    path["points_mm"] = [list(pt) for pt in pts[index:] + pts[:index]]
    forces = path.get("point_forces")
    if forces and len(forces) == len(pts):
        path["point_forces"] = forces[index:] + forces[:index]


def _link_spine(opens):
    if not opens or any(not isinstance(path.get("link"), int) for path in opens):
        return None
    groups = set(path.get("link_group", 0) for path in opens)
    if len(groups) != 1:
        return None
    ordered = sorted(opens, key=lambda path: path["link"])
    if _spine_fits(ordered):
        return ordered
    for path in ordered:
        _reverse_open(path)
    flipped = list(reversed(ordered))
    if _spine_fits(flipped):
        return flipped
    for path in ordered:
        _reverse_open(path)
    return None


def _spine_fits(ordered):
    for index in range(len(ordered) - 1):
        if not _near_pt(_geom_end(ordered[index]), ordered[index + 1]["points_mm"][0]):
            return False
    return True


def _order_opens(opens, target):
    if not opens:
        return []
    linked = _link_spine(opens)
    if linked is not None:
        return linked
    remaining = list(opens)
    start = min(remaining, key=lambda path: min(
        _dist2_to(path["points_mm"][0], target),
        _dist2_to(path["points_mm"][-1], target),
    ))
    _face_open(start, target)
    remaining.remove(start)
    ordered = [start]
    while remaining:
        end = _geom_end(ordered[-1])
        nxt = None
        for path in remaining:
            if _near_pt(path["points_mm"][0], end) or _near_pt(path["points_mm"][-1], end):
                nxt = path
                break
        if nxt is None:
            nxt = remaining[0]
        _face_open(nxt, end)
        remaining.remove(nxt)
        ordered.append(nxt)
    return ordered


def _order_loops(loops, target):
    counts = {}
    for loop in loops:
        seen = set()
        for pt in loop["points_mm"]:
            key = _point_key(pt)
            if key in seen:
                continue
            seen.add(key)
            counts.setdefault(key, []).append(loop)
    shared = [key for key, group in counts.items() if len(group) >= 2]
    if not shared:
        return loops
    key = min(shared, key=lambda item: _dist2_to((item[0] * JOIN_MM, item[1] * JOIN_MM), target))
    ordered = []
    for loop in loops:
        if any(_point_key(pt) == key for pt in loop["points_mm"]):
            _rotate_closed(loop, key)
            ordered.append(loop)
    for loop in loops:
        if loop not in ordered:
            ordered.append(loop)
    return ordered


def _order_stay(paths, target):
    opens = [path for path in paths if not _is_closed(path)]
    loops = [path for path in paths if _is_closed(path)]
    spine = _order_opens(opens, target)
    if not loops:
        _mark_resume(spine)
        return spine
    if not spine:
        ordered = _order_loops(loops, target)
        _mark_resume(ordered)
        return ordered
    buckets = {}
    for loop in loops:
        for pt in loop["points_mm"]:
            buckets.setdefault(_point_key(pt), []).append(loop)
    used = set()
    result = []

    def take(key):
        for loop in buckets.get(key, []):
            if id(loop) in used:
                continue
            _rotate_closed(loop, key)
            used.add(id(loop))
            result.append(loop)

    take(_point_key(spine[0]["points_mm"][0]))
    for piece in spine:
        result.append(piece)
        take(_point_key(_geom_end(piece)))
    for loop in loops:
        if id(loop) not in used:
            result.append(loop)
    _mark_resume(result)
    return result


def _mark_resume(chain):
    for index in range(1, len(chain)):
        if _near_pt(_geom_end(chain[index - 1]), chain[index]["points_mm"][0]):
            chain[index - 1]["handoff"] = True
            chain[index - 1]["joined"] = True
            chain[index]["resume"] = True
            chain[index]["joined"] = True


def _group_stay(paths):
    """Keep touching paths together and aim each one along the cut.

    Zusammenhaengend and the lift mode share this order. The lift mode
    only leaves the knife up at the joint between two pieces.
    """
    used = [False] * len(paths)
    ordered = []
    for index, path in enumerate(paths):
        if used[index]:
            continue
        if len(path.get("points_mm") or []) < 2:
            ordered.append(path)
            used[index] = True
            continue
        group = [index]
        used[index] = True
        grew = True
        while grew:
            grew = False
            for other in range(len(paths)):
                if used[other] or len(paths[other].get("points_mm") or []) < 2:
                    continue
                if any(_touches(paths[member], paths[other]) for member in group):
                    group.append(other)
                    used[other] = True
                    grew = True
        members = [paths[member] for member in group]
        if len(members) == 1:
            ordered.append(members[0])
            continue
        incoming = (0.0, 0.0)
        if ordered:
            incoming = _geom_end(ordered[-1])
        ordered.extend(_order_stay(members, incoming))
    for index, path in enumerate(ordered):
        path["order"] = index
    return ordered


def expand_stay_chains(paths):
    """Repeat a joined outline as a whole, once per pass.

    Piece 1 four times and then piece 2 four times would walk back and
    forth on the first piece. A split form is one loop, so the passes go
    around that loop.
    """
    result = []
    group = []

    def flush():
        if not group:
            return
        if len(group) == 1:
            result.append(group[0])
            del group[:]
            return
        laps = 1
        for path in group:
            laps = max(laps, int(path.get("passes", 1) or 1))
        closes = _near_pt(_geom_end(group[-1]), group[0]["points_mm"][0])
        for lap in range(laps):
            for index, path in enumerate(group):
                copy = dict(path)
                copy["passes"] = 1
                previous = group[-1] if index == 0 else group[index - 1]
                both_down = path.get("stay_down") is True and previous.get("stay_down") is True
                copy["resume"] = both_down and (index > 0 or (lap > 0 and closes))
                copy["handoff"] = not (index == len(group) - 1 and lap == laps - 1)
                result.append(copy)
        del group[:]

    for path in paths:
        if path.get("resume") and group:
            group.append(path)
        else:
            flush()
            group.append(path)
    flush()
    for index, path in enumerate(result):
        path["order"] = index
    return result


def _chain(paths):
    target = (0.0, 0.0)
    for path in paths:
        closed = bool(path.get("closed", True))
        if path.get("joined"):
            end = _geom_end(path)
            target = (end[0], end[1])
            continue
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
    parser.add_argument("--no-titles", action="store_true", help="omit the X and Y axis titles")
    parser.add_argument("--preview-out", help="write a simulate preview and do not connect")
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
            titles=not args.no_titles,
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
        if args.preview_out and not args.out and not args.dry_run:
            payload = None
        else:
            payload = job_from_document(document)
    else:
        parser.error("pass a job json, --pattern, or --force-card")

    if args.json_out:
        if document is None:
            parser.error("--json-out needs --force-card or a job file")
        with open(args.json_out, "w") as handle:
            json.dump(document, handle)
    if args.preview_out:
        if document is None:
            parser.error("--preview-out needs a job file")
        with open(args.preview_out, "w") as handle:
            json.dump(sent_view(document), handle)
        return 0
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
