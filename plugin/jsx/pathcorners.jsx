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
