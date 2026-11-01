var cs = new CSInterface();
var nodeRequire = window.nodeRequire;
var PYTHON = "C:/Users/Leon/AppData/Local/Programs/Python/Python38/python.exe";
var PLOTTER_PY = "C:/Users/Leon/Downloads/doublecut/plotter/send_job.py";
var COLORS_FILE = "C:/Users/Leon/Downloads/doublecut/colors.json";

var busy = false;
var library = [];
var colors = [];
var selected = -1;
var statusEl = document.getElementById("status");
var listEl = document.getElementById("colors");

function setStatus(text) {
    statusEl.textContent = text;
}

function jsString(text) {
    return "\"" + String(text).replace(/\\/g, "/").replace(/"/g, "\\\"") + "\"";
}

function unwrap(value) {
    var msg = String(value == null ? "" : value);
    if (msg.charAt(0) === "\"" && msg.charAt(msg.length - 1) === "\"") {
        msg = msg.substring(1, msg.length - 1);
    }
    return msg;
}

function numberValue(id, fallback) {
    var n = parseFloat(document.getElementById(id).value);
    return isNaN(n) ? fallback : n;
}

function intField(id) {
    var n = parseInt(document.getElementById(id).value, 10);
    return isNaN(n) ? null : n;
}

function setBusy(value) {
    busy = value;
    var buttons = document.querySelectorAll("button");
    var i;
    for (i = 0; i < buttons.length; i++) buttons[i].disabled = value;
}

function runPython(args, done) {
    var execFile = nodeRequire("child_process").execFile;
    execFile(PYTHON, args, { windowsHide: true }, function (err, stdout, stderr) {
        if (err) done(String(stderr || err.message || "Python-Fehler"));
        else done(null, stdout || "");
    });
}

function evalHost(call, done) {
    cs.evalScript(call, function (result) {
        done(unwrap(result));
    });
}

function tempPath(name) {
    var os = nodeRequire("os");
    var path = nodeRequire("path");
    return path.join(os.tmpdir(), name);
}

function rgbKey(rgb) {
    return Math.round(rgb[0]) + "," + Math.round(rgb[1]) + "," + Math.round(rgb[2]);
}

function loadLibrary() {
    var fs = nodeRequire("fs");
    if (!fs.existsSync(COLORS_FILE)) return [];
    try {
        var data = JSON.parse(fs.readFileSync(COLORS_FILE, "utf8"));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        return [];
    }
}

function saveLibrary() {
    var fs = nodeRequire("fs");
    fs.writeFileSync(COLORS_FILE, JSON.stringify(library));
}

function defaultColor(rgb) {
    return {
        rgb: rgb,
        holder: "left",
        force: 20,
        speed: 20,
        travel: 20,
        passes: 1,
        mode: "cut"
    };
}

function mergeFound(found) {
    var known = {};
    var i, added = 0;
    for (i = 0; i < library.length; i++) known[rgbKey(library[i].rgb)] = library[i];
    colors = [];
    for (i = 0; i < found.length; i++) {
        var key = rgbKey(found[i]);
        if (!known[key]) {
            known[key] = defaultColor(found[i]);
            library.push(known[key]);
            added++;
        }
        colors.push(known[key]);
    }
    if (selected >= colors.length) selected = colors.length - 1;
    return added;
}

function caption(color) {
    var side = color.holder === "right" ? "rechts" : "links";
    var kind = color.mode === "pen" ? "Stift" : (color.mode === "fold" ? "Falz" : "Schnitt");
    return "F" + color.force + " S" + color.speed + " T" + color.travel + " x" + color.passes + " " + side + " " + kind;
}

function readFields() {
    if (selected < 0 || !colors[selected]) return;
    var color = colors[selected];
    color.force = numberValue("force", color.force);
    color.speed = numberValue("speed", color.speed);
    color.travel = numberValue("travel-set", color.travel);
    color.passes = numberValue("passes", color.passes);
    if (color.passes < 1) color.passes = 1;
    color.holder = document.getElementById("holder").value;
    color.mode = document.getElementById("mode").value;
}

function showFields(color) {
    document.getElementById("force").value = color.force;
    document.getElementById("speed").value = color.speed;
    document.getElementById("travel-set").value = color.travel;
    document.getElementById("passes").value = color.passes;
    document.getElementById("holder").value = color.holder === "right" ? "right" : "left";
    document.getElementById("mode").value = color.mode === "pen" || color.mode === "fold" ? color.mode : "cut";
}

function renderList() {
    var keep = selected >= 0 && colors[selected] ? rgbKey(colors[selected].rgb) : "";
    listEl.innerHTML = "";
    var i;
    selected = -1;
    for (i = 0; i < colors.length; i++) {
        if (rgbKey(colors[i].rgb) === keep) selected = i;
        var item = document.createElement("li");
        var chip = document.createElement("i");
        chip.className = "chip";
        chip.style.background = "rgb(" + colors[i].rgb.join(",") + ")";
        var label = document.createElement("span");
        label.textContent = caption(colors[i]);
        item.appendChild(chip);
        item.appendChild(label);
        item.setAttribute("data-index", String(i));
        item.addEventListener("click", onPick);
        listEl.appendChild(item);
    }
    if (selected < 0 && colors.length) selected = 0;
    if (selected >= 0) {
        listEl.children[selected].className = "selected";
        showFields(colors[selected]);
    }
}

function onPick(event) {
    readFields();
    selected = parseInt(event.currentTarget.getAttribute("data-index"), 10);
    renderList();
}

function refreshColors(done) {
    var outPath = tempPath("plotter_colors.json");
    evalHost("scanColors(" + jsString(outPath) + ")", function (msg) {
        if (msg === "nodoc") {
            if (done) done(0, "nodoc");
            return;
        }
        if (msg.indexOf("ok") !== 0) {
            if (done) done(0, msg);
            return;
        }
        var fs = nodeRequire("fs");
        var found = JSON.parse(fs.readFileSync(outPath, "utf8"));
        var added = mergeFound(found);
        saveLibrary();
        renderList();
        if (done) done(added, null);
    });
}

function rangeArgs(label, prefix) {
    var min = intField(prefix + "-min");
    var max = intField(prefix + "-max");
    var step = intField(prefix + "-step");
    if (min === null || max === null || step === null || step === 0) {
        setStatus(label + ": von, bis und Schritt angeben. Schritt darf nicht 0 sein.");
        return null;
    }
    return [
        "--" + prefix + "-min", String(min),
        "--" + prefix + "-max", String(max),
        "--" + prefix + "-step", String(step)
    ];
}

function cardArgs() {
    var force = rangeArgs("Force", "force");
    var speed = rangeArgs("Speed", "speed");
    var passes = rangeArgs("Durchgaenge", "pass");
    if (!force || !speed || !passes) return null;
    return ["--force-card", "--pen-force", String(numberValue("pen", 10))]
        .concat(force)
        .concat(speed)
        .concat(passes)
        .concat([
            "--travel", String(numberValue("travel", 20)),
            "--overcut", String(numberValue("overcut", 0))
        ]);
}

function startSquares() {
    if (busy) return;
    var args = cardArgs();
    if (!args) return;
    setBusy(true);
    setStatus("Zeichne Quadrate...");
    var jsonPath = tempPath("krafttest.json");
    runPython([PLOTTER_PY].concat(args).concat(["--json-out", jsonPath]), function (err) {
        if (err) {
            setBusy(false);
            setStatus(err);
            return;
        }
        evalHost("drawCard(" + jsString(jsonPath) + ")", function (msg) {
            setBusy(false);
            if (msg !== "ok") {
                setStatus(msg);
                return;
            }
            setStatus("Quadrate gezeichnet. Die Ebenennamen sind die Plot-Einstellungen.");
        });
    });
}

function sendJob() {
    var jobPath = tempPath("plotter_job.json");
    var blade = numberValue("blade", 0.35);
    var turn = numberValue("turn", 1);
    var marked = document.getElementById("marked").checked;
    var call = "collectJob(" + jsString(jobPath) + "," + blade + "," + turn + "," + (marked ? "true" : "false") + "," + jsString(COLORS_FILE) + ")";
    evalHost(call, function (msg) {
        if (msg === "nodoc") {
            setBusy(false);
            setStatus("Kein Dokument offen.");
            return;
        }
        if (msg.indexOf("ok ") !== 0) {
            setBusy(false);
            setStatus(msg);
            return;
        }
        var parts = msg.split(" ");
        var count = parseInt(parts[1], 10);
        var skipped = parseInt(parts[2], 10);
        if (!count) {
            setBusy(false);
            setStatus(marked
                ? "Nichts zu senden. Keine markierte Ebene mit Namen oder Strichfarbe."
                : "Nichts zu senden. " + skipped + " Pfade ohne Namen und ohne Strichfarbe.");
            return;
        }
        var host = document.getElementById("host").value.replace(/^\s+|\s+$/g, "");
        var port = document.getElementById("port").value.replace(/^\s+|\s+$/g, "");
        runPython([PLOTTER_PY, jobPath, "--host", host, "--port", port], function (err) {
            setBusy(false);
            if (err) setStatus(err);
            else setStatus("Gesendet: " + count + " Pfade, " + skipped + " ausgelassen. " + host);
        });
    });
}

function plot() {
    if (busy) return;
    readFields();
    saveLibrary();
    setBusy(true);
    setStatus("Sende...");
    refreshColors(function (added, err) {
        if (err === "nodoc") {
            setBusy(false);
            setStatus("Kein Dokument offen.");
            return;
        }
        if (err) {
            setBusy(false);
            setStatus(err);
            return;
        }
        if (added > 0) {
            setBusy(false);
            setStatus("Neue Strichfarbe. F, S und T einstellen, dann nochmal Plot.");
            return;
        }
        sendJob();
    });
}

document.getElementById("squares").addEventListener("click", startSquares);
document.getElementById("plot").addEventListener("click", plot);
document.getElementById("apply").addEventListener("click", function () {
    readFields();
    saveLibrary();
    renderList();
    setStatus("Farbe gespeichert. Ein vollstaendiger Ebenenname gilt trotzdem zuerst.");
});
document.getElementById("reread").addEventListener("click", function () {
    if (busy) return;
    readFields();
    refreshColors(function (added, err) {
        if (err === "nodoc") setStatus("Kein Dokument offen.");
        else if (err) setStatus(err);
        else setStatus(colors.length + " Strichfarben ohne vollstaendigen Ebenennamen.");
    });
});

if (!nodeRequire) {
    setStatus("Das Panel braucht den Illustrator-Erweiterungsmodus.");
} else {
    library = loadLibrary();
    var root = "";
    try { root = cs.getSystemPath("extension"); } catch (ePath) { root = ""; }
    if (root) {
        evalHost("$.evalFile(" + jsString(root + "/jsx/host.jsx") + ")", function () {
            refreshColors(function () {});
        });
    }
    setInterval(function () {
        if (busy) return;
        var active = document.activeElement;
        if (active && (active.tagName === "INPUT" || active.tagName === "SELECT")) return;
        evalHost("sweepEmptyLayers(true)", function (msg) {
            if (busy || msg.indexOf("ok ") !== 0) return;
            if (parseInt(msg.split(" ")[1], 10) > 0) refreshColors(function () {});
        });
    }, 2000);
}
