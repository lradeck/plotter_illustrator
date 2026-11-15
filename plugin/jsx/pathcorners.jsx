var WELD_PT = 2;

function planCut(specs, extendPt, inward, loopPt, gapPt) {
    var strokes = [];
    var removeMap = {};
    var i, out, s, chain, grew, shares;
    if (!specs) return { strokes: strokes, remove: [] };
    for (i = 0; i < specs.length; i++) {
        if (!specs[i] || !specs[i].closed || !specs[i].verts || specs[i].verts.length < 2) continue;
        out = cutVerts(specs[i].verts, true, extendPt, inward, loopPt, gapPt);
        for (s = 0; s < out.length; s++) strokes.push({ source: i, verts: out[s] });
        if (out.length) removeMap[i] = true;
    }
    var chains = weldChains(specs);
    for (i = 0; i < chains.length; i++) {
        chain = chains[i];
        chain.strokes = cutVerts(chain.verts, chain.closed, extendPt, inward, loopPt, gapPt);
        if (chain.strokes.length) markSources(removeMap, chain.sources);
    }
    grew = true;
    while (grew) {
        grew = false;
        for (i = 0; i < chains.length; i++) {
            chain = chains[i];
            if (chain.strokes.length || chain.kept) continue;
            shares = sharesSource(chain.sources, removeMap);
            if (!shares) continue;
            chain.kept = true;
            if (chain.verts.length >= 2) strokes.push({ source: chain.sources[0], verts: chain.verts });
            markSources(removeMap, chain.sources);
            grew = true;
        }
    }
    for (i = 0; i < chains.length; i++) {
        chain = chains[i];
        for (s = 0; s < chain.strokes.length; s++) {
            strokes.push({ source: chain.sources[0], verts: chain.strokes[s] });
        }
    }
    return { strokes: strokes, remove: mapKeys(removeMap) };
}

function markSources(map, sources) {
    var i;
    for (i = 0; i < sources.length; i++) map[sources[i]] = true;
}

function sharesSource(sources, map) {
    var i;
    for (i = 0; i < sources.length; i++) if (map[sources[i]]) return true;
    return false;
}

function mapKeys(map) {
    var keys = [];
    var key;
    for (key in map) {
        if (map.hasOwnProperty(key) && map[key]) keys.push(Number(key));
    }
    return keys;
}

function cutVerts(verts, closed, extendPt, inward, loopPt, gapPt) {
    var n = verts.length;
    if (n < 2) return [];
    var area = closed ? ringArea(verts) : 0;
    if (closed && Math.abs(area) < 0.001) area = 1;
    var i;
    var concave = 0;
    for (i = 0; i < n; i++) {
        verts[i].role = cornerRole(verts, i, closed, area, inward);
        if (verts[i].role === "concave") concave++;
    }
    if (inward && !concave) return [];
    var breaks = [];
    for (i = 0; i < n; i++) {
        if (verts[i].role === "convex" && (extendPt > 0 || inward)) breaks.push(i);
        else if (verts[i].role === "concave" && inward) breaks.push(i);
    }
    if (!breaks.length) return [];
    var runs = closed ? closedRuns(verts, breaks) : openRuns(verts, breaks);
    var out = [];
    var built;
    var halves;
    var h;
    for (i = 0; i < runs.length; i++) {
        built = finishRun(runs[i], extendPt, inward);
        if (!built || built.length < 2) continue;
        if (inward && built[0].role === "concave" && built[built.length - 1].role === "concave") {
            halves = halvesFromTips(built);
            for (h = 0; h < halves.length; h++) out.push(halves[h]);
        } else out.push(built);
    }
    if (loopPt > 0 && !inward && out.length > 1) {
        var joined = joinCutOvers(out, closed, loopPt, gapPt);
        if (joined && joined.length > 2) return [joined];
    }
    return out;
}

function joinCutOvers(runs, closed, radius, gap) {
    var joined = [];
    var i, run, prevRun, nextRun, k;
    var count = runs.length;
    var links = closed ? count : count - 1;
    for (i = 0; i < count; i++) {
        run = runs[i];
        if (i < links) {
            nextRun = runs[(i + 1) % count];
            linkLoop(run[run.length - 2], run[run.length - 1], nextRun[0], nextRun[1], radius);
        }
        for (k = 0; k < run.length; k++) joined.push(run[k]);
    }
    if (closed && joined.length > 2) {
        joined.closedPath = true;
        joined.loopIndexes = [];
        for (i = 0; i < joined.length; i++) {
            if (joined[i].role === "loop") joined.loopIndexes.push(i);
        }
    } else if (joined.length > 2) {
        joined.loopIndexes = [];
        for (i = 0; i < joined.length; i++) {
            if (joined[i].role === "loop") joined.loopIndexes.push(i);
        }
    }
    if (gap > 0 && joined.length > 2) clearLoops(joined, joined.closedPath === true, gap);
    return joined;
}

function linkLoop(before, endVert, startVert, after, radius) {
    var leave = unitOf(before.anchor, endVert.anchor);
    var enter = unitOf(startVert.anchor, after.anchor);
    var len = radius > 0.2 ? radius : 8;
    if (!leave || !enter) return;
    endVert.left = [endVert.anchor[0] - leave[0] * len, endVert.anchor[1] - leave[1] * len];
    endVert.right = [endVert.anchor[0] + leave[0] * len, endVert.anchor[1] + leave[1] * len];
    endVert.corner = false;
    endVert.role = "loop";
    startVert.left = [startVert.anchor[0] - enter[0] * len, startVert.anchor[1] - enter[1] * len];
    startVert.right = [startVert.anchor[0] + enter[0] * len, startVert.anchor[1] + enter[1] * len];
    startVert.corner = false;
    startVert.role = "loop";
}

function unitOf(from, to) {
    var dx = to[0] - from[0];
    var dy = to[1] - from[1];
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.01) return null;
    return [dx / len, dy / len];
}

function ringArea(verts) {
    var sum = 0;
    var i, a, b, n = verts.length;
    for (i = 0; i < n; i++) {
        a = verts[i].anchor;
        b = verts[(i + 1) % n].anchor;
        sum += a[0] * b[1] - b[0] * a[1];
    }
    return sum / 2;
}

function cornerRole(verts, index, closed, area, inward) {
    var n = verts.length;
    if (!closed && (index === 0 || index === n - 1)) {
        if (verts[index].joint) return inward ? "concave" : "convex";
        return "flat";
    }
    var prev = verts[(index - 1 + n) % n];
    var here = verts[index];
    var next = verts[(index + 1) % n];
    var into = arrivalDir(prev, here);
    var out = departDir(here, next);
    var lenIn = Math.sqrt(into[0] * into[0] + into[1] * into[1]);
    var lenOut = Math.sqrt(out[0] * out[0] + out[1] * out[1]);
    if (lenIn < 0.2 || lenOut < 0.2) return "flat";
    var cos = (into[0] * out[0] + into[1] * out[1]) / (lenIn * lenOut);
    if (cos > 0.978) return "flat";
    if (!closed) return inward ? "concave" : "convex";
    var cross = into[0] * out[1] - into[1] * out[0];
    return cross * area >= 0 ? "convex" : "concave";
}

function cloneVert(v) {
    return {
        anchor: [v.anchor[0], v.anchor[1]],
        left: [v.left[0], v.left[1]],
        right: [v.right[0], v.right[1]],
        corner: v.corner,
        role: v.role,
        joint: v.joint === true
    };
}

function closedRuns(verts, breaks) {
    var runs = [];
    var k, start, end, pts, i, guard, n;
    n = verts.length;
    for (k = 0; k < breaks.length; k++) {
        start = breaks[k];
        end = breaks[(k + 1) % breaks.length];
        pts = [cloneVert(verts[start])];
        i = start;
        guard = 0;
        while (guard < n + 1) {
            i = (i + 1) % n;
            pts.push(cloneVert(verts[i]));
            guard++;
            if (i === end) break;
        }
        runs.push(pts);
    }
    return runs;
}

function openRuns(verts, breaks) {
    var stops = [];
    var k;
    if (breaks[0] !== 0) stops.push(0);
    for (k = 0; k < breaks.length; k++) stops.push(breaks[k]);
    if (stops[stops.length - 1] !== verts.length - 1) stops.push(verts.length - 1);
    var runs = [];
    var pts, i;
    for (k = 0; k < stops.length - 1; k++) {
        pts = [];
        for (i = stops[k]; i <= stops[k + 1]; i++) pts.push(cloneVert(verts[i]));
        runs.push(pts);
    }
    return runs;
}

function finishRun(pts, extendPt, inward) {
    var corner;
    if (!pts || pts.length < 2) return null;
    if (inward && pts[pts.length - 1].role === "concave" && pts[0].role !== "concave") reverseRun(pts);
    if (extendPt > 0) {
        if (pts[0].role === "convex") {
            pts.unshift(extendBack(pts[0], pts[1], extendPt));
            corner = pts[1];
            corner.left = [corner.anchor[0], corner.anchor[1]];
            corner.corner = true;
        }
        if (pts[pts.length - 1].role === "convex") {
            pts.push(extendForward(pts[pts.length - 2], pts[pts.length - 1], extendPt));
            corner = pts[pts.length - 2];
            corner.right = [corner.anchor[0], corner.anchor[1]];
            corner.corner = true;
        }
    }
    return pts;
}

function halvesFromTips(pts) {
    var total = 0;
    var i;
    var parts;
    for (i = 0; i < pts.length - 1; i++) total += segmentLen(pts[i], pts[i + 1]);
    parts = splitRun(pts, total * 0.5);
    if (!parts) return [pts];
    reverseRun(parts[1]);
    return parts;
}

function segmentLen(a, b) {
    var dx = b.anchor[0] - a.anchor[0];
    var dy = b.anchor[1] - a.anchor[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function splitRun(pts, dist) {
    var i, seg, acc, t, part, first, second, k;
    acc = 0;
    for (i = 0; i < pts.length - 1; i++) {
        seg = segmentLen(pts[i], pts[i + 1]);
        if (seg < 0.01) continue;
        if (acc + seg < dist && i < pts.length - 2) {
            acc += seg;
            continue;
        }
        t = (dist - acc) / seg;
        if (t < 0.05) t = 0.05;
        if (t > 0.95) t = 0.95;
        part = splitSegment(pts[i], pts[i + 1], t);
        first = [];
        second = [];
        for (k = 0; k < i; k++) first.push(cloneVert(pts[k]));
        first.push(part.a);
        first.push(part.end);
        second.push(part.start);
        second.push(part.b);
        for (k = i + 2; k < pts.length; k++) second.push(cloneVert(pts[k]));
        return [first, second];
    }
    return null;
}

function splitSegment(a, b, t) {
    var p0 = a.anchor;
    var p1 = a.right;
    var p2 = b.left;
    var p3 = b.anchor;
    var q0 = lerp(p0, p1, t);
    var q1 = lerp(p1, p2, t);
    var q2 = lerp(p2, p3, t);
    var r0 = lerp(q0, q1, t);
    var r1 = lerp(q1, q2, t);
    var s = lerp(r0, r1, t);
    var left = cloneVert(a);
    var right = cloneVert(b);
    left.right = q0;
    right.left = q2;
    return {
        a: left,
        b: right,
        end: { anchor: s, left: r0, right: [s[0], s[1]], corner: true, role: "flat", joint: false },
        start: { anchor: s, left: [s[0], s[1]], right: r1, corner: true, role: "flat", joint: false }
    };
}

function lerp(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function reverseRun(pts) {
    var i, v, tmp;
    pts.reverse();
    for (i = 0; i < pts.length; i++) {
        v = pts[i];
        tmp = v.left;
        v.left = v.right;
        v.right = tmp;
    }
}

function departDir(here, next) {
    var d = [here.right[0] - here.anchor[0], here.right[1] - here.anchor[1]];
    if (d[0] * d[0] + d[1] * d[1] < 0.01) d = [next.left[0] - here.anchor[0], next.left[1] - here.anchor[1]];
    if (d[0] * d[0] + d[1] * d[1] < 0.01) d = [next.anchor[0] - here.anchor[0], next.anchor[1] - here.anchor[1]];
    return d;
}

function arrivalDir(prev, here) {
    var d = [here.anchor[0] - here.left[0], here.anchor[1] - here.left[1]];
    if (d[0] * d[0] + d[1] * d[1] < 0.01) d = [here.anchor[0] - prev.right[0], here.anchor[1] - prev.right[1]];
    if (d[0] * d[0] + d[1] * d[1] < 0.01) d = [here.anchor[0] - prev.anchor[0], here.anchor[1] - prev.anchor[1]];
    return d;
}

function extendBack(corner, next, dist) {
    var dir = departDir(corner, next);
    return pointBeyond(corner.anchor, [-dir[0], -dir[1]], dist);
}

function extendForward(prev, corner, dist) {
    return pointBeyond(corner.anchor, arrivalDir(prev, corner), dist);
}

function pointBeyond(anchor, dir, dist) {
    var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
    var scale = len < 0.01 ? 0 : dist / len;
    var at = [anchor[0] + dir[0] * scale, anchor[1] + dir[1] * scale];
    return { anchor: at, left: at, right: at, corner: true, role: "ext", joint: false };
}

function weldChains(specs) {
    var raw = [];
    var i, k, verts;
    for (i = 0; i < specs.length; i++) {
        if (!specs[i] || specs[i].closed || !specs[i].verts || specs[i].verts.length < 2) continue;
        verts = specs[i].verts;
        for (k = 0; k < verts.length - 1; k++) raw.push(edgeFrom(verts[k], verts[k + 1], i));
    }
    raw = splitEdges(raw);
    var built = clusterEdges(raw);
    return walkChains(built.edges, built.clusters);
}

function edgeFrom(v0, v1, source) {
    return {
        ax: v0.anchor[0], ay: v0.anchor[1],
        bx: v1.anchor[0], by: v1.anchor[1],
        hax: v0.right[0], hay: v0.right[1],
        hbx: v1.left[0], hby: v1.left[1],
        cornerA: v0.corner !== false,
        cornerB: v1.corner !== false,
        source: source,
        sources: [source]
    };
}

function splitEdges(raw) {
    var splits = [];
    var i, j, cross, out, ts, prev, p, q, piece;
    for (i = 0; i < raw.length; i++) splits.push([]);
    for (i = 0; i < raw.length; i++) {
        for (j = i + 1; j < raw.length; j++) {
            if (!isStraight(raw[i]) || !isStraight(raw[j])) continue;
            cross = properCross(raw[i], raw[j]);
            if (cross && awayFromEnds(raw[i], cross.t) && awayFromEnds(raw[j], cross.u)) {
                splits[i].push(cross.t);
                splits[j].push(cross.u);
            }
            endpointOn(raw[i], raw[j].ax, raw[j].ay, splits[i]);
            endpointOn(raw[i], raw[j].bx, raw[j].by, splits[i]);
            endpointOn(raw[j], raw[i].ax, raw[i].ay, splits[j]);
            endpointOn(raw[j], raw[i].bx, raw[i].by, splits[j]);
        }
    }
    out = [];
    for (i = 0; i < raw.length; i++) {
        ts = uniqueTs(splits[i]);
        if (!ts.length || !isStraight(raw[i])) {
            out.push(raw[i]);
            continue;
        }
        prev = 0;
        ts.push(1);
        for (j = 0; j < ts.length; j++) {
            p = pointAt(raw[i], prev);
            q = pointAt(raw[i], ts[j]);
            piece = {
                ax: p[0], ay: p[1], bx: q[0], by: q[1],
                hax: p[0], hay: p[1], hbx: q[0], hby: q[1],
                cornerA: true, cornerB: true,
                source: raw[i].source,
                sources: copySources(raw[i].sources)
            };
            if (span2(piece) > 0.04) out.push(piece);
            prev = ts[j];
        }
    }
    return out;
}

function isStraight(e) {
    return near2(e.hax, e.hay, e.ax, e.ay) && near2(e.hbx, e.hby, e.bx, e.by);
}

function near2(x, y, px, py) {
    var dx = x - px;
    var dy = y - py;
    return dx * dx + dy * dy < 0.56;
}

function span2(e) {
    var dx = e.bx - e.ax;
    var dy = e.by - e.ay;
    return dx * dx + dy * dy;
}

function awayFromEnds(e, t) {
    var len = Math.sqrt(span2(e));
    return t * len > WELD_PT && (1 - t) * len > WELD_PT;
}

function properCross(a, b) {
    var dax = a.bx - a.ax;
    var day = a.by - a.ay;
    var dbx = b.bx - b.ax;
    var dby = b.by - b.ay;
    var den = dax * dby - day * dbx;
    if (Math.abs(den) < 1e-8) return null;
    var dx = b.ax - a.ax;
    var dy = b.ay - a.ay;
    var t = (dx * dby - dy * dbx) / den;
    var u = (dx * day - dy * dax) / den;
    if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
    return { t: t, u: u };
}

function endpointOn(edge, x, y, into) {
    var dx = edge.bx - edge.ax;
    var dy = edge.by - edge.ay;
    var len2 = dx * dx + dy * dy;
    var t, qx, qy, ex, ey, len;
    if (len2 < 1e-6) return;
    t = ((x - edge.ax) * dx + (y - edge.ay) * dy) / len2;
    qx = edge.ax + t * dx;
    qy = edge.ay + t * dy;
    ex = x - qx;
    ey = y - qy;
    if (ex * ex + ey * ey > WELD_PT * WELD_PT) return;
    len = Math.sqrt(len2);
    if (t * len <= WELD_PT || (1 - t) * len <= WELD_PT) return;
    into.push(t);
}

function uniqueTs(list) {
    var sorted = [];
    var i, out;
    for (i = 0; i < list.length; i++) sorted.push(list[i]);
    sorted.sort(function (a, b) { return a - b; });
    out = [];
    for (i = 0; i < sorted.length; i++) {
        if (sorted[i] <= 0.001 || sorted[i] >= 0.999) continue;
        if (!out.length || sorted[i] - out[out.length - 1] > 0.002) out.push(sorted[i]);
    }
    return out;
}

function pointAt(e, t) {
    return [e.ax + (e.bx - e.ax) * t, e.ay + (e.by - e.ay) * t];
}

function copySources(sources) {
    var out = [];
    var i;
    for (i = 0; i < sources.length; i++) out.push(sources[i]);
    return out;
}

function clusterEdges(raw) {
    var pts = [];
    var parent = [];
    var i, a, b, dx, dy, clusters, idOf, root, map, edges, seen, key, at;
    for (i = 0; i < raw.length; i++) {
        pts.push({ x: raw[i].ax, y: raw[i].ay });
        pts.push({ x: raw[i].bx, y: raw[i].by });
        parent.push(parent.length);
        parent.push(parent.length);
    }
    function find(n) {
        while (parent[n] !== n) {
            parent[n] = parent[parent[n]];
            n = parent[n];
        }
        return n;
    }
    function unite(p, q) {
        var rp = find(p);
        var rq = find(q);
        if (rp !== rq) parent[rq] = rp;
    }
    for (a = 0; a < pts.length; a++) {
        for (b = a + 1; b < pts.length; b++) {
            dx = pts[a].x - pts[b].x;
            dy = pts[a].y - pts[b].y;
            if (dx * dx + dy * dy <= WELD_PT * WELD_PT) unite(a, b);
        }
    }
    clusters = [];
    idOf = [];
    map = {};
    for (i = 0; i < pts.length; i++) {
        root = find(i);
        if (map[root] === undefined) {
            map[root] = clusters.length;
            clusters.push({ x: 0, y: 0, n: 0 });
        }
        idOf[i] = map[root];
        clusters[map[root]].x += pts[i].x;
        clusters[map[root]].y += pts[i].y;
        clusters[map[root]].n += 1;
    }
    for (i = 0; i < clusters.length; i++) {
        clusters[i].x /= clusters[i].n;
        clusters[i].y /= clusters[i].n;
    }
    edges = [];
    seen = {};
    for (i = 0; i < raw.length; i++) {
        raw[i].ca = idOf[i * 2];
        raw[i].cb = idOf[i * 2 + 1];
        if (raw[i].ca === raw[i].cb) continue;
        key = raw[i].ca < raw[i].cb ? raw[i].ca + ":" + raw[i].cb : raw[i].cb + ":" + raw[i].ca;
        if (seen[key] === undefined) {
            seen[key] = edges.length;
            edges.push(raw[i]);
        } else {
            at = seen[key];
            addSources(edges[at].sources, raw[i].sources);
        }
    }
    return { edges: edges, clusters: clusters };
}

function addSources(into, extra) {
    var i, k, known;
    for (i = 0; i < extra.length; i++) {
        known = false;
        for (k = 0; k < into.length; k++) if (into[k] === extra[i]) known = true;
        if (!known) into.push(extra[i]);
    }
}

function walkChains(edges, clusters) {
    var adj = [];
    var used = [];
    var chains = [];
    var i, ei, start;
    for (i = 0; i < clusters.length; i++) adj.push([]);
    for (ei = 0; ei < edges.length; ei++) {
        adj[edges[ei].ca].push(ei);
        adj[edges[ei].cb].push(ei);
        used.push(false);
    }
    function edgeVec(edgeIndex, fromCluster) {
        var e = edges[edgeIndex];
        var other = e.ca === fromCluster ? e.cb : e.ca;
        return [clusters[other].x - clusters[fromCluster].x, clusters[other].y - clusters[fromCluster].y];
    }
    function continueAt(cluster, incoming) {
        var links = adj[cluster];
        var others = [];
        var n, from, travel, tlen, best, bestCos, leave, llen, cos;
        for (n = 0; n < links.length; n++) if (links[n] !== incoming) others.push(links[n]);
        if (!others.length) return null;
        if (links.length === 2) return others[0];
        from = edges[incoming].ca === cluster ? edges[incoming].cb : edges[incoming].ca;
        travel = edgeVec(incoming, from);
        tlen = Math.sqrt(travel[0] * travel[0] + travel[1] * travel[1]);
        if (tlen < 1e-6) return null;
        best = null;
        bestCos = 0.978;
        for (n = 0; n < others.length; n++) {
            leave = edgeVec(others[n], cluster);
            llen = Math.sqrt(leave[0] * leave[0] + leave[1] * leave[1]);
            if (llen < 1e-6) continue;
            cos = (travel[0] * leave[0] + travel[1] * leave[1]) / (tlen * llen);
            if (cos > bestCos) {
                bestCos = cos;
                best = others[n];
            }
        }
        return best;
    }
    function freeEnd(edgeIndex) {
        var e = edges[edgeIndex];
        if (continueAt(e.ca, edgeIndex) === null) return e.ca;
        if (continueAt(e.cb, edgeIndex) === null) return e.cb;
        return null;
    }
    function walkFrom(startEi, startFrom) {
        var seq = [];
        var edgeIndex = startEi;
        var from = startFrom;
        var guard = 0;
        var closed = false;
        var e, to, next, jointStart, jointEnd;
        while (guard < edges.length + 2) {
            guard++;
            if (used[edgeIndex]) break;
            e = edges[edgeIndex];
            to = e.ca === from ? e.cb : e.ca;
            used[edgeIndex] = true;
            seq.push({ ei: edgeIndex, from: from, to: to });
            next = continueAt(to, edgeIndex);
            if (next === null) break;
            if (next === startEi && to === startFrom) {
                closed = true;
                break;
            }
            if (used[next]) break;
            from = to;
            edgeIndex = next;
        }
        jointStart = false;
        jointEnd = false;
        if (!closed && seq.length) {
            jointStart = adj[seq[0].from].length >= 3;
            jointEnd = adj[seq[seq.length - 1].to].length >= 3;
        }
        return {
            seq: seq,
            closed: closed,
            jointStart: jointStart,
            jointEnd: jointEnd,
            verts: chainVerts(seq, closed, jointStart, jointEnd),
            sources: chainSources(seq)
        };
    }
    function chainSources(seq) {
        var src = [];
        var n, m, e;
        for (n = 0; n < seq.length; n++) {
            e = edges[seq[n].ei];
            for (m = 0; m < e.sources.length; m++) addSources(src, [e.sources[m]]);
        }
        return src;
    }
    function makeVert(clusterId, leftOff, rightOff, corner, joint) {
        var c = clusters[clusterId];
        return {
            anchor: [c.x, c.y],
            left: [c.x + leftOff[0], c.y + leftOff[1]],
            right: [c.x + rightOff[0], c.y + rightOff[1]],
            corner: corner !== false,
            role: "flat",
            joint: joint === true
        };
    }
    function chainVerts(seq, closed, jointStart, jointEnd) {
        var verts = [];
        var n, e, from, forward, dep, arr, prev;
        for (n = 0; n < seq.length; n++) {
            e = edges[seq[n].ei];
            from = seq[n].from;
            forward = e.ca === from;
            dep = forward ? [e.hax - e.ax, e.hay - e.ay] : [e.hbx - e.bx, e.hby - e.by];
            arr = forward ? [e.hbx - e.bx, e.hby - e.by] : [e.hax - e.ax, e.hay - e.ay];
            seq[n].dep = dep;
            seq[n].arr = arr;
            seq[n].cornerFrom = forward ? e.cornerA : e.cornerB;
            seq[n].cornerTo = forward ? e.cornerB : e.cornerA;
        }
        if (closed) {
            for (n = 0; n < seq.length; n++) {
                prev = seq[(n - 1 + seq.length) % seq.length];
                verts.push(makeVert(seq[n].from, prev.arr, seq[n].dep, seq[n].cornerFrom, false));
            }
            return verts;
        }
        for (n = 0; n < seq.length; n++) {
            prev = n === 0 ? [0, 0] : seq[n - 1].arr;
            verts.push(makeVert(seq[n].from, prev, seq[n].dep, seq[n].cornerFrom, n === 0 && jointStart));
        }
        e = seq[seq.length - 1];
        verts.push(makeVert(e.to, e.arr, [0, 0], e.cornerTo, jointEnd));
        return verts;
    }
    for (ei = 0; ei < edges.length; ei++) {
        if (used[ei]) continue;
        start = freeEnd(ei);
        if (start === null) continue;
        chains.push(walkFrom(ei, start));
    }
    for (ei = 0; ei < edges.length; ei++) {
        if (used[ei]) continue;
        chains.push(walkFrom(ei, edges[ei].ca));
    }
    return chains;
}

function planOverlap(specs, overlapPt) {
    var strokes = [];
    var remove = [];
    if (!specs || !(overlapPt > 0)) return { strokes: strokes, remove: remove };
    var ends = [];
    var i, verts;
    for (i = 0; i < specs.length; i++) {
        if (!specs[i] || specs[i].closed || !specs[i].verts || specs[i].verts.length < 2) continue;
        verts = specs[i].verts;
        ends.push({ path: i, start: true, at: verts[0].anchor });
        ends.push({ path: i, start: false, at: verts[verts.length - 1].anchor });
    }
    var used = {};
    var pairs = [];
    var e, f, best, bestD, keyE, keyF;
    for (e = 0; e < ends.length; e++) {
        keyE = ends[e].path + ":" + (ends[e].start ? "s" : "e");
        if (used[keyE]) continue;
        best = -1;
        bestD = WELD_PT * WELD_PT;
        for (f = 0; f < ends.length; f++) {
            if (ends[f].path === ends[e].path) continue;
            keyF = ends[f].path + ":" + (ends[f].start ? "s" : "e");
            if (used[keyF]) continue;
            var gap = ptDist2(ends[e].at, ends[f].at);
            if (gap <= bestD) {
                bestD = gap;
                best = f;
            }
        }
        if (best < 0) continue;
        keyF = ends[best].path + ":" + (ends[best].start ? "s" : "e");
        used[keyE] = true;
        used[keyF] = true;
        pairs.push([ends[e], ends[best]]);
    }
    if (!pairs.length) return { strokes: strokes, remove: remove };
    var extra = [];
    for (i = 0; i < specs.length; i++) extra.push({ start: null, end: null });
    var pair, piece;
    for (i = 0; i < pairs.length; i++) {
        pair = pairs[i];
        piece = shiftOnto(takeInto(specs[pair[1].path].verts, pair[1].start, overlapPt), pair[0].at);
        if (pair[0].start) extra[pair[0].path].start = piece;
        else extra[pair[0].path].end = piece;
        piece = shiftOnto(takeInto(specs[pair[0].path].verts, pair[0].start, overlapPt), pair[1].at);
        if (pair[1].start) extra[pair[1].path].start = piece;
        else extra[pair[1].path].end = piece;
    }
    var built;
    for (i = 0; i < specs.length; i++) {
        if (!extra[i] || (!usablePiece(extra[i].start) && !usablePiece(extra[i].end))) continue;
        built = cloneAll(specs[i].verts);
        if (usablePiece(extra[i].start)) built = attachPiece(built, true, extra[i].start);
        if (usablePiece(extra[i].end)) built = attachPiece(built, false, extra[i].end);
        strokes.push({ source: i, verts: built });
        remove.push(i);
    }
    return { strokes: strokes, remove: remove };
}

function usablePiece(piece) {
    return piece && piece.length >= 2;
}

function takeInto(verts, fromStart, dist) {
    var oriented = cloneAll(verts);
    if (!fromStart) reverseRun(oriented);
    return clipForward(oriented, dist);
}

function clipForward(pts, dist) {
    var out = [cloneVert(pts[0])];
    var remain = dist;
    var i, seg, t, part;
    if (!pts || pts.length < 2 || !(dist > 0.01)) return out;
    for (i = 0; i < pts.length - 1; i++) {
        seg = curveLen(pts[i], pts[i + 1]);
        if (seg < 0.01) continue;
        if (remain >= seg - 0.01) {
            out.push(cloneVert(pts[i + 1]));
            remain -= seg;
            if (remain <= 0.01) return out;
            continue;
        }
        t = tForLen(pts[i], pts[i + 1], remain);
        if (t <= 0.001) return out;
        if (t >= 0.999) {
            out.push(cloneVert(pts[i + 1]));
            return out;
        }
        part = splitSegment(pts[i], pts[i + 1], t);
        out[out.length - 1].right = part.a.right;
        out.push(part.end);
        return out;
    }
    return out;
}

function curveLen(a, b) {
    return lengthUntil(a, b, 1);
}

function lengthUntil(a, b, t) {
    var p0 = a.anchor;
    var p1 = a.right;
    var p2 = b.left;
    var p3 = b.anchor;
    var steps = 16;
    var len = 0;
    var prev = p0;
    var i, u, pt, dx, dy;
    for (i = 1; i <= steps; i++) {
        u = t * i / steps;
        pt = bezPoint(p0, p1, p2, p3, u);
        dx = pt[0] - prev[0];
        dy = pt[1] - prev[1];
        len += Math.sqrt(dx * dx + dy * dy);
        prev = pt;
    }
    return len;
}

function tForLen(a, b, target) {
    var lo = 0;
    var hi = 1;
    var mid = 0.5;
    var i;
    for (i = 0; i < 18; i++) {
        mid = (lo + hi) / 2;
        if (lengthUntil(a, b, mid) < target) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

function bezPoint(p0, p1, p2, p3, t) {
    var u = 1 - t;
    var uu = u * u;
    var tt = t * t;
    return [
        uu * u * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + tt * t * p3[0],
        uu * u * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + tt * t * p3[1]
    ];
}

function attachPiece(verts, atStart, piece) {
    var copy = cloneAll(verts);
    var rev, merged, k;
    if (!atStart) {
        copy[copy.length - 1].right = [piece[0].right[0], piece[0].right[1]];
        copy[copy.length - 1].corner = true;
        for (k = 1; k < piece.length; k++) copy.push(cloneVert(piece[k]));
        return copy;
    }
    rev = cloneAll(piece);
    reverseRun(rev);
    copy[0].left = [rev[rev.length - 1].left[0], rev[rev.length - 1].left[1]];
    copy[0].corner = true;
    merged = [];
    for (k = 0; k < rev.length - 1; k++) merged.push(rev[k]);
    for (k = 0; k < copy.length; k++) merged.push(copy[k]);
    return merged;
}

function shiftOnto(pts, anchor) {
    var dx = anchor[0] - pts[0].anchor[0];
    var dy = anchor[1] - pts[0].anchor[1];
    var i, v;
    if (dx * dx + dy * dy < 1e-8) return pts;
    for (i = 0; i < pts.length; i++) {
        v = pts[i];
        v.anchor = [v.anchor[0] + dx, v.anchor[1] + dy];
        v.left = [v.left[0] + dx, v.left[1] + dy];
        v.right = [v.right[0] + dx, v.right[1] + dy];
    }
    return pts;
}

function cloneAll(verts) {
    var out = [];
    var i;
    for (i = 0; i < verts.length; i++) out.push(cloneVert(verts[i]));
    return out;
}

function ptDist2(a, b) {
    var dx = a[0] - b[0];
    var dy = a[1] - b[1];
    return dx * dx + dy * dy;
}

function isConnectorLoop(a, b) {
    var drx = a.right[0] - a.anchor[0];
    var dry = a.right[1] - a.anchor[1];
    var dlx = b.left[0] - b.anchor[0];
    var dly = b.left[1] - b.anchor[1];
    var abx = b.anchor[0] - a.anchor[0];
    var aby = b.anchor[1] - a.anchor[1];
    var lenR = Math.sqrt(drx * drx + dry * dry);
    var lenL = Math.sqrt(dlx * dlx + dly * dly);
    if (lenR < 0.8 || lenL < 0.8) return false;
    return drx * abx + dry * aby < 0 && dlx * -abx + dly * -aby < 0;
}

function clearLoops(verts, closed, gap, preset) {
    var indexes = [];
    var marked = {};
    var n, count, i, j, lines, fit, key;
    if (!verts || verts.length < 3 || !(gap > 0)) return indexes;
    n = verts.length;
    count = closed ? n : n - 1;
    if (preset) {
        for (key in preset) {
            if (preset.hasOwnProperty(key) && preset[key]) marked[key] = true;
        }
    }
    for (i = 0; i < count; i++) {
        j = (i + 1) % n;
        if (verts[i].role === "loop" && verts[j].role === "loop") marked[i] = true;
        if (isConnectorLoop(verts[i], verts[j])) marked[i] = true;
    }
    for (i = 0; i < count; i++) {
        if (!marked[i]) continue;
        j = (i + 1) % n;
        lines = loopObstacles(verts, closed, i, marked);
        fit = placeLoop(verts[(i - 1 + n) % n], verts[i], verts[j], verts[(j + 1) % n], lines, gap);
        if (!fit) continue;
        verts[i].anchor = fit.a;
        verts[i].left = [fit.a[0], fit.a[1]];
        verts[i].right = fit.right;
        verts[i].role = "loop";
        verts[i].corner = false;
        verts[j].anchor = fit.b;
        verts[j].right = [fit.b[0], fit.b[1]];
        verts[j].left = fit.left;
        verts[j].role = "loop";
        verts[j].corner = false;
        indexes.push(i);
    }
    return indexes;
}

function loopObstacles(verts, closed, loopAt, marked) {
    var n = verts.length;
    var count = closed ? n : n - 1;
    var skip = {};
    var lines = [];
    var i, j;
    skip[loopAt] = true;
    skip[(loopAt - 1 + n) % n] = true;
    skip[(loopAt + 1) % n] = true;
    for (i = 0; i < count; i++) {
        if (skip[i] || (marked && marked[i])) continue;
        j = (i + 1) % n;
        pushCurveLines(lines, verts[i], verts[j], 6);
    }
    return lines;
}

function pushCurveLines(lines, a, b, steps) {
    var prev = a.anchor;
    var i, t, pt;
    for (i = 1; i <= steps; i++) {
        t = i / steps;
        pt = bezPoint(a.anchor, a.right, b.left, b.anchor, t);
        lines.push([prev[0], prev[1], pt[0], pt[1]]);
        prev = pt;
    }
}

function placeLoop(prev, aVert, bVert, next, lines, gap) {
    var A = retreatTip(aVert.anchor, prev.anchor, lines, gap);
    var B = retreatTip(bVert.anchor, next.anchor, lines, gap);
    var Ta = unitOf(prev.anchor, A);
    var Tb = unitOf(B, next.anchor);
    if (!Ta) Ta = unitOf(prev.anchor, aVert.anchor);
    if (!Tb) Tb = unitOf(bVert.anchor, next.anchor);
    if (!Ta || !Tb) return null;
    return fitLoopBetween(A, Ta, B, Tb, lines, gap);
}

function fitLoopBetween(A, Ta, B, Tb, lines, gap) {
    var outward, len, extra, sign, best, trial, i;
    outward = unitOf([0, 0], [Ta[0] - Tb[0], Ta[1] - Tb[1]]);
    if (!outward) outward = [-Ta[1], Ta[0]];
    best = null;
    for (i = 1; i <= 14; i++) {
        len = i * gap;
        for (extra = 0; extra <= 8; extra++) {
            for (sign = 1; sign >= -1; sign -= 2) {
                trial = gradeLoop(A, Ta, B, Tb, outward, len, extra * gap, sign, lines, gap);
                if (!best || betterLoop(trial, best)) best = trial;
                if (trial.hits === 0 && trial.clear >= gap) return trial;
                if (extra === 0) break;
            }
        }
    }
    return best;
}

function betterLoop(trial, best) {
    var trialOk = trial.hits === 0 && trial.clear >= trial.need;
    var bestOk = best.hits === 0 && best.clear >= best.need;
    if (trialOk !== bestOk) return trialOk;
    if (trial.hits !== best.hits) return trial.hits < best.hits;
    return trial.clear > best.clear;
}

function gradeLoop(A, Ta, B, Tb, outward, len, extra, sign, lines, gap) {
    var right = [
        A[0] + Ta[0] * len + outward[0] * extra * sign,
        A[1] + Ta[1] * len + outward[1] * extra * sign
    ];
    var left = [
        B[0] - Tb[0] * len + outward[0] * extra * sign,
        B[1] - Tb[1] * len + outward[1] * extra * sign
    ];
    var samples = [];
    var steps = 16;
    var i, clear, hits;
    for (i = 0; i <= steps; i++) samples.push(bezPoint(A, right, left, B, i / steps));
    clear = loopClearance(samples, lines);
    hits = loopHits(samples, lines);
    return { a: A, b: B, right: right, left: left, clear: clear, hits: hits, need: gap };
}

function loopClearance(samples, lines) {
    var best = 1e9;
    var i, k, d;
    for (i = 2; i < samples.length - 2; i++) {
        for (k = 0; k < lines.length; k++) {
            d = distToLine(samples[i], lines[k]);
            if (d < best) best = d;
        }
    }
    return best;
}

function loopHits(samples, lines) {
    var hits = 0;
    var i, k;
    for (i = 0; i < samples.length - 1; i++) {
        for (k = 0; k < lines.length; k++) {
            if (segmentsCross(samples[i], samples[i + 1], lines[k])) hits++;
        }
    }
    return hits;
}

function retreatTip(tip, toward, lines, gap) {
    var dx = toward[0] - tip[0];
    var dy = toward[1] - tip[1];
    var span = Math.sqrt(dx * dx + dy * dy);
    var lo, hi, mid, i, p;
    if (span < 0.4) return [tip[0], tip[1]];
    if (minPointDist(tip, lines) >= gap) return [tip[0], tip[1]];
    lo = 0;
    hi = 0.92;
    for (i = 0; i < 12; i++) {
        mid = (lo + hi) / 2;
        p = [tip[0] + dx * mid, tip[1] + dy * mid];
        if (minPointDist(p, lines) >= gap) hi = mid;
        else lo = mid;
    }
    return [tip[0] + dx * hi, tip[1] + dy * hi];
}

function minPointDist(p, lines) {
    var best = 1e9;
    var i, d;
    for (i = 0; i < lines.length; i++) {
        d = distToLine(p, lines[i]);
        if (d < best) best = d;
    }
    return best;
}

function distToLine(p, line) {
    var dx = line[2] - line[0];
    var dy = line[3] - line[1];
    var len2 = dx * dx + dy * dy;
    var t, x, y, ex, ey;
    if (len2 < 1e-8) {
        ex = p[0] - line[0];
        ey = p[1] - line[1];
        return Math.sqrt(ex * ex + ey * ey);
    }
    t = ((p[0] - line[0]) * dx + (p[1] - line[1]) * dy) / len2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    x = line[0] + dx * t;
    y = line[1] + dy * t;
    ex = p[0] - x;
    ey = p[1] - y;
    return Math.sqrt(ex * ex + ey * ey);
}

var progressFloor = 0;
var progressCeil = 1;
var progressLabel = "";

function noteProgress(local) {
    if (typeof reportProgress !== "function") return;
    if (!(local > 0)) local = 0;
    if (local > 1) local = 1;
    reportProgress(progressFloor + (progressCeil - progressFloor) * local, progressLabel);
}

function planProcess(specs, extendPt, overlapPt, offsetPt, steepPt, clearPt) {
    var strokes = [];
    var remove = [];
    var world = [];
    var i, spec, breaks, runs, r, made, outline, area, gap, k, others, formTotal, formNo, runTotal;
    if (!specs) return { strokes: strokes, remove: remove };
    gap = clearPt > 0 ? clearPt : 0;
    for (i = 0; i < specs.length; i++) {
        spec = specs[i];
        if (!spec || !spec.closed || !spec.verts || spec.verts.length < 4) world.push(null);
        else world.push(formOutline(spec.verts));
    }
    formTotal = 0;
    formNo = 0;
    for (i = 0; i < world.length; i++) if (world[i]) formTotal++;
    if (!(formTotal > 0)) formTotal = 1;
    for (i = 0; i < specs.length; i++) {
        if (!world[i]) continue;
        formNo++;
        spec = specs[i];
        progressLabel = "Form " + formNo + " von " + formTotal;
        breaks = markSteepCorners(spec.verts);
        if (breaks.length < 2) {
            progressFloor = 0.08 + (formNo - 1) / formTotal * 0.74;
            progressCeil = 0.08 + formNo / formTotal * 0.74;
            noteProgress(1);
            continue;
        }
        outline = world[i];
        others = [];
        for (k = 0; k < world.length; k++) {
            if (k !== i && world[k]) others.push(world[k]);
        }
        outline.others = others;
        area = ringArea(spec.verts);
        runs = closedRuns(spec.verts, breaks);
        runTotal = runs.length || 1;
        for (r = 0; r < runs.length; r++) {
            progressFloor = 0.08 + ((formNo - 1) + r / runTotal) / formTotal * 0.74;
            progressCeil = 0.08 + ((formNo - 1) + (r + 1) / runTotal) / formTotal * 0.74;
            noteProgress(0);
            made = finishProcessRun(runs[r], area, outline, extendPt, overlapPt, offsetPt, steepPt, gap);
            noteProgress(1);
            for (var s = 0; s < made.length; s++) strokes.push({ source: i, verts: made[s] });
        }
        if (runs.length) remove.push(i);
    }
    return { strokes: strokes, remove: remove };
}

function markSteepCorners(verts) {
    var area = ringArea(verts);
    var n = verts.length;
    var breaks = [];
    var i, prev, next, into, out, li, lo, cross, dot, turn, lenPrev, lenNext;
    for (i = 0; i < n; i++) {
        prev = verts[(i - 1 + n) % n];
        next = verts[(i + 1) % n];
        into = arrivalDir(prev, verts[i]);
        out = departDir(verts[i], next);
        li = Math.sqrt(into[0] * into[0] + into[1] * into[1]);
        lo = Math.sqrt(out[0] * out[0] + out[1] * out[1]);
        verts[i].role = "flat";
        if (li < 0.2 || lo < 0.2) continue;
        cross = into[0] * out[1] - into[1] * out[0];
        dot = into[0] * out[0] + into[1] * out[1];
        turn = Math.atan2(cross, dot) * 180 / Math.PI;
        lenPrev = segmentLen(prev, verts[i]);
        lenNext = segmentLen(verts[i], next);
        if (Math.abs(turn) < 40) continue;
        if (lenPrev < 8 && lenNext < 8) continue;
        verts[i].role = cross * area >= 0 ? "out" : "in";
        breaks.push(i);
    }
    return breaks;
}

function finishProcessRun(pts, area, outline, extendPt, overlapPt, offsetPt, steepPt, clearPt) {
    var startRole, endRole, dir, back, dist;
    if (!pts || pts.length < 2) return [];
    startRole = pts[0].role;
    endRole = pts[pts.length - 1].role;
    if (startRole === "in" && endRole === "in") return overlapFadeRun(pts, area, outline, overlapPt, offsetPt, steepPt, clearPt);
    if (startRole === "in" && endRole === "out") reverseRun(pts);
    if (extendPt > 0 && pts[0].role === "out") {
        dir = departDir(pts[0], pts[1]);
        back = [-dir[0], -dir[1]];
        dist = fitOutward(pts[0].anchor, back, extendPt, outline);
        if (dist > 0.3) {
            pts.unshift(pointBeyond(pts[0].anchor, back, dist));
            pts[1].left = [pts[1].anchor[0], pts[1].anchor[1]];
            pts[1].corner = true;
        }
    }
    if (extendPt > 0 && pts[pts.length - 1].role === "out") {
        dir = arrivalDir(pts[pts.length - 2], pts[pts.length - 1]);
        dist = fitOutward(pts[pts.length - 1].anchor, dir, extendPt, outline);
        if (dist > 0.3) {
            pts.push(pointBeyond(pts[pts.length - 1].anchor, dir, dist));
            pts[pts.length - 2].right = [pts[pts.length - 2].anchor[0], pts[pts.length - 2].anchor[1]];
            pts[pts.length - 2].corner = true;
        }
    }
    return [pts];
}

function overlapFadeRun(pts, area, outline, overlapPt, offsetPt, steepPt, clearPt) {
    var fit, built;
    if (pts.length < 2) return [];
    fit = placeFade(pts, area, outline, overlapPt, offsetPt, steepPt, clearPt);
    built = buildFadePair(pts, area, outline, fit.overlap, fit.offset, fit.steep, fit.where);
    return built.length ? built : [pts];
}

function buildFadePair(pts, area, outline, overlapPt, offsetPt, steepPt, splitAt) {
    var total, margin, d, left, right, travel, normal;
    total = pathLength(pts);
    if (total < 1) return [];
    margin = overlapPt > 0 ? overlapPt : 0;
    if (margin > total * 0.45) margin = total * 0.45;
    d = splitAt;
    if (!(d > margin && d < total - margin)) d = total * 0.5;
    left = sliceRun(pts, 0, d + margin);
    right = sliceRun(pts, Math.max(0, d - margin), total);
    if (left.length < 2 || right.length < 2) return [];
    travel = arrivalDir(left[left.length - 2], left[left.length - 1]);
    normal = outsideNormal(left[left.length - 1].anchor, travel, area, outline);
    fadeRunTip(left, false, steepPt, offsetPt, normal, outline);
    travel = departDir(right[0], right[1]);
    normal = outsideNormal(right[0].anchor, travel, area, outline);
    fadeRunTip(right, true, steepPt, offsetPt, normal, outline);
    reverseRun(left);
    return [left, right];
}

function placeFade(pts, area, outline, overlapPt, offsetPt, steepPt, clearPt) {
    var total, overlap, lo, hi, step, d, scale, gap, smooth, best;
    total = pathLength(pts);
    overlap = overlapPt > 0 ? overlapPt : 0;
    if (overlap > total * 0.49) overlap = total * 0.49;
    if (!(offsetPt > 0)) offsetPt = 0;
    if (!(steepPt > 0)) steepPt = 0;
    if (!(clearPt > 0)) clearPt = 0;
    lo = overlap;
    hi = total - overlap;
    if (!(hi > lo + 0.4)) {
        scale = largestFadeScale(pts, area, outline, overlap, offsetPt, steepPt, total * 0.5, clearPt);
        return { overlap: overlap, offset: offsetPt * scale, steep: steepPt * scale, where: total * 0.5 };
    }
    best = null;
    step = Math.max((hi - lo) / 16, 1);
    var fadeStep = 0;
    var fadeExpect = Math.ceil((hi - lo) / step) + 1;
    if (!(fadeExpect > 0)) fadeExpect = 1;
    for (d = lo; d <= hi + step * 0.2; d += step) {
        noteProgress(fadeStep / fadeExpect);
        fadeStep++;
        scale = largestFadeScale(pts, area, outline, overlap, offsetPt, steepPt, d, clearPt);
        if (!(scale > 0.05)) continue;
        gap = fadeGapAt(pts, area, outline, overlap, offsetPt * scale, steepPt * scale, d);
        smooth = curveScore(pts, Math.max(0, d - overlap), Math.min(total, d + overlap));
        if (!best || scale > best.scale + 0.08 || (scale >= best.scale - 0.08 && (smooth < best.smooth - 0.02 || (smooth <= best.smooth + 0.02 && gap > best.gap)))) {
            best = { scale: scale, gap: gap, smooth: smooth, where: d };
        }
    }
    if (!best) best = { scale: 0, gap: 0, where: (lo + hi) / 2 };
    return { overlap: overlap, offset: offsetPt * best.scale, steep: steepPt * best.scale, where: best.where };
}

function largestFadeScale(pts, area, outline, overlap, maxOffset, maxSteep, splitAt, clearPt) {
    var lo = 0;
    var hi = 1;
    var mid, i;
    if (fadeClear(pts, area, outline, overlap, maxOffset, maxSteep, splitAt, clearPt)) return 1;
    for (i = 0; i < 6; i++) {
        mid = (lo + hi) / 2;
        if (fadeClear(pts, area, outline, overlap, maxOffset * mid, maxSteep * mid, splitAt, clearPt)) lo = mid;
        else hi = mid;
    }
    return lo;
}

function fadeRoom(pts) {
    return pathLength(pts) * 0.45;
}

function fadeClear(pts, area, outline, overlapPt, offsetPt, steepPt, splitAt, clearPt) {
    var made, i;
    made = buildFadePair(pts, area, outline, overlapPt, offsetPt, steepPt, splitAt);
    for (i = 0; i < made.length; i++) {
        if (fadeCutsForm(made[i], outline, clearPt, 6)) return false;
    }
    return true;
}

function straightSplit(pts, overlap) {
    var total = pathLength(pts);
    var lo, hi, d, step, best, bestLo, bestHi, score;
    if (total < 1) return 0;
    if (!(overlap > 0.5)) overlap = Math.min(total * 0.25, 1);
    lo = overlap;
    hi = total - overlap;
    if (!(hi > lo + 0.5)) return total * 0.5;
    best = 1e9;
    bestLo = (lo + hi) / 2;
    bestHi = bestLo;
    step = Math.max((hi - lo) / 28, 0.75);
    for (d = lo; d <= hi + step * 0.25; d += step) {
        score = curveScore(pts, d - overlap, d + overlap);
        if (score < best - 0.015) {
            best = score;
            bestLo = d;
            bestHi = d;
        } else if (score <= best + 0.015 && d - bestHi < step * 1.5) bestHi = d;
    }
    return (bestLo + bestHi) / 2;
}

function curveScore(pts, d0, d1) {
    var span = d1 - d0;
    var steps = 4;
    var i, prev, cur, dot, cross, score;
    if (span < 0.5) return 0;
    prev = tangentAt(pts, d0);
    score = 0;
    for (i = 1; i <= steps; i++) {
        cur = tangentAt(pts, d0 + span * i / steps);
        dot = prev[0] * cur[0] + prev[1] * cur[1];
        cross = prev[0] * cur[1] - prev[1] * cur[0];
        score += Math.abs(Math.atan2(cross, dot));
        prev = cur;
    }
    return score;
}

function tangentAt(pts, dist) {
    var acc = 0;
    var i, seg, t, dir, len;
    if (dist < 0) dist = 0;
    for (i = 0; i < pts.length - 1; i++) {
        seg = bezierLength(pts[i], pts[i + 1]);
        if (acc + seg < dist && i < pts.length - 2) {
            acc += seg;
            continue;
        }
        t = tAtLength(pts[i], pts[i + 1], dist - acc);
        dir = bezierTangent(pts[i], pts[i + 1], t);
        len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
        if (len < 1e-6) return [1, 0];
        return [dir[0] / len, dir[1] / len];
    }
    return [1, 0];
}

function bezierTangent(a, b, t) {
    var p0 = a.anchor;
    var p1 = a.right;
    var p2 = b.left;
    var p3 = b.anchor;
    var u = 1 - t;
    return [
        3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]),
        3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1])
    ];
}

function pathLength(pts) {
    var n = 0;
    var i;
    for (i = 0; i < pts.length - 1; i++) n += bezierLength(pts[i], pts[i + 1]);
    return n;
}

function bezierLength(a, b) {
    var samples = sampleCubic(a.anchor, a.right, b.left, b.anchor);
    var len = 0;
    var i, dx, dy;
    for (i = 1; i < samples.length; i++) {
        dx = samples[i][0] - samples[i - 1][0];
        dy = samples[i][1] - samples[i - 1][1];
        len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
}

function tAtLength(a, b, dist) {
    var total = bezierLength(a, b);
    var lo = 0;
    var hi = 1;
    var mid, i, part, got;
    if (dist <= 0 || total < 0.01) return 0;
    if (dist >= total) return 1;
    for (i = 0; i < 14; i++) {
        mid = (lo + hi) / 2;
        part = splitSegment(a, b, mid);
        got = bezierLength(part.a, part.end);
        if (got < dist) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

function sliceRun(pts, dist0, dist1) {
    var cut, rest, second;
    if (!pts || pts.length < 2 || dist1 < dist0) return [];
    if (dist0 <= 0.2) {
        cut = cutRun(pts, dist1);
        return cut ? cut[0] : [];
    }
    cut = cutRun(pts, dist0);
    if (!cut) return [];
    rest = cut[1];
    second = cutRun(rest, dist1 - dist0);
    return second ? second[0] : rest;
}

function cutRun(pts, dist) {
    var acc = 0;
    var i, seg, t, part, first, second, k, total;
    total = pathLength(pts);
    if (dist >= total - 0.2) {
        first = [];
        for (k = 0; k < pts.length; k++) first.push(cloneVert(pts[k]));
        return [first, [cloneVert(pts[pts.length - 1])]];
    }
    for (i = 0; i < pts.length - 1; i++) {
        seg = bezierLength(pts[i], pts[i + 1]);
        if (acc + seg < dist - 0.05 && i < pts.length - 2) {
            acc += seg;
            continue;
        }
        t = seg < 0.01 ? 0 : tAtLength(pts[i], pts[i + 1], dist - acc);
        if (t < 0) t = 0;
        if (t > 1) t = 1;
        part = splitSegment(pts[i], pts[i + 1], t);
        first = [];
        second = [];
        for (k = 0; k < i; k++) first.push(cloneVert(pts[k]));
        first.push(part.a);
        first.push(part.end);
        second.push(part.start);
        second.push(part.b);
        for (k = i + 2; k < pts.length; k++) second.push(cloneVert(pts[k]));
        return [first, second];
    }
    return null;
}

function longestSegmentStart(pts) {
    var best = 0;
    var bestLen = -1;
    var i, len, index;
    for (i = 0; i < pts.length - 1; i++) {
        len = segmentLen(pts[i], pts[i + 1]);
        if (len > bestLen) {
            bestLen = len;
            best = i;
        }
    }
    index = best;
    if (index < 1) index = 1;
    if (index > pts.length - 2) index = pts.length - 2;
    return index;
}

function extendRunEnd(pts, dist) {
    var ext = extendForward(pts[pts.length - 2], pts[pts.length - 1], dist);
    pts[pts.length - 1].right = [pts[pts.length - 1].anchor[0], pts[pts.length - 1].anchor[1]];
    pts[pts.length - 1].corner = true;
    pts.push(ext);
}

function extendRunStart(pts, dist) {
    var dir = departDir(pts[0], pts[1]);
    var ext = pointBeyond(pts[0].anchor, [-dir[0], -dir[1]], dist);
    pts[0].left = [pts[0].anchor[0], pts[0].anchor[1]];
    pts[0].corner = true;
    pts.unshift(ext);
}

function outsideDir(dir, area) {
    var len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
    var left;
    if (len < 0.01) return [0, area >= 0 ? -1 : 1];
    left = [-dir[1] / len, dir[0] / len];
    if (area >= 0) return [-left[0], -left[1]];
    return left;
}

function outsideNormal(anchor, travel, area, outline) {
    var normal = outsideDir(travel, area);
    var probe = [anchor[0] + normal[0] * 1.5, anchor[1] + normal[1] * 1.5];
    if (insideForm(probe, outline)) return [-normal[0], -normal[1]];
    return normal;
}

function fitOutward(anchor, dir, maxDist, outline) {
    var len, unit, lo, hi, mid, i;
    len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]);
    if (len < 0.01 || !(maxDist > 0)) return 0;
    unit = [dir[0] / len, dir[1] / len];
    if (extensionClear(anchor, unit, maxDist, outline)) return maxDist;
    lo = 0;
    hi = maxDist;
    for (i = 0; i < 10; i++) {
        mid = (lo + hi) / 2;
        if (extensionClear(anchor, unit, mid, outline)) lo = mid;
        else hi = mid;
    }
    return lo;
}

function extensionClear(anchor, unit, dist, outline) {
    var steps, i, p;
    if (dist < 0.2) return true;
    steps = 8;
    for (i = 1; i <= steps; i++) {
        p = [anchor[0] + unit[0] * dist * i / steps, anchor[1] + unit[1] * dist * i / steps];
        if (insideForm(p, outline)) return false;
        if (i > 1 && nearOutline(p, outline, 0.5)) return false;
    }
    if (crossesOutline(anchor, [anchor[0] + unit[0] * dist, anchor[1] + unit[1] * dist], outline)) return false;
    return true;
}

function formOutline(verts) {
    var line = [];
    var n = verts.length;
    var i, s, t, u, a, b;
    for (i = 0; i < n; i++) {
        a = verts[i];
        b = verts[(i + 1) % n];
        for (s = 0; s < 4; s++) {
            t = s / 4;
            u = 1 - t;
            line.push([
                u * u * u * a.anchor[0] + 3 * u * u * t * a.right[0] + 3 * u * t * t * b.left[0] + t * t * t * b.anchor[0],
                u * u * u * a.anchor[1] + 3 * u * u * t * a.right[1] + 3 * u * t * t * b.left[1] + t * t * t * b.anchor[1]
            ]);
        }
    }
    return line;
}

function insideForm(p, outline) {
    var near, nx, ny, stepped;
    if (!outline || outline.length < 3) return false;
    near = closestOutline(p, outline);
    if (near.dist <= 0.45) {
        if (near.dist < 0.02) return false;
        nx = (p[0] - near.point[0]) / near.dist;
        ny = (p[1] - near.point[1]) / near.dist;
        stepped = [p[0] + nx * 1.2, p[1] + ny * 1.2];
        return rayInside(stepped, outline);
    }
    return rayInside(p, outline);
}

function rayInside(p, outline) {
    var n = outline.length;
    var i, a, b, cross;
    cross = 0;
    for (i = 0; i < n; i++) {
        a = outline[i];
        b = outline[(i + 1) % n];
        if ((a[1] > p[1]) === (b[1] > p[1])) continue;
        if (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) cross++;
    }
    return cross % 2 === 1;
}

function closestOutline(p, outline) {
    var n = outline.length;
    var i, a, b, abx, aby, d, t, px, py, dist, best, bestPt;
    best = 1e9;
    bestPt = [p[0], p[1]];
    for (i = 0; i < n; i++) {
        a = outline[i];
        b = outline[(i + 1) % n];
        abx = b[0] - a[0];
        aby = b[1] - a[1];
        d = abx * abx + aby * aby;
        if (d < 1e-6) continue;
        t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / d;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        px = a[0] + abx * t;
        py = a[1] + aby * t;
        dist = (px - p[0]) * (px - p[0]) + (py - p[1]) * (py - p[1]);
        if (dist < best) {
            best = dist;
            bestPt = [px, py];
        }
    }
    return { dist: Math.sqrt(best), point: bestPt };
}

function nearOutline(p, outline, tol) {
    return closestOutline(p, outline).dist <= tol;
}

function crossesOutline(a, b, outline) {
    var n = outline.length;
    var i, c, d;
    for (i = 0; i < n; i++) {
        c = outline[i];
        d = outline[(i + 1) % n];
        if (segmentCrosses(a, b, c, d)) return true;
    }
    return false;
}

function segmentCrosses(a, b, c, d) {
    var r0 = b[0] - a[0];
    var r1 = b[1] - a[1];
    var s0 = d[0] - c[0];
    var s1 = d[1] - c[1];
    var den = r0 * s1 - r1 * s0;
    var t, u, x, y, dx, dy;
    if (Math.abs(den) < 1e-8) return false;
    t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den;
    u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
    if (t <= 0.04 || t >= 0.98 || u <= 0.02 || u >= 0.98) return false;
    x = a[0] + r0 * t;
    y = a[1] + r1 * t;
    dx = x - a[0];
    dy = y - a[1];
    return dx * dx + dy * dy > 2.25;
}

function fadeGapAt(pts, area, outline, overlapPt, offsetPt, steepPt, splitAt) {
    var made, i, gap, part;
    made = buildFadePair(pts, area, outline, overlapPt, offsetPt, steepPt, splitAt);
    gap = 1e9;
    for (i = 0; i < made.length; i++) {
        part = fadeClearance(made[i], outline, 6);
        if (part < gap) gap = part;
    }
    return gap;
}

function fadeCutsForm(path, outline, clearance, hostReach) {
    var i, tip, other, c1, c2, samples, s, prev;
    if (!(clearance > 0)) clearance = 0;
    if (!(hostReach > 1)) hostReach = 6;
    for (i = 0; i < path.length; i++) {
        if (path[i].role !== "fade") continue;
        tip = path[i];
        if (i === 0) {
            other = path[1];
            c1 = tip.right;
            c2 = other.left;
        } else {
            other = path[i - 1];
            c1 = other.right;
            c2 = tip.left;
        }
        samples = sampleCubic(i === 0 ? tip.anchor : other.anchor, c1, c2, i === 0 ? other.anchor : tip.anchor);
        prev = samples[0];
        for (s = 0; s < samples.length; s++) {
            if (insideForm(samples[s], outline)) return true;
            if (s > 1 && crossesOutline(prev, samples[s], outline)) return true;
            prev = samples[s];
        }
    }
    return clearance > 0 && fadeClearance(path, outline, hostReach) < clearance;
}

function fadeClearance(path, outline, hostReach) {
    var i, tip, other, join, attach, samples, s, dx, dy, dist, best, from, to, hit, others;
    best = 1e9;
    if (!(hostReach > 1)) hostReach = 8;
    others = outline && outline.others ? outline.others : null;
    for (i = 0; i < path.length; i++) {
        if (path[i].role !== "fade") continue;
        tip = path[i];
        if (i === 0) {
            other = path[1];
            join = other.anchor;
            samples = sampleCubic(tip.anchor, tip.right, other.left, other.anchor);
        } else {
            other = path[i - 1];
            join = other.anchor;
            samples = sampleCubic(other.anchor, other.right, tip.left, tip.anchor);
        }
        attach = locateOn(outline, join);
        from = i === 0 ? 0 : Math.floor(samples.length * 0.55);
        to = i === 0 ? Math.ceil(samples.length * 0.5) : samples.length;
        for (s = from; s < to; s++) {
            dx = samples[s][0] - join[0];
            dy = samples[s][1] - join[1];
            if (dx * dx + dy * dy < 2.25) continue;
            hit = locateOn(outline, samples[s]);
            if (arcBetween(outline, attach, hit) > hostReach && hit.dist < best) best = hit.dist;
            if (others) {
                dist = otherDist(samples[s], others, join);
                if (dist < best) best = dist;
            }
            if (s + 1 < to && crossesFar(samples[s], samples[s + 1], outline, attach, hostReach)) return 0;
            if (s + 1 < to && others && crossesOthers(samples[s], samples[s + 1], others)) return 0;
        }
    }
    return best;
}

function locateOn(outline, p) {
    var n = outline.length;
    var i, a, b, abx, aby, d, t, px, py, dist, best, seg, at, bx, by;
    best = 1e9;
    seg = 0;
    at = 0;
    bx = p[0];
    by = p[1];
    for (i = 0; i < n; i++) {
        a = outline[i];
        b = outline[(i + 1) % n];
        abx = b[0] - a[0];
        aby = b[1] - a[1];
        d = abx * abx + aby * aby;
        if (d < 1e-6) continue;
        t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / d;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        px = a[0] + abx * t;
        py = a[1] + aby * t;
        dist = (px - p[0]) * (px - p[0]) + (py - p[1]) * (py - p[1]);
        if (dist < best) {
            best = dist;
            seg = i;
            at = t;
            bx = px;
            by = py;
        }
    }
    return { seg: seg, t: at, dist: Math.sqrt(best), point: [bx, by] };
}

function edgeLenAt(outline, i) {
    var n = outline.length;
    var a = outline[i];
    var b = outline[(i + 1) % n];
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function arcBetween(outline, a, b) {
    var n = outline.length;
    var forward, back, guard, i, len;
    if (!a || !b) return 0;
    if (a.seg === b.seg) {
        return Math.abs(a.t - b.t) * edgeLenAt(outline, a.seg);
    }
    forward = (1 - a.t) * edgeLenAt(outline, a.seg);
    i = (a.seg + 1) % n;
    guard = 0;
    while (i !== b.seg && guard < n) {
        forward += edgeLenAt(outline, i);
        i = (i + 1) % n;
        guard++;
    }
    forward += b.t * edgeLenAt(outline, b.seg);
    back = a.t * edgeLenAt(outline, a.seg);
    i = (a.seg - 1 + n) % n;
    guard = 0;
    while (i !== b.seg && guard < n) {
        back += edgeLenAt(outline, i);
        i = (i - 1 + n) % n;
        guard++;
    }
    len = edgeLenAt(outline, b.seg);
    back += (1 - b.t) * len;
    return forward < back ? forward : back;
}

function otherDist(p, others, join) {
    var best = 1e9;
    var k, loc, dx, dy;
    for (k = 0; k < others.length; k++) {
        if (!others[k] || others[k].length < 2) continue;
        loc = locateOn(others[k], p);
        dx = loc.point[0] - join[0];
        dy = loc.point[1] - join[1];
        if (dx * dx + dy * dy < 6.25) continue;
        if (loc.dist < best) best = loc.dist;
    }
    return best;
}

function crossesFar(a, b, outline, attach, reach) {
    var n = outline.length;
    var i, va, vb;
    for (i = 0; i < n; i++) {
        if (!segmentCrosses(a, b, outline[i], outline[(i + 1) % n])) continue;
        va = { seg: i, t: 0 };
        vb = { seg: i, t: 1 };
        if (arcBetween(outline, attach, va) <= reach && arcBetween(outline, attach, vb) <= reach) continue;
        return true;
    }
    return false;
}

function crossesOthers(a, b, others) {
    var k, o, n, i;
    for (k = 0; k < others.length; k++) {
        o = others[k];
        if (!o) continue;
        n = o.length;
        for (i = 0; i < n; i++) {
            if (segmentCrosses(a, b, o[i], o[(i + 1) % n])) return true;
        }
    }
    return false;
}

function sampleCubic(p0, p1, p2, p3) {
    var out = [];
    var s, t, u;
    for (s = 0; s <= 8; s++) {
        t = s / 8;
        u = 1 - t;
        out.push([
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
        ]);
    }
    return out;
}

function fadeTravel(on, atStart, join) {
    var forward, len, chord, usedHandle;
    if (atStart) forward = [on.right[0] - on.anchor[0], on.right[1] - on.anchor[1]];
    else forward = [on.anchor[0] - on.left[0], on.anchor[1] - on.left[1]];
    len = Math.sqrt(forward[0] * forward[0] + forward[1] * forward[1]);
    usedHandle = len >= 0.35;
    if (!usedHandle) {
        if (atStart) forward = [on.anchor[0] - on.left[0], on.anchor[1] - on.left[1]];
        else forward = [on.right[0] - on.anchor[0], on.right[1] - on.anchor[1]];
        len = Math.sqrt(forward[0] * forward[0] + forward[1] * forward[1]);
        usedHandle = len >= 0.35;
    }
    if (usedHandle) {
        forward = [forward[0] / len, forward[1] / len];
        if (atStart) return [-forward[0], -forward[1]];
        return forward;
    }
    chord = [on.anchor[0] - join.anchor[0], on.anchor[1] - join.anchor[1]];
    len = Math.sqrt(chord[0] * chord[0] + chord[1] * chord[1]);
    if (len < 0.35) return null;
    return [chord[0] / len, chord[1] / len];
}

function fadeRunTip(pts, atStart, steep, handle, normal, outline) {
    var tipIndex, joinIndex, on, join, toward, len, along, side, sideDir, align, tipAt, tip, pathHandle, tipHandle;
    if (!pts || pts.length < 2 || Math.abs(steep) < 0.01) return;
    tipIndex = atStart ? 0 : pts.length - 1;
    joinIndex = atStart ? 1 : pts.length - 2;
    on = pts[tipIndex];
    join = pts[joinIndex];
    toward = fadeTravel(on, atStart, join);
    if (!toward) return;
    along = handle < 0.15 ? 0.15 : handle;
    side = Math.abs(steep);
    sideDir = [-toward[1], toward[0]];
    align = sideDir[0] * normal[0] + sideDir[1] * normal[1];
    if (align < 0.25) sideDir = [normal[0], normal[1]];
    else if (align < 0) sideDir = [-sideDir[0], -sideDir[1]];
    if (insideForm([on.anchor[0] + sideDir[0] * 1.5, on.anchor[1] + sideDir[1] * 1.5], outline)) {
        sideDir = [-sideDir[0], -sideDir[1]];
    }
    tipAt = [on.anchor[0] + toward[0] * along + sideDir[0] * side, on.anchor[1] + toward[1] * along + sideDir[1] * side];
    pathHandle = [toward[0] * along * 0.5522847498, toward[1] * along * 0.5522847498];
    tipHandle = [-sideDir[0] * side * 0.5522847498, -sideDir[1] * side * 0.5522847498];
    tip = {
        anchor: tipAt,
        left: [tipAt[0], tipAt[1]],
        right: [tipAt[0], tipAt[1]],
        corner: false,
        role: "fade",
        joint: false
    };
    on.corner = false;
    if (atStart) {
        tip.right = [tipAt[0] + tipHandle[0], tipAt[1] + tipHandle[1]];
        on.left = [on.anchor[0] + pathHandle[0], on.anchor[1] + pathHandle[1]];
        pts.unshift(tip);
    } else {
        tip.left = [tipAt[0] + tipHandle[0], tipAt[1] + tipHandle[1]];
        on.right = [on.anchor[0] + pathHandle[0], on.anchor[1] + pathHandle[1]];
        pts.push(tip);
    }
}

function segmentsCross(p, q, line) {
    var r0 = q[0] - p[0];
    var r1 = q[1] - p[1];
    var s0 = line[2] - line[0];
    var s1 = line[3] - line[1];
    var den = r0 * s1 - r1 * s0;
    var t, u;
    if (Math.abs(den) < 1e-8) return false;
    t = ((line[0] - p[0]) * s1 - (line[1] - p[1]) * s0) / den;
    u = ((line[0] - p[0]) * r1 - (line[1] - p[1]) * r0) / den;
    return t > 0.08 && t < 0.92 && u > 0.02 && u < 0.98;
}
