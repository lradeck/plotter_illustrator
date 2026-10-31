var cs = new CSInterface();
var nodeRequire = window.nodeRequire;
var PYTHON = "C:/Users/Leon/AppData/Local/Programs/Python/Python38/python.exe";
var PLOTTER_PY = "C:/Users/Leon/Downloads/doublecut/plotter/send_job.py";

var busy = false;
var statusEl = document.getElementById("status");

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
        .concat(["--travel", String(numberValue("travel", 20))]);
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

function plot() {
    if (busy) return;
    setBusy(true);
    setStatus("Sende...");
    var jobPath = tempPath("plotter_job.json");
    var blade = numberValue("blade", 0.35);
    var turn = numberValue("turn", 1);
    var marked = document.getElementById("marked").checked;
    var call = "collectJob(" + jsString(jobPath) + "," + blade + "," + turn + "," + (marked ? "true" : "false") + ")";
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
                ? "Nichts zu senden. Keine markierte Ebene mit F, S, T oder x im Namen."
                : "Nichts zu senden. " + skipped + " Pfade ohne Einstellung im Ebenennamen.");
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

document.getElementById("squares").addEventListener("click", startSquares);
document.getElementById("plot").addEventListener("click", plot);

if (!nodeRequire) {
    setStatus("Das Panel braucht den Illustrator-Erweiterungsmodus.");
} else {
    var root = "";
    try { root = cs.getSystemPath("extension"); } catch (ePath) { root = ""; }
    if (root) {
        evalHost("$.evalFile(" + jsString(root + "/jsx/host.jsx") + ")", function () {});
    }
}
