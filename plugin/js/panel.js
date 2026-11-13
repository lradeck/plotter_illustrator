var cs = new CSInterface();
var nodeRequire = window.nodeRequire;
var PYTHON = "C:/Users/Leon/AppData/Local/Programs/Python/Python38/python.exe";
var PLOTTER_PY = "C:/Users/Leon/Downloads/doublecut/plotter/send_job.py";
var COLORS_FILE = "C:/Users/Leon/Downloads/doublecut/colors.json";
var CONFIG_FILE = "C:/Users/Leon/Downloads/doublecut/configurations.json";
var CONNECTION_FILE = "C:/Users/Leon/Downloads/doublecut/connection.json";
var LOG_FILE = "C:/Users/Leon/Downloads/doublecut/panel.log";
var MATERIALS_FILE = "C:/Users/Leon/Downloads/doublecut/materials.yaml";
var HISTORY_FILE = "C:/Users/Leon/Downloads/doublecut/history.json";
var SQUARE_FIELDS = [
    "force-min", "force-max", "force-step",
    "speed-min", "speed-max", "speed-step",
    "pass-min", "pass-max", "pass-step",
    "y-axis", "travel", "pen", "pen-speed", "square-offset", "overcut", "steg"
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
var fieldsDirty = false;
var plotJobs = [];
var historyOpen = "";
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

function stayChecked(id) {
    var el = document.getElementById(id);
    return !!(el && el.getAttribute("aria-pressed") === "true");
}

function setStayChecked(id, on) {
    var el = document.getElementById(id);
    if (!el) return;
    var yes = !!on;
    el.setAttribute("aria-pressed", yes ? "true" : "false");
    el.textContent = yes ? "Ja" : "Nein";
    el.className = yes ? "toggle on" : "toggle";
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
        logLine("configs ERR " + (e && e.message ? e.message : e));
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
        mode: mode,
        stay: stayChecked("cfg-stay") ? "1" : "0"
    };
}

function offsetText(id) {
    var text = String(document.getElementById(id).value).replace(",", ".").replace(/^\s+|\s+$/g, "");
    if (text === "" || isNaN(parseFloat(text))) return "0.35";
    return text;
}

function passCount(id) {
    var n = parseInt(document.getElementById(id).value, 10);
    if (isNaN(n) || n < 1) return 1;
    if (n > 12) return 12;
    return n;
}

function forceBox(prefix) {
    return document.getElementById(prefix ? "cfg-pass-forces" : "pass-forces");
}

function forceInputId(prefix, index) {
    return (prefix ? "cfg-force" : "force") + (index === 1 ? "" : "-" + index);
}

function renderPassForces(prefix) {
    var box = forceBox(prefix);
    var first = document.getElementById(forceInputId(prefix, 1));
    if (!box || !first) return;
    var count = passCount(prefix ? prefix + "passes" : "passes");
    var kept = readPassForces(prefix);
    box.innerHTML = "";
    var i, row, input;
    for (i = 2; i <= count; i++) {
        row = document.createElement("label");
        row.textContent = "Pass " + i + " ";
        input = document.createElement("input");
        input.id = forceInputId(prefix, i);
        input.value = kept[i - 1] ? kept[i - 1] : document.getElementById(forceInputId(prefix, 1)).value;
        input.addEventListener("input", markDirty);
        row.appendChild(input);
        box.appendChild(row);
    }
}

function readPassForces(prefix) {
    var count = passCount(prefix ? prefix + "passes" : "passes");
    var out = [];
    var i, el;
    for (i = 1; i <= count; i++) {
        el = document.getElementById(forceInputId(prefix, i));
        out.push(el ? el.value : "");
    }
    return out;
}

function applyForceList(list, prefix) {
    if (!list || !list.length) return;
    var i, el;
    document.getElementById(forceInputId(prefix, 1)).value = list[0];
    for (i = 1; i < list.length; i++) {
        el = document.getElementById(forceInputId(prefix, i + 1));
        if (el) el.value = list[i];
    }
}

function markDirty() {
    fieldsDirty = true;
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
    setStayChecked(toWorking ? "stay" : "cfg-stay", stayChecked(toWorking ? "cfg-stay" : "stay"));
    renderPassForces("");
    renderPassForces("cfg-");
}

function applySquareConfig(values) {
    var i, id;
    for (i = 0; i < SQUARE_FIELDS.length; i++) {
        id = SQUARE_FIELDS[i];
        if (values[id] != null) document.getElementById(id).value = values[id];
    }
    syncAngleFrom("square-offset", "square-angle");
}

function fillConfigSelect(list, selectedName) {
    if (!list) return;
    var current = selectedName == null ? list.value : selectedName;
    if (findConfig(current) < 0 && configs.length) current = configs[0].name;
    var parent = list.parentNode;
    var replacement = list.cloneNode(false);
    if (parent) {
        parent.replaceChild(replacement, list);
        list = replacement;
    }
    while (list.options.length) list.remove(0);
    if (!configs.length) {
        list.add(new Option("keine", ""));
        list.selectedIndex = 0;
        list.title = "";
    } else {
        var i, picked = 0;
        for (i = 0; i < configs.length; i++) {
            list.add(new Option(configs[i].name, configs[i].name));
            if (configs[i].name === current) picked = i;
        }
        list.selectedIndex = picked;
        list.title = configs[picked].name;
    }
    if (list.id === "color-config") {
        var nameEl = document.getElementById("material-current");
        if (nameEl) nameEl.textContent = list.selectedIndex >= 0 && list.options[list.selectedIndex] ? list.options[list.selectedIndex].text : "";
    }
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
    var force = firstValue(values, ["force", "forceStraight", "force-straight", "force_straight", "force-min"]);
    var speed = firstValue(values, ["speed", "speedStraight", "speed-straight", "speed_straight", "speed-min"]);
    var travel = firstValue(values, ["travel-set", "travel"]);
    var passes = firstValue(values, ["passes", "pass-min"]);
    var mode = firstValue(values, ["mode"]);
    var holder = firstValue(values, ["holder"]);
    var depth = firstValue(values, ["depth"]);
    var offset = firstValue(values, ["offset"]);
    var travelId = prefix ? prefix + "travel-set" : "travel-set";
    var passesId = prefix ? prefix + "passes" : "passes";
    var modeId = prefix ? prefix + "mode" : "mode";
    var holderId = prefix ? prefix + "holder" : "holder";
    var depthId = prefix ? prefix + "depth" : "depth";
    var offsetId = prefix ? prefix + "offset" : "offset";
    var forceId = prefix ? "cfg-force" : "force";
    var speedId = prefix ? "cfg-speed" : "speed";
    document.getElementById(forceId).value = force != null ? force : 20;
    document.getElementById(speedId).value = speed != null ? speed : 20;
    document.getElementById(travelId).value = travel != null ? travel : 20;
    document.getElementById(passesId).value = passes != null ? passes : 1;
    document.getElementById(depthId).value = depth != null ? depth : 0;
    document.getElementById(offsetId).value = offset != null ? offset : 0.35;
    setStayChecked(prefix ? "cfg-stay" : "stay", !(values.stay === false || values.stay === "0" || values.stay === 0));
    syncAngleFrom(offsetId, offsetId === "cfg-offset" ? "cfg-angle" : "angle");
    document.getElementById(modeId).value = mode === "pen" || mode === "fold" ? mode : "cut";
    document.getElementById(holderId).value = holder === "right" ? "right" : "left";
}

function loadColorConfig() {
    if (!document.getElementById("color-config").value && configs.length) {
        document.getElementById("color-config").value = configs[0].name;
    }
    var name = document.getElementById("color-config").value;
    var index = findConfig(name);
    if (index < 0) {
        setStatus("Erst eine Einstellung aus der Liste waehlen.");
        return;
    }
    fillColorFields(configs[index].values, "");
    if (selected >= 0 && colors[selected]) {
        fieldsDirty = true;
        readFields(true);
        saveLibrary();
    }
    fieldsDirty = false;
    logLine("load color " + name + " F" + document.getElementById("force").value + " S" + document.getElementById("speed").value);
}

function loadEditorConfig() {
    if (!selectedConfigName() && configs.length) {
        document.getElementById("config-list").value = configs[0].name;
    }
    var name = selectedConfigName();
    var index = findConfig(name);
    if (index < 0) {
        setStatus("Erst eine Einstellung aus der Liste waehlen.");
        return;
    }
    fillColorFields(configs[index].values, "cfg-");
    document.getElementById("config-name").value = name;
    logLine("load material " + name + " F" + document.getElementById("cfg-force").value + " S" + document.getElementById("cfg-speed").value + " x" + document.getElementById("cfg-passes").value + " D" + document.getElementById("cfg-depth").value);
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
        lines.push("  stay: " + yamlScalar(values.stay != null ? values.stay : "1"));
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
        else if (item.force_straight != null) values.force = item.force_straight;
        if (item.speed != null) values.speed = item.speed;
        else if (item.speed_straight != null) values.speed = item.speed_straight;
        if (item.travel_speed != null) values["travel-set"] = item.travel_speed;
        if (item.passes != null) values.passes = item.passes;
        if (item.cut_depth != null) values.depth = item.cut_depth;
        if (item.offset != null) values.offset = item.offset;
        if (item.mode === "pen" || item.mode === "fold" || item.mode === "cut") values.mode = item.mode;
        if (item.stay != null) values.stay = item.stay;
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
    renderConfigs(configs.length ? configs[0].name : "");
    if (configs.length) loadEditorConfig();
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
        mode: "cut",
        stay: true,
        forces: null
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
            if (typeof found[i].depth === "number") color.depth = found[i].depth;
            if (found[i].forces) color.forces = found[i].forces;
            if (found[i].stay === true || found[i].stay === false) color.stay = found[i].stay;
            if (typeof found[i].boost === "number") color.boost = found[i].boost;
        }
        colors.push(color);
    }
    if (selected >= colors.length) selected = colors.length - 1;
    return added;
}

function caption(color) {
    return qualifiedLayerName(color);
}

function readFields(forceWrite) {
    if (!forceWrite && !fieldsDirty) return;
    if (selected < 0 || !colors[selected]) return;
    var color = colors[selected];
    color.passes = numberValue("passes", color.passes);
    if (color.passes < 1) color.passes = 1;
    color.force = numberValue("force", color.force);
    color.speed = numberValue("speed", color.speed);
    color.forces = null;
    color.travel = numberValue("travel-set", color.travel);
    color.depth = numberValue("depth", color.depth);
    color.offset = offsetText("offset");
    color.mode = document.getElementById("mode").value;
    color.holder = document.getElementById("holder").value;
    color.stay = stayChecked("stay");
    fieldsDirty = false;
    logLine("fields F" + color.force + " S" + color.speed + " D" + color.depth);
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
    setStayChecked("stay", color.stay !== false);
    fieldsDirty = false;
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
    var body = "F" + force + " S" + speed + " T" + travel + " x" + passes
        + " O" + formatOffset(color.offset) + " D" + formatOffset(color.depth)
        + " Z" + (color.stay === false ? "0" : "1");
    if (color.mode === "pen") return side + " Stift " + body;
    if (color.mode === "fold") return side + " Falz " + body;
    return side + " " + body;
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
    var result = ["--force-card", "--pen-force", String(numberValue("pen", 20)), "--pen-speed", String(numberValue("pen-speed", 20))]
        .concat(force)
        .concat(speed)
        .concat(passes)
        .concat([
            "--travel", String(numberValue("travel", 20)),
            "--offset", offsetText("square-offset"),
            "--overcut", String(numberValue("overcut", 0)),
            "--steg", String(numberValue("steg", 0.5)),
            "--y-axis", yAxis,
            "--pen-holder", document.getElementById("pen-holder").value === "left" ? "left" : "right"
        ]);
    if (!document.getElementById("axis-titles").checked) result.push("--no-titles");
    return result;
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
    var marked = document.getElementById("marked").checked;
    var call = "collectJob(" + jsString(jobPath) + ",0.35,1," + (marked ? "true" : "false") + "," + jsString(COLORS_FILE) + ")";
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
        runPython(sendArgs, function (err) {
            setBusy(false);
            if (err) setStatus(err);
            else {
                rememberJob(jobPath, host, port, count);
                setStatus("Gesendet: " + count + " Pfade, " + skipped + " ausgelassen. " + host);
            }
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
        if (id === "stay" || id === "cfg-stay") {
            setStayChecked(id, data[id] === "1" || data[id] === true);
        } else if (id === "marked" || id === "axis-titles" || id === "connect-loops") {
            var box = document.getElementById(id);
            if (box) box.checked = data[id] === "1" || data[id] === true;
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
        marked: document.getElementById("marked").checked ? "1" : "0"
    };
    fs.writeFileSync(CONNECTION_FILE, JSON.stringify(data, null, 2));
    setStatus("Verbindung gespeichert.");
    closeSheet("settings-sheet");
}

function loadHistory() {
    var fs = nodeRequire("fs");
    try {
        if (!fs.existsSync(HISTORY_FILE)) {
            logLine("history missing " + HISTORY_FILE);
            return [];
        }
        var data = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8"));
        var jobs = Array.isArray(data) ? data : [];
        logLine("history loaded " + jobs.length);
        return jobs;
    } catch (eHist) {
        logLine("history load ERR " + (eHist && eHist.message ? eHist.message : eHist));
        return [];
    }
}

function saveHistory() {
    var fs = nodeRequire("fs");
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(plotJobs, null, 2));
}

function rememberJob(jobPath, host, port, count) {
    try {
        var fs = nodeRequire("fs");
        var job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
        if (!Array.isArray(plotJobs)) plotJobs = [];
        plotJobs.unshift({
            id: String(Date.now()),
            at: new Date().toISOString(),
            note: "",
            host: host,
            port: String(port),
            count: count,
            duration_s: jobSeconds({ job: job }),
            job: job
        });
        if (plotJobs.length > 40) plotJobs = plotJobs.slice(0, 40);
        saveHistory();
        renderHistory();
        logLine("history saved " + plotJobs[0].id + " paths " + count);
    } catch (eRemember) {
        logLine("history ERR " + eRemember.message);
    }
}

function historyWhen(at) {
    var date = new Date(at);
    if (isNaN(date.getTime())) return "";
    return pad(date.getDate()) + "." + pad(date.getMonth() + 1) + "." + date.getFullYear() + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function strokeLength(path) {
    var pts = path.points_mm || [];
    var total = 0;
    var i, dx, dy;
    for (i = 1; i < pts.length; i++) {
        dx = pts[i][0] - pts[i - 1][0];
        dy = pts[i][1] - pts[i - 1][1];
        total += Math.sqrt(dx * dx + dy * dy);
    }
    if (path.closed && pts.length > 1) {
        dx = pts[0][0] - pts[pts.length - 1][0];
        dy = pts[0][1] - pts[pts.length - 1][1];
        total += Math.sqrt(dx * dx + dy * dy);
    }
    return total;
}

function jobSeconds(entry) {
    var paths = entry.job && entry.job.paths ? entry.job.paths.slice() : [];
    var seconds = 0;
    var last = null;
    var i, path, passes, speed, travel, len, start, dx, dy;
    paths.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    for (i = 0; i < paths.length; i++) {
        path = paths[i];
        if (!path.points_mm || path.points_mm.length < 2) continue;
        len = strokeLength(path);
        passes = parseInt(path.passes, 10);
        if (isNaN(passes) || passes < 1) passes = 1;
        speed = parseFloat(path.cut_speed);
        if (speed > 0) seconds += (len * passes) / speed;
        start = path.points_mm[0];
        travel = parseFloat(path.travel_speed);
        if (last && travel > 0) {
            dx = start[0] - last[0];
            dy = start[1] - last[1];
            seconds += Math.sqrt(dx * dx + dy * dy) / travel;
        }
        last = path.closed ? path.points_mm[0] : path.points_mm[path.points_mm.length - 1];
    }
    return seconds > 0 ? seconds : null;
}

function historyDuration(entry) {
    var seconds = entry.duration_s != null ? entry.duration_s : jobSeconds(entry);
    var total, h, m, s;
    if (!(seconds > 0)) return "";
    total = Math.round(seconds);
    s = total % 60;
    m = Math.floor(total / 60) % 60;
    h = Math.floor(total / 3600);
    if (h > 0) return "ca. " + h + ":" + pad(m) + ":" + pad(s);
    if (total >= 60) return "ca. " + Math.floor(total / 60) + ":" + pad(s);
    return "ca. " + total + " s";
}

function renderHistory() {
    var list = document.getElementById("history");
    var i, item, entry;
    if (!Array.isArray(plotJobs)) plotJobs = [];
    var label = document.getElementById("history-label");
    if (label) label.textContent = "Verlauf (" + plotJobs.length + ")";
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!plotJobs.length) {
        item = document.createElement("li");
        item.textContent = "Noch kein Job gesendet.";
        list.appendChild(item);
        return;
    }
    for (i = 0; i < plotJobs.length; i++) {
        entry = plotJobs[i];
        item = document.createElement("li");
        item.textContent = historyWhen(entry.at) + "  " + (entry.count || 0) + " Pfade" + (historyDuration(entry) ? "  " + historyDuration(entry) : "") + (entry.note ? "  " + entry.note : "");
        item.setAttribute("data-id", entry.id);
        if (entry.id === historyOpen) item.className = "selected";
        item.addEventListener("click", openHistory);
        list.appendChild(item);
    }
}

function findHistory(id) {
    var i;
    for (i = 0; i < plotJobs.length; i++) if (plotJobs[i].id === id) return plotJobs[i];
    return null;
}

function jobText(entry) {
    var lines = ["Host " + entry.host + ":" + entry.port];
    if (historyDuration(entry)) lines.push("Dauer " + historyDuration(entry));
    lines.push("");
    var paths = entry.job && entry.job.paths ? entry.job.paths : [];
    var i, path;
    for (i = 0; i < paths.length; i++) {
        path = paths[i];
        lines.push((path.layer || path.mode || "Pfad") + "  " + (path.holder || "") + "  F" + (path.forces ? path.forces.join("/") : path.force) + "  S" + path.cut_speed + "  T" + path.travel_speed + "  x" + path.passes + (path.blade_offset_mm != null ? "  O" + path.blade_offset_mm : "") + (path.cut_depth != null ? "  D" + path.cut_depth : "") + (path.stay_down === false ? "  abheben" : "  zusammenhaengend") + (path.boost_speed ? "  Boost " + path.boost_speed : ""));
    }
    return lines.join("\n");
}

function openHistory(event) {
    var entry = findHistory(event.currentTarget.getAttribute("data-id"));
    if (!entry) return;
    historyOpen = entry.id;
    document.getElementById("history-title").textContent = historyWhen(entry.at) + (historyDuration(entry) ? "  " + historyDuration(entry) : "");
    document.getElementById("history-params").textContent = jobText(entry);
    document.getElementById("history-note").value = entry.note || "";
    openSheet("history-sheet");
    renderHistory();
    logLine("history open " + entry.id);
}

function applyHistoryTemplate() {
    var entry = findHistory(historyOpen);
    if (!entry || !entry.job || !entry.job.paths) return;
    var seen = {};
    var pending = 0;
    var i, path, key, rgb;
    for (i = 0; i < entry.job.paths.length; i++) {
        path = entry.job.paths[i];
        if (!path.rgb || !path.layer) continue;
        key = path.rgb.join(",");
        if (seen[key]) continue;
        seen[key] = true;
        rgb = path.rgb;
        pending++;
        evalHost("applyColorName(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + jsString(path.layer) + ")", function () {
            pending--;
            if (pending <= 0) refreshColors(function () {});
        });
    }
    var first = null;
    for (i = 0; i < entry.job.paths.length; i++) {
        if (entry.job.paths[i].mode !== "pen") { first = entry.job.paths[i]; break; }
    }
    if (!first) first = entry.job.paths[0];
    if (first) {
        document.getElementById("force").value = first.force;
        document.getElementById("speed").value = first.cut_speed;
        document.getElementById("travel-set").value = first.travel_speed;
        document.getElementById("passes").value = first.passes;
        if (first.cut_depth != null) document.getElementById("depth").value = first.cut_depth;
        if (first.blade_offset_mm != null) document.getElementById("offset").value = first.blade_offset_mm;
        setStayChecked("stay", first.stay_down !== false);
        if (first.holder) document.getElementById("holder").value = first.holder;
        fieldsDirty = true;
    }
    logLine("template " + historyOpen);
    setStatus("Job als Vorlage geladen.");
}

var simData = null;
var simSeg = 0;
var simPart = 0;
var simPlayTimer = 0;
var simPlayTarget = 0;
var simCommandStamp = "";
var simZoom = 1;
var simPanX = 0;
var simPanY = 0;
var simSpace = false;
var simPanning = false;
var simPanLast = null;

function refreshSimulate() {
    var jobPath = tempPath("plotter_preview_job.json");
    var previewPath = tempPath("plotter_preview.json");
    var marked = document.getElementById("marked").checked;
    readFields();
    saveLibrary();
    logLine("simulate refresh");
    evalHost("collectJob(" + jsString(jobPath) + ",0.35,1," + (marked ? "true" : "false") + "," + jsString(COLORS_FILE) + ",true)", function (msg) {
        if (msg.indexOf("ok ") !== 0) {
            document.getElementById("sim-tip").textContent = msg === "nodoc" ? "Kein Dokument offen." : msg;
            return;
        }
        try {
            var fs = nodeRequire("fs");
            runPython([PLOTTER_PY, jobPath, "--preview-out", previewPath], function (err) {
                if (err) {
                    document.getElementById("sim-tip").textContent = err;
                    return;
                }
                simData = JSON.parse(fs.readFileSync(previewPath, "utf8"));
                simStopPlay();
                simSeg = 0;
                simPart = 0;
                renderSimCommands(simData.sections);
                drawSimulate();
                var count = simData.strokes ? simData.strokes.length : 0;
                if (!count) document.getElementById("sim-tip").textContent = "Keine Linie im Dokument.";
                logLine("simulate strokes " + count);
            });
        } catch (eSim) {
            logLine("simulate ERR " + eSim.message);
        }
    });
}

function renderSimCommands(sections) {
    var root = document.getElementById("sim-commands");
    var i, k, n, section, part, block, summary, note, code, name, stamp, open;
    if (!root) return;
    stamp = JSON.stringify(sections || []);
    if (stamp === simCommandStamp && root.firstChild) return;
    open = {};
    var nodes = root.querySelectorAll("details");
    for (n = 0; n < nodes.length; n++) {
        if (!nodes[n].open) continue;
        name = nodes[n].querySelector("summary");
        if (name) open[name.textContent] = true;
    }
    simCommandStamp = stamp;
    while (root.firstChild) root.removeChild(root.firstChild);
    if (!sections) return;
    for (i = 0; i < sections.length; i++) {
        section = sections[i];
        block = document.createElement("details");
        summary = document.createElement("summary");
        summary.textContent = section.title || ("Part " + (i + 1));
        if (open[summary.textContent]) block.open = true;
        block.appendChild(summary);
        part = section.parts || [];
        for (k = 0; k < part.length; k++) {
            note = document.createElement("p");
            note.className = "sim-note";
            note.textContent = part[k].note || "";
            code = document.createElement("pre");
            code.className = "sim-cmd";
            code.textContent = part[k].commands || "";
            block.appendChild(note);
            block.appendChild(code);
        }
        root.appendChild(block);
    }
}

function simTravelOn() {
    var box = document.getElementById("sim-travel");
    return !box || box.checked;
}

function simSteps() {
    var all = simData && simData.segments ? simData.segments : [];
    var showTravel = simTravelOn();
    var steps = [];
    var i, seg, pts, open, last;
    open = false;
    last = null;
    for (i = 0; i < all.length; i++) {
        seg = all[i];
        pts = seg.points || [];
        if (!pts.length) continue;
        if (seg.kind === "travel") {
            if (open && last) steps.push({ kind: "up", points: [last] });
            open = false;
            if (showTravel && pts.length >= 2) steps.push({ kind: "travel", points: pts });
            continue;
        }
        if (!open) steps.push({ kind: "down", points: [pts[0]] });
        steps.push({ kind: seg.kind, points: pts, force: seg.force });
        open = true;
        last = pts[pts.length - 1];
    }
    if (open && last) steps.push({ kind: "up", points: [last] });
    return steps;
}

function simStepTitle(steps, index) {
    var step = steps[index];
    var nxt, after;
    if (!step) return "";
    if (step.kind === "down") return "Messer runter";
    if (step.kind === "up") return "Messer hoch";
    if (step.kind === "tick") return "1 mm schneiden";
    if (step.kind === "cut") return step.force ? ("Durchgang F" + step.force) : "Pfad schneiden";
    nxt = steps[index + 1];
    if (!nxt) return "Fahrt zurueck zum Start";
    if (nxt.kind === "down") {
        after = steps[index + 2];
        if (after && after.kind === "tick") return "Fahrt zum 1-mm-Ansatz";
        return "Fahrt zum Schnitt";
    }
    return "Fahrt";
}

function simSetTip(steps) {
    var el = document.getElementById("sim-tip");
    var title;
    if (!el) return;
    if (!steps.length) {
        el.textContent = "Keine Linie im Dokument.";
        return;
    }
    if (simSeg <= 0) {
        el.textContent = "Vor: " + simStepTitle(steps, 0);
        return;
    }
    title = simSeg + "/" + steps.length + " " + simStepTitle(steps, simSeg - 1);
    if (simSeg < steps.length) title += "   ·   Vor: " + simStepTitle(steps, simSeg);
    el.textContent = title;
}

function simBounds(segments) {
    var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, i, j, p;
    for (i = 0; i < segments.length; i++) {
        for (j = 0; j < segments[i].points.length; j++) {
            p = segments[i].points[j];
            if (p[0] < minX) minX = p[0];
            if (p[1] < minY) minY = p[1];
            if (p[0] > maxX) maxX = p[0];
            if (p[1] > maxY) maxY = p[1];
        }
    }
    if (maxX <= minX) maxX = minX + 1;
    if (maxY <= minY) maxY = minY + 1;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
}

function simProject(bounds, point, width, height) {
    var pad = 16;
    var sx = (width - pad * 2) / (bounds.maxX - bounds.minX);
    var sy = (height - pad * 2) / (bounds.maxY - bounds.minY);
    var fit = Math.min(sx, sy);
    var cx = width / 2;
    var cy = height / 2;
    var x = pad + (point[0] - bounds.minX) * fit;
    var y = height - pad - (point[1] - bounds.minY) * fit;
    return [
        cx + (x - cx) * simZoom + simPanX,
        cy + (y - cy) * simZoom + simPanY
    ];
}

function simResetView() {
    simZoom = 1;
    simPanX = 0;
    simPanY = 0;
    drawSimulate();
}

function simZoomAt(canvasX, canvasY, factor) {
    var canvas = document.getElementById("sim-canvas");
    var next = simZoom * factor;
    var cx, cy, baseX, baseY;
    if (next < 0.4) next = 0.4;
    if (next > 24) next = 24;
    cx = canvas.width / 2;
    cy = canvas.height / 2;
    baseX = cx + (canvasX - simPanX - cx) / simZoom;
    baseY = cy + (canvasY - simPanY - cy) / simZoom;
    simPanX = canvasX - cx - (baseX - cx) * next;
    simPanY = canvasY - cy - (baseY - cy) * next;
    simZoom = next;
}

function speedColor(speed, slow, fast) {
    var t = fast <= slow ? 0 : (speed - slow) / (fast - slow);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var r = Math.round(40 + t * 180);
    var g = Math.round(150 - t * 110);
    var b = Math.round(70 - t * 30);
    return "rgb(" + r + "," + g + "," + b + ")";
}

function drawSimulate() {
    var canvas = document.getElementById("sim-canvas");
    var steps = simSteps();
    if (!canvas || !simData) return;
    var ctx = canvas.getContext("2d");
    var width = canvas.width;
    var height = canvas.height;
    var bounds = simBounds(steps);
    var i;
    if (simSeg > steps.length) simSeg = steps.length;
    if (simSeg < 0) simSeg = 0;
    ctx.clearRect(0, 0, width, height);
    simSetTip(steps);
    if (!steps.length) return;
    for (i = 0; i < simSeg; i++) {
        drawSimStep(ctx, bounds, width, height, steps[i]);
    }
    if (simPart > 0 && simSeg < steps.length) {
        drawSimStep(ctx, bounds, width, height, steps[simSeg], simPart);
    }
    drawSimBlade(ctx, bounds, width, height, steps);
}

function simForceWidth(force) {
    var f = typeof force === "number" ? force : 13;
    var width = 1.2 + Math.max(0, f - 8) * 0.45;
    if (width > 8) width = 8;
    return width;
}

function drawSimStep(ctx, bounds, width, height, step, limit) {
    var pts = step.points;
    var j, at, first, count;
    var screen = [];
    if (!pts.length) return;
    count = pts.length;
    if (typeof limit === "number" && limit < count) count = limit;
    if (count < 1) return;
    if (step.kind === "down") {
        drawSimMark(ctx, simProject(bounds, pts[0], width, height), "down");
        return;
    }
    if (step.kind === "up") {
        drawSimMark(ctx, simProject(bounds, pts[0], width, height), "up");
        return;
    }
    ctx.save();
    ctx.lineWidth = step.kind === "travel" ? 1.4 : (step.kind === "tick" ? 2.4 : simForceWidth(step.force));
    if (step.kind === "travel") {
        ctx.strokeStyle = "#c8c8c8";
        ctx.setLineDash([5, 4]);
    } else if (step.kind === "tick") {
        ctx.strokeStyle = "#ff4d6d";
        ctx.setLineDash([]);
    } else {
        ctx.strokeStyle = "#e6b15a";
        ctx.setLineDash([]);
    }
    if (count > 1) {
        ctx.beginPath();
        for (j = 0; j < count; j++) {
            at = simProject(bounds, pts[j], width, height);
            screen.push(at);
            if (j === 0) ctx.moveTo(at[0], at[1]);
            else ctx.lineTo(at[0], at[1]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        drawSimArrows(ctx, screen, width, height);
    }
    ctx.restore();
    if (step.kind !== "travel") {
        first = simProject(bounds, pts[0], width, height);
        drawSimMark(ctx, first, "x");
    }
}

function simBladeOffset() {
    var value = simData && simData.blade_offset_mm;
    if (typeof value === "number" && value > 0) return value;
    return 0.35;
}

function simSegmentDir(points, fromStart) {
    var i, dx, dy, a, b;
    if (!points || points.length < 2) return null;
    if (fromStart) {
        for (i = 1; i < points.length; i++) {
            dx = points[i][0] - points[i - 1][0];
            dy = points[i][1] - points[i - 1][1];
            if (dx * dx + dy * dy > 1e-8) return [dx, dy];
        }
        return null;
    }
    for (i = points.length - 1; i > 0; i--) {
        a = points[i];
        b = points[i - 1];
        dx = a[0] - b[0];
        dy = a[1] - b[1];
        if (dx * dx + dy * dy > 1e-8) return [dx, dy];
    }
    return null;
}

function simKnifeTip(steps) {
    var step, nxt, i, dir, len, offset, center, partial;
    if (simPart > 1 && simSeg < steps.length) {
        partial = steps[simSeg];
        if (partial && (partial.kind === "cut" || partial.kind === "tick")) {
            step = { kind: partial.kind, points: partial.points.slice(0, simPart) };
        }
    }
    if (!step && simSeg <= 0) return null;
    if (!step) step = steps[simSeg - 1];
    if (!step || step.kind === "up" || step.kind === "travel") return null;
    if (step.kind === "down") {
        center = step.points[0];
        dir = null;
        for (i = simSeg; i < steps.length; i++) {
            nxt = steps[i];
            if (nxt.kind !== "tick" && nxt.kind !== "cut") continue;
            dir = simSegmentDir(nxt.points, true);
            break;
        }
    } else {
        center = step.points[step.points.length - 1];
        dir = simSegmentDir(step.points, false);
    }
    if (!center || !dir) return null;
    len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
    if (len < 1e-8) return null;
    offset = simBladeOffset();
    return {
        center: center,
        tip: [center[0] - dir[0] / len * offset, center[1] - dir[1] / len * offset],
        dir: dir
    };
}

function simCenterOn() {
    var box = document.getElementById("sim-center");
    return !box || box.checked;
}

function drawSimBlade(ctx, bounds, width, height, steps) {
    var pose = simKnifeTip(steps);
    var at, ahead, ang, hub;
    if (!pose) return;
    at = simProject(bounds, pose.tip, width, height);
    ahead = simProject(bounds, [pose.tip[0] + pose.dir[0], pose.tip[1] + pose.dir[1]], width, height);
    ang = Math.atan2(ahead[1] - at[1], ahead[0] - at[0]);
    if (simCenterOn()) {
        hub = simProject(bounds, pose.center, width, height);
        ctx.save();
        ctx.strokeStyle = "#9ad0ff";
        ctx.fillStyle = "#9ad0ff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(hub[0], hub[1]);
        ctx.lineTo(at[0], at[1]);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(hub[0], hub[1], 5.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.save();
    ctx.translate(at[0], at[1]);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(-10, 8);
    ctx.lineTo(-10, -8);
    ctx.closePath();
    ctx.fillStyle = "#ff8a00";
    ctx.fill();
    ctx.restore();
}

function simOnScreen(x, y, width, height) {
    return x >= -40 && y >= -40 && x <= width + 40 && y <= height + 40;
}

function drawSimArrow(ctx, x, y, ang) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, 4.5);
    ctx.lineTo(-6, -4.5);
    ctx.closePath();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#141414";
    ctx.stroke();
    ctx.restore();
}

function drawSimArrows(ctx, screen, width, height) {
    var spacing = 46;
    var total = 0;
    var j, dx, dy, len, walked, next, placed, t, x, y, ang, ax, ay, bx, by, guard;
    for (j = 1; j < screen.length; j++) {
        dx = screen[j][0] - screen[j - 1][0];
        dy = screen[j][1] - screen[j - 1][1];
        total += Math.sqrt(dx * dx + dy * dy);
    }
    if (total < 8) return;
    next = total < spacing ? total * 0.55 : spacing * 0.65;
    walked = 0;
    placed = 0;
    guard = 0;
    for (j = 1; j < screen.length; j++) {
        ax = screen[j - 1][0];
        ay = screen[j - 1][1];
        bx = screen[j][0];
        by = screen[j][1];
        dx = bx - ax;
        dy = by - ay;
        len = Math.sqrt(dx * dx + dy * dy);
        if (len < 0.01) continue;
        while (walked + len >= next - 0.01) {
            guard += 1;
            if (guard > 4000) return;
            t = (next - walked) / len;
            if (t < 0) t = 0;
            if (t > 1) t = 1;
            x = ax + dx * t;
            y = ay + dy * t;
            if (simOnScreen(x, y, width, height)) {
                ang = Math.atan2(dy, dx);
                drawSimArrow(ctx, x, y, ang);
                placed += 1;
                if (placed > 120) return;
            }
            next += spacing;
        }
        walked += len;
    }
}

function drawSimMark(ctx, at, kind) {
    ctx.save();
    ctx.lineWidth = 2.8;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (kind === "up" || kind === "down") {
        ctx.strokeStyle = kind === "up" ? "#8fd0ff" : "#ff4d6d";
        ctx.beginPath();
        if (kind === "up") {
            ctx.moveTo(at[0], at[1]);
            ctx.lineTo(at[0], at[1] - 32);
            ctx.moveTo(at[0] - 9, at[1] - 18);
            ctx.lineTo(at[0], at[1] - 32);
            ctx.lineTo(at[0] + 9, at[1] - 18);
        } else {
            ctx.moveTo(at[0], at[1] - 40);
            ctx.lineTo(at[0], at[1] - 12);
            ctx.moveTo(at[0] - 9, at[1] - 24);
            ctx.lineTo(at[0], at[1] - 12);
            ctx.lineTo(at[0] + 9, at[1] - 24);
        }
        ctx.stroke();
    }
    if (kind === "down" || kind === "x") {
        ctx.strokeStyle = "#ff4d6d";
        ctx.beginPath();
        ctx.moveTo(at[0] - 11, at[1] - 11);
        ctx.lineTo(at[0] + 11, at[1] + 11);
        ctx.moveTo(at[0] + 11, at[1] - 11);
        ctx.lineTo(at[0] - 11, at[1] + 11);
        ctx.stroke();
    }
    ctx.restore();
}

function simStopPlay() {
    if (simPlayTimer) clearTimeout(simPlayTimer);
    simPlayTimer = 0;
}

function simStep(dir) {
    var total = simSteps().length;
    if (!simData) return;
    simStopPlay();
    simPart = 0;
    simSeg += dir;
    if (simSeg < 0) simSeg = 0;
    if (simSeg > total) simSeg = total;
    drawSimulate();
}

function simRestart() {
    simStopPlay();
    simSeg = 0;
    simPart = 0;
    drawSimulate();
}

function simPlayPass() {
    var steps, i, target;
    if (!simData) return;
    simStopPlay();
    simPart = 0;
    steps = simSteps();
    target = simSeg;
    for (i = simSeg; i < steps.length; i++) {
        if (steps[i].kind === "cut") {
            target = i + 1;
            break;
        }
    }
    if (target <= simSeg) {
        for (i = simSeg; i < steps.length; i++) {
            if (steps[i].kind === "tick") {
                target = i + 1;
                break;
            }
        }
    }
    if (target <= simSeg) return;
    simPlayTarget = target;
    simPassTick();
}

function simPassTick() {
    var steps, step, n, jump;
    steps = simSteps();
    if (simSeg >= simPlayTarget) {
        simPart = 0;
        simStopPlay();
        drawSimulate();
        return;
    }
    step = steps[simSeg];
    if (step && (step.kind === "cut" || step.kind === "tick")) {
        n = step.points.length;
        jump = Math.max(1, Math.ceil(n / 16));
        simPart += jump;
        if (simPart >= n) {
            simSeg += 1;
            simPart = 0;
        }
    } else {
        simSeg += 1;
        simPart = 0;
    }
    drawSimulate();
    if (simSeg >= simPlayTarget && simPart === 0) {
        simStopPlay();
        return;
    }
    simPlayTimer = setTimeout(simPassTick, 28);
}

document.getElementById("squares").addEventListener("click", function () {
    openSheet("square-sheet");
    renderConfigs();
});
document.getElementById("square-close").addEventListener("click", function () {
    closeSheet("square-sheet");
});
document.getElementById("square-draw").addEventListener("click", startSquares);
document.getElementById("settings").addEventListener("click", function () {
    openSheet("settings-sheet");
    renderConfigs();
    if (selectedConfigName()) loadEditorConfig();
    else copyEditor(false);
    logLine("settings materials " + configs.length + " options " + document.getElementById("config-list").options.length);
});
document.getElementById("settings-close").addEventListener("click", function () {
    closeSheet("settings-sheet");
});
document.getElementById("connection-save").addEventListener("click", saveConnection);
document.getElementById("angle").addEventListener("change", function () { applyAngle("angle", "offset"); });
document.getElementById("cfg-angle").addEventListener("change", function () { applyAngle("cfg-angle", "cfg-offset"); });
document.getElementById("offset").addEventListener("change", function () { syncAngleFrom("offset", "angle"); });
document.getElementById("cfg-offset").addEventListener("change", function () { syncAngleFrom("cfg-offset", "cfg-angle"); });
document.getElementById("square-angle").addEventListener("change", function () { applyAngle("square-angle", "square-offset"); });
document.getElementById("square-offset").addEventListener("change", function () { syncAngleFrom("square-offset", "square-angle"); });
var splitPreviewTimer = null;

function openTool(which, title) {
    var previous = document.getElementById("tool-sheet").getAttribute("data-tool");
    var groups = ["tool-cutover", "tool-inward", "tool-overlap", "tool-split"];
    var i;
    if (previous === "tool-split" && which !== "tool-split") dropSplitPreview();
    for (i = 0; i < groups.length; i++) {
        document.getElementById(groups[i]).className = groups[i] === which ? "tool-fields" : "tool-fields hidden";
    }
    document.getElementById("tool-title").textContent = title;
    document.getElementById("tool-sheet").setAttribute("data-tool", which);
    openSheet("tool-sheet");
    logLine("tool " + which);
    if (which === "tool-split") scheduleSplitPreview();
}

function scheduleSplitPreview() {
    var deg = Math.round(numberValue("split-detail", 20));
    document.getElementById("split-detail-value").textContent = String(deg);
    if (splitPreviewTimer) clearTimeout(splitPreviewTimer);
    splitPreviewTimer = setTimeout(function () {
        evalHost("previewSplit(" + deg + ")", function (msg) {
            if (msg === "nodoc") setStatus("Kein Dokument offen.");
            else if (msg === "nosel") setStatus("Erst eine Form selektieren.");
            else if (msg.indexOf("ok") === 0) setStatus("Vorschau: " + msg);
            else setStatus(msg);
        });
    }, 80);
}

function dropSplitPreview() {
    if (splitPreviewTimer) clearTimeout(splitPreviewTimer);
    splitPreviewTimer = null;
    evalHost("clearSplitPreview()", function () {});
}

function runCutOver() {
    var mm = numberValue("cutover", 0);
    var loop = document.getElementById("connect-loops").checked ? numberValue("loop-size", 2) : 0;
    logLine("cutover click " + mm + " loop " + loop);
    evalHost("addCutOver(" + mm + "," + loop + ",0)", function (msg) {
        if (msg === "nodoc") setStatus("Kein Dokument offen.");
        else if (msg === "nosel") setStatus("Erst eine Form selektieren.");
        else if (msg === "none") setStatus("Keine Aussenecke gefunden.");
        else if (msg.indexOf("ok") === 0) setStatus("Cut over: " + msg.split(" ")[1] + " Pfade.");
        else setStatus(msg);
        refreshColors(function () {});
    });
}

function runOverlap() {
    var mm = numberValue("overlap", 0);
    evalHost("addOverlap(" + mm + ")", function (msg) {
        if (msg === "nodoc") setStatus("Kein Dokument offen.");
        else if (msg === "nosel") setStatus("Zwei Pfade selektieren.");
        else if (msg === "none") setStatus("Keine Beruehrung gefunden.");
        else if (msg.indexOf("ok") === 0) setStatus("Overlap: " + msg.split(" ")[1] + " Pfade.");
        else setStatus(msg);
        refreshColors(function () {});
    });
}

function runSplitInward() {
    evalHost("splitInward()", function (msg) {
        if (msg === "nodoc") setStatus("Kein Dokument offen.");
        else if (msg === "nosel") setStatus("Erst eine Form selektieren.");
        else if (msg === "none") setStatus("Keine Innen-Spitze gefunden.");
        else if (msg.indexOf("ok") === 0) setStatus("Innen-Spitzen: " + msg.split(" ")[1] + " Pfade.");
        else setStatus(msg);
        refreshColors(function () {});
    });
}

function runSplitForm() {
    var deg = Math.round(numberValue("split-detail", 20));
    logLine("split click " + deg);
    if (splitPreviewTimer) clearTimeout(splitPreviewTimer);
    evalHost("splitForm(" + deg + ")", function (msg) {
        if (msg === "nodoc") setStatus("Kein Dokument offen.");
        else if (msg === "nosel") setStatus("Erst eine Form selektieren.");
        else if (msg.indexOf("ok") === 0) setStatus("Geteilt: " + msg);
        else setStatus(msg);
        refreshColors(function () {});
    });
}

document.getElementById("add-cutover").addEventListener("click", function () { openTool("tool-cutover", "Cut over"); });
document.getElementById("split-inward").addEventListener("click", function () { openTool("tool-inward", "Split inward"); });
document.getElementById("add-overlap").addEventListener("click", function () { openTool("tool-overlap", "Overlap"); });
document.getElementById("split-form").addEventListener("click", function () { openTool("tool-split", "Detailgrad"); });
document.getElementById("split-detail").addEventListener("input", function () {
    if (document.getElementById("tool-sheet").getAttribute("data-tool") === "tool-split") scheduleSplitPreview();
});
document.getElementById("tool-close").addEventListener("click", function () {
    if (document.getElementById("tool-sheet").getAttribute("data-tool") === "tool-split") dropSplitPreview();
    closeSheet("tool-sheet");
});
document.getElementById("tool-ok").addEventListener("click", function () {
    var which = document.getElementById("tool-sheet").getAttribute("data-tool");
    if (which === "tool-cutover" && numberValue("cutover", 0) <= 0) {
        setStatus("Cut over in mm angeben.");
        return;
    }
    if (which === "tool-overlap" && numberValue("overlap", 0) <= 0) {
        setStatus("Overlap in mm angeben.");
        return;
    }
    closeSheet("tool-sheet");
    if (which === "tool-cutover") runCutOver();
    else if (which === "tool-inward") runSplitInward();
    else if (which === "tool-overlap") runOverlap();
    else if (which === "tool-split") runSplitForm();
});
document.getElementById("color-load").addEventListener("click", loadColorConfig);
document.getElementById("plot").addEventListener("click", plot);
function applySelectedColor(done) {
    var color, name;
    readFields(true);
    saveLibrary();
    renderList();
    if (selected < 0 || !colors[selected]) {
        if (done) done("Keine Strichfarbe gewaehlt.");
        return;
    }
    color = colors[selected];
    name = qualifiedLayerName(color);
    evalHost(
        "applyColorName(" + color.rgb[0] + "," + color.rgb[1] + "," + color.rgb[2] + "," + jsString(name) + ")",
        function (msg) {
            logLine("uebernehmen '" + name + "' -> " + msg);
            refreshColors(function () {});
            if (done) done(msg);
        }
    );
}

document.getElementById("apply").addEventListener("click", function () {
    applySelectedColor(function (msg) {
        if (msg === "nodoc") setStatus("Kein Dokument offen.");
        else if (msg === "ok 0") setStatus("Keine Pfade mit dieser Strichfarbe.");
        else if (msg === "Keine Strichfarbe gewaehlt.") setStatus(msg);
        else if (msg.indexOf("ok") !== 0) setStatus(msg);
    });
});
document.getElementById("reread").addEventListener("click", function () {
    if (busy) return;
    readFields();
    refreshColors(function (added, err) {
        if (err === "nodoc") setStatus("Kein Dokument offen.");
        else if (err) setStatus(err);
    });
});

["holder", "passes", "force", "speed", "travel-set", "depth", "offset"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", markDirty);
});
document.getElementById("stay").addEventListener("click", function () {
    setStayChecked("stay", !stayChecked("stay"));
    markDirty();
    applySelectedColor(function (msg) {
        if (msg === "nodoc") setStatus("Kein Dokument offen.");
        else if (msg && msg.indexOf("ok") === 0) setStatus(stayChecked("stay") ? "Zusammenhaengend: Ja" : "Zusammenhaengend: Nein");
    });
});
document.getElementById("cfg-stay").addEventListener("click", function () {
    setStayChecked("cfg-stay", !stayChecked("cfg-stay"));
});
document.getElementById("holder").addEventListener("change", markDirty);
document.getElementById("history-close").addEventListener("click", function () { closeSheet("history-sheet"); });
document.getElementById("history-note").addEventListener("input", function () {
    var entry = findHistory(historyOpen);
    if (!entry) return;
    entry.note = document.getElementById("history-note").value;
    saveHistory();
    renderHistory();
});
document.getElementById("history-delete").addEventListener("click", function () {
    plotJobs = plotJobs.filter(function (entry) { return entry.id !== historyOpen; });
    saveHistory();
    historyOpen = "";
    closeSheet("history-sheet");
    renderHistory();
    logLine("history delete");
});
document.getElementById("history-template").addEventListener("click", applyHistoryTemplate);
document.getElementById("simulate").addEventListener("click", function () {
    openSheet("simulate-sheet");
    refreshSimulate();
});
document.getElementById("simulate-close").addEventListener("click", function () {
    simStopPlay();
    closeSheet("simulate-sheet");
});
document.getElementById("sim-back").addEventListener("click", function () { simStep(-1); });
document.getElementById("sim-forward").addEventListener("click", function () { simStep(1); });
document.getElementById("sim-pass").addEventListener("click", simPlayPass);
document.getElementById("sim-restart").addEventListener("click", simRestart);
document.getElementById("sim-travel").addEventListener("change", function () {
    simStopPlay();
    simPart = 0;
    simSeg = 0;
    drawSimulate();
});
document.getElementById("sim-center").addEventListener("change", drawSimulate);
document.getElementById("sim-zoom-reset").addEventListener("click", simResetView);
(function () {
    var canvas = document.getElementById("sim-canvas");
    canvas.addEventListener("wheel", function (event) {
        var rect = canvas.getBoundingClientRect();
        var x, y;
        if (!rect.width || !rect.height) return;
        event.preventDefault();
        x = (event.clientX - rect.left) * (canvas.width / rect.width);
        y = (event.clientY - rect.top) * (canvas.height / rect.height);
        simZoomAt(x, y, event.deltaY < 0 ? 1.12 : 1 / 1.12);
        drawSimulate();
    }, { passive: false });
    canvas.addEventListener("mousedown", function (event) {
        if (!simSpace || event.button !== 0) return;
        simPanning = true;
        simPanLast = { x: event.clientX, y: event.clientY };
        canvas.style.cursor = "grabbing";
        event.preventDefault();
    });
    document.addEventListener("mousemove", function (event) {
        var rect, dx, dy;
        if (!simPanning || !simPanLast) return;
        rect = canvas.getBoundingClientRect();
        dx = (event.clientX - simPanLast.x) * (canvas.width / rect.width);
        dy = (event.clientY - simPanLast.y) * (canvas.height / rect.height);
        simPanX += dx;
        simPanY += dy;
        simPanLast = { x: event.clientX, y: event.clientY };
        drawSimulate();
    });
    document.addEventListener("mouseup", function () {
        simPanning = false;
        simPanLast = null;
        canvas.style.cursor = simSpace ? "grab" : "";
    });
    document.addEventListener("keydown", function (event) {
        var tag, sheet;
        if (event.code !== "Space") return;
        tag = document.activeElement && document.activeElement.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        sheet = document.getElementById("simulate-sheet");
        if (!sheet || sheet.className.indexOf("open") < 0) return;
        simSpace = true;
        if (!simPanning) canvas.style.cursor = "grab";
        event.preventDefault();
    });
    document.addEventListener("keyup", function (event) {
        if (event.code !== "Space") return;
        simSpace = false;
        if (!simPanning) canvas.style.cursor = "";
    });
})();
if (!nodeRequire) {
    setStatus("Das Panel braucht den Illustrator-Erweiterungsmodus.");
} else {
    library = loadLibrary();
    configs = loadConfigs();
    loadConnection();
    plotJobs = loadHistory();
    renderHistory();
    renderPassForces("");
    renderPassForces("cfg-");
    renderConfigs(configs.length ? configs[0].name : "");
    if (configs.length) loadEditorConfig();
    logLine("panel ready materials " + configs.length + " shown " + document.getElementById("color-config").options.length + " " + (selectedConfigName() || "none") + " history " + plotJobs.length);
    if (!configs.length) setStatus("Keine Materialien in configurations.json.");
    setTimeout(function () { renderConfigs(configs.length ? configs[0].name : ""); }, 300);
    var root = "";
    try { root = cs.getSystemPath("extension"); } catch (ePath) { root = ""; }
    if (root) {
        evalHost("$.evalFile(" + jsString(root + "/jsx/host.jsx") + ")", function () {
            renderConfigs(document.getElementById("color-config").value || (configs.length ? configs[0].name : ""));
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
