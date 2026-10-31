"""Checks the encoder against a job CameraCut actually sent."""

import json
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "plotter"))

from pattern import SPEEDS, FORCES, build_test_pattern, encode_test_pattern
from protocol import encode_job, parse_job, units
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
        start = downs[0]
        span = abs(end[1] - start[1]) + abs(end[2] - start[2])
        self.assertEqual(span, units(3))


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


if __name__ == "__main__":
    unittest.main()
