#include "pathcorners.jsx"
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
    if (named.forces) entry.forces = named.forces;
    if (typeof named.offset === "number") entry.offset = named.offset;
    if (typeof named.depth === "number") entry.depth = named.depth;
    if (named.stay === true || named.stay === false) entry.stay = named.stay;
    if (typeof named.boost === "number") entry.boost = named.boost;
    if (typeof named.detail === "number") entry.detail = named.detail;
    if (typeof named.ramp === "number") entry.ramp = named.ramp;
    if (typeof named.forceDetail === "number") entry.forceDetail = named.forceDetail;
    if (typeof named.forceStraight === "number") entry.forceStraight = named.forceStraight;
    if (typeof named.speedDetail === "number") entry.speedDetail = named.speedDetail;
    if (typeof named.speedStraight === "number") entry.speedStraight = named.speedStraight;
}

function collectJob(jobPath, blade, turn, selectedOnly, colorsPath, allowDefault) {
    try {
        if (!app.documents.length) return "nodoc";
        var onlyMarked = selectedOnly === true || selectedOnly === 1 || selectedOnly === "true";
        var useDefault = allowDefault === true || allowDefault === 1 || allowDefault === "true";
        var library = settingsMap(readJson(colorsPath));
        var doc = app.activeDocument;
        var board = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var found = harvest(doc);
        var paths = [];
        var skipped = found.skipped;
        var i, item, named, anyPicked, useItem, mode, holder, entry, loopForce;
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
            entry = library[rgbKey(item.rgb)];
            if (!isComplete(named)) {
                var fromLib = libraryNamed(entry);
                if (fromLib) {
                    copyIfMissing(named, fromLib);
                    logLine("material color " + rgbKey(item.rgb) + " F" + named.force + " S" + named.speed + " x" + named.passes);
                }
            }
            if (!isComplete(named) && useDefault) {
                if (named.force === null) named.force = 20;
                if (named.speed === null) named.speed = 20;
                if (named.travel === null) named.travel = 20;
                if (named.passes === null) named.passes = 1;
                if (!named.holder) named.holder = "left";
                if (!named.mode) named.mode = "cut";
                logLine("material default F" + named.force);
            }
            if (!isComplete(named)) {
                skipped++;
                if (skipped <= 8) logLine("skip incomplete layer '" + (item.layers && item.layers.length ? item.layers.join(" / ") : "") + "'");
                continue;
            }
            mode = named.mode === "pen" || named.mode === "fold" ? named.mode : "cut";
            holder = named.holder === "right" ? "right" : "left";
            if (paths.length < 12) {
                logLine("plot " + holder + " " + mode + " F" + named.force + " S" + named.speed + " T" + named.travel + " x" + named.passes + (typeof named.offset === "number" ? " O" + named.offset : "") + (typeof named.depth === "number" ? " D" + named.depth : "") + (named.stay ? " Z1" : "") + " seg " + segmentKind(item.note) + " '" + (item.layers && item.layers.length ? item.layers[0] : "") + "'");
            }
            paths.push(jobPathFrom(item, holder, mode, named, paths.length, null));
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

function blankNamed() {
    return {
        force: null,
        forces: null,
        speed: null,
        travel: null,
        passes: null,
        holder: "",
        mode: "",
        offset: null,
        depth: null,
        stay: null,
        boost: null,
        detail: null,
        ramp: null,
        forceDetail: null,
        forceStraight: null,
        speedDetail: null,
        speedStraight: null
    };
}

function numOrNull(value) {
    if (value === undefined || value === null || value === "") return null;
    var n = parseFloat(value);
    return isNaN(n) ? null : n;
}

function copyIfMissing(named, extra) {
    if (!extra) return;
    if (named.force === null && extra.force !== null) named.force = extra.force;
    if (!named.forces && extra.forces) named.forces = extra.forces;
    if (named.speed === null && extra.speed !== null) named.speed = extra.speed;
    if (named.travel === null && extra.travel !== null) named.travel = extra.travel;
    if (named.passes === null && extra.passes !== null) named.passes = extra.passes;
    if (!named.holder && extra.holder) named.holder = extra.holder;
    if (!named.mode && extra.mode) named.mode = extra.mode;
    if (named.offset === null && extra.offset !== null) named.offset = extra.offset;
    if (named.depth === null && extra.depth !== null) named.depth = extra.depth;
    if (named.stay === null && (extra.stay === true || extra.stay === false)) named.stay = extra.stay;
    if (named.boost === null && typeof extra.boost === "number") named.boost = extra.boost;
    if (named.detail === null && typeof extra.detail === "number") named.detail = extra.detail;
    if (named.ramp === null && typeof extra.ramp === "number") named.ramp = extra.ramp;
    if (named.forceDetail === null && typeof extra.forceDetail === "number") named.forceDetail = extra.forceDetail;
    if (named.forceStraight === null && typeof extra.forceStraight === "number") named.forceStraight = extra.forceStraight;
    if (named.speedDetail === null && typeof extra.speedDetail === "number") named.speedDetail = extra.speedDetail;
    if (named.speedStraight === null && typeof extra.speedStraight === "number") named.speedStraight = extra.speedStraight;
}

function libraryNamed(entry) {
    if (!entry) return null;
    var named = blankNamed();
    var force = entry.force;
    if ((force === undefined || force === null || force === "") && entry.forces && entry.forces.length) force = entry.forces[0];
    named.force = numOrNull(force);
    named.forces = entry.forces && entry.forces.length ? entry.forces : null;
    named.speed = numOrNull(entry.speed);
    named.travel = numOrNull(entry.travel);
    named.passes = numOrNull(entry.passes);
    named.holder = entry.holder === "right" || entry.holder === "left" ? entry.holder : "";
    named.mode = entry.mode === "pen" || entry.mode === "fold" || entry.mode === "cut" ? entry.mode : "";
    named.offset = numOrNull(entry.offset);
    named.depth = numOrNull(entry.depth);
    if (entry.stay === false || entry.stay === 0 || entry.stay === "0") named.stay = false;
    else if (entry.stay === true || entry.stay === 1 || entry.stay === "1") named.stay = true;
    named.boost = numOrNull(entry.boost);
    named.detail = numOrNull(entry.detail);
    named.ramp = numOrNull(entry.ramp);
    named.forceDetail = numOrNull(entry.forceDetail);
    named.forceStraight = numOrNull(entry.forceStraight);
    named.speedDetail = numOrNull(entry.speedDetail);
    named.speedStraight = numOrNull(entry.speedStraight);
    if (named.forceDetail === null) named.forceDetail = named.force;
    if (named.forceStraight === null) named.forceStraight = named.force;
    if (named.speedDetail === null) named.speedDetail = named.speed;
    if (named.speedStraight === null) named.speedStraight = named.speed;
    return named;
}

function applyLoopForce(shape, loopForce) {
    var i;
    if (!shape || !shape.forces || loopForce === null) return;
    for (i = 0; i < shape.forces.length; i++) {
        if (shape.forces[i] !== null) shape.forces[i] = loopForce;
    }
}

function whole(value, fallback) {
    var n = parseFloat(value);
    if (isNaN(n)) return fallback;
    return n;
}

function jobPathFrom(item, holder, mode, named, order, loopForce) {
    var passes = named.passes;
    if (passes < 1) passes = 1;
    var layerName = "";
    if (item.layers && item.layers.length) layerName = String(item.layers[0]);
    var shape = item.shape || { points: item.points, forces: null };
    var path = {
        holder: holder || "left",
        mode: mode || "cut",
        force: named.force,
        cut_speed: named.speed,
        travel_speed: named.travel,
        closed: item.closed,
        passes: passes,
        layer: layerName,
        order: order,
        points_mm: shape.points,
        rgb: item.rgb,
        segment: segmentKind(item.note) || "straight"
    };
    var link = linkIndex(item.note);
    if (link) {
        path.link_group = link.group;
        path.link = link.index;
    }
    if (named.forces && named.forces.length > 1) path.forces = named.forces;
    if (typeof named.offset === "number" && !isNaN(named.offset)) path.blade_offset_mm = named.offset;
    if (named.stay === true || named.stay === false) path.stay_down = named.stay === true;
    if (typeof named.depth === "number") path.cut_depth = named.depth;
    if (shape.forces) path.point_forces = shape.forces;
    return path;
}

function linkIndex(note) {
    var found = String(note || "").match(/link=(\d+):(\d+)/i);
    if (!found) return null;
    return { group: parseInt(found[1], 10), index: parseInt(found[2], 10) };
}

function preferNumber(primary, fallback) {
    if (typeof primary === "number" && !isNaN(primary)) return primary;
    return fallback;
}

function segmentKind(note) {
    var found = String(note || "").match(/seg=(detail|straight)/i);
    return found ? String(found[1]).toLowerCase() : "";
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
    if (layer.name === "Detailgrad Vorschau") return;
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
    var shape = pathShape(item);
    if (!shape || !shape.points || shape.points.length < 2) {
        acc.skipped++;
        return;
    }
    var note = "";
    try { note = String(item.note || ""); } catch (eNote) {}
    acc.paths.push({
        rgb: rgb,
        points: shape.points,
        shape: shape,
        closed: item.closed === true,
        holder: holder || "",
        layers: layerNames(item),
        marked: layerMarked(item.layer),
        picked: pathSelected(item),
        note: note
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
    var forces = forcesFromName(name);
    var stay = tokenNumber(name, "Z");
    if (text.indexOf("stift") >= 0 || text.indexOf("pen") >= 0) mode = "pen";
    else if (text.indexOf("falz") >= 0 || text.indexOf("fold") >= 0) mode = "fold";
    return {
        force: forces ? forces[0] : null,
        forces: forces,
        speed: firstNumber(name, /S\s*(\d+)/i),
        travel: firstNumber(name, /T\s*(\d+)/i),
        passes: firstNumber(name, /x\s*(\d+)/i),
        holder: holderFromName(name),
        mode: mode,
        offset: offsetFromName(name),
        depth: tokenNumber(name, "D"),
        stay: stay === null ? null : stay >= 1,
        boost: tokenNumber(name, "B"),
        detail: tokenNumber(name, "G"),
        ramp: tokenNumber(name, "R"),
        forceDetail: tokenNumber(name, "Fd"),
        forceStraight: tokenNumber(name, "Fg"),
        speedDetail: tokenNumber(name, "Sd"),
        speedStraight: tokenNumber(name, "Sg")
    };
}

function forcesFromName(name) {
    var found = String(name).match(/(^|[^A-Za-z])F\s*(\d+(?:\s*\/\s*\d+)*)/i);
    if (!found) return null;
    var parts = found[2].split("/");
    var out = [];
    var i, n;
    for (i = 0; i < parts.length; i++) {
        n = parseInt(parts[i], 10);
        if (!isNaN(n)) out.push(n);
    }
    return out.length ? out : null;
}

function tokenNumber(name, letters) {
    var found = String(name).match(new RegExp("(^|[^A-Za-z])" + letters + "\\s*(\\d+(?:[.,]\\d+)?)", "i"));
    if (!found) return null;
    var n = parseFloat(String(found[2]).replace(",", "."));
    return isNaN(n) ? null : n;
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
    var named = blankNamed();
    var i, parsed;
    if (!names) return named;
    for (i = 0; i < names.length; i++) {
        parsed = parseLayerName(names[i]);
        if (isComplete(parsed)) return parsed;
        copyIfMissing(named, parsed);
    }
    return named;
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

function pathShape(item) {
    var pts = item.pathPoints;
    if (!pts || pts.length < 2) return null;
    var doc = app.activeDocument;
    var ab = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
    var originX = ab[0];
    var originY = ab[3];
    var loops = loopIndexSet(item.note);
    var loopForce = tokenNumber(String(item.note || ""), "LF");
    var poly = [];
    var flags = [];
    var count = pts.length;
    var segments = item.closed ? count : count - 1;
    var s, a, b, p0, p1, p2, p3, before, k, isLoop;
    pushPoint(poly, toMm(pts[0].anchor, originX, originY));
    flags.push(false);
    for (s = 0; s < segments; s++) {
        a = pts[s];
        b = pts[(s + 1) % count];
        isLoop = loops[s] === true;
        if (isLoop) flags[flags.length - 1] = true;
        p0 = toMm(a.anchor, originX, originY);
        p1 = toMm(a.rightDirection, originX, originY);
        p2 = toMm(b.leftDirection, originX, originY);
        p3 = toMm(b.anchor, originX, originY);
        before = poly.length;
        if (near(p0, p1) && near(p2, p3)) pushPoint(poly, p3);
        else flattenCubic(p0, p1, p2, p3, poly, 0);
        for (k = before; k < poly.length; k++) flags.push(isLoop);
    }
    if (item.closed && poly.length > 2 && near(poly[0], poly[poly.length - 1])) {
        poly.pop();
        flags.pop();
    }
    var forces = null;
    if (loopForce !== null) {
        forces = [];
        for (k = 0; k < poly.length; k++) forces.push(flags[k] ? loopForce : null);
    }
    return { points: poly, forces: forces };
}

function loopIndexSet(note) {
    var found = String(note || "").match(/loops=([0-9,]+)/);
    var set = {};
    var parts, i;
    if (!found) return set;
    parts = found[1].split(",");
    for (i = 0; i < parts.length; i++) set[parseInt(parts[i], 10)] = true;
    return set;
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

function splitForm(detailDeg) {
    try {
        if (!app.documents.length) return "nodoc";
        var limit = splitLimit(detailDeg);
        clearSplitPreview();
        var paths = selectedPaths();
        if (!paths.length) return "nosel";
        var created = [];
        var detailCount = 0;
        var straightCount = 0;
        var i, made;
        for (i = 0; i < paths.length; i++) {
            if (!paths[i].pathPoints || paths[i].pathPoints.length < 2) continue;
            made = emitSegments(paths[i], paths[i].layer, limit, i, false);
            created = created.concat(made.created);
            detailCount += made.detail;
            straightCount += made.straight;
            try { paths[i].remove(); } catch (eRem) {}
        }
        if (created.length) {
            try { app.activeDocument.selection = created; } catch (eSel) {}
        }
        logLine("split deg " + limit + " made " + created.length + " detail " + detailCount + " straight " + straightCount);
        return "ok " + created.length + " detail " + detailCount + " straight " + straightCount;
    } catch (err) {
        logLine("split ERR " + clean(err.message));
        return "ERR " + clean(err.message);
    }
}

function previewSplit(detailDeg) {
    try {
        if (!app.documents.length) return "nodoc";
        var limit = splitLimit(detailDeg);
        var paths = selectedPaths();
        var real = [];
        var i, layer, made, count, detailCount, straightCount;
        for (i = 0; i < paths.length; i++) {
            if (paths[i].layer && paths[i].layer.name === "Detailgrad Vorschau") continue;
            real.push(paths[i]);
        }
        clearSplitPreview();
        if (!real.length) return "nosel";
        layer = app.activeDocument.layers.add();
        layer.name = "Detailgrad Vorschau";
        count = 0;
        detailCount = 0;
        straightCount = 0;
        for (i = 0; i < real.length; i++) {
            if (!real[i].pathPoints || real[i].pathPoints.length < 2) continue;
            made = emitSegments(real[i], layer, limit, i, true);
            count += made.created.length;
            detailCount += made.detail;
            straightCount += made.straight;
        }
        try { app.activeDocument.selection = real; } catch (eSel) {}
        app.redraw();
        return "ok " + count + " detail " + detailCount + " straight " + straightCount;
    } catch (err) {
        logLine("preview split ERR " + clean(err.message));
        return "ERR " + clean(err.message);
    }
}

function clearSplitPreview() {
    try {
        if (!app.documents.length) return "nodoc";
        var layer = findLayerNamed(app.activeDocument, "Detailgrad Vorschau");
        if (layer) layer.remove();
        return "ok";
    } catch (err) {
        return "ERR " + clean(err.message);
    }
}

function splitLimit(detailDeg) {
    var limit = parseFloat(detailDeg);
    if (isNaN(limit) || limit < 0) limit = 20;
    return limit;
}

function emitSegments(source, container, limit, linkId, preview) {
    var verts = readVerts(source);
    var closed = source.closed === true;
    var runs = segmentRuns(verts, closed, limit);
    var created = [];
    var detailCount = 0;
    var straightCount = 0;
    var r, neu, piece, kind;
    for (r = 0; r < runs.length; r++) {
        kind = runs[r].kind;
        neu = container.pathItems.add();
        if (runs[r].whole && closed) {
            writeJoined(neu, verts);
            neu.closed = true;
        } else {
            piece = runVerts(verts, runs[r], closed);
            writeCurve(neu, piece);
            neu.closed = false;
        }
        neu.note = "seg=" + kind + ";link=" + linkId + ":" + r;
        copyAppearance(source, neu);
        paintSegment(neu, kind);
        if (preview) {
            neu.note = "preview=1;" + neu.note;
            neu.strokeWidth = neu.strokeWidth + 0.4;
        }
        created.push(neu);
        if (kind === "detail") detailCount++;
        else straightCount++;
    }
    return { created: created, detail: detailCount, straight: straightCount };
}

function segmentRuns(verts, closed, limit) {
    var n = verts.length;
    var count = closed ? n : n - 1;
    var kinds = [];
    var i, runs, run, last;
    if (count < 1) return [];
    for (i = 0; i < count; i++) kinds.push(segmentBend(verts[i], verts[(i + 1) % n]) >= limit ? "detail" : "straight");
    runs = [];
    run = { kind: kinds[0], from: 0, to: 0, wrap: false, whole: false };
    for (i = 1; i < count; i++) {
        if (kinds[i] === run.kind) run.to = i;
        else {
            runs.push(run);
            run = { kind: kinds[i], from: i, to: i, wrap: false, whole: false };
        }
    }
    runs.push(run);
    if (closed && runs.length > 1 && runs[0].kind === runs[runs.length - 1].kind) {
        last = runs.pop();
        runs[0].from = last.from;
        runs[0].wrap = true;
    }
    if (runs.length === 1 && closed) runs[0].whole = true;
    return runs;
}

function runVerts(verts, run, closed) {
    var n = verts.length;
    var idx = [];
    var i, out, src, copy;
    if (run.wrap) {
        for (i = run.from; i < n; i++) idx.push(i);
        for (i = 0; i <= run.to + 1; i++) idx.push(i % n);
    } else {
        for (i = run.from; i <= run.to + 1; i++) idx.push(closed ? i % n : i);
    }
    out = [];
    for (i = 0; i < idx.length; i++) {
        src = verts[idx[i]];
        copy = {
            anchor: [src.anchor[0], src.anchor[1]],
            left: [src.left[0], src.left[1]],
            right: [src.right[0], src.right[1]],
            corner: src.corner
        };
        out.push(copy);
    }
    return out;
}

function segmentBend(a, b) {
    var steps = 8;
    var pts = [];
    var i, t, total;
    for (i = 0; i <= steps; i++) {
        t = i / steps;
        pts.push(cubicAt(a.anchor, a.right, b.left, b.anchor, t));
    }
    total = 0;
    for (i = 1; i < pts.length - 1; i++) total += headingTurn(pts[i - 1], pts[i], pts[i + 1]);
    return total;
}

function cubicAt(a, b, c, d, t) {
    var u = 1 - t;
    return [
        u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
        u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]
    ];
}

function headingTurn(p0, p1, p2) {
    var ax = p1[0] - p0[0];
    var ay = p1[1] - p0[1];
    var bx = p2[0] - p1[0];
    var by = p2[1] - p1[1];
    var la = Math.sqrt(ax * ax + ay * ay);
    var lb = Math.sqrt(bx * bx + by * by);
    var cos;
    if (la < 0.05 || lb < 0.05) return 0;
    cos = (ax * bx + ay * by) / (la * lb);
    if (cos > 1) cos = 1;
    if (cos < -1) cos = -1;
    return Math.acos(cos) * 180 / Math.PI;
}

function paintSegment(path, kind) {
    var color = new RGBColor();
    if (kind === "detail") {
        color.red = 255;
        color.green = 106;
        color.blue = 213;
    } else {
        color.red = 0;
        color.green = 90;
        color.blue = 40;
    }
    path.filled = false;
    path.stroked = true;
    path.strokeColor = color;
}

function addCutOver(mm, loopMm, loopForce) {
    return editSelection(Number(mm), false, Number(loopMm), Number(loopForce));
}

function splitInward() {
    return editSelection(0, true);
}

function addOverlap(mm) {
    return editOverlap(Number(mm));
}

function loadCorners() {
    if (typeof planCut === "function") return;
    var candidates = [];
    var name = "";
    try { name = String($.fileName); } catch (eName) { name = ""; }
    if (name) candidates.push(name.replace(/[^\/\\]+$/, "") + "pathcorners.jsx");
    try {
        candidates.push(Folder.userData.fsName + "/Adobe/CEP/extensions/com.leon.plotter/jsx/pathcorners.jsx");
    } catch (eFolder) {}
    var i, file;
    for (i = 0; i < candidates.length; i++) {
        file = new File(candidates[i]);
        if (!file.exists) continue;
        $.evalFile(file);
        if (typeof planCut === "function") {
            $.global.planCut = planCut;
            if (typeof planOverlap === "function") $.global.planOverlap = planOverlap;
            return;
        }
    }
}

function cornerPlan() {
    if (typeof planCut === "function") return planCut;
    if (typeof $.global.planCut === "function") return $.global.planCut;
    return null;
}

function overlapPlan() {
    if (typeof planOverlap === "function") return planOverlap;
    if (typeof $.global.planOverlap === "function") return $.global.planOverlap;
    return null;
}

function editOverlap(mm) {
    try {
        if (!app.documents.length) return "nodoc";
        if (!(mm > 0)) return "none";
        loadCorners();
        var overlap = overlapPlan();
        if (typeof overlap !== "function") return "ERR pathcorners";
        var paths = selectedPaths();
        if (paths.length < 2) return "nosel";
        var specs = [];
        var i;
        for (i = 0; i < paths.length; i++) {
            try {
                if (!paths[i].pathPoints || paths[i].pathPoints.length < 2) {
                    specs.push({ closed: false, verts: [] });
                    continue;
                }
            } catch (eGone) {
                specs.push({ closed: false, verts: [] });
                continue;
            }
            specs.push({ closed: paths[i].closed === true, verts: readVerts(paths[i]) });
        }
        var plan = overlap(specs, mm * MM);
        var made = 0;
        var created = [];
        var s, src, neu;
        for (s = 0; s < plan.strokes.length; s++) {
            src = paths[plan.strokes[s].source];
            neu = src.layer.pathItems.add();
            neu.closed = false;
            writeCurve(neu, plan.strokes[s].verts);
            copyAppearance(src, neu);
            created.push(neu);
            made++;
        }
        for (s = 0; s < plan.remove.length; s++) {
            try { paths[plan.remove[s]].remove(); } catch (eRem) {}
        }
        if (created.length) {
            try { app.activeDocument.selection = created; } catch (eSel) {}
        }
        logLine("overlap " + mm + " paths " + paths.length + " made " + made);
        app.redraw();
        return made ? "ok " + made : "none";
    } catch (eEdit) {
        logLine("overlap ERR " + clean(eEdit.message));
        return "ERR " + clean(eEdit.message);
    }
}

function editSelection(cutoverMm, inward, loopMm, loopForce) {
    try {
        if (!app.documents.length) return "nodoc";
        if (!(cutoverMm > 0) && !inward) return "none";
        loadCorners();
        var cut = cornerPlan();
        if (typeof cut !== "function") return "ERR pathcorners";
        var paths = selectedPaths();
        if (!paths.length) return "nosel";
        var loopPt = loopMm > 0 ? loopMm * MM : 0;
        var specs = [];
        var i;
        for (i = 0; i < paths.length; i++) {
            try {
                if (!paths[i].pathPoints || paths[i].pathPoints.length < 2) {
                    specs.push({ closed: false, verts: [] });
                    continue;
                }
            } catch (eGone) {
                specs.push({ closed: false, verts: [] });
                continue;
            }
            specs.push({ closed: paths[i].closed === true, verts: readVerts(paths[i]) });
        }
        var plan = cut(specs, cutoverMm > 0 ? cutoverMm * MM : 0, inward, loopPt);
        var made = 0;
        var created = [];
        var s, src, neu;
        for (s = 0; s < plan.strokes.length; s++) {
            src = paths[plan.strokes[s].source];
            neu = src.layer.pathItems.add();
            var joined = plan.strokes[s].verts.closedPath === true;
            if (joined || loopPt > 0) writeJoined(neu, plan.strokes[s].verts);
            else writeRun(neu, plan.strokes[s].verts);
            neu.closed = joined;
            var note = loopNote(plan.strokes[s].verts, loopForce, neu.closed);
            if (note) neu.note = note;
            copyAppearance(src, neu);
            created.push(neu);
            made++;
        }
        for (s = 0; s < plan.remove.length; s++) {
            try { paths[plan.remove[s]].remove(); } catch (eRem) {}
        }
        if (created.length) {
            try { app.activeDocument.selection = created; } catch (eSel) {}
        }
        logLine((inward ? "split-inward" : "cutover " + cutoverMm + (loopPt > 0 ? " loop " + loopMm + " F" + loopForce : "")) + " paths " + paths.length + " made " + made);
        app.redraw();
        return made ? "ok " + made : "none";
    } catch (eEdit) {
        logLine("edit ERR " + clean(eEdit.message));
        return "ERR " + clean(eEdit.message);
    }
}

function selectedPaths() {
    var found = [];
    var sel = app.activeDocument.selection;
    var i;
    if (!sel) return found;
    for (i = 0; i < sel.length; i++) collectPathItems(sel[i], found);
    return found;
}

function collectPathItems(item, found) {
    var i;
    if (!item) return;
    if (item.typename === "PathItem") {
        if (!item.guides && !item.clipping) found.push(item);
    } else if (item.typename === "CompoundPathItem") {
        for (i = 0; i < item.pathItems.length; i++) collectPathItems(item.pathItems[i], found);
    } else if (item.typename === "GroupItem") {
        for (i = 0; i < item.pageItems.length; i++) collectPathItems(item.pageItems[i], found);
    }
}

function readVerts(item) {
    var pts = item.pathPoints;
    var verts = [];
    var i, p;
    for (i = 0; i < pts.length; i++) {
        p = pts[i];
        verts.push({
            anchor: [p.anchor[0], p.anchor[1]],
            left: [p.leftDirection[0], p.leftDirection[1]],
            right: [p.rightDirection[0], p.rightDirection[1]],
            corner: p.pointType === PointType.CORNER,
            role: "flat"
        });
    }
    return verts;
}

function writeJoined(path, pts) {
    var i, p, vert;
    for (i = 0; i < pts.length; i++) {
        vert = pts[i];
        p = path.pathPoints.add();
        p.anchor = vert.anchor;
        p.leftDirection = vert.left;
        p.rightDirection = vert.right;
        p.pointType = vert.corner ? PointType.CORNER : PointType.SMOOTH;
    }
}

function loopNote(verts, force, closed) {
    var indexes = [];
    var i, n, j;
    n = verts.length;
    if (n < 2 || !(parseFloat(force) > 0)) return "";
    for (i = 0; i < n; i++) {
        j = i + 1;
        if (j === n) {
            if (!closed) break;
            j = 0;
        }
        if (verts[i].role === "loop" && verts[j].role === "loop") indexes.push(i);
    }
    if (!indexes.length) return "";
    var level = parseInt(force, 10);
    if (isNaN(level)) level = 0;
    return "LF" + level + ";loops=" + indexes.join(",");
}

function writeCurve(path, pts) {
    var i, p, vert, n;
    n = pts.length;
    for (i = 0; i < n; i++) {
        vert = pts[i];
        p = path.pathPoints.add();
        p.anchor = vert.anchor;
        if (i === 0) {
            p.leftDirection = vert.anchor;
            p.rightDirection = vert.right;
            p.pointType = PointType.CORNER;
        } else if (i === n - 1) {
            p.leftDirection = vert.left;
            p.rightDirection = vert.anchor;
            p.pointType = PointType.CORNER;
        } else {
            p.leftDirection = vert.left;
            p.rightDirection = vert.right;
            p.pointType = vert.corner ? PointType.CORNER : PointType.SMOOTH;
        }
    }
}

function writeRun(path, pts) {
    var i, p, vert, atEnd;
    for (i = 0; i < pts.length; i++) {
        vert = pts[i];
        atEnd = i === 0 || i === pts.length - 1 || vert.role === "ext";
        p = path.pathPoints.add();
        p.anchor = vert.anchor;
        if (atEnd) {
            p.leftDirection = vert.anchor;
            p.rightDirection = vert.anchor;
            p.pointType = PointType.CORNER;
        } else {
            p.leftDirection = vert.left;
            p.rightDirection = vert.right;
            p.pointType = vert.corner ? PointType.CORNER : PointType.SMOOTH;
        }
    }
}

function copyAppearance(from, to) {
    to.filled = false;
    to.stroked = true;
    to.strokeWidth = 0.6;
    try {
        if (from.stroked) {
            to.strokeColor = from.strokeColor;
            to.strokeWidth = from.strokeWidth;
        } else if (from.filled) {
            to.strokeColor = from.fillColor;
        }
    } catch (eAppear) {}
}
