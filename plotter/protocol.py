"""CameraCut plotter language.

Units are 40 per millimetre (0.025 mm), which is what a live send used:
an A3 mat is FSIZE16800,11880 and a 122.0 mm side is 4880 units.

A knife job captured from Send to Cutter looked like:

    IN FSIZE16800,11880 CMD:32,16800,11880,1984,2344;CMD:35,2,1,0;U... D... U0,0 @

Left and right holders are the tool tokens stored in CameraCut as
LEFT-CMD / RIGHT-CMD. On this machine the left holder is P0; the right
holder token in the program is P1;. Force, cut speed and travel speed are
FS, VS and US, inserted in front of the path when a color has a cutting
setting. Folding is a blade type on a holder: the crease path is sent on
that holder without the drag-knife corner swing.
"""

import math
import re

UNITS_PER_MM = 40
PARK_TRAVEL = 200

HOLDERS = {
    "left": "P0;",
    "right": "P1;",
}


def units(mm):
    return int(round(float(mm) * UNITS_PER_MM))


def encode_job(paths, page_mm, origin_mm=(0, 0), accurate=True,
               blade_offset_mm=0.35, overcut_mm=0.0, turn_knife_mm=0.0,
               alternate=False, keep_laps=False):
    """Build the ASCII job CameraCut writes to the plotter.

    paths: dicts with holder, mode ('cut' or 'fold'), force, cut_speed,
    travel_speed, and points_mm (closed outline, first point not repeated).
    page_mm: (width, height) of the mat.
    origin_mm: the CMD:32 origin pair. The captured job carried the
    placement of the art on the mat here; path coordinates are absolute
    on that same mat.
    """
    page_w = units(page_mm[0])
    page_h = units(page_mm[1])
    origin_x = units(origin_mm[0])
    origin_y = units(origin_mm[1])
    parts = [
        "IN FSIZE%d,%d CMD:32,%d,%d,%d,%d;CMD:35,2,1,0;" % (
            page_w, page_h, page_w, page_h, origin_x, origin_y
        )
    ]
    holder = None
    for path in paths:
        points = [(units(x), units(y)) for x, y in path["points_mm"]]
        knife = accurate and path.get("mode", "cut") == "cut"
        offset = path.get("blade_offset_mm", None)
        if offset is None:
            offset = blade_offset_mm
        radius = units(offset) if knife else 0
        overcut = units(overcut_mm) if knife else 0
        turn = units(turn_knife_mm) if knife else 0
        passes = int(path.get("passes", 1))
        if passes < 1:
            raise ValueError("passes must be at least 1")
        resume = bool(path.get("resume")) and path.get("stay_down") is True and holder == path.get("holder")
        if resume:
            parts.append("FS%d;VS%d;" % (_lap_forces(path, passes)[0], int(path["cut_speed"])))
        else:
            parts.append(_tool_prefix(path))
        holder = path.get("holder")
        parts.append(_decorate(path, _moves(
            points, radius, overcut, turn,
            closed=path.get("closed", True),
            passes=passes,
            alternate=alternate and path.get("mode", "cut") == "cut",
            stay_down=path.get("stay_down", None),
            resume=resume,
            handoff=bool(path.get("handoff")),
        ), keep_laps))
    parts.append("US%d; U0,0 @ " % PARK_TRAVEL)
    return "".join(parts)


def _tool_prefix(path):
    holder = path.get("holder", "left")
    if holder not in HOLDERS:
        raise ValueError("holder must be left or right, got %r" % holder)
    passes = int(path.get("passes", 1))
    if passes < 1:
        passes = 1
    return "%sFS%d;VS%d;US%d;" % (
        HOLDERS[holder],
        _lap_forces(path, passes)[0],
        int(path["cut_speed"]),
        int(path["travel_speed"]),
    )


def _moves(points, radius, overcut, turn, closed=True, passes=1, alternate=False, stay_down=None, resume=False, handoff=False):
    if len(points) < 2:
        raise ValueError("a path needs at least two points")
    if not closed:
        # A straight stroke has no corner, so the knife is not swung.
        # Every pass starts with the knife up, unless the material says the
        # passes stay down on a continuous path. Alternating still starts
        # even passes at the other end and lifts between them.
        commands = []
        if stay_down is not None and not alternate:
            begun = False
            if not resume:
                commands.append("U%d,%d" % points[0])
                begun = True
            for lap in range(passes):
                if lap:
                    commands.append("LAP")
                for point in points:
                    if not begun:
                        begun = True
                        continue
                    commands.append("D%d,%d" % point)
            return " ".join(commands) + " "
        for lap in range(passes):
            stroke = list(reversed(points)) if alternate and lap % 2 == 1 else points
            commands.append("U%d,%d" % stroke[0])
            for point in stroke:
                commands.append("D%d,%d" % point)
        return " ".join(commands) + " "
    if alternate:
        return _alternate_closed(points, radius, overcut, turn, passes)
    return _camera_closed(points, radius, overcut, turn, passes, resume=resume, handoff=handoff)


def _camera_closed(points, radius, overcut, turn, passes, resume=False, handoff=False):
    """One tick, then every lap in a single pen-down.

    CameraCut keeps the knife down through the corner arcs. It plunges one
    blade-offset past the point where the closing arc meets the first side,
    runs the outline once per pass, and stops one further offset past that
    plunge. The captured square used 14, 28 and 42 units for a 0.35 mm offset.
    """
    outline = _outline(points, radius)
    if outline[0] != outline[-1]:
        outline.append(outline[0])
    junction = outline[0]
    far = outline[1]
    length = math.hypot(far[0] - junction[0], far[1] - junction[1])
    tail = 2 * radius + overcut
    if radius > 0 and length > tail:
        plunge = _extend(junction, far, radius)
        seam = _extend(junction, far, 2 * radius)
    else:
        plunge = junction
        seam = junction
    finish = _extend(seam, far, overcut) if overcut > 0 else seam
    commands = []
    if turn > 0 and not resume:
        commands.extend(_turn_knife(plunge, far, turn))
    path = [plunge]
    ring = outline[:-1]
    boundaries = []
    for lap in range(passes):
        if lap:
            boundaries.append(len(path))
        path.extend(ring[1:])
        path.append(ring[0])
    if not handoff:
        if seam != path[-1]:
            path.append(seam)
        if finish != path[-1]:
            path.append(finish)
    if not resume:
        commands.append("U%d,%d" % path[0])
    previous = None
    boundary_at = {}
    for index in boundaries:
        boundary_at[index] = True
    for index, point in enumerate(path):
        if index in boundary_at:
            commands.append("LAP")
        if point == previous:
            continue
        commands.append("D%d,%d" % point)
        previous = point
    return " ".join(commands) + " "


def _alternate_closed(points, radius, overcut, turn, passes):
    """Lift between laps and start the next one at the following corner."""
    commands = []
    count = len(points)
    for lap in range(passes):
        shift = lap % count
        ring = points[shift:] + points[:shift]
        if lap % 2 == 1:
            ring = list(reversed(ring))
        outline = _outline(ring, radius)
        lead = _lead_in(ring, radius)
        if turn > 0 and len(outline) >= 2:
            commands.extend(_turn_knife(outline[0], outline[1], turn))
        if len(lead) >= 2 and lead[-1] == outline[0]:
            commands.append("U%d,%d" % lead[0])
            for point in lead:
                commands.append("D%d,%d" % point)
            for point in outline[1:]:
                commands.append("D%d,%d" % point)
        else:
            commands.append("U%d,%d" % outline[0])
            for point in outline:
                commands.append("D%d,%d" % point)
        if overcut > 0 and len(outline) >= 2:
            commands.append("D%d,%d" % _extend(outline[0], outline[1], overcut))
    return " ".join(commands) + " "


def _lead_in(points, radius):
    """Corner swing that aims the blade along the side into the first vertex."""
    if radius <= 0 or len(points) < 3:
        return []
    return _corner_arc(points[-2], points[-1], points[0], radius)


def _outline(points, radius):
    if radius <= 0 or len(points) < 3:
        closed = list(points) + [points[0]]
        return closed
    arcs = []
    count = len(points)
    for index in range(count):
        prev = points[(index - 1) % count]
        corner = points[index]
        nxt = points[(index + 1) % count]
        arcs.append(_corner_arc(prev, corner, nxt, radius))
    outline = []
    for index, arc in enumerate(arcs):
        previous = arcs[(index - 1) % count]
        if not outline:
            outline.append(previous[-1])
        elif outline[-1] != previous[-1]:
            outline.append(previous[-1])
        outline.append(arc[0])
        outline.extend(arc[1:])
    if outline[0] != outline[-1]:
        outline.append(outline[0])
    return outline


def _corner_arc(prev, corner, nxt, radius):
    incoming = _unit(corner[0] - prev[0], corner[1] - prev[1])
    outgoing = _unit(nxt[0] - corner[0], nxt[1] - corner[1])
    if incoming is None or outgoing is None:
        return [corner]
    start_angle = math.atan2(incoming[1], incoming[0])
    end_angle = math.atan2(outgoing[1], outgoing[0])
    sweep = (end_angle - start_angle + math.pi) % (2 * math.pi) - math.pi
    if abs(sweep) < 1e-6:
        return [corner]
    # Drag-knife center swings around the corner on the offset radius.
    points = []
    steps = 3
    for step in range(0, steps + 1):
        angle = start_angle + sweep * step / float(steps)
        points.append((
            int(round(corner[0] + radius * math.cos(angle))),
            int(round(corner[1] + radius * math.sin(angle))),
        ))
    return points


def _turn_knife(start, nxt, length):
    """1 mm on the cut, from its first point, so the blade faces the line."""
    direction = _unit(nxt[0] - start[0], nxt[1] - start[1])
    if direction is None:
        return []
    tip = (
        int(round(start[0] + direction[0] * length)),
        int(round(start[1] + direction[1] * length)),
    )
    return [
        "U%d,%d" % start,
        "D%d,%d" % start,
        "D%d,%d" % tip,
        "U%d,%d" % tip,
    ]


def _extend(start, nxt, distance):
    direction = _unit(nxt[0] - start[0], nxt[1] - start[1])
    if direction is None:
        return start
    return (
        int(round(start[0] + direction[0] * distance)),
        int(round(start[1] + direction[1] * distance)),
    )


def _unit(dx, dy):
    length = math.hypot(dx, dy)
    if length < 1e-6:
        return None
    return (dx / length, dy / length)


def speed_at(points, query, cut_speed, boost, detail_deg=25, ramp_mm=8, closed=True):
    """Speed in mm/s at a point on the path.

    Straight stretches use `boost`. Within `ramp_mm` of a corner or a tight
    bend the speed eases down to `cut_speed` and back up afterwards.
    """
    cut_speed = float(cut_speed)
    if not boost or float(boost) <= cut_speed or len(points) < 3:
        return cut_speed
    boost = float(boost)
    detail_deg = float(detail_deg or 25)
    ramp_mm = max(float(ramp_mm or 0), 0.0)
    located = _locate(points, query, closed)
    if located is None:
        return cut_speed
    dist = _detail_distance(points, located[0], detail_deg, closed)
    if ramp_mm <= 0 or dist >= ramp_mm:
        return boost if dist > 0 else cut_speed
    if dist <= 0:
        return cut_speed
    t = dist / ramp_mm
    smooth = t * t * (3.0 - 2.0 * t)
    return cut_speed + (boost - cut_speed) * smooth


def detail_flags(points, detail_deg=25, closed=True):
    count = len(points)
    flags = [False] * count
    if count < 3:
        return flags
    limit = float(detail_deg or 25)
    turns = []
    span = count if closed else count - 2
    for index in range(count):
        if not closed and (index == 0 or index == count - 1):
            turns.append(0.0)
            continue
        prev = points[(index - 1) % count]
        nxt = points[(index + 1) % count]
        turns.append(_turn_deg(prev, points[index], nxt))
        if turns[-1] >= limit:
            flags[index] = True
    lengths = _segment_lengths(points, closed)
    window = 5.0
    for index in range(count):
        if not closed and (index == 0 or index == count - 1):
            continue
        total = 0.0
        walked = 0.0
        cursor = index
        while walked < window and cursor < len(lengths):
            total += turns[cursor]
            step = lengths[cursor]
            if step <= 0:
                break
            walked += step
            cursor = (cursor + 1) % count if closed else cursor + 1
            if cursor >= count or cursor == index:
                break
        if total >= limit:
            flags[index] = True
    return flags


def fine_spans(points, detail_deg=25, ramp_mm=8, closed=True, loop=None):
    """Pink pieces for the simulate view.

    A fine spot is a vertex that turns at least `detail_deg`, counting the
    bend on both sides, or a point on a cut-over loop. Straight runs keep
    their color. Only the `ramp_mm` next to a fine spot is marked, so both
    cut-over legs show and a long side does not.
    """
    count = len(points)
    if count < 2:
        return []
    flags = _fine_points(points, detail_deg, closed, loop)
    ramp = max(float(ramp_mm or 0), 0.0)
    limit = count if closed else count - 1
    spans = []
    for index in range(limit):
        end = (index + 1) % count
        ax, ay = points[index]
        bx, by = points[end]
        dx = bx - ax
        dy = by - ay
        length = math.hypot(dx, dy)
        if length < 1e-9:
            continue
        start_fine = flags[index]
        end_fine = flags[end]
        if not start_fine and not end_fine:
            continue
        ux = dx / length
        uy = dy / length
        if start_fine and end_fine and length <= max(ramp, 0.0) * 2.0:
            spans.append([[ax, ay], [bx, by]])
            continue
        if start_fine:
            take = length if ramp <= 0 else min(length, ramp)
            spans.append([[ax, ay], [ax + ux * take, ay + uy * take]])
        if end_fine:
            take = length if ramp <= 0 else min(length, ramp)
            spans.append([[bx - ux * take, by - uy * take], [bx, by]])
    return spans


def _fine_points(points, detail_deg, closed, loop):
    count = len(points)
    flags = [False] * count
    if count < 3:
        return flags
    limit = float(detail_deg or 25)
    turns = []
    for index in range(count):
        if not closed and (index == 0 or index == count - 1):
            turns.append(0.0)
            continue
        prev = points[(index - 1) % count]
        nxt = points[(index + 1) % count]
        turns.append(_turn_deg(prev, points[index], nxt))
    lengths = _segment_lengths(points, closed)
    for index in range(count):
        on_loop = bool(loop and index < len(loop) and loop[index])
        around = _turn_around(turns, lengths, index, 5.0, closed)
        if on_loop or turns[index] >= limit or around >= limit:
            flags[index] = True
    return flags


def _turn_around(turns, lengths, index, window, closed):
    total = turns[index]
    count = len(turns)
    for sign in (-1, 1):
        walked = 0.0
        cursor = index
        guard = 0
        while walked < window and guard < count:
            guard += 1
            if sign > 0:
                if not closed and cursor >= len(lengths):
                    break
                step = lengths[cursor]
                nxt = cursor + 1
            else:
                prev = cursor - 1
                if not closed and prev < 0:
                    break
                step = lengths[prev]
                nxt = prev
            if step <= 0:
                break
            walked += step
            if closed:
                nxt %= count
            if nxt == index or nxt < 0 or nxt >= count:
                break
            total += turns[nxt]
            cursor = nxt
    return total


def force_on_segment(points, query, point_forces, closed=True):
    """Loop force when the query sits on a segment whose ends share one."""
    if not point_forces or len(point_forces) != len(points):
        return None
    located = _locate(points, query, closed)
    if located is None:
        return None
    index = located[1]
    end = (index + 1) % len(points)
    if not closed and index >= len(points) - 1:
        return None
    start_force = point_forces[index]
    end_force = point_forces[end]
    if start_force is None or end_force is None:
        return None
    if int(round(float(start_force))) != int(round(float(end_force))):
        return None
    return int(round(float(start_force)))


def preview_strokes(paths):
    """Drawing-order samples for the simulate view."""
    ordered = sorted(paths, key=lambda path: path.get("order", 0))
    strokes = []
    for path in ordered:
        points = path.get("points_mm") or []
        if len(points) < 2:
            continue
        try:
            strokes.append(_preview_stroke(path, points))
        except Exception as exc:
            strokes.append({
                "points": points,
                "speeds": [path.get("cut_speed", path.get("speed", 20))] * len(points),
                "forces": [int(path.get("force", 20))] * len(points),
                "detail": [False] * len(points),
                "detail_spans": [],
                "ramp": path.get("ramp_mm", 8),
                "closed": bool(path.get("closed", True)),
                "passes": int(path.get("passes", 1) or 1),
                "mode": path.get("mode", "cut"),
                "layer": path.get("layer", ""),
                "order": path.get("order", 0),
                "error": str(exc),
            })
    return strokes


def _preview_stroke(path, points):
    closed = bool(path.get("closed", True))
    cut = path.get("cut_speed", path.get("speed", 20))
    detail = path.get("detail_deg", 25)
    ramp = path.get("ramp_mm", 8)
    boost = path.get("boost_speed")
    flags = detail_flags(points, detail, closed)
    point_forces = path.get("point_forces")
    loop = []
    if point_forces:
        for index in range(len(points)):
            loop.append(index < len(point_forces) and point_forces[index] is not None)
    speeds = []
    forces = []
    for index, point in enumerate(points):
        speeds.append(round(speed_at(
            points, point, cut, boost, detail, ramp, closed
        ), 2))
        special = None
        if point_forces and index < len(point_forces):
            special = point_forces[index]
        forces.append(int(special if special is not None else path.get("force", 20)))
    return {
        "points": points,
        "speeds": speeds,
        "forces": forces,
        "detail": flags,
        "detail_spans": fine_spans(points, detail, ramp, closed, loop),
        "ramp": ramp,
        "closed": closed,
        "passes": int(path.get("passes", 1)),
        "mode": path.get("mode", "cut"),
        "layer": path.get("layer", ""),
        "order": path.get("order", 0),
        "stay_down": path.get("stay_down", None),
    }


def _decorate(path, text, keep_laps=False):
    boost = path.get("boost_speed")
    point_forces = path.get("point_forces")
    passes = int(path.get("passes", 1))
    lap_forces = _lap_forces(path, passes)
    varied = len(set(lap_forces)) > 1
    if not boost and not point_forces and not varied:
        if keep_laps:
            return text
        return text.replace(" LAP ", " ")
    src = path.get("points_mm") or []
    closed = bool(path.get("closed", True))
    cut = float(path.get("cut_speed", 20))
    detail = path.get("detail_deg", 25)
    ramp = path.get("ramp_mm", 8)
    tokens = text.split()
    out = []
    speed_state = int(round(cut))
    force_state = lap_forces[0]
    lap = 0
    down = False
    down_len = 0.0
    last = None
    for token in tokens:
        if token == "LAP":
            if lap + 1 < len(lap_forces):
                lap += 1
            wanted = lap_forces[min(lap, len(lap_forces) - 1)]
            if wanted != force_state:
                force_state = wanted
                out.append("FS%d;" % force_state)
            if keep_laps:
                out.append("LAP")
            continue
        if len(token) < 4 or token[0] not in "UD":
            out.append(token)
            continue
        kind = token[0]
        xs, ys = token[1:].split(",")
        x, y = int(xs), int(ys)
        if kind == "U":
            if down and down_len > 3.0 and lap + 1 < len(lap_forces):
                lap += 1
            down = False
            down_len = 0.0
            last = None
            if lap_forces[min(lap, len(lap_forces) - 1)] != force_state:
                force_state = lap_forces[min(lap, len(lap_forces) - 1)]
                out.append("FS%d;" % force_state)
        else:
            # The plotter keeps the current speed until the next point.
            # A long straight side is one move, so the fast middle never
            # happens unless that move is split into samples. The knife stays
            # down; the samples are still one path.
            targets = [(x, y)]
            if last is not None and boost and len(src) >= 2:
                gap = math.hypot(x - last[0], y - last[1])
                pieces = int(gap / (2.0 * UNITS_PER_MM))
                if pieces > 1:
                    targets = []
                    for step in range(1, pieces + 1):
                        portion = step / float(pieces)
                        targets.append((
                            int(round(last[0] + (x - last[0]) * portion)),
                            int(round(last[1] + (y - last[1]) * portion)),
                        ))
                    if targets[-1] != (x, y):
                        targets.append((x, y))
            for tx, ty in targets:
                if last is not None:
                    down_len += math.hypot(tx - last[0], ty - last[1]) / float(UNITS_PER_MM)
                last = (tx, ty)
                down = True
                mm = (tx / float(UNITS_PER_MM), ty / float(UNITS_PER_MM))
                if boost and len(src) >= 2:
                    spd = int(round(speed_at(src, mm, cut, boost, detail, ramp, closed)))
                    if spd != speed_state:
                        out.append("VS%d;" % spd)
                        speed_state = spd
                wanted = force_state
                if point_forces:
                    special = force_on_segment(src, mm, point_forces, closed)
                    wanted = special if special is not None else lap_forces[min(lap, len(lap_forces) - 1)]
                elif varied:
                    wanted = lap_forces[min(lap, len(lap_forces) - 1)]
                if wanted != force_state:
                    force_state = wanted
                    out.append("FS%d;" % force_state)
                out.append("D%d,%d" % (tx, ty))
            continue
        out.append(token)
    return " ".join(out) + " "


def _lap_forces(path, passes):
    raw = path.get("forces")
    if isinstance(raw, (list, tuple)) and raw:
        forces = [int(round(float(value))) for value in raw]
    else:
        forces = [int(round(float(path.get("force", 20))))]
    if len(forces) < passes:
        forces.extend([forces[-1]] * (passes - len(forces)))
    return forces[:passes]


def _detail_distance(points, arc_pos, detail_deg, closed):
    flags = detail_flags(points, detail_deg, closed)
    lengths = _segment_lengths(points, closed)
    total = sum(lengths)
    if total <= 0:
        return 0.0
    marks = []
    walked = 0.0
    for index, flag in enumerate(flags):
        if flag:
            marks.append(walked)
        if index < len(lengths):
            walked += lengths[index]
    if not marks:
        return total
    best = total
    for mark in marks:
        if closed:
            gap = abs(arc_pos - mark)
            gap = min(gap, total - gap)
        else:
            gap = abs(arc_pos - mark)
        if gap < best:
            best = gap
    return best


def _locate(points, query, closed):
    count = len(points)
    if count < 2:
        return None
    limit = count if closed else count - 1
    best = None
    best_dist = None
    best_arc = 0.0
    walked = 0.0
    for index in range(limit):
        end = (index + 1) % count
        ax, ay = points[index]
        bx, by = points[end]
        dx = bx - ax
        dy = by - ay
        length = math.hypot(dx, dy)
        if length < 1e-9:
            continue
        t = ((query[0] - ax) * dx + (query[1] - ay) * dy) / (length * length)
        if t < 0:
            t = 0.0
        elif t > 1:
            t = 1.0
        px = ax + dx * t
        py = ay + dy * t
        dist = math.hypot(query[0] - px, query[1] - py)
        if best_dist is None or dist < best_dist:
            best_dist = dist
            best = index
            best_arc = walked + length * t
        walked += length
    if best is None:
        return None
    return (best_arc, best)


def _segment_lengths(points, closed):
    count = len(points)
    limit = count if closed else count - 1
    lengths = []
    for index in range(limit):
        end = (index + 1) % count
        lengths.append(math.hypot(
            points[end][0] - points[index][0],
            points[end][1] - points[index][1],
        ))
    return lengths


def _turn_deg(prev, here, nxt):
    ax = here[0] - prev[0]
    ay = here[1] - prev[1]
    bx = nxt[0] - here[0]
    by = nxt[1] - here[1]
    la = math.hypot(ax, ay)
    lb = math.hypot(bx, by)
    if la < 1e-9 or lb < 1e-9:
        return 0.0
    cos = (ax * bx + ay * by) / (la * lb)
    if cos > 1:
        cos = 1
    elif cos < -1:
        cos = -1
    return math.degrees(math.acos(cos))


def parse_job(text):
    """Split a job into the header fields and the U/D moves."""
    header_at = text.find(";")
    if header_at < 0 or not text.startswith("IN FSIZE"):
        raise ValueError("not a CameraCut job")
    header = text[:header_at]
    # second semicolon closes CMD:35
    mode_at = text.find(";", header_at + 1)
    if mode_at < 0:
        raise ValueError("job is missing CMD:35")
    mode = text[header_at + 1:mode_at]
    body = text[mode_at + 1:]
    moves = []
    for token in body.replace("@", " ").split():
        if len(token) < 4 or token[0] not in "UD":
            continue
        comma = token.find(",")
        if comma < 0:
            continue
        moves.append((token[0], int(token[1:comma]), int(token[comma + 1:])))
    size = header.split("FSIZE", 1)[1].split()[0]
    width, height = size.split(",")
    return {
        "page": (int(width), int(height)),
        "header": header,
        "mode": mode,
        "moves": moves,
        "raw": text,
    }


_SENT_TOKEN = re.compile(
    r"P[01];|FS\d+;|VS\d+;|US\d+;|U-?\d+,-?\d+|D-?\d+,-?\d+|LAP|@"
)


def describe_sent(payload, paths, min_x, max_y):
    """Group the exact plotter text and put the turn stroke back on the drawing.

    paths are the anchored paths in send order. min_x and max_y are the
    drawing's top-left, so machine coordinates land back on the art.
    """
    tokens = _SENT_TOKEN.findall(payload or "")
    if tokens and tokens[-1] == "@":
        tokens.pop()
    park = []
    if tokens and tokens[-1] == "U0,0":
        park = [tokens.pop()]
    if tokens and tokens[-1].startswith("US"):
        park.insert(0, tokens.pop())
    header_at = re.search(r"P[01];", payload or "")
    header = (payload[:header_at.start()] if header_at else payload or "").strip()
    sections = []
    if header:
        sections.append({
            "title": "Header",
            "parts": [{
                "note": "Page size and origin. The knife does not move.",
                "commands": header,
            }],
        })
    ticks = []
    index = 0
    path_index = 0
    count = len(tokens)
    while index < count:
        if tokens[index] not in ("P0;", "P1;") and not (
            tokens[index].startswith("FS") and index + 1 < count and tokens[index + 1].startswith("VS")
        ):
            index += 1
            continue
        prefix = [tokens[index]]
        index += 1
        while index < count and (
            tokens[index].startswith("FS") or tokens[index].startswith("VS") or tokens[index].startswith("US")
        ):
            prefix.append(tokens[index])
            index += 1
        moves = []
        while index < count and not _path_prefix(tokens, index):
            moves.append(tokens[index])
            index += 1
        path = paths[path_index] if path_index < len(paths) else {}
        path_index += 1
        tick, cut = _split_turn_stroke(moves)
        title = path.get("layer") or ("Path %d" % path_index)
        parts = [{
            "note": _tool_note(prefix, path),
            "commands": " ".join(prefix),
        }]
        if tick:
            parts.append({
                "note": "Turn stroke. The knife drops on the first point of the cut and draws 1 mm along that line so the blade faces it.",
                "commands": " ".join(tick),
            })
            points = _stroke_points(tick, min_x, max_y)
            if len(points) >= 2:
                ticks.append({"points": points, "layer": title})
        parts.append({
            "note": _cut_note(path, prefix[0] not in ("P0;", "P1;")),
            "commands": " ".join(cut),
        })
        sections.append({"title": title, "parts": parts})
    if park:
        sections.append({
            "title": "Park",
            "parts": [{
                "note": "Knife up. Travel speed %d back to the parked start." % PARK_TRAVEL,
                "commands": " ".join(park) + " @",
            }],
        })
    return sections, ticks


def _path_prefix(tokens, index):
    if tokens[index] in ("P0;", "P1;"):
        return True
    return tokens[index].startswith("FS") and index + 1 < len(tokens) and tokens[index + 1].startswith("VS")


def _split_turn_stroke(moves):
    if len(moves) < 4:
        return [], moves
    kinds = [move[0] for move in moves[:4]]
    if kinds != ["U", "D", "D", "U"]:
        return [], moves
    first = _xy(moves[0])
    plunge = _xy(moves[1])
    tip = _xy(moves[2])
    lift = _xy(moves[3])
    if first != plunge or tip != lift or tip == first:
        return [], moves
    span = math.hypot(tip[0] - first[0], tip[1] - first[1])
    if abs(span - units(1)) > 2:
        return [], moves
    return moves[:4], moves[4:]


def _xy(token):
    raw = token[1:]
    x, y = raw.split(",")
    return int(x), int(y)


def sent_segments(payload, min_x, max_y):
    """Knife-up travels and knife-down runs, in illustrator millimetres.

    A LAP marker starts the next pass without a lift. Each pass keeps the
    force that was in effect when it began.
    """
    tokens = _SENT_TOKEN.findall(payload or "")
    segments = []
    travel = None
    down = None
    last = None
    force = None
    # The head starts parked at machine 0,0, the drawing's top-left.
    origin = _ill_point("U0,0", min_x, max_y)
    for token in tokens:
        if token == "LAP":
            if down is not None and len(down["points"]) >= 2:
                segments.append(down)
                down = {
                    "kind": "cut",
                    "points": [down["points"][-1]],
                    "force": force,
                    "continues": True,
                }
            continue
        if token.startswith("FS"):
            force = int(token[2:-1])
            continue
        if token[0] not in "UD" or "," not in token:
            continue
        point = _ill_point(token, min_x, max_y)
        if token[0] == "U":
            if down is not None:
                segments.append(down)
                down = None
            if travel is None:
                travel = [last] if last is not None else [origin]
            if not travel or travel[-1] != point:
                travel.append(point)
            last = point
            continue
        if travel is not None and len(travel) >= 2:
            segments.append({"kind": "travel", "points": travel})
        travel = None
        if down is None:
            down = {"kind": "cut", "points": [point], "force": force}
        elif down["points"][-1] != point:
            down["points"].append(point)
        last = point
    if down is not None:
        segments.append(down)
    elif travel is not None and len(travel) >= 2:
        segments.append({"kind": "travel", "points": travel})
    for index, segment in enumerate(segments):
        if segment["kind"] != "cut" or len(segment["points"]) != 2:
            continue
        span = math.hypot(
            segment["points"][1][0] - segment["points"][0][0],
            segment["points"][1][1] - segment["points"][0][1],
        )
        if abs(span - 1.0) > 0.05:
            continue
        for later in segments[index + 1:]:
            if later["kind"] == "travel":
                continue
            if later["points"] and later["points"][0] == segment["points"][0]:
                segment["kind"] = "tick"
            break
    return segments


def _ill_point(token, min_x, max_y):
    mx, my = _xy(token)
    return [
        round(min_x - (my / float(UNITS_PER_MM)), 3),
        round((mx / float(UNITS_PER_MM)) + max_y, 3),
    ]


def _stroke_points(moves, min_x, max_y):
    points = []
    for move in moves:
        if move[0] != "D":
            continue
        mx, my = _xy(move)
        points.append([
            round(min_x - (my / float(UNITS_PER_MM)), 3),
            round((mx / float(UNITS_PER_MM)) + max_y, 3),
        ])
    return points


def _tool_note(prefix, path):
    holder = "right" if prefix and prefix[0] == "P1;" else "left"
    if prefix and prefix[0] not in ("P0;", "P1;"):
        holder = path.get("holder") or holder
    force = _prefixed(prefix, "FS")
    speed = _prefixed(prefix, "VS")
    travel = _prefixed(prefix, "US")
    text = "%s holder, force %s, cut speed %s" % (holder.capitalize(), force, speed)
    if travel is not None:
        text += ", travel %s" % travel
    text += "."
    return text


def _prefixed(prefix, name):
    for token in prefix:
        if token.startswith(name):
            return token[len(name):-1]
    return None


def _cut_note(path, resumed):
    passes = int(path.get("passes", 1) or 1)
    if resumed:
        return "Knife stays down from the previous path. These passes continue the same line. Zusammenhaengend is on."
    if path.get("stay_down") is False:
        return "Knife lifts before this path, then stays down for all %d passes. Zusammenhaengend is off, so the next path starts with its own plunge." % passes
    if passes > 1:
        return "Knife plunges once and stays down for all %d passes." % passes
    return "Knife plunges once and follows the outline."
