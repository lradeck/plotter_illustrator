var MM = 72 / 25.4;

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
        removeEmptyLayers(doc);
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
        var i, key;
        for (i = 0; i < found.paths.length; i++) {
            key = rgbKey(found.paths[i].rgb);
            if (seen[key]) continue;
            seen[key] = true;
            list.push(found.paths[i].rgb);
        }
        if (!writeText(outPath, toJson(list))) return "ERR Farben konnten nicht gespeichert werden";
        return "ok " + list.length;
    } catch (eScan) {
        return "ERR " + clean(eScan.message);
    }
}

function collectJob(jobPath, blade, turn, selectedOnly) {
    try {
        if (!app.documents.length) return "nodoc";
        var onlyMarked = selectedOnly === true || selectedOnly === 1 || selectedOnly === "true";
        var doc = app.activeDocument;
        var board = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        var found = harvest(doc);
        var paths = [];
        var skipped = found.skipped;
        var i, item, passes, named, hasName;
        for (i = 0; i < found.paths.length; i++) {
            item = found.paths[i];
            if (onlyMarked && !item.marked) {
                skipped++;
                continue;
            }
            named = readLayerSettings(item.layers);
            hasName = named.force !== null || named.speed !== null || named.travel !== null || named.passes !== null || named.holder || named.mode;
            if (!hasName) {
                skipped++;
                continue;
            }
            passes = named.passes !== null ? named.passes : 1;
            if (passes < 1) passes = 1;
            paths.push({
                holder: named.holder || "left",
                mode: named.mode || "cut",
                force: named.force !== null ? named.force : 20,
                cut_speed: named.speed !== null ? named.speed : 20,
                travel_speed: named.travel !== null ? named.travel : 20,
                closed: item.closed,
                passes: passes,
                points_mm: item.points
            });
        }
        var pageW = (board[2] - board[0]) / MM;
        var pageH = (board[1] - board[3]) / MM;
        var job = {
            page_mm: [round3(pageW), round3(pageH)],
            origin_mm: [0, 0],
            accurate: true,
            blade_offset_mm: blade,
            overcut_mm: 0,
            turn_knife_mm: turn,
            paths: paths
        };
        if (!writeText(jobPath, toJson(job))) return "ERR Auftrag konnte nicht geschrieben werden";
        return "ok " + paths.length + " " + skipped;
    } catch (eJob) {
        return "ERR " + clean(eJob.message);
    }
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
    if (path.mode === "pen") {
        item.filled = false;
        item.stroked = true;
        item.strokeWidth = 0.35;
        item.strokeColor = color;
    } else {
        item.stroked = false;
        item.filled = true;
        item.fillColor = color;
    }
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
        marked: layerMarked(item.layer)
    });
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
        mode: mode
    };
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
    var i, parsed;
    if (!names) {
        return { force: force, speed: speed, travel: travel, passes: passes, holder: holder, mode: mode };
    }
    for (i = 0; i < names.length; i++) {
        parsed = parseLayerName(names[i]);
        if (force === null && parsed.force !== null) force = parsed.force;
        if (speed === null && parsed.speed !== null) speed = parsed.speed;
        if (travel === null && parsed.travel !== null) travel = parsed.travel;
        if (passes === null && parsed.passes !== null) passes = parsed.passes;
        if (!holder && parsed.holder) holder = parsed.holder;
        if (!mode && parsed.mode) mode = parsed.mode;
    }
    return { force: force, speed: speed, travel: travel, passes: passes, holder: holder, mode: mode };
}

function layerForPath(doc, path) {
    var name = path.layer;
    if (!name) {
        if (path.mode === "pen") name = "Right Stift F" + path.force + " S" + path.cut_speed + " T" + path.travel_speed + " x" + path.passes;
        else name = (path.holder === "right" ? "Right " : "Left ") + "F" + path.force + " S" + path.cut_speed + " T" + path.travel_speed + " x" + path.passes;
    }
    var parent = doc;
    if (path.mode !== "pen") parent = ensureLayer(doc, "Bereich " + path.passes);
    return ensureLayer(parent, name);
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

function removeEmptyLayers(doc) {
    var i, layer;
    for (i = doc.layers.length - 1; i >= 0; i--) {
        if (doc.layers.length === 1) return;
        layer = doc.layers[i];
        if (layer.pageItems.length === 0 && layer.layers.length === 0) layer.remove();
    }
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
        if (item.filled) {
            var fill = asRgb(item.fillColor);
            if (fill) return fill;
        }
    } catch (eFill) {}
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
