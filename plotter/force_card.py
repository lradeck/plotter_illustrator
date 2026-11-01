"""Force, speed and pass-count card.

Three areas sit under each other: one pass, two passes, three passes.
Inside an area the columns are force 10..25 and the rows are cut speed
10, 20, 30, 40 and 50 mm/s. Squares are 10 mm. Each square has its own
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
        for stroke in GLYPHS[char]:
            placed.append([
                (x + px * scale, baseline + py * scale) for px, py in stroke
            ])
        x += cell
        if index != len(text) - 1:
            x += gap
    return placed


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


def build_force_card(pen_force=10, force_min=FORCE_MIN, force_max=FORCE_MAX,
                     force_step=1, speed_min=10, speed_max=50, speed_step=10,
                     pass_min=1, pass_max=3, pass_step=1, travel=TRAVEL,
                     overcut=0):
    forces = series(force_min, force_max, force_step)
    speeds = series(speed_min, speed_max, speed_step)
    pass_values = series(pass_min, pass_max, pass_step)
    grid_w = len(forces) * SQUARE_MM + max(len(forces) - 1, 0) * GAP_MM
    grid_h = len(speeds) * SQUARE_MM + max(len(speeds) - 1, 0) * GAP_MM
    left_pad = max(text_width(str(speed), DIGIT_MM) for speed in speeds) + 2.0
    above = HEAD_MM + 1.5 + DIGIT_MM + 1.5
    block_h = above + grid_h
    area_gap = 8.0
    total_w = left_pad + grid_w
    total_h = len(pass_values) * block_h + max(len(pass_values) - 1, 0) * area_gap
    overlap = max(float(overcut), 0.0)
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
        for row, speed in enumerate(speeds):
            square_y = block_bottom + (len(speeds) - 1 - row) * (SQUARE_MM + GAP_MM)
            if row == 0:
                top_square_y = square_y
            speed_label = str(speed)
            label_w = text_width(speed_label, DIGIT_MM)
            label_x = squares_x - 2.0 - label_w
            label_y = square_y + (SQUARE_MM - DIGIT_MM) / 2.0
            for stroke in text_strokes(speed_label, DIGIT_MM, label_x, label_y):
                pens.append(_pen(stroke, pen_force, travel, "S" + speed_label))
            for col, force in enumerate(forces):
                x = squares_x + col * (SQUARE_MM + GAP_MM)
                cuts.extend(_cut(
                    x, square_y, force, speed, passes, travel,
                    rgb_for(force, speed, passes, forces, speeds, pass_values),
                    overlap,
                ))
                if row == 0:
                    force_label = str(force)
                    force_w = text_width(force_label, DIGIT_MM)
                    force_x = x + (SQUARE_MM - force_w) / 2.0
                    force_y = square_y + SQUARE_MM + 1.5
                    for stroke in text_strokes(force_label, DIGIT_MM, force_x, force_y):
                        pens.append(_pen(stroke, pen_force, travel, "F" + force_label))
        head = "%dx" % passes
        head_y = top_square_y + SQUARE_MM + 1.5 + DIGIT_MM + 1.5
        for stroke in text_strokes(head, HEAD_MM, squares_x, head_y):
            pens.append(_pen(stroke, pen_force, travel, head))
    return {
        "page_mm": [page_w, page_h],
        "origin_mm": [0, 0],
        "accurate": True,
        "blade_offset_mm": 0.35,
        "overcut_mm": 0.0,
        "turn_knife_mm": 1.0,
        "paths": pens + cuts,
    }


def _pen(points, force, travel, label):
    return {
        "holder": "right",
        "mode": "pen",
        "force": int(force),
        "cut_speed": int(travel),
        "travel_speed": int(travel),
        "closed": False,
        "passes": 1,
        "rgb": list(PEN_RGB),
        "label": label,
        "layer": "Right Stift F%d S%d T%d x1" % (int(force), int(travel), int(travel)),
        "points_mm": [[round(x, 3), round(y, 3)] for x, y in points],
    }


def _cut(x, y, force, speed, passes, travel, rgb, overcut=0):
    common = {
        "holder": "left",
        "mode": "cut",
        "force": int(force),
        "cut_speed": int(speed),
        "travel_speed": int(travel),
        "passes": int(passes),
        "rgb": rgb,
        "label": "F%d S%d x%d" % (force, speed, passes),
        "layer": "Left F%d S%d T%d x%d" % (int(force), int(speed), int(travel), int(passes)),
    }
    side = SQUARE_MM
    if overcut <= 0:
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
    span = overcut
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
