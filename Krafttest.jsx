/*
  Plotter panel.

  Layer names carry the settings, for example Left F10 S20 T20 x1.
  Quadrate draws the test sheet from the range fields.
  Plot sends the open document to 192.168.0.200.
*/

#target illustrator
#targetengine "plotterfarben"

var __plotterScriptFile = $.fileName;
var PYTHON = "C:/Users/Leon/AppData/Local/Programs/Python/Python38/python.exe";
var PLOTTER_PY = "C:/Users/Leon/Downloads/doublecut/plotter/send_job.py";
var COLOR_SETTINGS = "C:/Users/Leon/Downloads/doublecut/colors.json";
/*__WORKER_START__*/
var MM = 72 / 25.4;
var PANEL_LOG = "C:/Users/Leon/Downloads/doublecut/panel.log";

function logLine(message) {
    try {
        var file = new File(PANEL_LOG);
        file.encoding = "UTF-8";
        var stamp = new Date();
        var line = stamp.getFullYear() + "-" + two(stamp.getMonth() + 1) + "-" + two(stamp.getDate())
            + " " + two(stamp.getHours()) + ":" + two(stamp.getMinutes()) + ":" + two(stamp.getSeconds())
            + " host " + message;
        if (file.exists && file.length > 180000) {
            if (!file.open("r")) return;
            var text = file.read();
            file.close();
            text = text.substring(text.length - 120000);
            var cut = text.indexOf("\n");
            if (cut >= 0) text = text.substring(cut + 1);
            if (!file.open("w")) return;
            file.write(text);
            file.close();
        }
        if (!file.open("a")) return;
        file.writeln(line);
        file.close();
    } catch (eLog) {}
}

function two(n) {
    return (n < 10 ? "0" : "") + n;
}

function drawCard(jsonPath) {
    try {
        var job = readJson(jsonPath);
        if (!job) return "ERR Musterdatei fehlt";
        var page = job.page_mm;
        var doc = app.documents.add(DocumentColorSpace.RGB, page[0] * MM, page[1] * MM);
        var board = doc.artboards[0].artboardRect;
        var originX = board[0];
        var originY = board[3];
        var i, path, layer;
        for (i = 0; i < job.paths.length; i++) {
            path = job.paths[i];
            layer = layerForPath(doc, path);
            drawPath(layer, path, originX, originY);
        }
        sweepContainer(doc, false);
        return "ok";
    } catch (eDraw) {
        return "ERR " + clean(eDraw.message);
    }
}

function scanColors(outPath) {
    try {
        if (!app.documents.length) return "nodoc";
        var found = harvest(app.activeDocument);
        var seen = {};
        var list = [];
        var i, item, key, named, entry;
        for (i = 0; i < found.paths.length; i++) {
            item = found.paths[i];
            key = rgbKey(item.rgb);
            named = readLayerSettings(item.layers);
            entry = seen[key];
            if (!entry) {
                entry = {
                    rgb: item.rgb,
                    layer: item.layers && item.layers.length ? String(item.layers[0]) : ""
                };
                if (isComplete(named)) copyNamed(entry, named);
                seen[key] = entry;
                list.push(entry);
            } else if (!entry.complete && isComplete(named)) {
                copyNamed(entry, named);
                entry.layer = item.layers && item.layers.length ? String(item.layers[0]) : entry.layer;
            }
        }
        logLine("scan colors=" + list.length);
        if (!writeText(outPath, toJson(list))) return "ERR Farben konnten nicht gespeichert werden";
        return "ok " + list.length;
    } catch (eScan) {
        logLine("scan ERR " + clean(eScan.message));
        return "ERR " + clean(eScan.message);
    }
}

function copyNamed(entry, named) {
    entry.complete = true;
    entry.force = named.force;
    entry.speed = named.speed;
    entry.travel = named.travel;
    entry.passes = named.passes;
    entry.holder = named.holder;
    entry.mode = named.mode || "cut";
    if (typeof named.offset === "number") entry.offset = named.offset;
}

function collectJob(jobPath, blade, turn, selectedOnly, colorsPath) {
    try {
        if (!app.documents.length) return "nodoc";
        var onlyMarked = selectedOnly === true || selectedOnly === 1 || selectedOnly === "true";
        var doc = app.activeDocument;
        var board = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var found = harvest(doc);
        var paths = [];
        var skipped = found.skipped;
        var i, item, named, anyPicked, useItem, mode, holder;
        anyPicked = false;
        for (i = 0; i < found.paths.length; i++) {
            if (found.paths[i].picked) anyPicked = true;
        }
        for (i = 0; i < found.paths.length; i++) {
            item = found.paths[i];
            if (onlyMarked) {
                useItem = anyPicked ? item.picked : item.marked;
                if (!useItem) {
                    skipped++;
                    continue;
                }
            }
            named = readLayerSettings(item.layers);
            if (!isComplete(named)) {
                skipped++;
                if (skipped <= 8) logLine("skip incomplete layer '" + (item.layers && item.layers.length ? item.layers.join(" / ") : "") + "'");
                continue;
            }
            mode = named.mode === "pen" || named.mode === "fold" ? named.mode : "cut";
            holder = named.holder === "right" ? "right" : "left";
            if (paths.length < 12) {
                logLine("plot " + holder + " " + mode + " F" + named.force + " S" + named.speed + " T" + named.travel + " x" + named.passes + (typeof named.offset === "number" ? " O" + named.offset : "") + " '" + item.layers[0] + "'");
            }
            paths.push(jobPathFrom(item, holder, mode, named.force, named.speed, named.travel, named.passes, paths.length, named.offset));
        }
        logLine("collect paths=" + paths.length + " skipped=" + skipped);
        var pageW = (board[2] - board[0]) / MM;
        var pageH = (board[1] - board[3]) / MM;
        var job = {
            page_mm: [round3(pageW), round3(pageH)],
            origin_mm: [0, 0],
            accurate: true,
            blade_offset_mm: blade,
            overcut_mm: 0,
            turn_knife_mm: turn,
            anchor: "top-left",
            paths: paths
        };
        if (!writeText(jobPath, toJson(job))) return "ERR Auftrag konnte nicht geschrieben werden";
        return "ok " + paths.length + " " + skipped;
    } catch (eJob) {
        return "ERR " + clean(eJob.message);
    }
}

function isComplete(named) {
    return named.force !== null && named.speed !== null && named.travel !== null && named.passes !== null && !!named.holder;
}

function whole(value, fallback) {
    var n = parseFloat(value);
    if (isNaN(n)) return fallback;
    return n;
}

function jobPathFrom(item, holder, mode, force, speed, travel, passes, order, offset) {
    if (passes < 1) passes = 1;
    var layerName = "";
    if (item.layers && item.layers.length) layerName = String(item.layers[0]);
    var path = {
        holder: holder || "left",
        mode: mode || "cut",
        force: force,
        cut_speed: speed,
        travel_speed: travel,
        closed: item.closed,
        passes: passes,
        layer: layerName,
        order: order,
        points_mm: item.points
    };
    if (typeof offset === "number" && !isNaN(offset)) path.blade_offset_mm = offset;
    return path;
}

function drawPath(layer, path, originX, originY) {
    var item = layer.pathItems.add();
    var points = path.points_mm;
    var j, here, point;
    for (j = 0; j < points.length; j++) {
        point = item.pathPoints.add();
        here = [originX + points[j][0] * MM, originY + points[j][1] * MM];
        point.anchor = here;
        point.leftDirection = here;
        point.rightDirection = here;
        point.pointType = PointType.CORNER;
    }
    item.closed = path.closed === true;
    var color = rgbColor(path.rgb);
    item.filled = false;
    item.stroked = true;
    item.strokeWidth = path.mode === "pen" ? 0.35 : 0.6;
    item.strokeColor = color;
}

function harvest(doc) {
    var acc = { paths: [], skipped: 0 };
    var i;
    for (i = 0; i < doc.layers.length; i++) walkLayer(doc.layers[i], acc, "");
    return acc;
}

function walkLayer(layer, acc, inherited) {
    if (!layer.visible) return;
    var holder = holderFromName(layer.name) || inherited;
    var i;
    for (i = 0; i < layer.layers.length; i++) walkLayer(layer.layers[i], acc, holder);
    walkInto(layer, acc, holder);
}

function walkInto(container, acc, holder) {
    var items = container.pageItems;
    var i, it;
    for (i = 0; i < items.length; i++) {
        it = items[i];
        if (!it || it.hidden) continue;
        if (it.typename === "GroupItem") walkInto(it, acc, holder);
        else if (it.typename === "CompoundPathItem") addCompound(it, acc, holder);
        else if (it.typename === "PathItem") addOne(it, null, acc, holder);
    }
}

function addCompound(item, acc, holder) {
    var color = itemRgb(item);
    var i;
    for (i = 0; i < item.pathItems.length; i++) addOne(item.pathItems[i], color, acc, holder);
}

function addOne(item, color, acc, holder) {
    if (!item || item.guides || item.clipping) return;
    var rgb = color || itemRgb(item);
    if (!rgb) {
        acc.skipped++;
        return;
    }
    var poly = pathMm(item);
    if (!poly || poly.length < 2) {
        acc.skipped++;
        return;
    }
    acc.paths.push({
        rgb: rgb,
        points: poly,
        closed: item.closed === true,
        holder: holder || "",
        layers: layerNames(item),
        marked: layerMarked(item.layer),
        picked: pathSelected(item)
    });
}

function pathSelected(item) {
    var current = item;
    while (current && current.typename !== "Layer") {
        try {
            if (current.selected === true) return true;
        } catch (ePick) {}
        current = current.parent;
    }
    return false;
}

function layerMarked(layer) {
    var doc = app.activeDocument;
    var current = layer;
    while (current && current.typename === "Layer") {
        try {
            if (current.selected === true) return true;
        } catch (eSel) {}
        if (doc.activeLayer === current) return true;
        if (!current.parent || current.parent.typename !== "Layer") break;
        current = current.parent;
    }
    return false;
}

function layerNames(item) {
    var names = [];
    var layer = item.layer;
    while (layer && layer.typename === "Layer") {
        names.push(String(layer.name));
        if (!layer.parent || layer.parent.typename !== "Layer") break;
        layer = layer.parent;
    }
    return names;
}

function parseLayerName(name) {
    var text = String(name).toLowerCase();
    var mode = "";
    if (text.indexOf("stift") >= 0 || text.indexOf("pen") >= 0) mode = "pen";
    else if (text.indexOf("falz") >= 0 || text.indexOf("fold") >= 0) mode = "fold";
    return {
        force: firstNumber(name, /F\s*(\d+)/i),
        speed: firstNumber(name, /S\s*(\d+)/i),
        travel: firstNumber(name, /T\s*(\d+)/i),
        passes: firstNumber(name, /x\s*(\d+)/i),
        holder: holderFromName(name),
        mode: mode,
        offset: offsetFromName(name)
    };
}

function offsetFromName(name) {
    var found = String(name).match(/(^|[^A-Za-z])O\s*(\d+([.,]\d+)?)/i);
    if (!found) return null;
    var n = parseFloat(String(found[2]).replace(",", "."));
    return isNaN(n) ? null : n;
}

function firstNumber(name, expr) {
    var found = String(name).match(expr);
    if (!found) return null;
    return parseInt(found[1], 10);
}

function readLayerSettings(names) {
    var force = null;
    var speed = null;
    var travel = null;
    var passes = null;
    var holder = "";
    var mode = "";
    var offset = null;
    var i, parsed;
    if (!names) {
        return { force: force, speed: speed, travel: travel, passes: passes, holder: holder, mode: mode, offset: offset };
    }
    for (i = 0; i < names.length; i++) {
        parsed = parseLayerName(names[i]);
        if (isComplete(parsed)) return parsed;
        if (force === null && parsed.force !== null) force = parsed.force;
        if (speed === null && parsed.speed !== null) speed = parsed.speed;
        if (travel === null && parsed.travel !== null) travel = parsed.travel;
        if (passes === null && parsed.passes !== null) passes = parsed.passes;
        if (!holder && parsed.holder) holder = parsed.holder;
        if (!mode && parsed.mode) mode = parsed.mode;
        if (offset === null && parsed.offset !== null) offset = parsed.offset;
    }
    return { force: force, speed: speed, travel: travel, passes: passes, holder: holder, mode: mode, offset: offset };
}

function layerForPath(doc, path) {
    var name = path.layer;
    if (!name) {
        if (path.mode === "pen") name = (path.holder === "left" ? "Left " : "Right ") + "Stift F" + path.force + " S" + path.cut_speed + " T" + path.travel_speed + " x" + path.passes;
        else name = (path.holder === "right" ? "Right " : "Left ") + "F" + path.force + " S" + path.cut_speed + " T" + path.travel_speed + " x" + path.passes;
    }
    if (path.mode === "pen") {
        var penParent = ensureLayer(doc, name);
        return ensureLayer(penParent, path.label || "Stift");
    }
    return ensureLayer(ensureLayer(doc, "Bereich " + path.passes), name);
}

function ensureLayer(container, name) {
    var layers = container.layers;
    var i;
    for (i = 0; i < layers.length; i++) {
        if (layers[i].name === name) return layers[i];
    }
    var layer = layers.add();
    layer.name = name;
    return layer;
}

function sweepEmptyLayers(onlyGenerated) {
    try {
        if (!app.documents.length) return "nodoc";
        var only = onlyGenerated === true || onlyGenerated === 1 || onlyGenerated === "true";
        return "ok " + sweepContainer(app.activeDocument, only);
    } catch (eSweep) {
        return "ERR " + clean(eSweep.message);
    }
}

function sweepContainer(container, onlyGenerated) {
    var removed = 0;
    var layers = container.layers;
    var i, layer;
    if (!layers) return 0;
    for (i = layers.length - 1; i >= 0; i--) {
        layer = layers[i];
        removed += sweepContainer(layer, onlyGenerated);
        removeEmptyGroups(layer);
        if (!layerIsEmpty(layer)) continue;
        if (container.typename === "Document" && container.layers.length <= 1) continue;
        if (onlyGenerated && !generatedLayerName(layer.name) && !(container.typename === "Layer" && generatedLayerName(container.name))) continue;
        try {
            layer.remove();
            removed++;
        } catch (eRemove) {}
    }
    return removed;
}

function removeEmptyGroups(container) {
    var i, group;
    if (!container.groupItems) return;
    for (i = container.groupItems.length - 1; i >= 0; i--) {
        group = container.groupItems[i];
        removeEmptyGroups(group);
        try {
            if (group.pageItems.length === 0) group.remove();
        } catch (eGroup) {}
    }
}

function layerIsEmpty(layer) {
    try {
        return layer.pageItems.length === 0 && layer.layers.length === 0;
    } catch (eEmpty) {
        return false;
    }
}

function generatedLayerName(name) {
    return /^(Bereich\s+\d+|Left\b|Right\b)/i.test(String(name));
}

function applyColorName(r, g, b, layerName) {
    try {
        if (!app.documents.length) return "nodoc";
        var doc = app.activeDocument;
        var want = Math.round(r) + "," + Math.round(g) + "," + Math.round(b);
        var items = [];
        collectColored(doc, want, items);
        logLine("apply want=" + want + " name='" + layerName + "' items=" + items.length);
        if (!items.length) return "ok 0";
        var seen = [];
        var count = 0;
        var i, item, layer, sub, before, after;
        for (i = 0; i < items.length; i++) {
            item = items[i];
            layer = item.layer;
            if (!layer) {
                logLine("apply item without layer");
                continue;
            }
            unlockLayer(layer);
            if (layerIsOnlyColor(layer, want)) {
                if (layerSeen(seen, layer)) continue;
                seen.push(layer);
                before = String(layer.name);
                if (before !== layerName) layer.name = layerName;
                after = String(layer.name);
                logLine("rename '" + before + "' -> '" + after + "'");
                if (after !== layerName) return "ERR Ebene blieb '" + clean(after) + "'";
                count++;
            } else {
                sub = onlyColorChild(layer, layerName, want);
                if (!sub) {
                    sub = layer.layers.add();
                    sub.name = layerName;
                    logLine("sublayer '" + layerName + "' under '" + layer.name + "'");
                }
                unlockLayer(sub);
                if (item.layer !== sub) {
                    before = String(item.layer.name);
                    item.move(sub, ElementPlacement.PLACEATEND);
                    logLine("moved from '" + before + "' to '" + sub.name + "'");
                }
                if (String(sub.name) !== layerName) return "ERR Ebene blieb '" + clean(sub.name) + "'";
                count++;
            }
        }
        try { app.redraw(); } catch (eRedraw) { logLine("redraw " + eRedraw.message); }
        return "ok " + count;
    } catch (eName) {
        logLine("apply ERR " + clean(eName.message));
        return "ERR " + clean(eName.message);
    }
}

function layerSeen(seen, layer) {
    var i;
    for (i = 0; i < seen.length; i++) {
        if (seen[i] === layer) return true;
    }
    return false;
}

function unlockLayer(layer) {
    var current = layer;
    while (current && current.typename === "Layer") {
        try { current.locked = false; } catch (eLock) {}
        if (!current.parent || current.parent.typename !== "Layer") break;
        current = current.parent;
    }
}

function onlyColorChild(parent, name, want) {
    var i, layer;
    for (i = 0; i < parent.layers.length; i++) {
        layer = parent.layers[i];
        if (layer.name === name && layerIsOnlyColor(layer, want)) return layer;
    }
    return null;
}

function collectColored(container, want, items) {
    var pageItems, i, it, rgb;
    if (container.layers) {
        for (i = 0; i < container.layers.length; i++) collectColored(container.layers[i], want, items);
    }
    pageItems = container.pageItems;
    if (!pageItems) return;
    for (i = 0; i < pageItems.length; i++) {
        it = pageItems[i];
        if (!it || it.hidden) continue;
        if (it.typename === "GroupItem") collectColored(it, want, items);
        else if (it.typename === "CompoundPathItem" || it.typename === "PathItem") {
            rgb = itemRgb(it);
            if (rgb && rgbKey(rgb) === want) items.push(it);
        }
    }
}

function layerIsOnlyColor(layer, want) {
    var i;
    for (i = 0; i < layer.layers.length; i++) {
        if (!layerIsOnlyColor(layer.layers[i], want)) return false;
    }
    return pageItemsOnlyColor(layer, want);
}

function pageItemsOnlyColor(container, want) {
    var pageItems = container.pageItems;
    var i, it, rgb;
    if (!pageItems) return true;
    for (i = 0; i < pageItems.length; i++) {
        it = pageItems[i];
        if (!it || it.hidden) continue;
        if (it.typename === "GroupItem") {
            if (!pageItemsOnlyColor(it, want)) return false;
        } else if (it.typename === "CompoundPathItem" || it.typename === "PathItem") {
            rgb = itemRgb(it);
            if (rgb && rgbKey(rgb) !== want) return false;
        }
    }
    return true;
}

function findLayerNamed(container, name) {
    var layers = container.layers;
    var i, found;
    if (!layers) return null;
    for (i = 0; i < layers.length; i++) {
        if (layers[i].name === name) return layers[i];
        found = findLayerNamed(layers[i], name);
        if (found) return found;
    }
    return null;
}

function holderFromName(name) {
    var text = String(name).toLowerCase();
    var rightAt = text.indexOf("right");
    var leftAt = text.indexOf("left");
    if (leftAt < 0 && rightAt < 0) return "";
    if (rightAt < 0) return "left";
    if (leftAt < 0) return "right";
    return leftAt <= rightAt ? "left" : "right";
}

function pathMm(item) {
    var pts = item.pathPoints;
    if (!pts || pts.length < 2) return null;
    var doc = app.activeDocument;
    var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
    var originX = ab[0];
    var originY = ab[3];
    var poly = [];
    var count = pts.length;
    var segments = item.closed ? count : count - 1;
    var s, a, b, p0, p1, p2, p3;
    pushPoint(poly, toMm(pts[0].anchor, originX, originY));
    for (s = 0; s < segments; s++) {
        a = pts[s];
        b = pts[(s + 1) % count];
        p0 = toMm(a.anchor, originX, originY);
        p1 = toMm(a.rightDirection, originX, originY);
        p2 = toMm(b.leftDirection, originX, originY);
        p3 = toMm(b.anchor, originX, originY);
        if (near(p0, p1) && near(p2, p3)) pushPoint(poly, p3);
        else flattenCubic(p0, p1, p2, p3, poly, 0);
    }
    if (item.closed && poly.length > 2 && near(poly[0], poly[poly.length - 1])) poly.pop();
    return poly;
}

function flattenCubic(p0, p1, p2, p3, poly, depth) {
    if (depth > 8 || flatEnough(p0, p1, p2, p3)) {
        pushPoint(poly, p3);
        return;
    }
    var a = mid(p0, p1);
    var b = mid(p1, p2);
    var c = mid(p2, p3);
    var d = mid(a, b);
    var e = mid(b, c);
    var f = mid(d, e);
    flattenCubic(p0, a, d, f, poly, depth + 1);
    flattenCubic(f, e, c, p3, poly, depth + 1);
}

function flatEnough(p0, p1, p2, p3) {
    var dx = p3[0] - p0[0];
    var dy = p3[1] - p0[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.02) return true;
    return (chord(p0, p1, dx, dy) / len) < 0.04 && (chord(p0, p2, dx, dy) / len) < 0.04;
}

function chord(origin, point, dx, dy) {
    return Math.abs((point[0] - origin[0]) * dy - (point[1] - origin[1]) * dx);
}

function mid(a, b) {
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function near(a, b) {
    var dx = a[0] - b[0];
    var dy = a[1] - b[1];
    return dx * dx + dy * dy < 0.0004;
}

function pushPoint(poly, pt) {
    var rounded = [round3(pt[0]), round3(pt[1])];
    if (poly.length) {
        var last = poly[poly.length - 1];
        if (near(last, rounded)) return;
    }
    poly.push(rounded);
}

function toMm(pt, originX, originY) {
    return [(pt[0] - originX) / MM, (pt[1] - originY) / MM];
}

function itemRgb(item) {
    try {
        if (item.stroked) return asRgb(item.strokeColor);
    } catch (eStroke) {}
    return null;
}

function asRgb(color) {
    if (!color || color.typename === "NoColor") return null;
    if (color.typename === "RGBColor") {
        return [Math.round(color.red), Math.round(color.green), Math.round(color.blue)];
    }
    if (color.typename === "GrayColor") {
        var v = Math.round(255 * (1 - color.gray / 100));
        return [v, v, v];
    }
    if (color.typename === "CMYKColor") {
        var k = color.black / 100;
        var r = 255 * (1 - color.cyan / 100) * (1 - k);
        var g = 255 * (1 - color.magenta / 100) * (1 - k);
        var b = 255 * (1 - color.yellow / 100) * (1 - k);
        return [Math.round(r), Math.round(g), Math.round(b)];
    }
    if (color.typename === "SpotColor") {
        try { return asRgb(color.spot.color); } catch (eSpot) { return null; }
    }
    return null;
}

function rgbColor(rgb) {
    var color = new RGBColor();
    color.red = rgb[0];
    color.green = rgb[1];
    color.blue = rgb[2];
    return color;
}

function rgbKey(rgb) {
    return Math.round(rgb[0]) + "," + Math.round(rgb[1]) + "," + Math.round(rgb[2]);
}

function settingsMap(list) {
    var map = {};
    var i;
    if (!list) return map;
    for (i = 0; i < list.length; i++) map[rgbKey(list[i].rgb)] = list[i];
    return map;
}

function readJson(path) {
    var file = new File(path);
    file.encoding = "UTF-8";
    if (!file.exists || !file.open("r")) return null;
    var text = file.read();
    file.close();
    if (!text) return null;
    return parseJson(text);
}

function writeText(path, text) {
    var file = new File(path);
    file.encoding = "UTF-8";
    if (!file.open("w")) return false;
    file.write(text);
    file.close();
    return true;
}

function round3(n) {
    return Math.round(n * 1000) / 1000;
}

function whole(value, fallback) {
    var n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
}

function clean(message) {
    return String(message || "Fehler").replace(/"/g, "'");
}

function parseJson(text) {
    var i = 0;
    function peek() {
        while (i < text.length) {
            var c = text.charAt(i);
            if (c !== " " && c !== "\t" && c !== "\r" && c !== "\n") return c;
            i++;
        }
        return "";
    }
    function parseValue() {
        var c = peek();
        if (c === "{") return parseObject();
        if (c === "[") return parseArray();
        if (c === "\"") return parseString();
        if (c === "t") { i += 4; return true; }
        if (c === "f") { i += 5; return false; }
        if (c === "n") { i += 4; return null; }
        return parseNumber();
    }
    function parseObject() {
        var obj = {};
        i++;
        if (peek() === "}") { i++; return obj; }
        while (true) {
            var key = parseString();
            if (peek() !== ":") throw new Error("JSON");
            i++;
            obj[key] = parseValue();
            var next = peek();
            if (next === "}") { i++; return obj; }
            if (next !== ",") throw new Error("JSON");
            i++;
        }
    }
    function parseArray() {
        var arr = [];
        i++;
        if (peek() === "]") { i++; return arr; }
        while (true) {
            arr.push(parseValue());
            var next = peek();
            if (next === "]") { i++; return arr; }
            if (next !== ",") throw new Error("JSON");
            i++;
        }
    }
    function parseString() {
        if (peek() !== "\"") throw new Error("JSON");
        i++;
        var out = "";
        while (i < text.length) {
            var c = text.charAt(i);
            if (c === "\"") { i++; return out; }
            if (c === "\\") {
                i++;
                out += text.charAt(i);
                i++;
                continue;
            }
            out += c;
            i++;
        }
        throw new Error("JSON string");
    }
    function parseNumber() {
        var start = i;
        if (text.charAt(i) === "-") i++;
        while (i < text.length) {
            var c = text.charAt(i);
            if ((c >= "0" && c <= "9") || c === "." || c === "e" || c === "E" || c === "+") {
                i++;
                continue;
            }
            break;
        }
        return Number(text.substring(start, i));
    }
    return parseValue();
}

function toJson(value) {
    var kind = typeof value;
    if (value === null || value === undefined) return "null";
    if (kind === "number") return String(value);
    if (kind === "boolean") return value ? "true" : "false";
    if (kind === "string") return quote(value);
    if (value instanceof Array) {
        var items = [];
        var index;
        for (index = 0; index < value.length; index++) items.push(toJson(value[index]));
        return "[" + items.join(",") + "]";
    }
    var fields = [];
    var key;
    for (key in value) {
        if (value.hasOwnProperty(key)) fields.push(quote(key) + ":" + toJson(value[key]));
    }
    return "{" + fields.join(",") + "}";
}

function quote(text) {
    return "\"" + String(text).replace(/\\/g, "\\\\").replace(/\"/g, "\\\"") + "\"";
}
/*__WORKER_END__*/

function workerSource() {
    var file = new File(__plotterScriptFile);
    file.encoding = "UTF-8";
    if (!file.exists || !file.open("r")) throw new Error("Skript nicht lesbar");
    var text = file.read();
    file.close();
    var startMark = "/*__WORKER_" + "START__*/";
    var endMark = "/*__WORKER_" + "END__*/";
    var start = text.indexOf(startMark);
    var end = start < 0 ? -1 : text.indexOf(endMark, start + startMark.length);
    if (start < 0 || end < 0) throw new Error("Skript nicht lesbar");
    return text.substring(start + startMark.length, end);
}

function jsString(text) {
    return "\"" + String(text).replace(/\\/g, "/").replace(/\"/g, "\\\"") + "\"";
}

function unquote(value) {
    var msg = String(value === undefined || value === null ? "" : value);
    if (msg.charAt(0) === "\"" && msg.charAt(msg.length - 1) === "\"") {
        msg = msg.substring(1, msg.length - 1);
    }
    return msg;
}

function runIllustrator(call, done) {
    var bt = new BridgeTalk();
    bt.target = "illustrator";
    try {
        bt.body = "(function () {\n" + workerSource() + "\n" + call + "\n})()";
    } catch (eBody) {
        done("ERR " + eBody.message);
        return;
    }
    bt.onResult = function (res) { done(unquote(res.body)); };
    bt.onError = function (err) { done("ERR " + unquote(err.body)); };
    bt.send();
}

(function () {
    if ($.global.__plotterWin) {
        try { $.global.__plotterWin.onClose = null; } catch (e0) {}
        try { $.global.__plotterWin.close(); } catch (e1) {}
        $.global.__plotterWin = null;
    }

    var busy = false;

    var w = new Window("palette", "Plotter");
    w.orientation = "column";
    w.alignChildren = ["fill", "top"];
    w.margins = 14;
    w.spacing = 8;
    w.preferredSize.width = 420;

    var help = w.add("statictext", undefined, "Der Ebenenname gilt, z.B. Left F10 S20 T20 x1. Stift oder Falz im Namen wechselt die Art. Ohne diese Angaben wird die Ebene nicht geplottet.", {multiline: true});
    help.preferredSize = [390, 48];

    var hostRow = w.add("group");
    hostRow.add("statictext", undefined, "IP");
    var hostBox = hostRow.add("edittext", undefined, "192.168.0.200");
    hostBox.characters = 16;
    hostRow.add("statictext", undefined, "Port");
    var portBox = hostRow.add("edittext", undefined, "8080");
    portBox.characters = 6;

    var forceRow = w.add("group");
    forceRow.add("statictext", undefined, "Force");
    forceRow.add("statictext", undefined, "von");
    var forceMin = forceRow.add("edittext", undefined, "10");
    forceMin.characters = 4;
    forceRow.add("statictext", undefined, "bis");
    var forceMax = forceRow.add("edittext", undefined, "25");
    forceMax.characters = 4;
    forceRow.add("statictext", undefined, "Schritt");
    var forceStep = forceRow.add("edittext", undefined, "1");
    forceStep.characters = 4;

    var speedRow = w.add("group");
    speedRow.add("statictext", undefined, "Speed");
    speedRow.add("statictext", undefined, "von");
    var speedMin = speedRow.add("edittext", undefined, "10");
    speedMin.characters = 4;
    speedRow.add("statictext", undefined, "bis");
    var speedMax = speedRow.add("edittext", undefined, "50");
    speedMax.characters = 4;
    speedRow.add("statictext", undefined, "Schritt");
    var speedStep = speedRow.add("edittext", undefined, "10");
    speedStep.characters = 4;

    var passRow = w.add("group");
    passRow.add("statictext", undefined, "Durchgaenge");
    passRow.add("statictext", undefined, "von");
    var passMin = passRow.add("edittext", undefined, "1");
    passMin.characters = 4;
    passRow.add("statictext", undefined, "bis");
    var passMax = passRow.add("edittext", undefined, "3");
    passMax.characters = 4;
    passRow.add("statictext", undefined, "Schritt");
    var passStep = passRow.add("edittext", undefined, "1");
    passStep.characters = 4;

    var extraRow = w.add("group");
    extraRow.add("statictext", undefined, "Travel");
    var travelBox = extraRow.add("edittext", undefined, "20");
    travelBox.characters = 4;
    extraRow.add("statictext", undefined, "Stift-Force");
    var penBox = extraRow.add("edittext", undefined, "20");
    penBox.characters = 4;
    extraRow.add("statictext", undefined, "Klinge");
    var bladeBox = extraRow.add("edittext", undefined, "0.35");
    bladeBox.characters = 5;
    extraRow.add("statictext", undefined, "Drehen");
    var turnBox = extraRow.add("edittext", undefined, "1");
    turnBox.characters = 4;
    extraRow.add("statictext", undefined, "Overcut");
    var overBox = extraRow.add("edittext", undefined, "0");
    overBox.characters = 4;
    extraRow.add("statictext", undefined, "Steg");
    var stegBox = extraRow.add("edittext", undefined, "0.5");
    stegBox.characters = 4;

    var axisRow = w.add("group");
    axisRow.add("statictext", undefined, "Y-Achse");
    var axisList = axisRow.add("dropdownlist", undefined, ["Kraft", "Speed"]);
    axisList.selection = 0;

    var markedBox = w.add("checkbox", undefined, "Nur markierte Ebenen");
    markedBox.value = false;
    var alternateBox = w.add("checkbox", undefined, "Mehrfach abwechselnd");
    alternateBox.value = true;

    var buttons = w.add("group");
    var squaresBtn = buttons.add("button", undefined, "Quadrate");
    var plotBtn = buttons.add("button", undefined, "Plot");
    plotBtn.preferredSize.height = 32;

    var status = w.add("statictext", undefined, "Bereit.", {multiline: true});
    status.preferredSize = [390, 36];

    squaresBtn.onClick = function () { makeSquares(); };
    plotBtn.onClick = function () { plot(); };

    w.onClose = function () { $.global.__plotterWin = null; };
    $.global.__plotterWin = w;
    w.show();

    function cardArgs() {
        var force = intRange(forceMin, forceMax, forceStep, "Force");
        var speed = intRange(speedMin, speedMax, speedStep, "Speed");
        var passes = intRange(passMin, passMax, passStep, "Durchgaenge");
        if (!force || !speed || !passes) return "";
        var travel = fieldNumber(travelBox, 20);
        var pen = fieldNumber(penBox, 20);
        var yAxis = axisList.selection && axisList.selection.text === "Speed" ? "speed" : "force";
        return " --pen-force " + pen
            + " --force-min " + force.min + " --force-max " + force.max + " --force-step " + force.step
            + " --speed-min " + speed.min + " --speed-max " + speed.max + " --speed-step " + speed.step
            + " --pass-min " + passes.min + " --pass-max " + passes.max + " --pass-step " + passes.step
            + " --travel " + travel
            + " --overcut " + fieldNumber(overBox, 0)
            + " --steg " + fieldNumber(stegBox, 0.5)
            + " --y-axis " + yAxis;
    }

    function makeSquares() {
        if (busy) return;
        var args = cardArgs();
        if (!args) return;
        busy = true;
        status.text = "Zeichne Quadrate...";
        var jsonFile = new File(Folder.temp.fsName + "/krafttest.json");
        var logFile = new File(Folder.temp.fsName + "/krafttest_build.log");
        if (jsonFile.exists) jsonFile.remove();
        if (logFile.exists) logFile.remove();
        var bat = new File(Folder.temp.fsName + "/krafttest_build.bat");
        if (!bat.open("w")) {
            busy = false;
            status.text = "Startdatei fehlgeschlagen.";
            return;
        }
        bat.writeln("@echo off");
        bat.writeln("\"" + PYTHON + "\" \"" + PLOTTER_PY + "\" --force-card" + args + " --json-out \"" + jsonFile.fsName + "\" > \"" + logFile.fsName + "\" 2>&1");
        bat.writeln("echo EXIT_%ERRORLEVEL%>> \"" + logFile.fsName + "\"");
        bat.close();
        if (!bat.execute()) {
            busy = false;
            status.text = "Python konnte nicht starten.";
            return;
        }
        var log = waitForLog(logFile, 12000);
        if (!jsonFile.exists || log.indexOf("EXIT_0") < 0) {
            busy = false;
            status.text = log || "Muster fehlgeschlagen.";
            return;
        }
        runIllustrator("return drawCard(" + jsString(jsonFile.fsName) + ");", function (msg) {
            busy = false;
            if (msg !== "ok") {
                status.text = msg;
                return;
            }
            status.text = "Quadrate gezeichnet. Die Ebenennamen sind die Plot-Einstellungen.";
        });
    }

    function plot() {
        if (busy) return;
        busy = true;
        status.text = "Sende...";
        var jobPath = Folder.temp.fsName + "/plotter_job.json";
        var blade = fieldNumber(bladeBox, 0.35);
        var turn = fieldNumber(turnBox, 1);
        var marked = markedBox.value ? "true" : "false";
        runIllustrator(
            "return collectJob(" + jsString(jobPath) + "," + blade + "," + turn + "," + marked + "," + jsString(COLOR_SETTINGS) + ");",
            function (msg) {
                if (msg === "nodoc") {
                    busy = false;
                    status.text = "Kein Dokument offen.";
                    return;
                }
                if (msg.indexOf("ok ") !== 0) {
                    busy = false;
                    status.text = msg;
                    return;
                }
                var parts = msg.split(" ");
                var count = parseInt(parts[1], 10);
                var skipped = parseInt(parts[2], 10);
                if (!count) {
                    busy = false;
                    status.text = markedBox.value
                        ? "Nichts zu senden. Keine markierte Ebene mit F, S, T oder x im Namen."
                        : "Nichts zu senden. " + skipped + " Pfade ohne Einstellung im Ebenennamen.";
                    return;
                }
                var logFile = new File(Folder.temp.fsName + "/plotter_send.log");
                if (logFile.exists) logFile.remove();
                var bat = new File(Folder.temp.fsName + "/plotter_send.bat");
                if (!bat.open("w")) {
                    busy = false;
                    status.text = "Startdatei fehlgeschlagen.";
                    return;
                }
                bat.writeln("@echo off");
                var alternateFlag = alternateBox.value ? " --alternate" : "";
                bat.writeln("\"" + PYTHON + "\" \"" + PLOTTER_PY + "\" \"" + jobPath + "\" --host " + trim(hostBox.text) + " --port " + trim(portBox.text) + alternateFlag + " > \"" + logFile.fsName + "\" 2>&1");
                bat.writeln("echo EXIT_%ERRORLEVEL%>> \"" + logFile.fsName + "\"");
                bat.close();
                if (!bat.execute()) {
                    busy = false;
                    status.text = "Python konnte nicht starten.";
                    return;
                }
                var log = waitForLog(logFile, 20000);
                busy = false;
                if (log.indexOf("EXIT_0") < 0) status.text = log || "Senden fehlgeschlagen.";
                else status.text = "Gesendet: " + count + " Pfade, " + skipped + " ausgelassen. " + trim(hostBox.text);
            }
        );
    }

    function intRange(minBox, maxBox, stepBox, label) {
        var min = parseInt(trim(minBox.text), 10);
        var max = parseInt(trim(maxBox.text), 10);
        var step = parseInt(trim(stepBox.text), 10);
        if (isNaN(min) || isNaN(max) || isNaN(step) || step === 0) {
            status.text = label + ": von, bis und Schritt angeben. Schritt darf nicht 0 sein.";
            return null;
        }
        return { min: min, max: max, step: step };
    }

    function fieldNumber(box, fallback) {
        var n = parseFloat(trim(box.text));
        return isNaN(n) ? fallback : n;
    }
})();

function waitForLog(logFile, limitMs) {
    var started = new Date().getTime();
    var body = "";
    while (new Date().getTime() - started < limitMs) {
        $.sleep(250);
        if (!logFile.exists) continue;
        if (!logFile.open("r")) continue;
        body = logFile.read();
        logFile.close();
        if (body.indexOf("EXIT_") >= 0) return body;
    }
    return body;
}

function trim(text) {
    return String(text).replace(/^\s+|\s+$/g, "");
}
