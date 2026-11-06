var assert = require("assert");
var fs = require("fs");
var path = require("path");
var vm = require("vm");

var file = path.join(__dirname, "..", "plugin", "jsx", "pathcorners.jsx");
var ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(file, "utf8"), ctx);

function V(x, y, left, right) {
    return {
        anchor: [x, y],
        left: left || [x, y],
        right: right || [x, y],
        corner: true,
        role: "flat"
    };
}

function ring(points) {
    return {
        closed: true,
        verts: points.map(function (p) { return V(p[0], p[1]); })
    };
}

function linesOf(points) {
    var specs = [];
    var i, a, b, n = points.length;
    for (i = 0; i < n; i++) {
        a = points[i];
        b = points[(i + 1) % n];
        specs.push({ closed: false, verts: [V(a[0], a[1]), V(b[0], b[1])] });
    }
    return specs;
}

function ngon(n, radius) {
    var points = [];
    var i, ang;
    for (i = 0; i < n; i++) {
        ang = -Math.PI / 2 + i * 2 * Math.PI / n;
        points.push([Math.cos(ang) * radius, Math.sin(ang) * radius]);
    }
    return points;
}

function dist(a, b) {
    var dx = a[0] - b[0];
    var dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function allAnchors(plan) {
    var found = [];
    plan.strokes.forEach(function (stroke) {
        stroke.verts.forEach(function (vert) { found.push(vert.anchor); });
    });
    return found;
}

function hasNear(plan, point, tol) {
    return allAnchors(plan).some(function (anchor) { return dist(anchor, point) <= tol; });
}

function extAnchors(plan) {
    var found = [];
    plan.strokes.forEach(function (stroke) {
        stroke.verts.forEach(function (vert) {
            if (vert.role === "ext") found.push(vert.anchor);
        });
    });
    return found;
}

var square = [[0, 0], [100, 0], [100, 100], [0, 100]];
var extend = 10;

var closedSquare = ctx.planCut([ring(square)], extend, false);
assert.strictEqual(closedSquare.strokes.length, 4, "closed square strokes");
assert.ok(hasNear(closedSquare, [-10, 0], 0.05));
assert.ok(hasNear(closedSquare, [110, 0], 0.05));
assert.ok(hasNear(closedSquare, [100, 110], 0.05));
assert.ok(hasNear(closedSquare, [0, -10], 0.05));
assert.strictEqual(extAnchors(closedSquare).length, 8);

var hex = ngon(6, 100);
var closedHex = ctx.planCut([ring(hex)], extend, false);
assert.strictEqual(closedHex.strokes.length, 6, "hexagon strokes");
assert.strictEqual(extAnchors(closedHex).length, 12);

var looseSquare = ctx.planCut(linesOf(square), extend, false);
assert.strictEqual(looseSquare.strokes.length, 4, "square from separate lines");
assert.ok(hasNear(looseSquare, [-10, 0], 0.05));
assert.ok(hasNear(looseSquare, [110, 100], 0.05));
assert.strictEqual(Array.prototype.map.call(looseSquare.remove, Number).sort(function (a, b) { return a - b; }).join(","), "0,1,2,3");

var gapped = linesOf(square);
gapped[0].verts[1] = V(98.8, 0);
var gapPlan = ctx.planCut(gapped, extend, false);
assert.strictEqual(gapPlan.strokes.length, 4, "square lines with a 1.2 pt gap");

var looseHex = ctx.planCut(linesOf(hex), extend, false);
assert.strictEqual(looseHex.strokes.length, 6, "hexagon from separate lines");

var dart = [[0, 0], [100, 0], [40, 30], [0, 100]];
var dartPlan = ctx.planCut([ring(dart)], 15, false);
assert.strictEqual(dartPlan.strokes.length, 3, "concave dart keeps the notch");
extAnchors(dartPlan).forEach(function (anchor) {
    assert.ok(dist(anchor, [40, 30]) > 12, "notch was extended " + anchor);
});
var dartLines = ctx.planCut(linesOf(dart), 15, false);
assert.strictEqual(dartLines.strokes.length, 3, "concave dart from separate lines");

var dartIn = ctx.planCut([ring(dart)], 0, true);
assert.strictEqual(dartIn.strokes.length, 4, "split inward dart");
var starts = dartIn.strokes.filter(function (stroke) {
    return dist(stroke.verts[0].anchor, [40, 30]) < 0.05;
});
assert.strictEqual(starts.length, 2, "both cuts leave the inward tip");
var deep = ring([[0, 0], [200, 0], [200, 40], [130, 40], [100, -120], [70, 40], [0, 40]]);
var deepIn = ctx.planCut([deep], 0, true);
var fromTip = deepIn.strokes.filter(function (stroke) {
    return dist(stroke.verts[0].anchor, [100, -120]) < 0.05;
});
assert.strictEqual(fromTip.length, 2, "both cuts leave the deep inward tip");

var curved = ring([
    [0, 0],
    [80, 0],
    [80, 60],
    [0, 60]
]);
curved.verts[1].right = [110, 40];
var curvedCut = ctx.planCut([curved], 10, false);
var tangent = null;
curvedCut.strokes.forEach(function (stroke) {
    var last = stroke.verts[stroke.verts.length - 1];
    var prev = stroke.verts[stroke.verts.length - 2];
    if (last.role !== "ext") return;
    if (dist(prev.anchor, [80, 0]) > 0.05) return;
    tangent = { prev: prev, ext: last.anchor };
});
assert.ok(tangent, "cut over continues the edge into the corner");
assert.ok(dist(tangent.prev.right, tangent.prev.anchor) < 0.05, "extension is a straight tangent");
assert.ok(Math.abs(tangent.ext[1] - tangent.prev.anchor[1]) < 0.05, "extension stays on the incoming tangent");
var lead = null;
curvedCut.strokes.forEach(function (stroke) {
    if (stroke.verts[0].role !== "ext") return;
    if (dist(stroke.verts[1].anchor, [80, 0]) > 0.05) return;
    lead = stroke.verts;
});
assert.ok(lead, "the leaving edge also gets a straight lead");
assert.ok(dist(lead[1].left, lead[1].anchor) < 0.05, "lead does not reuse the other tangent");
assert.ok(dist(lead[1].right, [110, 40]) < 0.05, "the original outgoing tangent stays");
assert.ok(Math.abs((lead[0].anchor[1] - 0) / (lead[0].anchor[0] - 80) - (40 / 30)) < 0.02, "lead lies on the outgoing tangent");

var valley = {
    closed: false,
    verts: [V(0, 0), V(30, 40), V(70, 10), V(110, 40)]
};
var valleyIn = ctx.planCut([valley], 0, true);
function endsAt(strokes, point) {
    return strokes.filter(function (stroke) {
        return dist(stroke.verts[stroke.verts.length - 1].anchor, point) < 0.05;
    }).length;
}
assert.strictEqual(valleyIn.strokes.filter(function (stroke) {
    return dist(stroke.verts[0].anchor, [30, 40]) < 0.05;
}).length, 2, "both flanks leave the first inward tip");
assert.strictEqual(valleyIn.strokes.filter(function (stroke) {
    return dist(stroke.verts[0].anchor, [70, 10]) < 0.05;
}).length, 2, "both flanks leave the second inward tip");
assert.strictEqual(endsAt(valleyIn.strokes, [30, 40]), 0, "no cut arrives at the first tip");
assert.strictEqual(endsAt(valleyIn.strokes, [70, 10]), 0, "no cut arrives at the second tip");

var looseIn = ctx.planCut(linesOf(dart), 0, true);
assert.strictEqual(looseIn.strokes.length, 4, "split inward on separate lines");
assert.strictEqual(looseIn.strokes.filter(function (stroke) {
    return dist(stroke.verts[0].anchor, [40, 30]) < 0.6;
}).length, 2);

assert.strictEqual(ctx.planCut([ring(square)], 0, true).strokes.length, 0, "square has no inward tip");
assert.strictEqual(ctx.planCut([ring(hex)], 0, true).strokes.length, 0, "hexagon has no inward tip");

var zigzag = [
    { closed: false, verts: [V(0, 0), V(50, 40)] },
    { closed: false, verts: [V(50, 40), V(100, 0)] },
    { closed: false, verts: [V(100, 0), V(150, 30)] }
];
var zig = ctx.planCut(zigzag, extend, false);
assert.strictEqual(zig.strokes.length, 3, "open connected lines");
assert.ok(hasNear(zig, [0, 0], 0.05));
assert.ok(hasNear(zig, [150, 30], 0.05));
assert.ok(!hasNear(zig, [-10, 0], 1));

var oneZig = {
    closed: false,
    verts: [V(0, 0), V(50, 40), V(100, 0), V(150, 30)]
};
assert.strictEqual(ctx.planCut([oneZig], extend, false).strokes.length, 3, "one open polyline");

var elbow = ctx.planCut([
    { closed: false, verts: [V(0, 0), V(40, 0)] },
    { closed: false, verts: [V(40, 0), V(40, 30)] }
], 0, true);
assert.strictEqual(elbow.strokes.length, 2, "split an open corner");
elbow.strokes.forEach(function (stroke) {
    assert.ok(dist(stroke.verts[0].anchor, [40, 0]) < 0.05);
});

var handleCorner = {
    closed: false,
    verts: [V(0, 0), V(50, 0, [50, 0], [50, 30]), V(50, 80)]
};
assert.strictEqual(ctx.planCut([handleCorner], extend, false).strokes.length, 2, "kinked handles are a corner");

var rounded = {
    closed: false,
    verts: [V(0, 0), V(50, 0, [30, 0], [70, 0]), V(50, 50)]
};
assert.strictEqual(ctx.planCut([rounded], extend, false).strokes.length, 0, "continuous tangent stays a radius");

var k = 0.5522847498 * 50;
function C(ax, ay, lx, ly, rx, ry) {
    return { anchor: [ax, ay], left: [lx, ly], right: [rx, ry], corner: false, role: "flat" };
}
var circle = {
    closed: true,
    verts: [
        C(50, 0, 50, -k, 50, k),
        C(0, 50, k, 50, -k, 50),
        C(-50, 0, -50, k, -50, -k),
        C(0, -50, -k, -50, k, -50)
    ]
};
assert.strictEqual(ctx.planCut([circle], extend, false).strokes.length, 0, "circle has no corner");
assert.strictEqual(ctx.planCut([circle], 0, true).strokes.length, 0, "circle has no inward tip");

var tee = ctx.planCut([
    { closed: false, verts: [V(0, 50), V(100, 50)] },
    { closed: false, verts: [V(50, 0), V(50, 50)] }
], extend, false);
assert.strictEqual(tee.strokes.length, 1, "stem at a T is extended");
assert.ok(hasNear(tee, [50, 60], 0.05));
assert.ok(hasNear(tee, [50, 0], 0.05));
assert.strictEqual(Array.prototype.map.call(tee.remove, Number).join(","), "1");

var cross = ctx.planCut([
    { closed: false, verts: [V(0, 50), V(100, 50)] },
    { closed: false, verts: [V(50, 0), V(50, 100)] }
], extend, false);
assert.strictEqual(cross.strokes.length, 0, "a crossing is not a corner");
assert.strictEqual(cross.remove.length, 0);

var almost = {
    closed: false,
    verts: [V(0, 0), V(100, 0), V(100, 100), V(0, 100), V(1, 0.4)]
};
var almostPlan = ctx.planCut([almost], extend, false);
assert.strictEqual(almostPlan.strokes.length, 4, "unclosed polygon whose ends meet");

var irregular = [[0, 0], [90, 5], [130, 70], [70, 40], [110, 120], [20, 100], [-10, 40]];
var irregularPlan = ctx.planCut(linesOf(irregular), extend, false);
assert.ok(irregularPlan.strokes.length >= 3, "irregular polygon from lines");
var irregularIn = ctx.planCut(linesOf(irregular), 0, true);
assert.ok(irregularIn.strokes.length > irregularPlan.strokes.length, "inward split finds the notch");

function strokeOf(plan, source) {
    var i;
    for (i = 0; i < plan.strokes.length; i++) {
        if (plan.strokes[i].source === source) return plan.strokes[i].verts;
    }
    return null;
}

var elbowA = { closed: false, verts: [V(0, 0), V(100, 0)] };
var elbowB = { closed: false, verts: [V(100, 0), V(100, 40)] };
var elbowOver = ctx.planOverlap([elbowA, elbowB], 10);
var overA = strokeOf(elbowOver, 0);
var overB = strokeOf(elbowOver, 1);
assert.ok(overA && overB, "both paths overlap");
assert.ok(dist(overA[overA.length - 1].anchor, [100, 10]) < 0.4, "first path follows the other curve");
assert.ok(dist(overA[0].anchor, [0, 0]) < 0.05, "the rest of the first path stays");
assert.ok(dist(overB[0].anchor, [90, 0]) < 0.4, "second path follows the other curve");
assert.ok(dist(overB[overB.length - 1].anchor, [100, 40]) < 0.05, "the rest of the second path stays");

var kappa = 0.5522847498 * 100;
var arc = { closed: false, verts: [V(0, -40), V(0, 0)] };
var bow = {
    closed: false,
    verts: [V(0, 0, [0, 0], [kappa, 0]), V(100, 100, [100, 100 - kappa], [100, 100])]
};
var bowed = ctx.planOverlap([arc, bow], 20);
var ontoBow = strokeOf(bowed, 0);
var landed = ontoBow[ontoBow.length - 1].anchor;
assert.ok(landed[0] > 15 && landed[0] < 25, "overlap follows the curve, x " + landed[0]);
assert.ok(landed[1] > 0.5 && landed[1] < 6, "overlap is not the chord, y " + landed[1]);
assert.ok(dist(ontoBow[0].anchor, [0, -40]) < 0.05);
assert.ok(dist(strokeOf(bowed, 1)[strokeOf(bowed, 1).length - 1].anchor, [100, 100]) < 0.05);

var shortOver = ctx.planOverlap([
    { closed: false, verts: [V(0, 0), V(30, 0)] },
    { closed: false, verts: [V(30, 0), V(35, 0)] }
], 20);
assert.ok(dist(strokeOf(shortOver, 0)[strokeOf(shortOver, 0).length - 1].anchor, [35, 0]) < 0.05, "overlap stops at the other path");

var chain = ctx.planOverlap([
    { closed: false, verts: [V(0, 0), V(50, 0)] },
    { closed: false, verts: [V(50, 0), V(100, 0)] },
    { closed: false, verts: [V(100, 0), V(150, 0)] }
], 10);
assert.ok(dist(strokeOf(chain, 0)[strokeOf(chain, 0).length - 1].anchor, [60, 0]) < 0.4);
assert.ok(dist(strokeOf(chain, 1)[0].anchor, [40, 0]) < 0.4);
assert.ok(dist(strokeOf(chain, 1)[strokeOf(chain, 1).length - 1].anchor, [110, 0]) < 0.4);
assert.ok(dist(strokeOf(chain, 2)[0].anchor, [90, 0]) < 0.4);

assert.strictEqual(ctx.planOverlap([
    { closed: false, verts: [V(0, 0), V(10, 0)] },
    { closed: false, verts: [V(40, 0), V(50, 0)] }
], 10).strokes.length, 0, "separate paths stay separate");

console.log("pathcorners ok");
