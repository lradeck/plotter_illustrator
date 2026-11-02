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

UNITS_PER_MM = 40
# The captured orient cut starts 21 mm along the first side. A tick on the
# corner is the mark CameraCut does not leave.
ORIENT_MM = 21

HOLDERS = {
    "left": "P0;",
    "right": "P1;",
}


def units(mm):
    return int(round(float(mm) * UNITS_PER_MM))


def encode_job(paths, page_mm, origin_mm=(0, 0), accurate=True,
               blade_offset_mm=0.35, overcut_mm=0.0, turn_knife_mm=0.0,
               alternate=False):
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
    for path in paths:
        parts.append(_tool_prefix(path))
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
        parts.append(_moves(
            points, radius, overcut, turn,
            closed=path.get("closed", True),
            passes=passes,
            alternate=alternate and path.get("mode", "cut") == "cut",
        ))
    parts.append("U0,0 @ ")
    return "".join(parts)


def _tool_prefix(path):
    holder = path.get("holder", "left")
    if holder not in HOLDERS:
        raise ValueError("holder must be left or right, got %r" % holder)
    return "%sFS%d;VS%d;US%d;" % (
        HOLDERS[holder],
        int(path["force"]),
        int(path["cut_speed"]),
        int(path["travel_speed"]),
    )


def _moves(points, radius, overcut, turn, closed=True, passes=1, alternate=False):
    if len(points) < 2:
        raise ValueError("a path needs at least two points")
    if not closed:
        # A straight stroke has no corner, so the knife is not swung.
        # Every pass starts with the knife up. Without alternating, every
        # pass runs the same direction. With it, even passes start at the
        # other end. The knife never travels back while it is down.
        commands = []
        for lap in range(passes):
            stroke = list(reversed(points)) if alternate and lap % 2 == 1 else points
            commands.append("U%d,%d" % stroke[0])
            for point in stroke:
                commands.append("D%d,%d" % point)
        return " ".join(commands) + " "
    if alternate:
        return _alternate_closed(points, radius, overcut, turn, passes)
    return _camera_closed(points, radius, overcut, turn, passes)


def _camera_closed(points, radius, overcut, turn, passes):
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
    if turn > 0:
        commands.extend(_orient_cut(junction, far, radius, turn))
    path = [plunge]
    ring = outline[:-1]
    for _lap in range(passes):
        path.extend(ring[1:])
        path.append(ring[0])
    if seam != path[-1]:
        path.append(seam)
    if finish != path[-1]:
        path.append(finish)
    commands.append("U%d,%d" % path[0])
    previous = None
    for point in path:
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


def _orient_cut(junction, far, radius, length):
    """1 mm tick beside the first side, inset from the corner."""
    direction = _unit(far[0] - junction[0], far[1] - junction[1])
    if direction is None:
        return []
    corner = (
        junction[0] - direction[0] * radius,
        junction[1] - direction[1] * radius,
    )
    span = math.hypot(far[0] - corner[0], far[1] - corner[1]) - radius
    start = units(ORIENT_MM)
    if span <= length or start + length > span - max(radius, 0):
        start = max(0, (span - length) / 2.0)
    origin = (
        int(round(corner[0] + direction[0] * start)),
        int(round(corner[1] + direction[1] * start)),
    )
    return _turn_knife(origin, far, length)


def _turn_knife(start, nxt, length):
    direction = _unit(nxt[0] - start[0], nxt[1] - start[1])
    if direction is None:
        return []
    # Sit one tick to the left of the cut and stroke along it, so the
    # blade rotates before the contour. The captured tick was 1.00 mm.
    left = (-direction[1], direction[0])
    origin = (
        int(round(start[0] + left[0] * length)),
        int(round(start[1] + left[1] * length)),
    )
    tip = (
        int(round(origin[0] + direction[0] * length)),
        int(round(origin[1] + direction[1] * length)),
    )
    return [
        "U%d,%d" % origin,
        "D%d,%d" % origin,
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
