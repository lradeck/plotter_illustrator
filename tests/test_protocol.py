"""Checks the encoder against a job CameraCut actually sent."""

import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "plotter"))

from pattern import SPEEDS, FORCES, build_test_pattern, encode_test_pattern
from protocol import encode_job, fine_spans, parse_job, preview_strokes, speed_at, units
from send_job import job_from_document

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "square_knife.job")


class CapturedJobTest(unittest.TestCase):
    def test_live_send_parses(self):
        with open(FIXTURE, "r") as handle:
            text = handle.read()
        job = parse_job(text)
        self.assertEqual(job["page"], (16800, 11880))
        self.assertEqual(
            job["header"],
            "IN FSIZE16800,11880 CMD:32,16800,11880,1984,2344",
        )
        self.assertEqual(job["mode"], "CMD:35,2,1,0")
        self.assertTrue(text.startswith("IN FSIZE16800,11880 "))
        self.assertIn("CMD:35,2,1,0;", text)
        self.assertTrue(text.endswith("U0,0 @ ") or text.rstrip("\n").endswith("U0,0 @ "))
        # 1.00 mm knife-turn tick captured beside the cut.
        self.assertIn("D-39,840", text)
        self.assertIn("D-39,880", text)
        # Blade offset 0.35 mm is 14 units; the corner swing ends there.
        self.assertIn("D14,4880", text)
        downs = [move for move in job["moves"] if move[0] == "D"]
        self.assertGreater(len(downs), 8)


class EncoderTest(unittest.TestCase):
    def test_header_uses_captured_commands(self):
        text = _knife_square()
        self.assertTrue(text.startswith("IN FSIZE11880,16800 CMD:32,11880,16800,0,0;CMD:35,2,1,0;"))
        self.assertTrue(text.endswith("U0,0 @ "))
        self.assertIn("P0;FS20;VS10;US30;", text)

    def test_right_holder_and_speeds(self):
        text = encode_job([
            _path("right", "cut", 16, 25, 40, [[0, 0], [10, 0], [10, 10], [0, 10]])
        ], (100, 100), accurate=False, turn_knife_mm=0)
        self.assertIn("P1;FS16;VS25;US40;", text)
        self.assertNotIn("P0;", text)
        self.assertIn("D%d,0" % units(10), text)

    def test_fold_stays_on_the_square(self):
        text = encode_job([
            _path("left", "fold", 12, 10, 20, [[0, 0], [10, 0], [10, 10], [0, 10]])
        ], (100, 100), accurate=True, blade_offset_mm=0.35, turn_knife_mm=1)
        self.assertIn("P0;FS12;VS10;US20;", text)
        self.assertIn("D0,0", text)
        self.assertIn("D%d,%d" % (units(10), units(10)), text)
        # No drag-knife swing past the corner.
        self.assertNotIn("D%d,0" % (units(10) + units(0.35)), text)

    def test_knife_swings_around_the_corner(self):
        text = _knife_square(turn_knife_mm=0, overcut_mm=0)
        # East then north at (10 mm, 0): axis goes 0.35 mm past the corner.
        past = units(10) + units(0.35)
        self.assertIn("D%d,0" % past, text)
        self.assertIn("D%d,%d" % (units(10), units(0.35)), text)

    def test_path_offset_replaces_the_job_offset(self):
        path = _path("right", "cut", 20, 10, 30, [[0, 0], [10, 0], [10, 10], [0, 10]])
        path["blade_offset_mm"] = 0.25
        text = encode_job(
            [path], (100, 100), accurate=True,
            blade_offset_mm=0.35, turn_knife_mm=0,
        )
        self.assertIn("D%d,0" % (units(10) + units(0.25)), text)
        self.assertNotIn("D%d,0" % (units(10) + units(0.35)), text)

    def test_orient_cut_stays_off_the_corners(self):
        text = encode_job([{
            "holder": "left",
            "mode": "cut",
            "force": 20,
            "cut_speed": 10,
            "travel_speed": 30,
            "closed": True,
            "points_mm": [[0, 0], [0, 122], [113.2, 122], [113.2, 0]],
        }], (420, 297), accurate=True, blade_offset_mm=0.35, turn_knife_mm=1)
        downs = [move for move in parse_job(text)["moves"] if move[0] == "D"]
        tick = downs[:2]
        span = abs(tick[1][1] - tick[0][1]) + abs(tick[1][2] - tick[0][2])
        self.assertEqual(span, units(1))
        corners = [
            (0, 0),
            (0, units(122)),
            (units(113.2), units(122)),
            (units(113.2), 0),
        ]
        for move in tick:
            nearest = min(abs(move[1] - x) + abs(move[2] - y) for x, y in corners)
            self.assertGreater(nearest, units(15))

    def test_turn_knife_is_one_millimetre(self):
        text = _knife_square(turn_knife_mm=1, overcut_mm=0)
        job = parse_job(text)
        downs = [move for move in job["moves"] if move[0] == "D"]
        span = abs(downs[1][1] - downs[0][1]) + abs(downs[1][2] - downs[0][2])
        self.assertEqual(span, units(1))

    def test_overcut_continues_past_the_start(self):
        text = _knife_square(turn_knife_mm=0, overcut_mm=3, accurate=True)
        job = parse_job(text)
        downs = [move for move in job["moves"] if move[0] == "D"]
        end = downs[-1]
        prev = downs[-2]
        span = abs(end[1] - prev[1]) + abs(end[2] - prev[2])
        self.assertEqual(span, units(3))

    def test_two_passes_stay_down_through_the_corners(self):
        path = _path("left", "cut", 20, 10, 30, [[0, 0], [10, 0], [10, 10], [0, 10]])
        path["passes"] = 2
        text = encode_job(
            [path], (297, 420), accurate=True, blade_offset_mm=0.35, turn_knife_mm=0
        )
        moves = parse_job(text)["moves"]
        body = text.split("US30;", 1)[1].replace(";", " ")
        ups = [token for token in body.split() if token.startswith("U")]
        self.assertEqual(ups, ["U0,%d" % (units(10) - 2 * units(0.35)), "U0,0"])
        longs = _long_cuts(moves)
        self.assertEqual(len(longs), 8)
        self.assertEqual(_side_key(longs[0]), _side_key(longs[4]))

    def test_closed_cut_overlaps_the_start_like_cameracut(self):
        text = _knife_square(turn_knife_mm=0, overcut_mm=0)
        downs = [move for move in parse_job(text)["moves"] if move[0] == "D"]
        radius = units(0.35)
        top = units(10)
        self.assertEqual(downs[0], ("D", 0, top - 2 * radius))
        self.assertEqual(downs[-1], ("D", 0, top - 3 * radius))


class PatternTest(unittest.TestCase):
    def test_grid_covers_both_holders_and_a_crease(self):
        job = build_test_pattern()
        self.assertEqual(len(job["paths"]), len(SPEEDS) * len(FORCES) * 2 + 2)
        holders = set(path["holder"] for path in job["paths"])
        modes = set(path["mode"] for path in job["paths"])
        self.assertEqual(holders, set(["left", "right"]))
        self.assertEqual(modes, set(["cut", "fold"]))
        text = encode_test_pattern()
        parsed = parse_job(text)
        self.assertEqual(parsed["page"], (units(297), units(420)))
        self.assertIn("P0;FS10;VS10;US20;", text)
        self.assertIn("P1;FS30;VS40;US20;", text)
        self.assertIn("P0;FS12;VS10;US20;", text)
        self.assertIn("P1;FS12;VS10;US20;", text)
        folds = [path for path in job["paths"] if path["mode"] == "fold"]
        self.assertEqual([path["points_mm"][0][1] for path in folds], [20.0, 20.0])

    def test_json_document_encodes_like_the_pattern(self):
        document = json.loads(json.dumps(build_test_pattern()))
        self.assertEqual(job_from_document(document), encode_test_pattern())

    def test_top_left_anchor_starts_cutting_at_the_head(self):
        document = {
            "anchor": "top-left",
            "page_mm": [420, 297],
            "turn_knife_mm": 0,
            "accurate": False,
            "paths": [{
                "holder": "left",
                "mode": "cut",
                "force": 10,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": True,
                "passes": 1,
                "points_mm": [[100, 50], [110, 50], [110, 60], [100, 60]],
            }],
        }
        text = job_from_document(document)
        moves = parse_job(text)["moves"]
        ups = [move for move in moves if move[0] == "U"]
        self.assertEqual(ups[0], ("U", 0, 0))
        downs = [move for move in moves if move[0] == "D"]
        self.assertIn((0, 0), [(move[1], move[2]) for move in downs])
        self.assertTrue(all(move[1] <= 0 and move[2] <= 0 for move in downs))
        self.assertIn(("D", 0, units(-10)), downs)
        self.assertIn(("D", units(-10), 0), downs)
        # First edge leaves the head downward, not sideways.
        self.assertEqual(downs[1], ("D", units(-10), 0))

    def test_stacked_areas_stay_stacked(self):
        def square(y):
            return {
                "holder": "left",
                "mode": "cut",
                "force": 10,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": True,
                "passes": 1,
                "points_mm": [[0, y], [10, y], [10, y + 10], [0, y + 10]],
            }
        document = {
            "anchor": "top-left",
            "turn_knife_mm": 0,
            "accurate": False,
            "paths": [square(20), square(0)],
        }
        text = job_from_document(document)
        downs = [move for move in parse_job(text)["moves"] if move[0] == "D"]
        left_edge = sorted(set(move[1] for move in downs if move[2] == 0))
        self.assertEqual(left_edge, [units(-30), units(-20), units(-10), 0])

    def test_pen_draws_before_the_knife(self):
        def cut():
            return {
                "holder": "left",
                "mode": "cut",
                "force": 16,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": True,
                "passes": 1,
                "points_mm": [[0, 20], [10, 20], [10, 30], [0, 30]],
            }
        def pen():
            return {
                "holder": "right",
                "mode": "pen",
                "force": 10,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": False,
                "passes": 1,
                "points_mm": [[40, 0], [46, 0]],
            }
        document = {
            "anchor": "top-left",
            "turn_knife_mm": 0,
            "accurate": False,
            "paths": [cut(), pen(), cut()],
        }
        text = job_from_document(document)
        pen_at = text.find("P1;")
        knife_at = text.find("P0;")
        self.assertGreater(pen_at, 0)
        self.assertGreater(knife_at, pen_at)
        self.assertEqual(text.find("P0;", pen_at), knife_at)
        moves = [move for move in parse_job(text.split("P0;", 1)[0])["moves"] if move[0] == "D"]
        self.assertGreater(len(moves), 1)
        self.assertNotEqual(moves[0][1:], moves[1][1:])

    def test_layer_order_beats_travelling_to_the_origin(self):
        def square(x, order, name):
            return {
                "holder": "left",
                "mode": "cut",
                "force": 10,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": True,
                "passes": 1,
                "layer": name,
                "order": order,
                "points_mm": [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]],
            }
        document = {
            "anchor": "top-left",
            "turn_knife_mm": 0,
            "accurate": False,
            "paths": [square(0, 1, "Left"), square(30, 0, "Right")],
        }
        starts = _cut_starts(job_from_document(document))
        self.assertEqual(starts[0], (0, units(-30)))
        self.assertEqual(starts[1], (0, units(-10)))

    def test_one_layer_is_cut_as_a_snake(self):
        def square(x, y):
            return {
                "holder": "left",
                "mode": "cut",
                "force": 10,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": True,
                "passes": 1,
                "layer": "Grid",
                "points_mm": [[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10]],
            }
        document = {
            "anchor": "top-left",
            "turn_knife_mm": 0,
            "accurate": False,
            "paths": [square(15, 0), square(0, 12), square(0, 0), square(15, 12)],
        }
        starts = _cut_starts(job_from_document(document))
        self.assertEqual(starts, [
            (0, 0),
            (0, units(-15)),
            (units(-12), units(-15)),
            (units(-12), units(-10)),
        ])

    def test_pen_layer_is_drawn_from_the_top(self):
        def stroke(y, order):
            return {
                "holder": "right",
                "mode": "pen",
                "force": 10,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": False,
                "passes": 1,
                "layer": "Zahl",
                "order": order,
                "points_mm": [[0, y], [5, y]],
            }
        document = {
            "anchor": "top-left",
            "turn_knife_mm": 0,
            "accurate": False,
            "paths": [stroke(0, 0), stroke(10, 1)],
        }
        text = job_from_document(document)
        pen = text.split("P1;", 1)[1]
        first = re.search(r"U(-?\d+),(-?\d+)", pen)
        self.assertEqual((int(first.group(1)), int(first.group(2))), (0, 0))

    def test_pen_finishes_each_number_before_the_next_row(self):
        from force_card import text_strokes

        def glyph(text, x, y):
            strokes = []
            for stroke in text_strokes(text, 3.2, x, y):
                strokes.append([[round(px, 3), round(py, 3)] for px, py in stroke])
            return strokes

        wanted = []
        wanted.extend(glyph("10", 20, 90))
        wanted.extend(glyph("20", 34, 90))
        for y, label in ((70, "10"), (57.5, "20"), (45, "30"), (15, "10"), (2.5, "20"), (-10, "30")):
            wanted.extend(glyph(label, 0, y))
        paths = []
        for stroke in wanted:
            paths.append({
                "holder": "right",
                "mode": "pen",
                "force": 10,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": False,
                "passes": 1,
                "layer": "Zahlen",
                "points_mm": stroke,
            })
        paths.append({
            "holder": "left",
            "mode": "cut",
            "force": 16,
            "cut_speed": 20,
            "travel_speed": 20,
            "closed": True,
            "passes": 2,
            "layer": "Schnitt",
            "points_mm": [[50, 20], [60, 20], [60, 30], [50, 30]],
        })
        document = {
            "anchor": "top-left",
            "turn_knife_mm": 0,
            "accurate": False,
            "paths": list(reversed(paths)),
        }
        text = job_from_document(document)
        self.assertLess(text.find("P1;"), text.find("P0;"))
        self.assertEqual(text.find("P1;", text.find("P0;")), -1)
        pen = text.split("P0;", 1)[0]
        points = [pt for path in document["paths"] for pt in path["points_mm"]]
        min_x = min(pt[0] for pt in points)
        max_y = max(pt[1] for pt in points)

        def back(mx, my):
            return (min_x - my / 40.0, max_y + mx / 40.0)

        centers = []
        for part in pen.split("P1;")[1:]:
            found = re.findall(r"[UD](-?\d+),(-?\d+)", part)
            self.assertGreaterEqual(len(found), 2)
            pts = [back(int(x), int(y)) for x, y in found]
            length = sum(abs(a[0] - b[0]) + abs(a[1] - b[1]) for a, b in zip(pts, pts[1:]))
            self.assertGreater(length, 0.2)
            centers.append((sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)))
        force_at = [i for i, center in enumerate(centers) if center[1] > 88]
        lower_at = [i for i, center in enumerate(centers) if center[1] < 80]
        self.assertTrue(force_at)
        self.assertTrue(lower_at)
        self.assertLess(max(force_at), min(lower_at))
        left = [i for i in force_at if centers[i][0] < 28]
        right = [i for i in force_at if centers[i][0] >= 28]
        self.assertTrue(left and right)
        self.assertLess(max(left), min(right))
        column = [center[1] for center in centers if center[0] < 12]
        steps = [column[0]]
        for y in column[1:]:
            if abs(y - steps[-1]) > 5:
                self.assertLess(y, steps[-1])
                steps.append(y)
        self.assertEqual(len(steps), 6)


class ScriptTest(unittest.TestCase):
    def test_illustrator_script_uses_the_same_grid(self):
        path = os.path.join(os.path.dirname(__file__), "..", "Testmuster.jsx")
        with open(path, "r") as handle:
            source = handle.read()
        self.assertEqual(_jsx_number(source, "SQUARE_MM"), 15)
        self.assertEqual(_jsx_number(source, "GAP_MM"), 8)
        self.assertEqual(_jsx_number(source, "TRAVEL_SPEED"), 20)
        self.assertEqual(_jsx_number(source, "PAGE_W"), 297)
        self.assertEqual(_jsx_number(source, "PAGE_H"), 420)
        self.assertEqual(_jsx_number(source, "BLOCK_Y"), 43)
        self.assertEqual(_jsx_number(source, "LEFT_X"), 20)
        self.assertEqual(_jsx_number(source, "RIGHT_X"), 170)
        self.assertEqual(_jsx_number(source, "FOLD_FORCE"), 12)
        self.assertEqual(_jsx_number(source, "FOLD_SPEED"), 10)
        self.assertEqual(_jsx_number(source, "BLADE_OFFSET_MM"), 0.35)
        self.assertEqual(_jsx_number(source, "TURN_KNIFE_MM"), 1)
        self.assertEqual(_jsx_list(source, "SPEEDS"), SPEEDS)
        self.assertEqual(_jsx_list(source, "FORCES"), FORCES)


def _cut_starts(text):
    starts = []
    for part in text.split("P0;")[1:]:
        found = re.search(r"U(-?\d+),(-?\d+)", part)
        starts.append((int(found.group(1)), int(found.group(2))))
    return starts


def _path(holder, mode, force, speed, travel, points):
    return {
        "holder": holder,
        "mode": mode,
        "force": force,
        "cut_speed": speed,
        "travel_speed": travel,
        "points_mm": points,
    }


def _jsx_number(source, name):
    match = re.search(r"var %s = ([0-9.]+);" % name, source)
    if not match:
        raise AssertionError("missing " + name)
    return float(match.group(1)) if "." in match.group(1) else int(match.group(1))


def _jsx_list(source, name):
    match = re.search(r"var %s = \[([0-9, ]+)\];" % name, source)
    if not match:
        raise AssertionError("missing " + name)
    return [int(part) for part in match.group(1).split(",")]


def _knife_square(turn_knife_mm=1, overcut_mm=0, accurate=True):
    return encode_job([
        _path("left", "cut", 20, 10, 30, [[0, 0], [10, 0], [10, 10], [0, 10]])
    ], (297, 420), accurate=accurate, blade_offset_mm=0.35,
        overcut_mm=overcut_mm, turn_knife_mm=turn_knife_mm)


def _long_cuts(moves):
    found = []
    prev = None
    down = False
    for kind, x, y in moves:
        if kind == "D" and down and prev is not None:
            span = abs(x - prev[0]) + abs(y - prev[1])
            if span > units(2):
                found.append((prev, (x, y)))
        down = kind == "D"
        prev = (x, y)
    return found


def _side_key(segment):
    start, end = segment
    if abs(start[0] - end[0]) <= 2:
        return ("v", round(start[0] / 40.0))
    return ("h", round(start[1] / 40.0))


class ProfileTest(unittest.TestCase):
    def test_stay_down_follows_split_pieces_in_link_order(self):
        first = _path("left", "cut", 12, 15, 40, [[0, 0], [10, 0]])
        second = _path("left", "cut", 30, 80, 40, [[10, 0], [10, 10]])
        for path in (first, second):
            path["closed"] = False
            path["stay_down"] = True
            path["link_group"] = 1
        first["link"] = 0
        second["link"] = 1
        text = job_from_document({
            "paths": [second, first],
            "page_mm": [50, 50],
            "anchor": "top-left",
            "accurate": False,
            "turn_knife_mm": 0,
            "blade_offset_mm": 0,
        })
        ups = re.findall(r"(?:^|[\s;])U(-?\d+),(-?\d+)", text)
        self.assertEqual(len(ups), 2)
        self.assertEqual(ups[0], (str(units(-10)), "0"))
        self.assertIn("FS12;", text)
        self.assertIn("FS30;", text)
        self.assertIn("VS15;", text)
        self.assertIn("VS80;", text)

    def test_stay_down_joins_squares_that_share_a_corner(self):
        left = _path("left", "cut", 20, 10, 30, [[0, 0], [10, 0], [10, 10], [0, 10]])
        right = _path("left", "cut", 20, 10, 30, [[10, 0], [20, 0], [20, -10], [10, -10]])
        left["stay_down"] = True
        right["stay_down"] = True
        left["closed"] = True
        right["closed"] = True
        text = job_from_document({
            "paths": [left, right],
            "page_mm": [50, 50],
            "anchor": "top-left",
            "accurate": False,
            "turn_knife_mm": 0,
            "blade_offset_mm": 0,
        })
        ups = re.findall(r"(?:^|[\s;])U(-?\d+),(-?\d+)", text)
        self.assertEqual(len(ups), 2)
        self.assertEqual(ups[0], (str(-units(10)), str(-units(10))))

    def test_split_loop_repeats_the_whole_outline(self):
        ring = [
            [[0, 0], [10, 0]],
            [[10, 0], [10, 10]],
            [[10, 10], [0, 10]],
            [[0, 10], [0, 0]],
        ]
        paths = []
        for index, points in enumerate(ring):
            path = _path("left", "cut", 13, 10 if index % 2 == 0 else 1, 40, points)
            path["closed"] = False
            path["stay_down"] = True
            path["passes"] = 4
            path["link_group"] = 0
            path["link"] = index
            paths.append(path)
        paths.reverse()
        text = job_from_document({
            "paths": paths,
            "page_mm": [40, 40],
            "anchor": "top-left",
            "accurate": False,
            "turn_knife_mm": 0,
            "blade_offset_mm": 0,
        })
        ups = re.findall(r"(?:^|[\s;])U(-?\d+),(-?\d+)", text)
        self.assertEqual(len(ups), 2)
        self.assertEqual(ups[0], (str(units(-10)), "0"))
        self.assertEqual(text.count("VS1;"), 8)
        self.assertGreaterEqual(text.count("VS10;"), 8)

    def test_separate_paths_still_lift_when_stay_down_is_off(self):
        first = _path("left", "cut", 20, 10, 30, [[0, 0], [10, 0]])
        second = _path("left", "cut", 20, 10, 30, [[10, 0], [10, 10]])
        first["closed"] = False
        second["closed"] = False
        first["stay_down"] = False
        second["stay_down"] = False
        text = job_from_document({
            "paths": [first, second],
            "page_mm": [50, 50],
            "anchor": "top-left",
            "accurate": False,
            "turn_knife_mm": 0,
            "blade_offset_mm": 0,
        })
        ups = re.findall(r"(?:^|[\s;])U(-?\d+),(-?\d+)", text)
        self.assertEqual(len(ups), 3)

    def test_open_passes_can_stay_down(self):
        path = _path("left", "cut", 20, 10, 30, [[5, 5], [25, 5]])
        path["passes"] = 3
        path["closed"] = False
        path["stay_down"] = True
        text = encode_job([path], (100, 100), accurate=False, turn_knife_mm=0)
        ups = re.findall(r"(?:^|[\s;])U(-?\d+),(-?\d+)", text)
        self.assertEqual(ups.count(("200", "200")), 1)
        self.assertEqual(len(ups), 2)

    def test_closed_passes_stay_down_without_a_second_segment(self):
        path = _path("left", "cut", 20, 10, 30, [[10, 10], [30, 10], [30, 30], [10, 30]])
        path["passes"] = 2
        path["stay_down"] = False
        text = encode_job([path], (100, 100), accurate=False, turn_knife_mm=0)
        ups = re.findall(r"(?:^|[\s;])U(-?\d+),(-?\d+)", text)
        self.assertEqual(len(ups), 2)

    def test_lift_mode_keeps_the_loop_order_and_lifts_between_pieces(self):
        ring = [
            [[0, 0], [10, 0]],
            [[10, 0], [10, 10]],
            [[10, 10], [0, 10]],
            [[0, 10], [0, 0]],
        ]
        paths = []
        for index, points in enumerate(ring):
            path = _path("left", "cut", 14 if index % 2 == 0 else 1, 5 if index % 2 == 0 else 1, 40, points)
            path["closed"] = False
            path["stay_down"] = False
            path["passes"] = 4
            path["link_group"] = 0
            path["link"] = index
            paths.append(path)
        paths.reverse()
        text = job_from_document({
            "paths": paths,
            "page_mm": [40, 40],
            "anchor": "top-left",
            "accurate": False,
            "turn_knife_mm": 0,
            "blade_offset_mm": 0,
        })
        ups = re.findall(r"(?:^|[\s;])U(-?\d+),(-?\d+)", text)
        self.assertEqual(len(ups), 17)
        self.assertEqual(ups[0], (str(units(-10)), "0"))
        self.assertEqual(ups[1], (str(units(-10)), str(units(-10))))
        self.assertEqual(text.count("FS1;"), 8)
        self.assertGreaterEqual(text.count("FS14;"), 8)
        self.assertIsNone(re.search(r"FS1;VS1;D", text))

    def test_each_pass_can_use_its_own_force(self):
        path = _path("left", "cut", 10, 10, 30, [[0, 0], [20, 0]])
        path["passes"] = 2
        path["closed"] = False
        path["stay_down"] = True
        path["forces"] = [10, 40]
        text = encode_job([path], (100, 100), accurate=False, turn_knife_mm=0)
        self.assertIn("FS10;", text)
        self.assertIn("FS40;", text)

    def test_boost_slows_down_before_a_corner(self):
        square = [[0, 0], [100, 0], [100, 100], [0, 100]]
        mid = speed_at(square, (50, 0), 20, 200, 25, 8, True)
        near = speed_at(square, (2, 0), 20, 200, 25, 8, True)
        after = speed_at(square, (100, 2), 20, 200, 25, 8, True)
        self.assertGreater(mid, 150)
        self.assertLess(near, mid)
        self.assertLess(after, mid)
        path = _path("left", "cut", 20, 20, 30, square)
        path["closed"] = True
        path["passes"] = 1
        path["boost_speed"] = 200
        path["detail_deg"] = 25
        path["ramp_mm"] = 8
        text = encode_job([path], (200, 200), accurate=False, turn_knife_mm=0)
        self.assertGreaterEqual(text.count("VS"), 2)
        self.assertIn("VS", text.split("D", 1)[1])

    def test_fine_area_marks_both_cutover_legs(self):
        points = [(-30, 0), (-6, 0), (0, 0), (-6, 1), (-30, 1)]
        spans = fine_spans(points, 20, 8, False)
        self.assertTrue(self._span(spans, (-6, 0), (0, 0)))
        self.assertTrue(self._span(spans, (0, 0), (-6, 1)))
        self.assertFalse(self._span(spans, (-30, 0), (-6, 0)))

    def _span(self, spans, start, end):
        for span in spans:
            if self._near(span[0], start) and self._near(span[1], end):
                return True
            if self._near(span[0], end) and self._near(span[1], start):
                return True
        return False

    def _near(self, point, target):
        return abs(point[0] - target[0]) < 0.2 and abs(point[1] - target[1]) < 0.2

    def test_loop_segment_uses_the_loop_force(self):
        points = [[0, 0], [10, 0], [14, 4], [10, 8]]
        path = _path("left", "cut", 20, 10, 30, points)
        path["closed"] = False
        path["passes"] = 1
        path["point_forces"] = [None, 20, 5, 5]
        text = encode_job([path], (100, 100), accurate=False, turn_knife_mm=0)
        self.assertIn("FS5;", text)

    def test_preview_open_segments_keep_their_points(self):
        bend = [[i * 3.0, 0.0 if i < 8 else (i - 8) * 2.0] for i in range(17)]
        strokes = preview_strokes([
            {"points_mm": [[0, 0], [40, 0]], "closed": False, "cut_speed": 80, "force": 20, "order": 0},
            {"points_mm": bend, "closed": False, "cut_speed": 20, "force": 12, "order": 1},
            {"points_mm": [[0, 0], [10, 0], [10, 10], [0, 10]], "closed": True, "cut_speed": 30, "force": 15, "order": 2},
            {"points_mm": [[0, 0], [0, 0], [5, 0]], "closed": False, "cut_speed": 20, "force": 10, "order": 3},
        ])
        self.assertEqual(len(strokes), 4)
        self.assertEqual(len(strokes[1]["speeds"]), 17)
        self.assertNotIn("error", strokes[1])
        self.assertEqual(strokes[0]["closed"], False)

    def test_preview_command_matches_the_panel(self):
        import subprocess
        import tempfile
        bend = [[i * 3.0, 0.0 if i < 8 else (i - 8) * 2.0] for i in range(17)]
        job = {"paths": [
            {"points_mm": [[0, 0], [40, 0]], "closed": False, "cut_speed": 80, "force": 20, "travel_speed": 200, "order": 0},
            {"points_mm": bend, "closed": False, "cut_speed": 20, "force": 12, "travel_speed": 200, "order": 1},
        ]}
        folder = tempfile.mkdtemp()
        src = os.path.join(folder, "job.json")
        out = os.path.join(folder, "preview.json")
        with open(src, "w") as handle:
            json.dump(job, handle)
        script = os.path.join(os.path.dirname(__file__), "..", "plotter", "send_job.py")
        proc = subprocess.run(
            [sys.executable, script, src, "--preview-out", out],
            capture_output=True, text=True
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        with open(out, "r") as handle:
            preview = json.load(handle)
        self.assertEqual(len(preview["strokes"]), 2)
        self.assertEqual(len(preview["strokes"][1]["points"]), 17)


if __name__ == "__main__":
    unittest.main()
