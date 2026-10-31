"""Grid of squares used to compare speed, force and the two holders."""

from protocol import encode_job

SQUARE_MM = 15.0
GAP_MM = 8.0
SPEEDS = [10, 20, 40]
FORCES = [10, 20, 30]
TRAVEL_SPEED = 20
PAGE_MM = (297.0, 420.0)


def build_test_pattern():
    """Squares for left knife, right knife, and a crease on each holder.

    Columns are cut speeds. Rows are forces. Crease squares sit underneath
    each holder block.
    """
    paths = []
    # Bottom sits one square above the margin so the crease stays on the mat.
    blocks = [
        ("left", "cut", 20.0, 43.0),
        ("right", "cut", 170.0, 43.0),
    ]
    for holder, mode, left, bottom in blocks:
        for row, force in enumerate(FORCES):
            for col, speed in enumerate(SPEEDS):
                x = left + col * (SQUARE_MM + GAP_MM)
                y = bottom + (len(FORCES) - 1 - row) * (SQUARE_MM + GAP_MM)
                paths.append(_square(holder, mode, force, speed, x, y))
        fold_y = bottom - (SQUARE_MM + GAP_MM)
        paths.append(_square(holder, "fold", 12, 10, left, fold_y))
    return {
        "page_mm": list(PAGE_MM),
        "origin_mm": [0, 0],
        "accurate": True,
        "blade_offset_mm": 0.35,
        "overcut_mm": 0.0,
        "turn_knife_mm": 1.0,
        "paths": paths,
    }


def _square(holder, mode, force, speed, x, y):
    return {
        "holder": holder,
        "mode": mode,
        "force": force,
        "cut_speed": speed,
        "travel_speed": TRAVEL_SPEED,
        "label": "%s %s F%d S%d" % (holder, mode, force, speed),
        "points_mm": [
            [x, y],
            [x + SQUARE_MM, y],
            [x + SQUARE_MM, y + SQUARE_MM],
            [x, y + SQUARE_MM],
        ],
    }


def encode_test_pattern():
    job = build_test_pattern()
    return encode_job(
        job["paths"],
        job["page_mm"],
        job["origin_mm"],
        accurate=job["accurate"],
        blade_offset_mm=job["blade_offset_mm"],
        overcut_mm=job["overcut_mm"],
        turn_knife_mm=job["turn_knife_mm"],
    )
