"""Force, speed and pass-count card.

Three areas sit under each other: one pass, two passes, three passes.
Inside an area the rows are force and the columns are cut speed, unless
the Y axis is set to speed. Squares are 10 mm. Each square has its own
color. Numbers are pen strokes for the right holder.
"""

PAGE_MM = (420.0, 297.0)
SQUARE_MM = 10.0
GAP_MM = 2.5
TRAVEL = 20
FORCE_MIN = 10
FORCE_MAX = 25
SPEEDS = [10, 20, 30, 40, 50]
PASSES = (1, 2, 3)
DIGIT_MM = 3.2
HEAD_MM = 5.0
AXIS_MM = 4.2
PEN_RGB = [8, 8, 8]

_SEGMENTS = {
    "a": [(0.4, 5.7), (3.6, 5.7)],
    "b": [(3.6, 5.7), (3.6, 3.15)],
    "c": [(3.6, 2.85), (3.6, 0.3)],
    "d": [(3.6, 0.3), (0.4, 0.3)],
    "e": [(0.4, 0.3), (0.4, 2.85)],
    "f": [(0.4, 3.15), (0.4, 5.7)],
    "g": [(0.4, 3.0), (3.6, 3.0)],
}
_MASKS = {
    "0": "1111110",
    "1": "0110000",
    "2": "1101101",
    "3": "1111001",
    "4": "0110011",
    "5": "1011011",
    "6": "1011111",
    "7": "1110000",
    "8": "1111111",
    "9": "1111011",
}


def _glyph(mask):
    strokes = []
    for bit, name in zip(mask, "abcdefg"):
        if bit == "1":
            strokes.append(list(_SEGMENTS[name]))
    return strokes


GLYPHS = dict((char, _glyph(mask)) for char, mask in _MASKS.items())
GLYPHS["x"] = [
    [(0.5, 0.6), (3.5, 5.4)],
    [(0.5, 5.4), (3.5, 0.6)],
]
# Stick letters in the same 4 by 6 cell as the digits.
GLYPHS["K"] = [
    [(0.4, 0.3), (0.4, 5.7)],
    [(0.4, 3.0), (3.6, 5.7)],
    [(0.4, 3.0), (3.6, 0.3)],
]
GLYPHS["S"] = [
    [(3.4, 5.4), (0.6, 5.4), (0.6, 3.0)],
    [(0.6, 3.0), (3.4, 3.0), (3.4, 0.6), (0.6, 0.6)],
]
GLYPHS["r"] = [
    [(0.6, 0.3), (0.6, 4.4)],
    [(0.6, 4.0), (1.8, 4.6), (3.3, 4.0)],
]
GLYPHS["a"] = [
    [(3.2, 0.4), (3.2, 4.2), (0.6, 4.2), (0.6, 0.4), (3.2, 0.4)],
    [(3.2, 2.2), (0.8, 2.2)],
]
GLYPHS["f"] = [
    [(1.4, 5.6), (2.4, 5.6), (2.4, 0.3)],
    [(1.0, 3.6), (3.4, 3.6)],
]
GLYPHS["t"] = [
    [(2.0, 5.4), (2.0, 0.5), (3.2, 0.5)],
    [(0.8, 3.6), (3.2, 3.6)],
]
GLYPHS["p"] = [
    [(0.6, 0.0), (0.6, 4.4)],
    [(0.6, 4.4), (3.2, 4.4), (3.2, 2.2), (0.6, 2.2)],
]
GLYPHS["e"] = [
    [(0.6, 2.2), (3.2, 2.2), (3.2, 4.4), (0.6, 4.4), (0.6, 0.4), (3.2, 0.4)],
]
GLYPHS["d"] = [
    [(3.2, 0.4), (3.2, 5.6)],
    [(3.2, 4.4), (0.6, 4.4), (0.6, 0.4), (3.2, 0.4)],
]


def _metrics(height):
    scale = float(height) / 6.0
    return scale, 4.0 * scale, 0.8 * scale


def text_width(text, height):
    _scale, cell, gap = _metrics(height)
    if not text:
        return 0.0
    return len(text) * cell + (len(text) - 1) * gap


def text_strokes(text, height, left, baseline):
    scale, cell, gap = _metrics(height)
    placed = []
    x = float(left)
    for index, char in enumerate(text):
        if char not in GLYPHS:
            raise ValueError("no glyph for %r" % char)
        for stroke in _join_glyph(GLYPHS[char]):
            placed.append([
                (x + px * scale, baseline + py * scale) for px, py in stroke
            ])
        x += cell
        if index != len(text) - 1:
            x += gap
    return placed


def _join_glyph(strokes):
    """Draw a digit in as few pen-downs as the shape allows.

    Segment ends that meet, or nearly meet at the middle of an 8, become
    one polyline. The pen stays down around the whole figure.
    """
    return join_strokes(strokes, 0.35)


def join_strokes(strokes, tol):
    parts = [list(stroke) for stroke in strokes if len(stroke) >= 2]
    if not parts:
        return []
    for _ in range(8):
        endpoints = [pt for part in parts for pt in (part[0], part[-1])]
        merged = []
        grew = False
        for part in parts:
            pieces = _split_stroke(part, endpoints, tol)
            grew = grew or len(pieces) > 1
            merged.extend(pieces)
        parts = merged
        if not grew:
            break
    nodes = []

    def node_at(pt):
        for index, node in enumerate(nodes):
            if _near(node, pt, tol):
                return index
        nodes.append((float(pt[0]), float(pt[1])))
        return len(nodes) - 1

    edges = []
    for part in parts:
        a = node_at(part[0])
        b = node_at(part[-1])
        points = list(part)
        points[0] = nodes[a]
        points[-1] = nodes[b]
        edges.append((a, b, points))
    remaining = set(range(len(edges)))
    trails = []
    while remaining:
        seed = next(iter(remaining))
        group = _connected(seed, edges, remaining)
        trails.extend(_cover_component(group, edges, nodes))
        remaining -= group
    return [_dedupe(trail) for trail in trails if len(_dedupe(trail)) >= 2]


def _split_stroke(part, endpoints, tol):
    for index in range(len(part) - 1):
        ax, ay = part[index]
        bx, by = part[index + 1]
        best = None
        for px, py in endpoints:
            if _near((px, py), (ax, ay), tol) or _near((px, py), (bx, by), tol):
                continue
            dist, t = _segment_hit(ax, ay, bx, by, px, py)
            if dist <= tol and 0.02 < t < 0.98 and (best is None or dist < best[0]):
                best = (dist, (px, py))
        if best is None:
            continue
        point = best[1]
        return [part[:index + 1] + [point], [point] + part[index + 1:]]
    return [part]


def _cover_component(group, edges, nodes):
    degree = {}
    for index in group:
        a, b, _points = edges[index]
        degree[a] = degree.get(a, 0) + (2 if a == b else 1)
        if a != b:
            degree[b] = degree.get(b, 0) + 1
    odds = [node for node, count in degree.items() if count % 2 == 1]
    local = [edges[index] for index in group]
    while len(odds) > 1:
        start = odds.pop(0)
        pick = min(range(len(odds)), key=lambda i: _dist(nodes[start], nodes[odds[i]]))
        other = odds.pop(pick)
        local.append((start, other, None))
    start = odds[0] if odds else local[0][0]
    circuit = _euler(start, local)
    return _trails_from_circuit(circuit, local, nodes)


def _euler(start, edges):
    size = max(max(a, b) for a, b, _points in edges) + 1
    adj = [[] for _ in range(size)]
    for index, (a, b, _points) in enumerate(edges):
        adj[a].append(index)
        adj[b].append(index)
    used = [False] * len(edges)
    stack = [(start, None)]
    circuit = []
    while stack:
        node, via = stack[-1]
        nxt = None
        while adj[node]:
            index = adj[node].pop()
            if not used[index]:
                nxt = index
                break
        if nxt is None:
            circuit.append(stack.pop())
        else:
            used[nxt] = True
            a, b, _points = edges[nxt]
            stack.append((b if node == a else a, nxt))
    circuit.reverse()
    return circuit


def _trails_from_circuit(circuit, edges, nodes):
    trails = []
    current = [nodes[circuit[0][0]]]
    for node, index in circuit[1:]:
        _a, _b, points = edges[index]
        if points is None:
            if len(current) >= 2:
                trails.append(current)
            current = [nodes[node]]
            continue
        seq = points if _near(points[-1], nodes[node], 1e-6) else list(reversed(points))
        if current and _near(current[-1], seq[0], 1e-6):
            current.extend(seq[1:])
        else:
            current.extend(seq)
    if len(current) >= 2:
        trails.append(current)
    # The tour began on an even corner, so the piece before the first lift
    # and the piece after the last lift are one stroke that passes that corner.
    if len(trails) >= 2 and _near(trails[-1][-1], trails[0][0], 1e-6):
        trails[-1].extend(trails[0][1:])
        trails = [trails[-1]] + trails[1:-1]
    return trails


def _connected(seed, edges, remaining):
    found = set()
    stack = [edges[seed][0], edges[seed][1]]
    seen = set()
    while stack:
        node = stack.pop()
        if node in seen:
            continue
        seen.add(node)
        for index in remaining:
            a, b, _points = edges[index]
            if a == node or b == node:
                found.add(index)
                stack.append(a)
                stack.append(b)
    return found


def _segment_hit(ax, ay, bx, by, px, py):
    dx = bx - ax
    dy = by - ay
    length = dx * dx + dy * dy
    if length < 1e-12:
        return _dist((ax, ay), (px, py)), 0.0
    t = ((px - ax) * dx + (py - ay) * dy) / length
    t = max(0.0, min(1.0, t))
    return _dist((ax + t * dx, ay + t * dy), (px, py)), t


def _near(a, b, tol):
    return _dist(a, b) <= tol


def _dist(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def _dedupe(points):
    kept = [points[0]]
    for point in points[1:]:
        if _dist(kept[-1], point) > 1e-6:
            kept.append(point)
    return kept


def series(start, stop, step):
    start = int(start)
    stop = int(stop)
    step = abs(int(step))
    if step == 0:
        raise ValueError("step must not be 0")
    if stop < start:
        start, stop = stop, start
    values = []
    value = start
    while value <= stop:
        values.append(value)
        value += step
    return values


def rgb_for(force, speed, passes, forces=None, speeds=None, pass_values=None):
    """A distinct screen color for one force, speed and pass count."""
    if forces is None:
        forces = list(range(FORCE_MIN, FORCE_MAX + 1))
    if speeds is None:
        speeds = list(SPEEDS)
    if pass_values is None:
        pass_values = list(PASSES)
    force_index = forces.index(force)
    speed_index = speeds.index(speed)
    pass_index = pass_values.index(passes)
    return [
        min(255, 20 + force_index * 14),
        min(255, 30 + speed_index * 45 + pass_index * 8),
        min(255, 40 + pass_index * 60 + (force_index % 4) * 10),
    ]


def build_force_card(pen_force=20, force_min=FORCE_MIN, force_max=FORCE_MAX,
                     force_step=1, speed_min=10, speed_max=50, speed_step=10,
                     pass_min=1, pass_max=3, pass_step=1, travel=TRAVEL,
                     overcut=0, y_axis="force", steg=0, pen_speed=20,
                     pen_holder="right", offset=0.35):
    forces = series(force_min, force_max, force_step)
    speeds = series(speed_min, speed_max, speed_step)
    pass_values = series(pass_min, pass_max, pass_step)
    if y_axis != "speed":
        y_axis = "force"
    pen_holder = "left" if pen_holder == "left" else "right"
    cut_holder = "left" if pen_holder == "right" else "right"
    cut_offset = float(offset)
    y_values = forces if y_axis == "force" else speeds
    x_values = speeds if y_axis == "force" else forces
    overlap = max(float(overcut), 0.0)
    # Each line runs `overlap` past its own square. The gap holds both tips
    # and at least 1 mm of clear space between them.
    gap = max(GAP_MM, 2.0 * overlap + 1.0)
    label_clear = max(1.5, overlap + 0.5)
    side_clear = max(2.0, overlap + 0.5)
    grid_w = len(x_values) * SQUARE_MM + max(len(x_values) - 1, 0) * gap
    grid_h = len(y_values) * SQUARE_MM + max(len(y_values) - 1, 0) * gap
    letter_w = text_width("K", AXIS_MM)
    left_pad = max(text_width(str(value), DIGIT_MM) for value in y_values) + letter_w + 2.5 + side_clear
    above = HEAD_MM + 1.5 + DIGIT_MM + label_clear
    block_h = above + grid_h
    area_gap = 8.0
    if above + area_gap < 2.0 * overlap + 1.0:
        area_gap += 2.0 * overlap + 1.0 - (above + area_gap)
    stack_h = len(pass_values) * block_h + max(len(pass_values) - 1, 0) * area_gap
    title_gap = 2.0
    total_w = left_pad + grid_w
    total_h = stack_h + AXIS_MM + title_gap
    margin = 12.0 + overlap
    page_w = max(PAGE_MM[0], total_w + 2 * margin)
    page_h = max(PAGE_MM[1], total_h + 2 * margin)
    origin_x = (page_w - total_w) / 2.0
    squares_x = origin_x + left_pad
    base_y = (page_h - total_h) / 2.0

    pens = []
    cuts = []
    for area, passes in enumerate(pass_values):
        block_bottom = base_y + (len(pass_values) - 1 - area) * (block_h + area_gap)
        top_square_y = None
        for row, y_value in enumerate(y_values):
            square_y = block_bottom + (len(y_values) - 1 - row) * (SQUARE_MM + gap)
            if row == 0:
                top_square_y = square_y
            row_text = str(y_value)
            row_label = ("F" if y_axis == "force" else "S") + row_text
            label_w = text_width(row_text, DIGIT_MM)
            label_x = squares_x - side_clear - label_w
            label_y = square_y + (SQUARE_MM - DIGIT_MM) / 2.0
            for stroke in text_strokes(row_text, DIGIT_MM, label_x, label_y):
                pens.append(_pen(stroke, pen_force, pen_speed, travel, row_label, pen_holder))
            columns = list(enumerate(x_values))
            if row % 2 == 1:
                columns.reverse()
            for col, x_value in columns:
                x = squares_x + col * (SQUARE_MM + gap)
                if y_axis == "force":
                    force, speed = y_value, x_value
                else:
                    force, speed = x_value, y_value
                cuts.extend(_cut(
                    x, square_y, force, speed, passes, travel,
                    rgb_for(force, speed, passes, forces, speeds, pass_values),
                    overlap,
                    steg,
                    cut_holder,
                    cut_offset,
                ))
                if row == 0:
                    col_text = str(x_value)
                    col_label = ("S" if y_axis == "force" else "F") + col_text
                    col_w = text_width(col_text, DIGIT_MM)
                    col_x = x + (SQUARE_MM - col_w) / 2.0
                    col_y = square_y + SQUARE_MM + label_clear
                    for stroke in text_strokes(col_text, DIGIT_MM, col_x, col_y):
                        pens.append(_pen(stroke, pen_force, pen_speed, travel, col_label, pen_holder))
        head = "%dx" % passes
        head_y = top_square_y + SQUARE_MM + label_clear + DIGIT_MM + 1.5
        for stroke in text_strokes(head, HEAD_MM, squares_x, head_y):
            pens.append(_pen(stroke, pen_force, pen_speed, travel, head, pen_holder))
    across = "Speed" if y_axis == "force" else "Kraft"
    down = "Kraft" if y_axis == "force" else "Speed"
    across_w = text_width(across, AXIS_MM)
    across_x = squares_x + (grid_w - across_w) / 2.0
    across_y = base_y + stack_h + title_gap
    for stroke in text_strokes(across, AXIS_MM, across_x, across_y):
        pens.append(_pen(stroke, pen_force, pen_speed, travel, across, pen_holder))
    down_gap = 0.8
    down_h = len(down) * AXIS_MM + (len(down) - 1) * down_gap
    down_bottom = base_y + (stack_h - down_h) / 2.0
    for index, char in enumerate(down):
        char_y = down_bottom + (len(down) - 1 - index) * (AXIS_MM + down_gap)
        for stroke in text_strokes(char, AXIS_MM, origin_x, char_y):
            pens.append(_pen(stroke, pen_force, pen_speed, travel, down, pen_holder))
    return {
        "page_mm": [page_w, page_h],
        "origin_mm": [0, 0],
        "accurate": True,
        "blade_offset_mm": cut_offset,
        "overcut_mm": 0.0,
        "turn_knife_mm": 1.0,
        "paths": _sheet_paths(pens, cuts),
    }


def _sheet_paths(pens, cuts):
    """Pen labels in reading order, then cuts in a snake.

    Illustrator inserts each new layer at the top and the plot walks the
    panel from the top, so the list is stored reversed. ``order`` is the
    plot sequence and stays put.
    """
    desired = _reading_order(pens) + cuts
    for index, path in enumerate(desired):
        path["order"] = index
    return list(reversed(desired))


def _reading_order(paths):
    groups = []
    found = {}
    for path in paths:
        key = path.get("label") or id(path)
        if key not in found:
            found[key] = []
            groups.append(found[key])
        found[key].append(path)

    def top(group):
        return max(pt[1] for path in group for pt in path["points_mm"])

    def left(group):
        return min(pt[0] for path in group for pt in path["points_mm"])

    groups.sort(key=lambda group: (-top(group), left(group)))
    ordered = []
    for group in groups:
        strokes = sorted(group, key=lambda path: (
            -max(pt[1] for pt in path["points_mm"]),
            min(pt[0] for pt in path["points_mm"]),
        ))
        ordered.extend(strokes)
    return ordered


def _pen(points, force, speed, travel, label, holder="right"):
    holder = "left" if holder == "left" else "right"
    side = "Left" if holder == "left" else "Right"
    return {
        "holder": holder,
        "mode": "pen",
        "force": int(force),
        "cut_speed": int(speed),
        "travel_speed": int(travel),
        "closed": False,
        "passes": 1,
        "rgb": list(PEN_RGB),
        "label": label,
        "layer": "%s Stift F%d S%d T%d x1 O0.0" % (side, int(force), int(speed), int(travel)),
        "blade_offset_mm": 0.0,
        "points_mm": [[round(x, 3), round(y, 3)] for x, y in points],
    }


def _offset_label(mm):
    text = str(round(float(mm), 3))
    if "." not in text:
        text += ".0"
    return text


def _cut(x, y, force, speed, passes, travel, rgb, overcut=0, steg=0, holder="left", offset=0.35):
    holder = "right" if holder == "right" else "left"
    side = "Right" if holder == "right" else "Left"
    common = {
        "holder": holder,
        "mode": "cut",
        "force": int(force),
        "cut_speed": int(speed),
        "travel_speed": int(travel),
        "passes": int(passes),
        "rgb": rgb,
        "label": "F%d S%d x%d" % (force, speed, passes),
        "layer": "%s F%d S%d T%d x%d O%s" % (
            side, int(force), int(speed), int(travel), int(passes), _offset_label(offset)
        ),
        "blade_offset_mm": float(offset),
    }
    side = SQUARE_MM
    span = max(float(overcut), 0.0)
    gap = max(float(steg), 0.0)
    if 0 < gap < side:
        # Two open pieces per side. The gap sits in the middle, and an
        # overcut still runs past the outer corner only.
        half = gap / 2.0
        mid = side / 2.0
        lines = [
            [(x - span, y), (x + mid - half, y)],
            [(x + mid + half, y), (x + side + span, y)],
            [(x + side, y - span), (x + side, y + mid - half)],
            [(x + side, y + mid + half), (x + side, y + side + span)],
            [(x + side + span, y + side), (x + mid + half, y + side)],
            [(x + mid - half, y + side), (x - span, y + side)],
            [(x, y + side + span), (x, y + mid + half)],
            [(x, y + mid - half), (x, y - span)],
        ]
        paths = []
        for line in lines:
            path = dict(common)
            path["closed"] = False
            path["points_mm"] = [[round(px, 3), round(py, 3)] for px, py in line]
            paths.append(path)
        return paths
    if span <= 0:
        path = dict(common)
        path["closed"] = True
        path["points_mm"] = [
            [round(x, 3), round(y, 3)],
            [round(x + side, 3), round(y, 3)],
            [round(x + side, 3), round(y + side, 3)],
            [round(x, 3), round(y + side, 3)],
        ]
        return [path]
    # Four open lines, each running past both corners, so adjacent cuts cross
    # and the knife stays straight instead of swinging around a corner.
    lines = [
        [(x - span, y), (x + side + span, y)],
        [(x + side, y - span), (x + side, y + side + span)],
        [(x + side + span, y + side), (x - span, y + side)],
        [(x, y + side + span), (x, y - span)],
    ]
    paths = []
    for line in lines:
        path = dict(common)
        path["closed"] = False
        path["points_mm"] = [[round(px, 3), round(py, 3)] for px, py in line]
        paths.append(path)
    return paths
