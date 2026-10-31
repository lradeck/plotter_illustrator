/*
  Testmuster fuer den CameraCut-Plotter.

  Legt Quadrate mit Force und Speed an, links mit Werkzeug P0 und
  rechts mit Werkzeug P1, plus je ein Falzquadrat. Zeichnen und senden
  schickt dieselben Werte an den Plotter.

  Datei > Skripten > Testmuster
  oder Datei > Skripten > Anderes Skript und diese Datei waehlen.
*/

#target illustrator

var SQUARE_MM = 15;
var GAP_MM = 8;
var SPEEDS = [10, 20, 40];
var FORCES = [10, 20, 30];
var TRAVEL_SPEED = 20;
var PAGE_W = 297;
var PAGE_H = 420;
var LEFT_X = 20;
var RIGHT_X = 170;
var BLOCK_Y = 43;
var FOLD_FORCE = 12;
var FOLD_SPEED = 10;
var BLADE_OFFSET_MM = 0.35;
var TURN_KNIFE_MM = 1;
var PYTHON = "C:/Users/Leon/AppData/Local/Programs/Python/Python38/python.exe";
var PLOTTER = "C:/Users/Leon/Downloads/doublecut/plotter/send_job.py";

var MM = 72 / 25.4;

(function () {
    var choice = ask();
    if (!choice) return;
    var job = buildJob();
    var doc = app.documents.add(DocumentColorSpace.RGB, PAGE_W * MM, PAGE_H * MM);
    draw(doc, job);
    if (choice.send) sendJob(job, choice.host, choice.port);
})();

function ask() {
    var dialog = new Window("dialog", "Testmuster");
    dialog.orientation = "column";
    dialog.alignChildren = ["fill", "top"];
    dialog.margins = 16;
    var note = dialog.add("statictext", undefined, "Links Messer P0, rechts Messer P1. Spalten sind Speed 10, 20 und 40. Zeilen sind Force 10, 20 und 30. Die gruenen Quadrate werden gefalzt.", {multiline: true});
    note.preferredSize = [360, 48];
    var row = dialog.add("group");
    row.add("statictext", undefined, "Plotter-IP");
    var hostBox = row.add("edittext", undefined, "172.31.192.1");
    hostBox.characters = 18;
    row.add("statictext", undefined, "Port");
    var portBox = row.add("edittext", undefined, "8080");
    portBox.characters = 6;
    var buttons = dialog.add("group");
    buttons.alignment = "right";
    var cancelBtn = buttons.add("button", undefined, "Abbrechen");
    var drawBtn = buttons.add("button", undefined, "Nur zeichnen");
    var sendBtn = buttons.add("button", undefined, "Zeichnen und senden");
    cancelBtn.onClick = function () { dialog.close(0); };
    drawBtn.onClick = function () { dialog.close(1); };
    sendBtn.onClick = function () { dialog.close(2); };
    var result = dialog.show();
    if (result !== 1 && result !== 2) return null;
    return {
        send: result === 2,
        host: trim(hostBox.text),
        port: trim(portBox.text)
    };
}

function buildJob() {
    var paths = [];
    var blocks = [
        { holder: "left", x: LEFT_X, y: BLOCK_Y },
        { holder: "right", x: RIGHT_X, y: BLOCK_Y }
    ];
    var block, row, col, x, y;
    for (block = 0; block < blocks.length; block++) {
        for (row = 0; row < FORCES.length; row++) {
            for (col = 0; col < SPEEDS.length; col++) {
                x = blocks[block].x + col * (SQUARE_MM + GAP_MM);
                y = blocks[block].y + (FORCES.length - 1 - row) * (SQUARE_MM + GAP_MM);
                paths.push(square(blocks[block].holder, "cut", FORCES[row], SPEEDS[col], x, y));
            }
        }
        y = blocks[block].y - (SQUARE_MM + GAP_MM);
        paths.push(square(blocks[block].holder, "fold", FOLD_FORCE, FOLD_SPEED, blocks[block].x, y));
    }
    return {
        page_mm: [PAGE_W, PAGE_H],
        origin_mm: [0, 0],
        accurate: true,
        blade_offset_mm: BLADE_OFFSET_MM,
        overcut_mm: 0,
        turn_knife_mm: TURN_KNIFE_MM,
        paths: paths
    };
}

function square(holder, mode, force, speed, x, y) {
    return {
        holder: holder,
        mode: mode,
        force: force,
        cut_speed: speed,
        travel_speed: TRAVEL_SPEED,
        label: holder + " " + mode + " F" + force + " S" + speed,
        points_mm: [
            [x, y],
            [x + SQUARE_MM, y],
            [x + SQUARE_MM, y + SQUARE_MM],
            [x, y + SQUARE_MM]
        ]
    };
}

function draw(doc, job) {
    var layer = doc.layers.add();
    layer.name = "Testmuster";
    var board = doc.artboards[0].artboardRect;
    var originX = board[0];
    var originY = board[3];
    var i, path, pts, x, y, side, left, top, item, color, caption, textItem, note;
    for (i = 0; i < job.paths.length; i++) {
        path = job.paths[i];
        pts = path.points_mm;
        x = pts[0][0];
        y = pts[0][1];
        side = pts[1][0] - pts[0][0];
        left = originX + x * MM;
        top = originY + (y + side) * MM;
        item = layer.pathItems.rectangle(top, left, side * MM, side * MM);
        item.filled = false;
        item.stroked = true;
        item.strokeWidth = 0.7;
        color = strokeColor(path);
        item.strokeColor = color;
        caption = "F" + path.force + "  S" + path.cut_speed;
        if (path.mode === "fold") caption = "Falz  F" + path.force;
        textItem = layer.textFrames.pointText([left + 1.5, top - 10]);
        textItem.contents = caption;
        textItem.textRange.characterAttributes.size = 7;
        textItem.textRange.characterAttributes.fillColor = color;
    }
    note = layer.textFrames.pointText([originX + 20 * MM, originY + 130 * MM]);
    note.contents = "Links P0 Messer     Rechts P1 Messer     Gruen = Falzen";
    note.textRange.characterAttributes.size = 11;
}

function strokeColor(path) {
    var color = new RGBColor();
    if (path.mode === "fold") {
        color.red = 16;
        color.green = 130;
        color.blue = 64;
        return color;
    }
    if (path.holder === "left") {
        color.red = 25;
        color.green = 72;
        color.blue = 90 + path.force * 4;
        return color;
    }
    color.red = 90 + path.force * 4;
    color.green = 36;
    color.blue = 36;
    return color;
}

function sendJob(job, host, port) {
    var folder = Folder.temp;
    var jsonFile = new File(folder.fsName + "/cameracut_pattern.json");
    jsonFile.encoding = "UTF-8";
    if (!jsonFile.open("w")) {
        alert("Die Auftragsdatei konnte nicht geschrieben werden.");
        return;
    }
    jsonFile.write(toJson(job));
    jsonFile.close();

    var logFile = new File(folder.fsName + "/cameracut_pattern.log");
    if (logFile.exists) logFile.remove();
    var bat = new File(folder.fsName + "/cameracut_pattern.bat");
    if (!bat.open("w")) {
        alert("Die Startdatei konnte nicht geschrieben werden.");
        return;
    }
    bat.writeln("@echo off");
    bat.writeln("\"" + PYTHON + "\" \"" + PLOTTER + "\" \"" + jsonFile.fsName + "\" --host " + host + " --port " + port + " > \"" + logFile.fsName + "\" 2>&1");
    bat.writeln("echo EXIT_%ERRORLEVEL%>> \"" + logFile.fsName + "\"");
    bat.close();
    if (!bat.execute()) {
        alert("Python konnte nicht gestartet werden.");
        return;
    }

    var started = new Date().getTime();
    var body = "";
    while (new Date().getTime() - started < 12000) {
        $.sleep(250);
        if (!logFile.exists) continue;
        if (!logFile.open("r")) continue;
        body = logFile.read();
        logFile.close();
        if (body.indexOf("EXIT_") >= 0) break;
    }
    alert(body.length ? body : "Keine Rueckmeldung vom Senden.");
}

function toJson(value) {
    var kind = typeof value;
    if (value === null) return "null";
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

function trim(text) {
    return String(text).replace(/^\s+|\s+$/g, "");
}
