"""Force and speed card: stacked pass areas, colored 10 mm squares."""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "plotter"))

from force_card import (
    FORCE_MAX,
    FORCE_MIN,
    PAGE_MM,
    PASSES,
    PEN_RGB,
    SPEEDS,
    SQUARE_MM,
    TRAVEL,
    build_force_card,
    rgb_for,
)
from protocol import encode_job, parse_job, units


class PassesTest(unittest.TestCase):
    def test_extra_passes_repeat_the_outline(self):
        once = _downs(_square(passes=1))
        twice = _downs(_square(passes=2))
        self.assertEqual(len(twice), len(once) * 2)

    def test_pen_stroke_stays_open(self):
        text = encode_job([
            {
                "holder": "right",
                "mode": "pen",
                "force": 10,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": False,
                "points_mm": [[0, 0], [4, 0]],
            }
        ], (100, 100), accurate=True, turn_knife_mm=1)
        self.assertIn("P1;FS10;VS20;US20;", text)
        downs = [move for move in parse_job(text)["moves"] if move[0] == "D"]
        self.assertEqual(downs, [("D", 0, 0), ("D", 160, 0)])


class ForceCardTest(unittest.TestCase):
    def setUp(self):
        self.job = build_force_card()
        self.cuts = [path for path in self.job["paths"] if path["mode"] == "cut"]
        self.pens = [path for path in self.job["paths"] if path["mode"] == "pen"]

    def test_grid_covers_force_speed_and_passes(self):
        forces = list(range(FORCE_MIN, FORCE_MAX + 1))
        self.assertEqual(len(self.cuts), len(forces) * len(SPEEDS) * len(PASSES))
        for path in self.cuts:
            self.assertEqual(path["holder"], "left")
            self.assertEqual(path["travel_speed"], TRAVEL)
            self.assertEqual(path["rgb"], rgb_for(path["force"], path["cut_speed"], path["passes"]))
            for channel in path["rgb"]:
                self.assertGreaterEqual(channel, 0)
                self.assertLessEqual(channel, 255)
            self.assertTrue(path["closed"])
            self.assertEqual(round(path["points_mm"][1][0] - path["points_mm"][0][0], 3), SQUARE_MM)
            self.assertEqual(round(path["points_mm"][2][1] - path["points_mm"][0][1], 3), SQUARE_MM)
            self.assertEqual(
                path["layer"],
                "Left F%d S%d T%d x%d" % (
                    path["force"], path["cut_speed"], path["travel_speed"], path["passes"]
                ),
            )
        colors = [tuple(path["rgb"]) for path in self.cuts]
        self.assertEqual(len(colors), len(set(colors)))
        self.assertNotIn(tuple(PEN_RGB), set(colors))

    def test_areas_and_speeds_stack_downward(self):
        bottoms = {}
        for path in self.cuts:
            bottoms.setdefault(path["passes"], []).append(path["points_mm"][0][1])
        self.assertGreater(min(bottoms[1]), max(bottoms[2]))
        self.assertGreater(min(bottoms[2]), max(bottoms[3]))
        for passes in PASSES:
            for force in range(FORCE_MIN, FORCE_MAX + 1):
                rows = [
                    path for path in self.cuts
                    if path["passes"] == passes and path["force"] == force
                ]
                rows.sort(key=lambda path: path["cut_speed"])
                heights = [path["points_mm"][0][1] for path in rows]
                self.assertEqual(heights, sorted(heights, reverse=True))
                self.assertEqual([path["cut_speed"] for path in rows], SPEEDS)

    def test_pen_labels_name_both_axes_and_the_passes(self):
        for path in self.pens:
            self.assertEqual(path["holder"], "right")
            self.assertEqual(path["mode"], "pen")
            self.assertEqual(path["rgb"], PEN_RGB)
            self.assertEqual(path["layer"], "Right Stift F10 S20 T20 x1")
            self.assertFalse(path["closed"])
        for passes in PASSES:
            area = [cut for cut in self.cuts if cut["passes"] == passes]
            top = max(cut["points_mm"][2][1] for cut in area)
            heads = [pen for pen in self.pens if pen["label"] == "%dx" % passes]
            self.assertGreater(len(heads), 0)
            for pen in heads:
                self.assertGreater(_bottom(pen), top)
            top_y = max(cut["points_mm"][0][1] for cut in area)
            for cut in area:
                if abs(cut["points_mm"][0][1] - top_y) > 0.01:
                    continue
                left = cut["points_mm"][0][0]
                right = cut["points_mm"][1][0]
                above = [
                    pen for pen in self.pens
                    if pen["label"] == "F%d" % cut["force"]
                    and _inside_column(pen, left, right)
                    and _bottom(pen) >= cut["points_mm"][2][1]
                ]
                self.assertGreater(len(above), 0)
            for cut in area:
                left = cut["points_mm"][0][0]
                bottom = cut["points_mm"][0][1]
                top_edge = cut["points_mm"][2][1]
                beside = []
                for pen in self.pens:
                    if pen["label"] != "S%d" % cut["cut_speed"]:
                        continue
                    xs = [point[0] for point in pen["points_mm"]]
                    ys = [point[1] for point in pen["points_mm"]]
                    if max(xs) < left and min(ys) >= bottom - 1 and max(ys) <= top_edge + 1:
                        beside.append(pen)
                self.assertGreater(len(beside), 0)

    def test_everything_lands_on_the_mat(self):
        page = self.job["page_mm"]
        for path in self.job["paths"]:
            for x, y in path["points_mm"]:
                self.assertGreaterEqual(x, 0)
                self.assertGreaterEqual(y, 0)
                self.assertLessEqual(x, page[0])
                self.assertLessEqual(y, page[1])

    def test_ranges_follow_the_requested_steps(self):
        job = build_force_card(
            force_min=10, force_max=14, force_step=2,
            speed_min=30, speed_max=40, speed_step=10,
            pass_min=2, pass_max=3, pass_step=1,
            travel=15,
        )
        cuts = [path for path in job["paths"] if path["mode"] == "cut"]
        pairs = set((path["force"], path["cut_speed"], path["passes"]) for path in cuts)
        self.assertEqual(pairs, set([
            (10, 30, 2), (12, 30, 2), (14, 30, 2),
            (10, 40, 2), (12, 40, 2), (14, 40, 2),
            (10, 30, 3), (12, 30, 3), (14, 30, 3),
            (10, 40, 3), (12, 40, 3), (14, 40, 3),
        ]))
        self.assertTrue(all(path["travel_speed"] == 15 for path in cuts))
        self.assertTrue(all("T15" in path["layer"] for path in cuts))

    def test_overcut_crosses_four_open_lines_at_the_corners(self):
        job = build_force_card(
            force_min=10, force_max=10, force_step=1,
            speed_min=20, speed_max=20, speed_step=10,
            pass_min=2, pass_max=2, pass_step=1,
            overcut=1.5,
        )
        cuts = [path for path in job["paths"] if path["mode"] == "cut"]
        self.assertEqual(len(cuts), 4)
        self.assertTrue(all(path["closed"] is False for path in cuts))
        self.assertEqual(len(set(path["layer"] for path in cuts)), 1)
        self.assertTrue(all(path["passes"] == 2 for path in cuts))
        span = SQUARE_MM + 3.0
        for path in cuts:
            start, end = path["points_mm"]
            length = abs(end[0] - start[0]) + abs(end[1] - start[1])
            self.assertEqual(round(length, 3), span)
        horiz = [path for path in cuts if path["points_mm"][0][1] == path["points_mm"][1][1]]
        vert = [path for path in cuts if path["points_mm"][0][0] == path["points_mm"][1][0]]
        left = min(vert, key=lambda path: path["points_mm"][0][0])
        right = max(vert, key=lambda path: path["points_mm"][0][0])
        bottom = min(horiz, key=lambda path: path["points_mm"][0][1])
        top = max(horiz, key=lambda path: path["points_mm"][0][1])
        corners = [
            (left["points_mm"][0][0], bottom["points_mm"][0][1]),
            (right["points_mm"][0][0], bottom["points_mm"][0][1]),
            (right["points_mm"][0][0], top["points_mm"][0][1]),
            (left["points_mm"][0][0], top["points_mm"][0][1]),
        ]
        for corner in corners:
            self.assertEqual(sum(1 for path in cuts if _covers(path, corner)), 2)
        text = encode_job(
            cuts, job["page_mm"], accurate=True,
            blade_offset_mm=0.35, turn_knife_mm=1, overcut_mm=0,
        )
        downs = [move for move in parse_job(text)["moves"] if move[0] == "D"]
        allowed = set()
        for path in cuts:
            for point in path["points_mm"]:
                allowed.add((units(point[0]), units(point[1])))
        for move in downs:
            self.assertIn((move[1], move[2]), allowed)
        self.assertEqual(len(downs), 3 * 4)

    def test_script_is_a_plot_panel_for_the_real_plotter(self):
        path = os.path.join(os.path.dirname(__file__), "..", "Krafttest.jsx")
        with open(path, "r") as handle:
            source = handle.read()
        self.assertIn("--force-card", source)
        self.assertIn("--json-out", source)
        self.assertIn("192.168.0.200", source)
        self.assertIn("Plot", source)
        self.assertIn("holderFromName", source)
        self.assertIn("parseLayerName", source)
        self.assertIn("selectedOnly", source)
        self.assertIn("--force-min", source)
        self.assertIn("--overcut", source)
        self.assertIn("item.filled = false", source)
        self.assertIn("if (item.stroked) return asRgb(item.strokeColor);", source)
        self.assertIn("Nur markierte Ebenen", source)
        self.assertIn("isComplete", source)
        self.assertIn("sweepEmptyLayers", source)
        self.assertNotIn("COLORS_FILE", source)
        self.assertIn("left", source)
        self.assertIn("right", source)


def _covers(path, corner):
    (x0, y0), (x1, y1) = path["points_mm"]
    x, y = corner
    if abs(y0 - y1) < 0.001:
        return abs(y - y0) < 0.001 and min(x0, x1) - 0.001 <= x <= max(x0, x1) + 0.001
    return abs(x - x0) < 0.001 and min(y0, y1) - 0.001 <= y <= max(y0, y1) + 0.001


def _inside_column(path, left, right):
    xs = [point[0] for point in path["points_mm"]]
    return min(xs) >= left - 0.5 and max(xs) <= right + 0.5


def _bottom(path):
    return min(point[1] for point in path["points_mm"])


def _square(passes):
    return {
        "holder": "left",
        "mode": "cut",
        "force": 12,
        "cut_speed": 20,
        "travel_speed": 20,
        "closed": True,
        "passes": passes,
        "points_mm": [[0, 0], [10, 0], [10, 10], [0, 10]],
    }


def _downs(path):
    text = encode_job(
        [path], (100, 100), accurate=False, turn_knife_mm=0, overcut_mm=0
    )
    return [move for move in parse_job(text)["moves"] if move[0] == "D"]


if __name__ == "__main__":
    unittest.main()
