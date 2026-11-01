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

HOLDERS = {
    "left": "P0;",
    "right": "P1;",
}


def units(mm):
    return int(round(float(mm) * UNITS_PER_MM))


def encode_job(paths, page_mm, origin_mm=(0, 0), accurate=True,
               blade_offset_mm=0.35, overcut_mm=0.0, turn_knife_mm=0.0):
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
        radius = units(blade_offset_mm) if knife else 0
        overcut = units(overcut_mm) if knife else 0
        turn = units(turn_knife_mm) if knife else 0
        passes = int(path.get("passes", 1))
        if passes < 1:
            raise ValueError("passes must be at least 1")
        parts.append(_moves(
            points, radius, overcut, turn,
            closed=path.get("closed", True),
            passes=passes,
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


def _moves(points, radius, overcut, turn, closed=True, passes=1):
    if len(points) < 2:
        raise ValueError("a path needs at least two points")
    if not closed:
        # A straight stroke has no corner, so the knife is not swung.
        # Further passes retrace the stroke with the knife still down.
        commands = ["U%d,%d" % points[0]]
        forward = True
        for _ in range(passes):
            seq = points if forward else list(reversed(points))
            if commands[-1][0] == "D":
                seq = seq[1:]
            for point in seq:
                commands.append("D%d,%d" % point)
            forward = not forward
        return " ".join(commands) + " "
    outline = _outline(points, radius)
    commands = []
    if turn > 0 and len(outline) >= 2:
        commands.extend(_turn_knife(outline[0], outline[1], turn))
    commands.append("U%d,%d" % outline[0])
    for _ in range(passes):
        for point in outline:
            commands.append("D%d,%d" % point)
    if overcut > 0 and len(outline) >= 2:
        commands.append("D%d,%d" % _extend(outline[0], outline[1], overcut))
    return " ".join(commands) + " "


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
