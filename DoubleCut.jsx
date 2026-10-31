/*
  Double Cut — Illustrator panel for drag-knife plotters.

  Turns a closed outline into one open path that travels the shape
  several times without a knife lift. The originals are moved into
  the same group, under "original".

  Install: copy this file into the Illustrator Presets Scripts folder,
  restart Illustrator, then choose File > Scripts > DoubleCut.
  Or run it once with File > Scripts > Other Script.
*/

#target illustrator
#targetengine "doublecut"

(function () {
  if ($.global.__doubleCutWin) {
    try { $.global.__doubleCutWin.onClose = null; } catch (e0) {}
    try { $.global.__doubleCutWin.close(); } catch (e1) {}
    $.global.__doubleCutWin = null;
  }

  var w = new Window("palette", "Double Cut");
  w.orientation = "column";
  w.alignChildren = ["fill", "top"];
  w.margins = 14;
  w.spacing = 8;
  w.preferredSize.width = 280;

  var help = w.add("statictext", undefined, "Closed outlines become one path that goes around the shape without lifting the knife.", {multiline: true});
  help.preferredSize = [250, 36];

  var turnsCtl = stepper(w, "Turns", 2, 1, 30);
  var extraCtl = stepper(w, "Extra segments", 1, 0, 200);

  var extraNote = w.add("statictext", undefined, "Extra segments stay on the outline, past the start. On a rectangle, 1 segment is one side.", {multiline: true});
  extraNote.preferredSize = [250, 32];

  var startCb = w.add("checkbox", undefined, "Start at the selected anchor");
  startCb.value = true;
  var reverseCb = w.add("checkbox", undefined, "Reverse direction");
  reverseCb.value = false;
  var groupCb = w.add("checkbox", undefined, "Put originals in the double-cut group");
  groupCb.value = true;
  var hideCb = w.add("checkbox", undefined, "Hide originals");
  hideCb.value = true;

  var status = w.add("statictext", undefined, "Select closed outlines, then click Make.", {multiline: true});
  status.preferredSize = [250, 48];

  var go = w.add("button", undefined, "Make double cut");
  go.alignment = ["fill", "center"];
  go.preferredSize.height = 28;

  go.onClick = function () {
    go.enabled = false;
    try { minusFocus(); } catch (eFocus) {}
    status.text = "Working...";
    // The panel keeps focus, so Illustrator reports no active document
    // if the cut runs here. Hand the job to the main engine instead.
    var bt = new BridgeTalk();
    bt.target = "illustrator";
    try {
      bt.body = "(function () {\n" + workerSource() +
        "\nreturn makeDoubleCut(" + optsLiteral({
          turns: turnsCtl.get(),
          extra: extraCtl.get(),
          useSelectedAnchor: startCb.value,
          reverse: reverseCb.value,
          groupOriginals: groupCb.value,
          hideOriginals: hideCb.value
        }) + ");\n})()";
    } catch (eBuild) {
      go.enabled = true;
      status.text = "Could not build the cut.";
      alert("Double Cut failed:\n" + eBuild.message);
      return;
    }
    bt.onResult = function (res) {
      go.enabled = true;
      status.text = unquote(res.body);
    };
    bt.onError = function (err) {
      go.enabled = true;
      status.text = "Could not build the cut.";
      alert("Double Cut failed:\n" + unquote(err.body));
    };
    if (!bt.send()) {
      go.enabled = true;
      status.text = "Could not build the cut.";
      alert("Double Cut could not reach the open document.");
    }
  };

  w.onClose = function () {
    $.global.__doubleCutWin = null;
  };

  $.global.__doubleCutWin = w;
  w.show();

  function stepper(parent, label, value, min, max) {
    var row = parent.add("group");
    row.orientation = "row";
    row.alignChildren = ["left", "center"];
    row.alignment = ["fill", "center"];
    var lab = row.add("statictext", undefined, label);
    lab.preferredSize.width = 120;
    var field = row.add("edittext", undefined, String(value));
    field.characters = 4;
    field.preferredSize.width = 48;
    var minus = row.add("button", undefined, "-");
    var plus = row.add("button", undefined, "+");
    minus.preferredSize = [26, 22];
    plus.preferredSize = [26, 22];
    minus.maximumSize = [26, 22];
    plus.maximumSize = [26, 22];

    var stored = value;
    function clamp(n) {
      n = parseInt(n, 10);
      if (isNaN(n)) n = stored;
      if (n < min) n = min;
      if (n > max) n = max;
      return n;
    }
    function write(n) {
      stored = clamp(n);
      field.text = String(stored);
    }

    field.onChanging = function () { stored = clamp(field.text); };
    field.onChange = function () { write(field.text); };
    minus.onClick = function () { write(stored - 1); };
    plus.onClick = function () { write(stored + 1); };
    return {
      get: function () {
        write(field.text);
        return stored;
      }
    };
  }

  function minusFocus() {
    startCb.active = true;
  }
})();

var __doubleCutScriptFile = $.fileName;

/*__WORKER_START__*/
function frontDocument() {
  if (!app.documents || app.documents.length === 0) {
    throw new Error("Open a document first.");
  }
  try {
    return app.activeDocument;
  } catch (e) {
    return app.documents[0];
  }
}

function makeDoubleCut(opts) {
  var doc = frontDocument();
  if (!doc.selection || doc.selection.length === 0) {
    throw new Error("Select one or more closed outlines.");
  }

  var selected = [];
  var i;
  for (i = 0; i < doc.selection.length; i++) selected.push(doc.selection[i]);
  selected = topLevelItems(selected);

  var jobs = [];
  var skippedOpen = 0;
  for (i = 0; i < selected.length; i++) {
    skippedOpen += collectJobs(selected[i], jobs);
  }
  if (jobs.length === 0) {
    throw new Error("No closed outlines in the selection. Open curves are skipped, because a second lap would have to flip the knife.");
  }

  var host = owningLayer(selected[0]);
  if (host.locked) {
    throw new Error("The layer '" + host.name + "' is locked.");
  }

  var wrap = null;
  var cutGroup = null;
  var originalGroup = null;
  if (opts.groupOriginals) {
    wrap = host.groupItems.add();
    wrap.name = "double cut x" + opts.turns;
    originalGroup = wrap.groupItems.add();
    originalGroup.name = "original";
    cutGroup = wrap.groupItems.add();
    cutGroup.name = "cut";
  }

  var parent = cutGroup || host;
  var made = [];
  for (i = 0; i < jobs.length; i++) {
    made.push(buildCutPath(parent, jobs[i], opts));
  }

  if (opts.groupOriginals) {
    for (i = 0; i < selected.length; i++) {
      if (isMovable(selected[i])) {
        selected[i].move(originalGroup, ElementPlacement.PLACEATEND);
      }
    }
    if (opts.hideOriginals) originalGroup.hidden = true;
  } else if (opts.hideOriginals) {
    for (i = 0; i < selected.length; i++) {
      try { selected[i].hidden = true; } catch (e) {}
    }
  }

  doc.selection = null;
  if (cutGroup) cutGroup.selected = true;
  else {
    for (i = 0; i < made.length; i++) made[i].selected = true;
  }
  app.redraw();

  var msg = made.length + " outline" + (made.length === 1 ? "" : "s") + " x " + opts.turns + " turns.";
  if (opts.groupOriginals) msg += " Originals are inside the group" + (opts.hideOriginals ? ", hidden." : ".");
  if (skippedOpen) msg += " Skipped " + skippedOpen + " open path" + (skippedOpen === 1 ? "" : "s") + ".";
  return msg;
}

function collectJobs(item, jobs) {
  var skipped = 0;
  if (!item || item.locked || item.hidden) return 0;
  if (item.typename === "PathItem") {
    if (item.guides) return 0;
    if (!item.closed || item.pathPoints.length < 2) return 1;
    jobs.push({
      points: readPoints(item),
      color: readColor(item),
      width: item.stroked ? item.strokeWidth : 1
    });
    return 0;
  }
  if (item.typename === "CompoundPathItem") {
    for (var c = 0; c < item.pathItems.length; c++) skipped += collectJobs(item.pathItems[c], jobs);
    return skipped;
  }
  if (item.typename === "GroupItem") {
    for (var g = 0; g < item.pageItems.length; g++) skipped += collectJobs(item.pageItems[g], jobs);
    return skipped;
  }
  return 0;
}

function readPoints(path) {
  var data = [];
  var pts = path.pathPoints;
  for (var i = 0; i < pts.length; i++) {
    var pt = pts[i];
    data.push({
      a: [pt.anchor[0], pt.anchor[1]],
      l: [pt.leftDirection[0], pt.leftDirection[1]],
      r: [pt.rightDirection[0], pt.rightDirection[1]],
      t: pt.pointType,
      selected: pt.selected === PathPointSelection.ANCHORPOINT
    });
  }
  return data;
}

function readColor(path) {
  if (!path.stroked || !path.strokeColor) return null;
  var c = path.strokeColor;
  if (c.typename === "RGBColor") return {t: "RGB", r: c.red, g: c.green, b: c.blue};
  if (c.typename === "CMYKColor") return {t: "CMYK", c: c.cyan, m: c.magenta, y: c.yellow, k: c.black};
  if (c.typename === "GrayColor") return {t: "Gray", g: c.gray};
  if (c.typename === "SpotColor") return {t: "Spot", spot: c.spot, tint: c.tint};
  return null;
}

function applyColor(path, col) {
  var gray;
  if (!col) {
    gray = new GrayColor();
    gray.gray = 100;
    path.strokeColor = gray;
    return;
  }
  if (col.t === "RGB") {
    var rgb = new RGBColor();
    rgb.red = col.r;
    rgb.green = col.g;
    rgb.blue = col.b;
    path.strokeColor = rgb;
  } else if (col.t === "CMYK") {
    var cmyk = new CMYKColor();
    cmyk.cyan = col.c;
    cmyk.magenta = col.m;
    cmyk.yellow = col.y;
    cmyk.black = col.k;
    path.strokeColor = cmyk;
  } else if (col.t === "Gray") {
    gray = new GrayColor();
    gray.gray = col.g;
    path.strokeColor = gray;
  } else if (col.t === "Spot") {
    var spot = new SpotColor();
    spot.spot = col.spot;
    spot.tint = col.tint;
    path.strokeColor = spot;
  }
}

function buildCutPath(parent, job, opts) {
  var data = job.points;
  if (opts.reverse) data = reversed(data);
  var start = 0;
  if (opts.useSelectedAnchor) start = singleAnchorIndex(data);

  var seq = sequenceIndexes(data.length, start, opts.turns, opts.extra);
  var path = parent.pathItems.add();
  path.closed = false;
  path.stroked = true;
  path.filled = false;
  path.strokeWidth = job.width > 0 ? job.width : 1;
  applyColor(path, job.color);
  path.name = "cut x" + opts.turns;

  var i;
  for (i = 0; i < seq.length; i++) {
    var np = path.pathPoints.add();
    var anchor = data[seq[i]].a;
    np.anchor = [anchor[0], anchor[1]];
  }
  for (i = 0; i < seq.length; i++) {
    var pp = path.pathPoints[i];
    var src = data[seq[i]];
    pp.pointType = src.t;
    pp.leftDirection = [src.l[0], src.l[1]];
    pp.rightDirection = [src.r[0], src.r[1]];
  }
  path.closed = false;
  return path;
}

function sequenceIndexes(n, start, turns, extra) {
  var seq = [];
  var lap, i, e;
  for (lap = 0; lap < turns; lap++) {
    for (i = 0; i < n; i++) seq.push((start + i) % n);
  }
  seq.push(start % n);
  for (e = 1; e <= extra; e++) seq.push((start + e) % n);
  return seq;
}

function singleAnchorIndex(data) {
  var found = 0;
  var count = 0;
  for (var i = 0; i < data.length; i++) {
    if (data[i].selected) {
      count++;
      found = i;
    }
  }
  return count === 1 ? found : 0;
}

function reversed(data) {
  var out = [];
  for (var i = data.length - 1; i >= 0; i--) {
    out.push({
      a: data[i].a,
      l: data[i].r,
      r: data[i].l,
      t: data[i].t,
      selected: data[i].selected
    });
  }
  return out;
}

function owningLayer(item) {
  var p = item;
  while (p && p.typename !== "Layer") p = p.parent;
  return p || frontDocument().activeLayer;
}

function isMovable(item) {
  if (!item || item.locked || item.typename === "Layer") return false;
  if (item.typename === "PathItem" && item.guides) return false;
  return true;
}

function topLevelItems(items) {
  var out = [];
  var i, j;
  for (i = 0; i < items.length; i++) {
    var nested = false;
    for (j = 0; j < items.length; j++) {
      if (i !== j && isAncestor(items[j], items[i])) nested = true;
    }
    if (!nested) out.push(items[i]);
  }
  return out;
}

function isAncestor(parent, item) {
  var p = item.parent;
  while (p) {
    if (p === parent) return true;
    p = p.parent;
  }
  return false;
}
/*__WORKER_END__*/

function workerSource() {
  var f = new File(__doubleCutScriptFile);
  f.encoding = "UTF-8";
  if (!f.exists || !f.open("r")) {
    throw new Error("Double Cut could not read its script file.");
  }
  var text = f.read();
  f.close();
  var startMark = "/*__WORKER_" + "START__*/";
  var endMark = "/*__WORKER_" + "END__*/";
  var start = text.indexOf(startMark);
  var end = start < 0 ? -1 : text.indexOf(endMark, start + startMark.length);
  if (start < 0 || end < 0) {
    throw new Error("Double Cut could not read its script file.");
  }
  return text.substring(start + startMark.length, end);
}

function optsLiteral(o) {
  return "({turns:" + o.turns +
    ",extra:" + o.extra +
    ",useSelectedAnchor:" + (o.useSelectedAnchor ? "true" : "false") +
    ",reverse:" + (o.reverse ? "true" : "false") +
    ",groupOriginals:" + (o.groupOriginals ? "true" : "false") +
    ",hideOriginals:" + (o.hideOriginals ? "true" : "false") + "})";
}

function unquote(value) {
  var msg = String(value === undefined || value === null ? "" : value);
  if (msg.charAt(0) === "\"" && msg.charAt(msg.length - 1) === "\"") {
    msg = msg.substring(1, msg.length - 1);
  }
  return msg;
}
