var cs = new CSInterface();
var nodeRequire = window.nodeRequire;
var PYTHON = "C:/Users/Leon/AppData/Local/Programs/Python/Python38/python.exe";
var PLOTTER_PY = "C:/Users/Leon/Downloads/doublecut/plotter/send_job.py";
var COLORS_FILE = "C:/Users/Leon/Downloads/doublecut/colors.json";
var CONFIG_FILE = "C:/Users/Leon/Downloads/doublecut/configurations.json";
var CONNECTION_FILE = "C:/Users/Leon/Downloads/doublecut/connection.json";
var LOG_FILE = "C:/Users/Leon/Downloads/doublecut/panel.log";
var MATERIALS_FILE = "C:/Users/Leon/Downloads/doublecut/materials.yaml";
var SQUARE_FIELDS = [
    "force-min", "force-max", "force-step",
    "speed-min", "speed-max", "speed-step",
    "pass-min", "pass-max", "pass-step",
    "y-axis", "travel", "pen", "pen-speed", "overcut", "steg"
];
var EDITOR_PAIRS = [
    ["cfg-force", "force"],
    ["cfg-speed", "speed"],
    ["cfg-travel-set", "travel-set"],
    ["cfg-passes", "passes"],
    ["cfg-depth", "depth"],
    ["cfg-offset", "offset"],
    ["cfg-holder", "holder"],
    ["cfg-mode", "mode"]
];
var ANGLE_OFFSET = { "30": "0.25", "45": "0.30", "60": "0.40" };

var busy = false;
var library = [];
var configs = [];
var colors = [];
var selected = -1;
var statusEl = document.getElementById("status");
var listEl = document.getElementById("colors");

function setStatus(text) {
    statusEl.textContent = text;
    if (text) logLine("status " + text);
}

function logLine(message) {
    try {
        if (!nodeRequire) return;
        var fs = nodeRequire("fs");
        var stamp = new Date();
        var line = stamp.getFullYear() + "-" + pad(stamp.getMonth() + 1) + "-" + pad(stamp.getDate())
            + " " + pad(stamp.getHours()) + ":" + pad(stamp.getMinutes()) + ":" + pad(stamp.getSeconds())
            + " panel " + message + "\n";
        fs.appendFileSync(LOG_FILE, line);
        var size = fs.statSync(LOG_FILE).size;
        if (size > 180000) {
            var text = fs.readFileSync(LOG_FILE, "utf8");
            text = text.slice(-120000);
            var cut = text.indexOf("\n");
            if (cut >= 0) text = text.slice(cut + 1);
            fs.writeFileSync(LOG_FILE, text);
        }
    } catch (eLog) {}
}

function pad(n) {
    return (n < 10 ? "0" : "") + n;
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
    logLine("python " + args.slice(1, 6).join(" "));
    execFile(PYTHON, args, { windowsHide: true }, function (err, stdout, stderr) {
        if (err) {
            logLine("python ERR " + String(stderr || err.message || "Python-Fehler").slice(0, 500));
            done(String(stderr || err.message || "Python-Fehler"));
        } else {
            logLine("python ok");
            done(null, stdout || "");
        }
    });
}

function evalHost(call, done) {
    cs.evalScript(call, function (result) {
        var msg = unwrap(result);
        if (call.indexOf("sweepEmptyLayers") !== 0 || (msg.indexOf("ok 0") !== 0 && msg !== "nodoc")) {
            logLine("eval " + call.slice(0, 220) + " -> " + String(msg).slice(0, 300));
        }
        done(msg);
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

function loadConfigs() {
    var fs = nodeRequire("fs");
    if (!fs.existsSync(CONFIG_FILE)) return [];
    try {
        var data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
        if (!Array.isArray(data)) return [];
        var kept = [];
        var i;
        for (i = 0; i < data.length; i++) {
            if (data[i] && data[i].name && data[i].values) kept.push(data[i]);
        }
        return kept;
    } catch (e) {
        return [];
    }
}

function writeConfigs() {
    var fs = nodeRequire("fs");
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
}

function configName() {
    return document.getElementById("config-name").value.replace(/^\s+|\s+$/g, "");
}

function findConfig(name) {
    var i;
    for (i = 0; i < configs.length; i++) {
        if (configs[i].name === name) return i;
    }
    return -1;
}

function selectedConfigName() {
    return document.getElementById("config-list").value;
}

function materialFromEditor() {
    var mode = document.getElementById("cfg-mode").value;
    return {
        holder: document.getElementById("cfg-holder").value,
        force: document.getElementById("cfg-force").value,
        speed: document.getElementById("cfg-speed").value,
        "travel-set": document.getElementById("cfg-travel-set").value,
        passes: document.getElementById("cfg-passes").value,
        depth: document.getElementById("cfg-depth").value,
        offset: offsetText("cfg-offset"),
        mode: mode
    };
}

function offsetText(id) {
    var text = String(document.getElementById(id).value).replace(",", ".").replace(/^\s+|\s+$/g, "");
    if (text === "" || isNaN(parseFloat(text))) return "0.35";
    return text;
}

function applyAngle(angleId, offsetId) {
    var picked = document.getElementById(angleId).value;
    if (ANGLE_OFFSET[picked]) document.getElementById(offsetId).value = ANGLE_OFFSET[picked];
}

function syncAngleFrom(offsetId, angleId) {
    var n = parseFloat(String(document.getElementById(offsetId).value).replace(",", "."));
    var picked = "";
    if (!isNaN(n)) {
        if (Math.abs(n - 0.25) < 0.0001) picked = "30";
        else if (Math.abs(n - 0.30) < 0.0001) picked = "45";
        else if (Math.abs(n - 0.40) < 0.0001) picked = "60";
    }
    document.getElementById(angleId).value = picked;
}

function copyEditor(toWorking) {
    var i, from, to;
    for (i = 0; i < EDITOR_PAIRS.length; i++) {
        from = document.getElementById(toWorking ? EDITOR_PAIRS[i][0] : EDITOR_PAIRS[i][1]);
        to = document.getElementById(toWorking ? EDITOR_PAIRS[i][1] : EDITOR_PAIRS[i][0]);
        if (from && to) to.value = from.value;
    }
    syncAngleFrom("offset", "angle");
    syncAngleFrom("cfg-offset", "cfg-angle");
}

function applySquareConfig(values) {
    var i, id;
    for (i = 0; i < SQUARE_FIELDS.length; i++) {
        id = SQUARE_FIELDS[i];
        if (values[id] != null) document.getElementById(id).value = values[id];
    }
}

function fillConfigSelect(list, selectedName) {
    var current = selectedName == null ? list.value : selectedName;
    list.innerHTML = "";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = configs.length ? "waehlen" : "keine";
    list.appendChild(empty);
    var i, option;
    for (i = 0; i < configs.length; i++) {
        option = document.createElement("option");
        option.value = configs[i].name;
        option.textContent = configs[i].name;
        list.appendChild(option);
    }
    list.value = findConfig(current) >= 0 ? current : "";
}

function renderConfigs(selectedName) {
    fillConfigSelect(document.getElementById("config-list"), selectedName);
    fillConfigSelect(document.getElementById("color-config"), selectedName);
    fillConfigSelect(document.getElementById("square-config"), selectedName);
}

function firstValue(values, keys) {
    var i;
    for (i = 0; i < keys.length; i++) {
        if (values[keys[i]] != null && values[keys[i]] !== "") return values[keys[i]];
    }
    return null;
}

function fillColorFields(values, prefix) {
    var force = firstValue(values, ["force", "force-min"]);
    var speed = firstValue(values, ["speed", "speed-min"]);
    var travel = firstValue(values, ["travel-set", "travel"]);
    var passes = firstValue(values, ["passes", "pass-min"]);
    var mode = firstValue(values, ["mode"]);
    var holder = firstValue(values, ["holder"]);
    var depth = firstValue(values, ["depth"]);
    var offset = firstValue(values, ["offset"]);
    var forceId = prefix ? prefix + "force" : "force";
    var speedId = prefix ? prefix + "speed" : "speed";
    var travelId = prefix ? prefix + "travel-set" : "travel-set";
    var passesId = prefix ? prefix + "passes" : "passes";
    var modeId = prefix ? prefix + "mode" : "mode";
    var holderId = prefix ? prefix + "holder" : "holder";
    var depthId = prefix ? prefix + "depth" : "depth";
    var offsetId = prefix ? prefix + "offset" : "offset";
    if (force != null) document.getElementById(forceId).value = force;
    if (speed != null) document.getElementById(speedId).value = speed;
    if (travel != null) document.getElementById(travelId).value = travel;
    if (passes != null) document.getElementById(passesId).value = passes;
    if (depth != null) document.getElementById(depthId).value = depth;
    if (offset != null) document.getElementById(offsetId).value = offset;
    syncAngleFrom(offsetId, offsetId === "cfg-offset" ? "cfg-angle" : "angle");
    if (mode === "pen" || mode === "fold" || mode === "cut") document.getElementById(modeId).value = mode;
    if (holder === "right" || holder === "left") document.getElementById(holderId).value = holder;
}

function loadColorConfig() {
    var name = document.getElementById("color-config").value;
    var index = findConfig(name);
    if (index < 0) {
        setStatus("Erst eine Einstellung aus der Liste waehlen.");
        return;
    }
    fillColorFields(configs[index].values, "");
}

function loadEditorConfig() {
    var name = selectedConfigName();
    var index = findConfig(name);
    if (index < 0) {
        setStatus("Erst eine Einstellung aus der Liste waehlen.");
        return;
    }
    fillColorFields(configs[index].values, "cfg-");
    document.getElementById("config-name").value = name;
}

function saveConfig() {
    var name = configName();
    if (!name) {
        setStatus("Konfiguration braucht einen Namen.");
        return;
    }
    var index = findConfig(name);
    var values = {};
    var key;
    var prior = index >= 0 ? configs[index].values : {};
    var material = materialFromEditor();
    for (key in prior) {
        if (prior.hasOwnProperty(key)) values[key] = prior[key];
    }
    for (key in material) {
        if (material.hasOwnProperty(key)) values[key] = material[key];
    }
    var entry = { name: name, values: values };
    if (index >= 0) configs[index] = entry;
    else configs.push(entry);
    writeConfigs();
    renderConfigs(name);
    setStatus(index >= 0 ? "Konfiguration aktualisiert: " + name : "Konfiguration gespeichert: " + name);
}

function yamlScalar(value) {
    var text = value == null ? "" : String(value);
    if (text === "" || /[:#&*!|>%@`'"\n]/.test(text) || text !== text.replace(/^\s+|\s+$/g, "")) {
        return "\"" + text.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"";
    }
    return text;
}

function unquoteYaml(value) {
    var text = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
    if (text.charAt(0) === "\"" && text.charAt(text.length - 1) === "\"") {
        return text.substring(1, text.length - 1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
    }
    return text;
}

function parseMaterialsYaml(text) {
    var lines = String(text).split(/\r?\n/);
    var items = [];
    var current = null;
    var i, line, nameMatch, fieldMatch;
    for (i = 0; i < lines.length; i++) {
        line = lines[i];
        if (!line || /^\s*#/.test(line) || /^\s*materials:\s*$/.test(line)) continue;
        nameMatch = line.match(/^\s*-\s+name:\s*(.*)$/);
        if (nameMatch) {
            current = { name: unquoteYaml(nameMatch[1]) };
            items.push(current);
            continue;
        }
        fieldMatch = line.match(/^\s+([A-Za-z0-9_]+):\s*(.*)$/);
        if (current && fieldMatch) current[fieldMatch[1]] = unquoteYaml(fieldMatch[2]);
    }
    var kept = [];
    for (i = 0; i < items.length; i++) {
        if (items[i].name) kept.push(items[i]);
    }
    return kept;
}

function exportMaterials() {
    var fs = nodeRequire("fs");
    var lines = ["materials:"];
    var i, values, travel, depth;
    if (!configs.length) {
        setStatus("Keine Material-Einstellung zum Exportieren.");
        return;
    }
    for (i = 0; i < configs.length; i++) {
        values = configs[i].values || {};
        travel = values["travel-set"] != null ? values["travel-set"] : values.travel;
        depth = values.depth != null ? values.depth : 0;
        lines.push("- name: " + yamlScalar(configs[i].name));
        lines.push("  holder: " + yamlScalar(values.holder || "left"));
        lines.push("  force: " + yamlScalar(values.force));
        lines.push("  speed: " + yamlScalar(values.speed));
        lines.push("  travel_speed: " + yamlScalar(travel));
        lines.push("  passes: " + yamlScalar(values.passes));
        lines.push("  cut_depth: " + yamlScalar(depth));
        lines.push("  offset: " + yamlScalar(values.offset != null ? values.offset : 0.35));
        lines.push("  mode: " + yamlScalar(values.mode || "cut"));
    }
    fs.writeFileSync(MATERIALS_FILE, lines.join("\n") + "\n");
    logLine("export " + configs.length + " materials");
    setStatus("Material exportiert.");
}

function importMaterials() {
    var fs = nodeRequire("fs");
    var text, items, i, item, index, prior, values, key;
    if (!fs.existsSync(MATERIALS_FILE)) {
        setStatus("materials.yaml fehlt.");
        return;
    }
    text = fs.readFileSync(MATERIALS_FILE, "utf8");
    items = parseMaterialsYaml(text);
    if (!items.length) {
        setStatus("Die YAML-Datei enthaelt kein Material.");
        return;
    }
    for (i = 0; i < items.length; i++) {
        item = items[i];
        index = findConfig(item.name);
        prior = index >= 0 ? configs[index].values : {};
        values = {};
        for (key in prior) {
            if (prior.hasOwnProperty(key)) values[key] = prior[key];
        }
        if (item.holder === "right" || item.holder === "left") values.holder = item.holder;
        if (item.force != null) values.force = item.force;
        if (item.speed != null) values.speed = item.speed;
        if (item.travel_speed != null) values["travel-set"] = item.travel_speed;
        if (item.passes != null) values.passes = item.passes;
        if (item.cut_depth != null) values.depth = item.cut_depth;
        if (item.offset != null) values.offset = item.offset;
        if (item.mode === "pen" || item.mode === "fold" || item.mode === "cut") values.mode = item.mode;
        if (index >= 0) configs[index] = { name: item.name, values: values };
        else configs.push({ name: item.name, values: values });
    }
    writeConfigs();
    renderConfigs(items[0].name);
    loadEditorConfig();
    logLine("import " + items.length + " materials");
    setStatus("Material gelesen.");
}

function loadConfig() {
    var name = document.getElementById("square-config").value;
    var index = findConfig(name);
    if (index < 0) {
        setStatus("Erst eine Einstellung aus der Liste waehlen.");
        return;
    }
    applySquareConfig(configs[index].values);
}

function renameConfig() {
    var name = selectedConfigName();
    var index = findConfig(name);
    var next = configName();
    if (index < 0) {
        setStatus("Erst eine Konfiguration aus der Liste waehlen.");
        return;
    }
    if (!next) {
        setStatus("Neuer Name fehlt.");
        return;
    }
    if (next !== name && findConfig(next) >= 0) {
        setStatus("Der Name ist schon vergeben: " + next);
        return;
    }
    configs[index].name = next;
    writeConfigs();
    renderConfigs(next);
    setStatus("Konfiguration heisst jetzt: " + next);
}

function deleteConfig() {
    var name = selectedConfigName();
    var index = findConfig(name);
    if (index < 0) {
        setStatus("Erst eine Konfiguration aus der Liste waehlen.");
        return;
    }
    if (!window.confirm("Konfiguration \"" + name + "\" loeschen?")) return;
    configs.splice(index, 1);
    writeConfigs();
    if (configName() === name) document.getElementById("config-name").value = "";
    renderConfigs("");
    setStatus("Konfiguration geloescht: " + name);
}

function defaultColor(rgb) {
    return {
        rgb: rgb,
        holder: "left",
        force: 20,
        speed: 20,
        travel: 20,
        passes: 1,
        depth: 0,
        offset: 0.35,
        mode: "cut"
    };
}

function entryRgb(entry) {
    if (entry && entry.rgb && entry.rgb.length === 3) return entry.rgb;
    return entry;
}

function mergeFound(found) {
    var known = {};
    var i, added = 0, rgb, key, color;
    for (i = 0; i < library.length; i++) known[rgbKey(library[i].rgb)] = library[i];
    colors = [];
    for (i = 0; i < found.length; i++) {
        rgb = entryRgb(found[i]);
        if (!rgb || rgb.length !== 3) continue;
        key = rgbKey(rgb);
        if (!known[key]) {
            known[key] = defaultColor(rgb);
            library.push(known[key]);
            added++;
        }
        color = known[key];
        if (color.depth == null) color.depth = 0;
        if (color.offset == null || color.offset === "") color.offset = 0.35;
        if (found[i] && found[i].complete && found[i].offset != null && !isNaN(found[i].offset)) {
            color.offset = found[i].offset;
        }
        if (found[i] && found[i].complete) {
            color.force = found[i].force;
            color.speed = found[i].speed;
            color.travel = found[i].travel;
            color.passes = found[i].passes;
            color.holder = found[i].holder === "right" ? "right" : "left";
            color.mode = found[i].mode === "pen" || found[i].mode === "fold" ? found[i].mode : "cut";
        }
        colors.push(color);
    }
    if (selected >= colors.length) selected = colors.length - 1;
    return added;
}

function caption(color) {
    var side = color.holder === "right" ? "Right" : "Left";
    var kind = color.mode === "pen" ? "Pen" : (color.mode === "fold" ? "Fold" : "Cut");
    return "Force " + color.force + "  Speed " + color.speed + "  Travel speed " + color.travel + "  Passes " + color.passes + "  Cut depth " + color.depth + "  Offset " + color.offset + "  " + side + "  " + kind;
}

function readFields() {
    if (selected < 0 || !colors[selected]) return;
    var color = colors[selected];
    color.force = numberValue("force", color.force);
    color.speed = numberValue("speed", color.speed);
    color.travel = numberValue("travel-set", color.travel);
    color.passes = numberValue("passes", color.passes);
    color.depth = numberValue("depth", color.depth);
    color.offset = offsetText("offset");
    if (color.passes < 1) color.passes = 1;
    color.mode = document.getElementById("mode").value;
    color.holder = document.getElementById("holder").value;
}

function showFields(color) {
    document.getElementById("force").value = color.force;
    document.getElementById("speed").value = color.speed;
    document.getElementById("travel-set").value = color.travel;
    document.getElementById("passes").value = color.passes;
    document.getElementById("depth").value = color.depth == null ? 0 : color.depth;
    document.getElementById("offset").value = color.offset == null ? 0.35 : color.offset;
    syncAngleFrom("offset", "angle");
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

function qualifiedLayerName(color) {
    var force = Math.round(color.force);
    var speed = Math.round(color.speed);
    var travel = Math.round(color.travel);
    var passes = Math.round(color.passes);
    var side = color.holder === "right" ? "Right" : "Left";
    if (passes < 1) passes = 1;
    var offset = " O" + formatOffset(color.offset);
    if (color.mode === "pen") return side + " Stift F" + force + " S" + speed + " T" + travel + " x" + passes + offset;
    if (color.mode === "fold") return side + " Falz F" + force + " S" + speed + " T" + travel + " x" + passes + offset;
    return side + " F" + force + " S" + speed + " T" + travel + " x" + passes + offset;
}

function formatOffset(value) {
    var n = parseFloat(String(value == null ? "" : value).replace(",", "."));
    if (isNaN(n)) n = 0.35;
    var text = String(Math.round(n * 1000) / 1000);
    if (text.indexOf(".") < 0) text += ".0";
    return text;
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
    var passes = rangeArgs("Passes", "pass");
    if (!force || !speed || !passes) return null;
    var yAxis = document.getElementById("y-axis").value === "speed" ? "speed" : "force";
    return ["--force-card", "--pen-force", String(numberValue("pen", 20)), "--pen-speed", String(numberValue("pen-speed", 20))]
        .concat(force)
        .concat(speed)
        .concat(passes)
        .concat([
            "--travel", String(numberValue("travel", 20)),
            "--overcut", String(numberValue("overcut", 0)),
            "--steg", String(numberValue("steg", 0.5)),
            "--y-axis", yAxis,
            "--pen-holder", document.getElementById("pen-holder").value === "left" ? "left" : "right"
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
            closeSheet("square-sheet");
            setStatus("");
            refreshColors(function () {});
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
                ? "Nichts zu senden. Keine markierte Ebene mit Force, Speed, Travel speed und Passes."
                : "Nichts zu senden. " + skipped + " Pfade ohne vollstaendigen Ebenennamen.");
            return;
        }
        var host = document.getElementById("host").value.replace(/^\s+|\s+$/g, "");
        var port = document.getElementById("port").value.replace(/^\s+|\s+$/g, "");
        var sendArgs = [PLOTTER_PY, jobPath, "--host", host, "--port", port];
        if (document.getElementById("alternate").checked) sendArgs.push("--alternate");
        runPython(sendArgs, function (err) {
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
            setStatus("Neue Strichfarbe. Force, Speed und Travel speed einstellen, dann nochmal Plot.");
            return;
        }
        sendJob();
    });
}

document.getElementById("config-list").addEventListener("change", function () {
    var name = selectedConfigName();
    if (name) loadEditorConfig();
});
document.getElementById("config-edit-load").addEventListener("click", loadEditorConfig);
document.getElementById("config-save").addEventListener("click", saveConfig);
document.getElementById("config-export").addEventListener("click", exportMaterials);
document.getElementById("config-import").addEventListener("click", importMaterials);
document.getElementById("config-load").addEventListener("click", loadConfig);
document.getElementById("config-rename").addEventListener("click", renameConfig);
document.getElementById("config-delete").addEventListener("click", deleteConfig);
function openSheet(id) {
    document.getElementById(id).className = "sheet open";
}

function closeSheet(id) {
    document.getElementById(id).className = "sheet";
}

function loadConnection() {
    var fs = nodeRequire("fs");
    var data, id;
    if (!fs.existsSync(CONNECTION_FILE)) return;
    try {
        data = JSON.parse(fs.readFileSync(CONNECTION_FILE, "utf8"));
    } catch (e) {
        return;
    }
    if (!data) return;
    for (id in data) {
        if (!data.hasOwnProperty(id) || data[id] == null) continue;
        if (id === "marked" || id === "alternate") {
            document.getElementById(id).checked = data[id] === "1" || data[id] === true;
        } else if (document.getElementById(id)) {
            document.getElementById(id).value = data[id];
        }
    }
}

function saveConnection() {
    var fs = nodeRequire("fs");
    var data = {
        host: document.getElementById("host").value,
        port: document.getElementById("port").value,
        blade: document.getElementById("blade").value,
        turn: document.getElementById("turn").value,
        marked: document.getElementById("marked").checked ? "1" : "0",
        alternate: document.getElementById("alternate").checked ? "1" : "0"
    };
    fs.writeFileSync(CONNECTION_FILE, JSON.stringify(data, null, 2));
    setStatus("Verbindung gespeichert.");
    closeSheet("settings-sheet");
}

document.getElementById("squares").addEventListener("click", function () {
    openSheet("square-sheet");
});
document.getElementById("square-close").addEventListener("click", function () {
    closeSheet("square-sheet");
});
document.getElementById("square-draw").addEventListener("click", startSquares);
document.getElementById("settings").addEventListener("click", function () {
    openSheet("settings-sheet");
    if (selectedConfigName()) loadEditorConfig();
    else copyEditor(false);
});
document.getElementById("settings-close").addEventListener("click", function () {
    closeSheet("settings-sheet");
});
document.getElementById("connection-save").addEventListener("click", saveConnection);
document.getElementById("angle").addEventListener("change", function () { applyAngle("angle", "offset"); });
document.getElementById("cfg-angle").addEventListener("change", function () { applyAngle("cfg-angle", "cfg-offset"); });
document.getElementById("offset").addEventListener("change", function () { syncAngleFrom("offset", "angle"); });
document.getElementById("cfg-offset").addEventListener("change", function () { syncAngleFrom("cfg-offset", "cfg-angle"); });
document.getElementById("color-load").addEventListener("click", loadColorConfig);
document.getElementById("plot").addEventListener("click", plot);
document.getElementById("apply").addEventListener("click", function () {
    var color, name;
    readFields();
    saveLibrary();
    renderList();
    if (selected < 0 || !colors[selected]) {
        setStatus("Keine Strichfarbe gewaehlt.");
        return;
    }
    color = colors[selected];
    name = qualifiedLayerName(color);
        evalHost(
        "applyColorName(" + color.rgb[0] + "," + color.rgb[1] + "," + color.rgb[2] + "," + jsString(name) + ")",
        function (msg) {
            logLine("uebernehmen '" + name + "' -> " + msg);
            refreshColors(function () {});
            if (msg === "nodoc") setStatus("Kein Dokument offen.");
            else if (msg === "ok 0") setStatus("Keine Pfade mit dieser Strichfarbe.");
            else if (msg.indexOf("ok") !== 0) setStatus(msg);
        }
    );
});
document.getElementById("reread").addEventListener("click", function () {
    if (busy) return;
    readFields();
    refreshColors(function (added, err) {
        if (err === "nodoc") setStatus("Kein Dokument offen.");
        else if (err) setStatus(err);
    });
});

if (!nodeRequire) {
    setStatus("Das Panel braucht den Illustrator-Erweiterungsmodus.");
} else {
    library = loadLibrary();
    configs = loadConfigs();
    loadConnection();
    renderConfigs("");
    logLine("panel ready");
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
