"""Force and speed card: stacked pass areas, colored 10 mm squares."""

import os
import re
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "plotter"))

from force_card import (
    FORCE_MAX,
    FORCE_MIN,
    GLYPHS,
    PAGE_MM,
    PASSES,
    PEN_RGB,
    SPEEDS,
    SQUARE_MM,
    TRAVEL,
    build_force_card,
    rgb_for,
    text_strokes,
)
from protocol import encode_job, parse_job, units


class PassesTest(unittest.TestCase):
    def test_extra_passes_repeat_the_outline(self):
        once = _downs(_square(passes=1))
        twice = _downs(_square(passes=2))
        thrice = _downs(_square(passes=3))
        self.assertEqual(len(twice), 1 + (len(once) - 1) * 2)
        self.assertEqual(len(thrice), 1 + (len(once) - 1) * 3)
        self.assertEqual(twice[len(once):], once[1:])
        self.assertEqual(_laps(_square(passes=2)), 1)
        self.assertEqual(_laps(_square(passes=3)), 1)

    def test_open_passes_lift_instead_of_reversing(self):
        text = encode_job([
            {
                "holder": "left",
                "mode": "cut",
                "force": 12,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": False,
                "passes": 3,
                "points_mm": [[0, 0], [10, 0]],
            }
        ], (100, 100), accurate=False, turn_knife_mm=0, overcut_mm=0)
        moves = parse_job(text)["moves"]
        if moves[-1] == ("U", 0, 0):
            moves = moves[:-1]
        ends = [move for move in moves if move[0] == "D" and move[1] == units(10)]
        self.assertEqual(len(ends), 3)
        lifted = True
        at_end = False
        for move in moves:
            if move[0] == "U":
                lifted = True
                continue
            if at_end and move[1] == 0:
                self.assertTrue(lifted)
            at_end = move[1] == units(10)
            lifted = False

    def test_alternate_passes_start_at_the_other_end(self):
        text = encode_job([
            {
                "holder": "left",
                "mode": "cut",
                "force": 12,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": False,
                "passes": 3,
                "points_mm": [[0, 0], [10, 0]],
            }
        ], (100, 100), accurate=False, turn_knife_mm=0, overcut_mm=0, alternate=True)
        starts = []
        lifted = True
        for kind, x, _y in _raw_moves(text):
            if kind == "U":
                lifted = True
                continue
            if lifted:
                starts.append(x)
            lifted = False
        self.assertEqual(starts, [0, units(10), 0])

    def test_alternate_closed_pass_runs_backwards(self):
        text = encode_job([
            {
                "holder": "left",
                "mode": "cut",
                "force": 12,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": True,
                "passes": 2,
                "points_mm": [[0, 0], [10, 0], [10, 10], [0, 10]],
            }
        ], (100, 100), accurate=False, turn_knife_mm=0, overcut_mm=0, alternate=True)
        starts = []
        lifted = True
        for kind, x, y in _raw_moves(text):
            if kind == "U":
                lifted = True
                continue
            if lifted:
                starts.append((x, y))
            lifted = False
        self.assertEqual(starts[0], (0, 0))
        self.assertEqual(starts[1], (0, 0))
        seconds = []
        lifted = True
        pending = None
        for kind, x, y in _raw_moves(text):
            if kind == "U":
                lifted = True
                pending = None
                continue
            if lifted:
                pending = (x, y)
                lifted = False
                continue
            if pending is not None:
                seconds.append((x, y))
                pending = None
        self.assertNotEqual(seconds[0], seconds[1])

    def test_alternate_leaves_the_pen_in_one_direction(self):
        text = encode_job([
            {
                "holder": "right",
                "mode": "pen",
                "force": 20,
                "cut_speed": 20,
                "travel_speed": 20,
                "closed": False,
                "passes": 2,
                "points_mm": [[0, 0], [10, 0]],
            }
        ], (100, 100), accurate=False, turn_knife_mm=0, overcut_mm=0, alternate=True)
        starts = []
        lifted = True
        for kind, x, _y in _raw_moves(text):
            if kind == "U":
                lifted = True
                continue
            if lifted:
                starts.append(x)
            lifted = False
        self.assertEqual(starts, [0, 0])

    def test_a_digit_is_one_continuous_pen_stroke(self):
        for char in "01256789":
            strokes = text_strokes(char, 6, 0, 0)
            self.assertEqual(len(strokes), 1, char)
            self.assertGreater(_path_length(strokes), _glyph_length(char) * 0.9, char)
        self.assertEqual(len(text_strokes("8", 3.2, 0, 0)), 1)
        self.assertGreater(len(text_strokes("8", 3.2, 0, 0)[0]), 4)

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
            self.assertEqual(path["blade_offset_mm"], 0.35)
            self.assertEqual(
                path["layer"],
                "Left F%d S%d T%d x%d O0.35" % (
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
            for speed in SPEEDS:
                column = [
                    path for path in self.cuts
                    if path["passes"] == passes and path["cut_speed"] == speed
                ]
                column.sort(key=lambda path: path["force"])
                heights = [path["points_mm"][0][1] for path in column]
                self.assertEqual(heights, sorted(heights, reverse=True))
                self.assertEqual(
                    [path["force"] for path in column],
                    list(range(FORCE_MIN, FORCE_MAX + 1)),
                )

    def test_pen_labels_name_both_axes_and_the_passes(self):
        for path in self.pens:
            self.assertEqual(path["holder"], "right")
            self.assertEqual(path["mode"], "pen")
            self.assertEqual(path["rgb"], PEN_RGB)
            self.assertEqual(path["layer"], "Right Stift F20 S20 T20 x1 O0.0")
            self.assertEqual(path["blade_offset_mm"], 0.0)
            self.assertEqual(path["cut_speed"], 20)
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
                    if pen["label"] == "S%d" % cut["cut_speed"]
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
                    if pen["label"] != "F%d" % cut["force"]:
                        continue
                    xs = [point[0] for point in pen["points_mm"]]
                    ys = [point[1] for point in pen["points_mm"]]
                    if max(xs) < left and min(ys) >= bottom - 1 and max(ys) <= top_edge + 1:
                        beside.append(pen)
                self.assertGreater(len(beside), 0)

    def test_pen_draws_at_pen_speed_while_travel_stays_fast(self):
        job = build_force_card(travel=400, pen_speed=20)
        pens = [path for path in job["paths"] if path["mode"] == "pen"]
        self.assertGreater(len(pens), 0)
        for path in pens:
            self.assertEqual(path["cut_speed"], 20)
            self.assertEqual(path["travel_speed"], 400)
            self.assertEqual(path["layer"], "Right Stift F20 S20 T400 x1 O0.0")
            self.assertEqual(path["blade_offset_mm"], 0.0)
        cuts = [path for path in job["paths"] if path["mode"] == "cut"]
        self.assertTrue(all(path["travel_speed"] == 400 for path in cuts))

    def test_pen_on_the_left_puts_the_knife_on_the_right(self):
        job = build_force_card(pen_holder="left")
        pens = [path for path in job["paths"] if path["mode"] == "pen"]
        cuts = [path for path in job["paths"] if path["mode"] == "cut"]
        self.assertGreater(len(pens), 0)
        self.assertGreater(len(cuts), 0)
        self.assertTrue(all(path["holder"] == "left" for path in pens))
        self.assertTrue(all(path["layer"].startswith("Left Stift ") for path in pens))
        self.assertTrue(all(path["holder"] == "right" for path in cuts))
        self.assertTrue(all(path["layer"].startswith("Right F") for path in cuts))

    def test_cut_offset_stays_off_the_pen(self):
        job = build_force_card(offset=0.4)
        pens = [path for path in job["paths"] if path["mode"] == "pen"]
        cuts = [path for path in job["paths"] if path["mode"] == "cut"]
        self.assertTrue(all(path["blade_offset_mm"] == 0.0 for path in pens))
        self.assertTrue(all(path["layer"].endswith(" O0.0") for path in pens))
        self.assertTrue(all(path["blade_offset_mm"] == 0.4 for path in cuts))
        self.assertTrue(all(path["layer"].endswith(" O0.4") for path in cuts))
        self.assertEqual(job["blade_offset_mm"], 0.4)

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

    def test_axis_titles_name_force_and_speed(self):
        labels = set(pen["label"] for pen in self.pens)
        self.assertIn("Kraft", labels)
        self.assertIn("Speed", labels)
        one_x_top = max(
            point[1] for pen in self.pens if pen["label"] == "1x" for point in pen["points_mm"]
        )
        speed = [pen for pen in self.pens if pen["label"] == "Speed"]
        self.assertTrue(speed)
        speed_bottom = min(point[1] for pen in speed for point in pen["points_mm"])
        self.assertGreater(speed_bottom, one_x_top)
        kraft_x = min(point[0] for pen in self.pens if pen["label"] == "Kraft" for point in pen["points_mm"])
        number_x = min(
            point[0] for pen in self.pens if pen["label"].startswith("F") and pen["label"][1:].isdigit()
            for point in pen["points_mm"]
        )
        self.assertLess(kraft_x, number_x)

    def test_squares_are_ordered_as_a_snake(self):
        job = build_force_card(
            force_min=10, force_max=20, force_step=10,
            speed_min=10, speed_max=20, speed_step=10,
            pass_min=1, pass_max=1, pass_step=1,
        )
        cuts = sorted(
            (path for path in job["paths"] if path["mode"] == "cut"),
            key=lambda path: path["order"],
        )
        corners = [
            (round(min(pt[0] for pt in path["points_mm"]), 1),
             round(min(pt[1] for pt in path["points_mm"]), 1))
            for path in cuts
        ]
        self.assertEqual(corners[0][1], corners[1][1])
        self.assertLess(corners[0][0], corners[1][0])
        self.assertGreater(corners[0][1], corners[2][1])
        self.assertEqual(corners[2][1], corners[3][1])
        self.assertGreater(corners[2][0], corners[3][0])

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
        self.assertEqual(len(downs), 2 * 2 * 4)

    def test_overcuts_stop_short_of_the_next_square(self):
        job = build_force_card(
            force_min=10, force_max=20, force_step=10,
            speed_min=10, speed_max=20, speed_step=10,
            pass_min=1, pass_max=1, pass_step=1,
            overcut=4,
        )
        cuts = [path for path in job["paths"] if path["mode"] == "cut"]
        self.assertTrue(_tips_only_meet(_axis_spans(cuts, 1)))
        self.assertTrue(_tips_only_meet(_axis_spans(cuts, 0)))

    def test_speed_can_be_the_vertical_axis(self):
        job = build_force_card(
            force_min=10, force_max=10, force_step=1,
            speed_min=10, speed_max=30, speed_step=10,
            pass_min=1, pass_max=1, pass_step=1,
            y_axis="speed",
        )
        cuts = [path for path in job["paths"] if path["mode"] == "cut"]
        height = {}
        for path in cuts:
            height[path["cut_speed"]] = path["points_mm"][0][1]
        self.assertGreater(height[10], height[20])
        self.assertGreater(height[20], height[30])
        self.assertEqual(len(set(path["points_mm"][0][0] for path in cuts)), 1)

    def test_steg_leaves_a_centered_gap_on_every_side(self):
        job = build_force_card(
            force_min=10, force_max=10, force_step=1,
            speed_min=20, speed_max=20, speed_step=10,
            pass_min=1, pass_max=1, pass_step=1,
            overcut=1.5,
            steg=0.5,
        )
        cuts = [path for path in job["paths"] if path["mode"] == "cut"]
        self.assertEqual(len(cuts), 8)
        self.assertTrue(all(path["closed"] is False for path in cuts))
        horizontal = {}
        vertical = {}
        for path in cuts:
            start, end = path["points_mm"]
            if start[1] == end[1]:
                horizontal.setdefault(start[1], []).append(sorted([start[0], end[0]]))
            else:
                vertical.setdefault(start[0], []).append(sorted([start[1], end[1]]))
        self.assertEqual(len(horizontal), 2)
        self.assertEqual(len(vertical), 2)
        for spans in list(horizontal.values()) + list(vertical.values()):
            spans.sort()
            self.assertEqual(len(spans), 2)
            self.assertAlmostEqual(spans[1][0] - spans[0][1], 0.5, places=3)
            outer = spans[1][1] - spans[0][0]
            self.assertAlmostEqual(outer, SQUARE_MM + 3.0, places=3)
            gap_center = (spans[0][1] + spans[1][0]) / 2.0
            side_center = (spans[0][0] + spans[1][1]) / 2.0
            self.assertAlmostEqual(gap_center, side_center, places=3)

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
        self.assertIn("--steg", source)
        self.assertIn("--alternate", source)
        self.assertIn("item.filled = false", source)
        self.assertIn("if (item.stroked) return asRgb(item.strokeColor);", source)
        self.assertIn("Nur markierte Ebenen", source)
        self.assertIn("isComplete", source)
        self.assertIn("logLine", source)
        self.assertNotIn("if (isComplete(readLayerSettings(item.layers))) continue;", source)
        self.assertNotIn("settings[rgbKey(item.rgb)]", source)
        self.assertIn("sweepEmptyLayers", source)
        self.assertIn("order: order", source)
        self.assertIn("applyColorName", source)
        self.assertNotIn("if (mode === \"pen\") holder = \"right\";", source)
        self.assertNotIn("COLORS_FILE", source)
        self.assertIn("left", source)
        self.assertIn("right", source)
        panel = os.path.join(os.path.dirname(__file__), "..", "plugin", "index.html")
        with open(panel, "r") as handle:
            html = handle.read()
        self.assertIn("max 500", html)
        self.assertIn("max 800", html)
        self.assertIn('id="pen" value="20"', html)
        self.assertIn('id="y-axis"', html)
        self.assertIn('id="steg" value="0.5"', html)
        self.assertIn('id="stay"', html)
        self.assertIn('class="toggle on"', html)
        self.assertNotIn("Zusammenhaengend schneiden", html)
        self.assertIn('id="simulate"', html)
        self.assertIn('id="axis-titles"', html)
        self.assertIn('id="connect-loops"', html)
        self.assertIn('id="history"', html)
        self.assertNotIn('id="blade"', html)
        self.assertNotIn('id="turn"', html)
        self.assertIn('id="config-save"', html)
        self.assertIn('id="config-load"', html)
        self.assertIn('id="config-rename"', html)
        self.assertIn('id="config-delete"', html)
        self.assertIn('id="settings"', html)
        self.assertIn('id="color-load"', html)
        self.assertIn('id="square-draw"', html)
        self.assertIn('id="add-cutover"', html)
        self.assertIn('id="split-inward"', html)
        self.assertIn('id="cutover"', html)
        self.assertIn('id="add-overlap"', html)
        self.assertIn('id="overlap"', html)
        self.assertNotIn("Cut speed", html)
        self.assertIn('id="cfg-depth"', html)
        self.assertIn('id="cfg-offset"', html)
        self.assertIn('id="cfg-angle"', html)
        self.assertIn('id="offset" value="0.35"', html)
        self.assertIn('value="30"', html)
        self.assertIn('value="60"', html)
        self.assertIn('id="config-export"', html)
        self.assertIn('id="config-import"', html)
        self.assertIn('id="pen-holder"', html)
        self.assertIn('id="square-offset" value="0.35"', html)
        self.assertIn('id="square-angle"', html)
        self.assertIn('id="pen-speed" value="20"', html)
        self.assertIn("Travel speed", html)
        self.assertIn("Pen force", html)
        self.assertNotIn("cfg-force-min", html)
        self.assertIn('id="cfg-force" value="20"', html)
        self.assertIn('id="cfg-speed" value="20"', html)
        self.assertIn('id="force" value="20"', html)
        self.assertIn('id="speed" value="20"', html)
        self.assertIn('id="split-form"', html)
        self.assertIn('id="split-detail"', html)
        self.assertIn('id="tool-ok"', html)
        self.assertIn('id="add-cutover" class="icon"', html)
        self.assertIn('id="split-inward" class="icon"', html)
        self.assertIn('id="add-overlap" class="icon"', html)
        self.assertNotIn('id="force-detail"', html)
        self.assertNotIn('id="force-straight"', html)
        self.assertNotIn('id="speed-detail"', html)
        self.assertNotIn('id="speed-straight"', html)
        self.assertNotIn('id="sim-boost"', html)
        self.assertNotIn('id="sim-detail"', html)
        self.assertNotIn('id="sim-ramp"', html)
        self.assertNotIn('id="loop-force"', html)
        self.assertLess(html.find('id="cfg-passes"'), html.find('id="cfg-force"'))
        self.assertLess(html.find('id="cfg-force"'), html.find('id="cfg-speed"'))
        self.assertLess(html.find('id="force"'), html.find('id="speed"'))
        panel_js = os.path.join(os.path.dirname(__file__), "..", "plugin", "js", "panel.js")
        with open(panel_js, "r") as handle:
            script = handle.read()
        self.assertIn("var plotJobs", script)
        self.assertNotIn("var history =", script)
        self.assertIn("new Option", script)
        self.assertIn("selectedIndex", script)
        self.assertIn('numberValue("force"', script)
        self.assertNotIn("force-detail", script)
        self.assertNotIn("Strichfarbe waehlen", html)
        self.assertIn(">Material<", html)

    def test_axis_titles_can_be_omitted(self):
        job = build_force_card(titles=False, pass_min=1, pass_max=1, force_min=10, force_max=10, speed_min=10, speed_max=10)
        labels = [path.get("label") for path in job["paths"]]
        self.assertNotIn("Kraft", labels)
        self.assertNotIn("Speed", labels)
        self.assertTrue(any(path.get("mode") == "cut" for path in job["paths"]))


def _axis_spans(cuts, axis):
    grouped = {}
    for path in cuts:
        a, b = path["points_mm"]
        if a[axis] != b[axis]:
            continue
        key = round(a[axis], 3)
        other = 1 - axis
        grouped.setdefault(key, []).append(tuple(sorted((a[other], b[other]))))
    return list(grouped.values())


def _tips_only_meet(groups):
    for spans in groups:
        ordered = sorted(spans)
        for left, right in zip(ordered, ordered[1:]):
            if right[0] - left[1] < 0.999:
                return False
    return True


def _glyph_length(char):
    total = 0.0
    for stroke in GLYPHS[char]:
        for start, end in zip(stroke, stroke[1:]):
            total += abs(end[0] - start[0]) + abs(end[1] - start[1])
    return total


def _path_length(strokes):
    total = 0.0
    for stroke in strokes:
        for start, end in zip(stroke, stroke[1:]):
            total += abs(end[0] - start[0]) + abs(end[1] - start[1])
    return total


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


def _raw_moves(text):
    body = text.split("@", 1)[0]
    found = re.findall(r"([UD])(-?\d+),(-?\d+)", body)
    moves = [(kind, int(x), int(y)) for kind, x, y in found]
    if moves and moves[-1] == ("U", 0, 0):
        moves = moves[:-1]
    return moves


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
    return [move for move in _moves(path) if move[0] == "D"]


def _laps(path):
    text = _text(path)
    body = text[:text.rfind("@")]
    body = body[:body.rfind("U")]
    return len(re.findall(r"(?:^|[\s;])U-?\d+,-?\d+", body))


def _moves(path):
    return parse_job(_text(path))["moves"]


def _text(path):
    return encode_job(
        [path], (100, 100), accurate=False, turn_knife_mm=0, overcut_mm=0
    )


if __name__ == "__main__":
    unittest.main()
