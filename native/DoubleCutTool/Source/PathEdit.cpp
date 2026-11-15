#include "IllustratorSDK.h"
#include "PathEdit.h"
#include "ToolSettings.h"
#include "DoubleCutToolSuites.h"

#include <cmath>
#include <vector>

namespace {

const AIReal kPtPerMm = 72.0 / 25.4;
const AIReal kAnchorPixels = 8.0;

struct Segs {
	std::vector<AIPathSegment> pts;
	bool closed;
};

bool ViewPoint(const AIRealPoint& art, AIRealPoint& view);
int NearestAnchor(const Segs& segs, const AIRealPoint& cursor);

AIReal Distance(const AIRealPoint& a, const AIRealPoint& b)
{
	AIReal dx = a.h - b.h;
	AIReal dy = a.v - b.v;
	return sqrt(dx * dx + dy * dy);
}

AIRealPoint AddPoint(const AIRealPoint& a, const AIRealPoint& b)
{
	AIRealPoint p;
	p.h = a.h + b.h;
	p.v = a.v + b.v;
	return p;
}

AIRealPoint SubPoint(const AIRealPoint& a, const AIRealPoint& b)
{
	AIRealPoint p;
	p.h = a.h - b.h;
	p.v = a.v - b.v;
	return p;
}

AIRealPoint ScalePoint(const AIRealPoint& a, AIReal s)
{
	AIRealPoint p;
	p.h = a.h * s;
	p.v = a.v * s;
	return p;
}

AIReal LengthPoint(const AIRealPoint& a)
{
	return sqrt(a.h * a.h + a.v * a.v);
}

AIPathSegment Straight(const AIRealPoint& at)
{
	AIPathSegment seg;
	seg.p = at;
	seg.in = at;
	seg.out = at;
	seg.corner = true;
	return seg;
}

AIRealPoint Depart(const AIPathSegment& here, const AIPathSegment& next)
{
	AIRealPoint d = SubPoint(here.out, here.p);
	if (LengthPoint(d) < 0.01) d = SubPoint(next.in, here.p);
	if (LengthPoint(d) < 0.01) d = SubPoint(next.p, here.p);
	return d;
}

AIRealPoint Arrive(const AIPathSegment& prev, const AIPathSegment& here)
{
	AIRealPoint d = SubPoint(here.p, here.in);
	if (LengthPoint(d) < 0.01) d = SubPoint(here.p, prev.out);
	if (LengthPoint(d) < 0.01) d = SubPoint(here.p, prev.p);
	return d;
}

AIRealPoint Beyond(const AIRealPoint& anchor, const AIRealPoint& dir, AIReal dist)
{
	AIReal len = LengthPoint(dir);
	if (len < 0.01) return anchor;
	return AddPoint(anchor, ScalePoint(dir, dist / len));
}

AIRealBezier BezierOf(const AIPathSegment& a, const AIPathSegment& b)
{
	AIRealBezier bez;
	bez.p0 = a.p;
	bez.p1 = a.out;
	bez.p2 = b.in;
	bez.p3 = b.p;
	return bez;
}

AIReal CurveLength(const AIPathSegment& a, const AIPathSegment& b)
{
	AIRealBezier bez = BezierOf(a, b);
	AIReal len = sAIRealBezier->Length(&bez, (AIReal)0.01);
	if (len < 0.01) len = Distance(a.p, b.p);
	return len;
}

void SplitCurve(AIPathSegment& a, AIPathSegment& b, AIReal t, AIPathSegment& mid)
{
	if (t < 0.02) t = 0.02;
	if (t > 0.98) t = 0.98;
	AIRealBezier bez = BezierOf(a, b);
	AIRealBezier left, right;
	sAIRealBezier->Divide(&bez, t, &left, &right);
	a.out = left.p1;
	mid = Straight(left.p3);
	mid.in = left.p2;
	mid.out = right.p1;
	b.in = right.p2;
}

bool UsablePath(AIArtHandle path)
{
	if (!path) return false;
	short type = 0;
	if (sAIArt->GetArtType(path, &type) != kNoErr || type != kPathArt) return false;
	AIBoolean guide = false;
	if (sAIPath->GetPathGuide(path, &guide) != kNoErr || guide) return false;
	ai::int32 attr = 0;
	if (sAIArt->GetArtUserAttr(path, kArtLocked | kArtHidden, &attr) != kNoErr) return false;
	if (attr & (kArtLocked | kArtHidden)) return false;
	return true;
}

ASErr ReadSegs(AIArtHandle path, Segs& segs)
{
	AIBoolean closed = false;
	ASErr err = sAIPath->GetPathClosed(path, &closed);
	if (err) return err;
	ai::int16 count = 0;
	err = sAIPath->GetPathSegmentCount(path, &count);
	if (err) return err;
	if (count < 2) return kBadParameterErr;
	segs.closed = closed != false;
	segs.pts.resize(count);
	return sAIPath->GetPathSegments(path, 0, count, &segs.pts[0]);
}

ASErr WriteSegs(AIArtHandle path, const Segs& segs)
{
	if (segs.pts.size() < 2 || segs.pts.size() > 32000) return kBadParameterErr;
	ASErr err = sAIPath->SetPathClosed(path, segs.closed ? true : false);
	if (err) return err;
	err = sAIPath->SetPathSegmentCount(path, (ai::int16)segs.pts.size());
	if (err) return err;
	return sAIPath->SetPathSegments(path, 0, (ai::int16)segs.pts.size(), const_cast<AIPathSegment*>(&segs.pts[0]));
}

void SelectArt(AIArtHandle art)
{
	if (art) sAIArt->SetArtUserAttr(art, kArtSelected, kArtSelected);
}

void MarkUndo(const char* name);

ASErr ReplaceWith(AIArtHandle path, const Segs& one, const char* undo)
{
	ASErr err = WriteSegs(path, one);
	if (err) return err;
	SelectArt(path);
	MarkUndo(undo);
	return kNoErr;
}

ASErr ReplaceWithTwo(AIArtHandle path, const Segs& a, const Segs& b, const char* undo)
{
	AIArtHandle first = NULL;
	AIArtHandle second = NULL;
	ASErr err = sAIArt->DuplicateArt(path, kPlaceAbove, path, &first);
	if (err) return err;
	err = sAIArt->DuplicateArt(path, kPlaceAbove, path, &second);
	if (err) {
		sAIArt->DisposeArt(first);
		return err;
	}
	err = WriteSegs(first, a);
	if (err) {
		sAIArt->DisposeArt(first);
		sAIArt->DisposeArt(second);
		return err;
	}
	err = WriteSegs(second, b);
	if (err) {
		sAIArt->DisposeArt(first);
		sAIArt->DisposeArt(second);
		return err;
	}
	sAIArt->DisposeArt(path);
	SelectArt(first);
	SelectArt(second);
	MarkUndo(undo);
	return kNoErr;
}

int EnsureAnchor(Segs& segs, int seg, AIReal t, int hitType)
{
	int n = (int)segs.pts.size();
	if (seg < 0 || seg >= n) return -1;
	if (hitType != kSegmentHitType) return seg;
	if (t <= 0.02) return seg;
	int next = seg + 1;
	if (next >= n) {
		if (!segs.closed) return seg;
		next = 0;
	}
	if (t >= 0.98) return next;
	AIPathSegment mid;
	SplitCurve(segs.pts[seg], segs.pts[next], t, mid);
	int at = seg + 1;
	segs.pts.insert(segs.pts.begin() + at, mid);
	return at;
}

AIRealPoint UnitPoint(const AIRealPoint& dir)
{
	AIReal len = LengthPoint(dir);
	if (len < 0.01) return dir;
	return ScalePoint(dir, 1.0 / len);
}

void BendLoop(AIPathSegment& from, const AIRealPoint& leave, AIPathSegment& to, const AIRealPoint& enter, AIReal radius)
{
	if (radius < 0.2) radius = 0.2;
	AIRealPoint outLeave = UnitPoint(leave);
	AIRealPoint outEnter = UnitPoint(enter);
	if (LengthPoint(outLeave) < 0.5 || LengthPoint(outEnter) < 0.5) return;
	from.in = AddPoint(from.p, ScalePoint(outLeave, -radius));
	from.out = AddPoint(from.p, ScalePoint(outLeave, radius));
	from.corner = false;
	to.in = AddPoint(to.p, ScalePoint(outEnter, -radius));
	to.out = AddPoint(to.p, ScalePoint(outEnter, radius));
	to.corner = false;
}

void CloseWithLoop(Segs& segs, AIReal radius)
{
	size_t n = segs.pts.size();
	if (n < 4) return;
	AIRealPoint leave = SubPoint(segs.pts[n - 1].p, segs.pts[n - 2].p);
	AIRealPoint enter = SubPoint(segs.pts[1].p, segs.pts[0].p);
	BendLoop(segs.pts[n - 1], leave, segs.pts[0], enter, radius);
	segs.closed = true;
}

Segs JoinWithLoop(Segs left, Segs right, AIReal radius)
{
	if (left.pts.size() < 2 || right.pts.size() < 2) return left;
	AIRealPoint leave = SubPoint(left.pts.back().p, left.pts[left.pts.size() - 2].p);
	AIRealPoint enter = SubPoint(right.pts[1].p, right.pts[0].p);
	BendLoop(left.pts.back(), leave, right.pts[0], enter, radius);
	left.pts.insert(left.pts.end(), right.pts.begin(), right.pts.end());
	left.closed = false;
	return left;
}

void ExtendStart(std::vector<AIPathSegment>& pts, AIReal dist)
{
	if (pts.size() < 2) return;
	AIRealPoint dir = Depart(pts[0], pts[1]);
	AIRealPoint back;
	back.h = -dir.h;
	back.v = -dir.v;
	AIPathSegment ext = Straight(Beyond(pts[0].p, back, dist));
	if (Distance(ext.p, pts[0].p) < 0.05) return;
	pts[0].in = pts[0].p;
	pts[0].corner = true;
	pts.insert(pts.begin(), ext);
}

void ExtendEnd(std::vector<AIPathSegment>& pts, AIReal dist)
{
	if (pts.size() < 2) return;
	size_t last = pts.size() - 1;
	AIRealPoint dir = Arrive(pts[last - 1], pts[last]);
	AIPathSegment ext = Straight(Beyond(pts[last].p, dir, dist));
	if (Distance(ext.p, pts[last].p) < 0.05) return;
	pts[last].out = pts[last].p;
	pts[last].corner = true;
	pts.push_back(ext);
}

Segs OpenAt(const Segs& segs, int index)
{
	Segs out;
	out.closed = false;
	int n = (int)segs.pts.size();
	for (int k = 0; k < n; ++k) out.pts.push_back(segs.pts[(index + k) % n]);
	out.pts.push_back(segs.pts[index]);
	out.pts.front().in = out.pts.front().p;
	out.pts.back().out = out.pts.back().p;
	return out;
}

void ReverseSegs(std::vector<AIPathSegment>& pts)
{
	std::reverse(pts.begin(), pts.end());
	for (size_t i = 0; i < pts.size(); ++i) {
		AIRealPoint tmp = pts[i].in;
		pts[i].in = pts[i].out;
		pts[i].out = tmp;
	}
}

bool SplitAtHalf(const std::vector<AIPathSegment>& pts, std::vector<AIPathSegment>& left, std::vector<AIPathSegment>& right)
{
	if (pts.size() < 3) return false;
	AIReal total = 0;
	for (size_t i = 0; i + 1 < pts.size(); ++i) total += CurveLength(pts[i], pts[i + 1]);
	if (total < 0.2) return false;
	AIReal target = total * 0.5;
	AIReal acc = 0;
	for (size_t i = 0; i + 1 < pts.size(); ++i) {
		AIReal seg = CurveLength(pts[i], pts[i + 1]);
		if (seg < 0.01) continue;
		if (acc + seg < target && i + 2 < pts.size()) {
			acc += seg;
			continue;
		}
		AIReal remain = target - acc;
		AIReal t = remain / seg;
		AIRealBezier bez = BezierOf(pts[i], pts[i + 1]);
		AIReal solved = t;
		if (sAIRealBezier->TAtLength(&bez, remain, seg, (AIReal)0.01, &solved) == kNoErr) t = solved;
		if (t < 0.05) t = 0.05;
		if (t > 0.95) t = 0.95;
		AIPathSegment a = pts[i];
		AIPathSegment b = pts[i + 1];
		AIPathSegment mid;
		SplitCurve(a, b, t, mid);
		left.clear();
		right.clear();
		for (size_t k = 0; k < i; ++k) left.push_back(pts[k]);
		left.push_back(a);
		left.push_back(mid);
		mid.in = mid.p;
		right.push_back(mid);
		right.push_back(b);
		for (size_t k = i + 2; k < pts.size(); ++k) right.push_back(pts[k]);
		return left.size() >= 2 && right.size() >= 2;
	}
	return false;
}

ASErr CutOver(AIArtHandle path, Segs segs, int index)
{
	ToolSettings cfg = LoadToolSettings();
	AIReal dist = (AIReal)(cfg.cutOverMm * kPtPerMm);
	AIReal loop = (AIReal)(cfg.loopMm * kPtPerMm);
	if (segs.closed) {
		Segs open = OpenAt(segs, index);
		ExtendStart(open.pts, dist);
		ExtendEnd(open.pts, dist);
		if (cfg.connectLoops) CloseWithLoop(open, loop);
		return ReplaceWith(path, open, "Cut over");
	}
	int last = (int)segs.pts.size() - 1;
	if (index <= 0) {
		ExtendStart(segs.pts, dist);
		segs.closed = false;
		return ReplaceWith(path, segs, "Cut over");
	}
	if (index >= last) {
		ExtendEnd(segs.pts, dist);
		segs.closed = false;
		return ReplaceWith(path, segs, "Cut over");
	}
	Segs left;
	Segs right;
	left.closed = false;
	right.closed = false;
	left.pts.assign(segs.pts.begin(), segs.pts.begin() + index + 1);
	right.pts.assign(segs.pts.begin() + index, segs.pts.end());
	ExtendEnd(left.pts, dist);
	ExtendStart(right.pts, dist);
	if (cfg.connectLoops) return ReplaceWith(path, JoinWithLoop(left, right, loop), "Cut over");
	return ReplaceWithTwo(path, left, right, "Cut over");
}

ASErr SplitInward(AIArtHandle path, Segs segs, int index)
{
	if (segs.closed) {
		Segs open = OpenAt(segs, index);
		std::vector<AIPathSegment> left, right;
		if (!SplitAtHalf(open.pts, left, right)) return kNoErr;
		ReverseSegs(right);
		Segs a;
		Segs b;
		a.closed = false;
		b.closed = false;
		a.pts.swap(left);
		b.pts.swap(right);
		return ReplaceWithTwo(path, a, b, "Split inward");
	}
	int last = (int)segs.pts.size() - 1;
	if (index <= 0) return kNoErr;
	if (index >= last) {
		ReverseSegs(segs.pts);
		segs.closed = false;
		return ReplaceWith(path, segs, "Split inward");
	}
	Segs left;
	Segs right;
	left.closed = false;
	right.closed = false;
	left.pts.assign(segs.pts.begin(), segs.pts.begin() + index + 1);
	right.pts.assign(segs.pts.begin() + index, segs.pts.end());
	ReverseSegs(left.pts);
	return ReplaceWithTwo(path, left, right, "Split inward");
}

std::vector<AIPathSegment> ClipForward(const std::vector<AIPathSegment>& pts, AIReal dist)
{
	std::vector<AIPathSegment> out;
	if (pts.size() < 2 || dist < 0.01) return out;
	out.push_back(pts[0]);
	AIReal remain = dist;
	for (size_t i = 0; i + 1 < pts.size(); ++i) {
		AIReal seg = CurveLength(pts[i], pts[i + 1]);
		if (seg < 0.01) continue;
		if (remain >= seg - 0.01) {
			out.push_back(pts[i + 1]);
			remain -= seg;
			if (remain <= 0.01) return out;
			continue;
		}
		AIRealBezier bez = BezierOf(pts[i], pts[i + 1]);
		AIReal t = remain / seg;
		AIReal solved = t;
		if (sAIRealBezier->TAtLength(&bez, remain, seg, (AIReal)0.01, &solved) == kNoErr) t = solved;
		if (t <= 0.001) return out;
		if (t >= 0.999) {
			out.push_back(pts[i + 1]);
			return out;
		}
		AIPathSegment a = out.back();
		AIPathSegment b = pts[i + 1];
		AIPathSegment mid;
		SplitCurve(a, b, t, mid);
		out.back().out = a.out;
		out.push_back(mid);
		return out;
	}
	return out;
}

std::vector<AIPathSegment> TakeInto(const std::vector<AIPathSegment>& pts, bool fromStart, AIReal dist)
{
	std::vector<AIPathSegment> oriented = pts;
	if (!fromStart) ReverseSegs(oriented);
	return ClipForward(oriented, dist);
}

void ShiftOnto(std::vector<AIPathSegment>& pts, const AIRealPoint& anchor)
{
	if (pts.empty()) return;
	AIReal dx = anchor.h - pts[0].p.h;
	AIReal dy = anchor.v - pts[0].p.v;
	if (dx * dx + dy * dy < 1e-8) return;
	for (size_t i = 0; i < pts.size(); ++i) {
		pts[i].p.h += dx;
		pts[i].p.v += dy;
		pts[i].in.h += dx;
		pts[i].in.v += dy;
		pts[i].out.h += dx;
		pts[i].out.v += dy;
	}
}

void Attach(std::vector<AIPathSegment>& pts, bool atStart, const std::vector<AIPathSegment>& piece)
{
	if (piece.size() < 2 || pts.size() < 2) return;
	if (!atStart) {
		pts.back().out = piece[0].out;
		pts.back().corner = true;
		for (size_t k = 1; k < piece.size(); ++k) pts.push_back(piece[k]);
		return;
	}
	std::vector<AIPathSegment> rev = piece;
	ReverseSegs(rev);
	pts.front().in = rev.back().in;
	pts.front().corner = true;
	pts.insert(pts.begin(), rev.begin(), rev.end() - 1);
}

struct CurveHit {
	int seg;
	AIReal t;
	AIReal dist;
	AIRealPoint at;
};

bool ClosestOnPath(const Segs& segs, const AIRealPoint& target, AIReal limit, CurveHit& hit)
{
	hit.dist = 1e9f;
	hit.seg = -1;
	int n = (int)segs.pts.size();
	int count = segs.closed ? n : n - 1;
	if (count < 1) return false;
	for (int i = 0; i < n; ++i) {
		AIReal dist = Distance(segs.pts[i].p, target);
		if (dist >= hit.dist) continue;
		hit.dist = dist;
		hit.at = segs.pts[i].p;
		if (!segs.closed && i == n - 1) {
			hit.seg = n - 2;
			hit.t = 1;
		}
		else {
			hit.seg = i;
			hit.t = 0;
		}
	}
	for (int i = 0; i < count; ++i) {
		int j = (i + 1) % n;
		AIRealBezier bez = BezierOf(segs.pts[i], segs.pts[j]);
		for (int step = 0; step <= 32; ++step) {
			AIReal t = (AIReal)step / 32.0f;
			AIRealPoint point;
			sAIRealBezier->Evaluate(&bez, t, &point);
			AIReal dist = Distance(point, target);
			if (dist < hit.dist) {
				hit.dist = dist;
				hit.seg = i;
				hit.t = t;
				hit.at = point;
			}
		}
	}
	if (hit.seg < 0 || hit.dist > limit) return false;
	int next = (hit.seg + 1) % n;
	AIRealBezier bez = BezierOf(segs.pts[hit.seg], segs.pts[next]);
	AIReal lo = hit.t - (1.0f / 32.0f);
	AIReal hi = hit.t + (1.0f / 32.0f);
	if (lo < 0) lo = 0;
	if (hi > 1) hi = 1;
	for (int step = 0; step <= 16; ++step) {
		AIReal t = lo + (hi - lo) * ((AIReal)step / 16.0f);
		AIRealPoint point;
		sAIRealBezier->Evaluate(&bez, t, &point);
		AIReal dist = Distance(point, target);
		if (dist < hit.dist) {
			hit.dist = dist;
			hit.t = t;
			hit.at = point;
		}
	}
	return true;
}

std::vector<AIPathSegment> ClipFrom(const std::vector<AIPathSegment>& pts, int index, bool forward, AIReal dist)
{
	std::vector<AIPathSegment> oriented;
	if (index < 0 || index >= (int)pts.size()) return oriented;
	if (forward) oriented.assign(pts.begin() + index, pts.end());
	else {
		oriented.assign(pts.begin(), pts.begin() + index + 1);
		ReverseSegs(oriented);
	}
	return ClipForward(oriented, dist);
}

void ClipsAt(const Segs& src, int index, AIReal dist, std::vector<AIPathSegment>& forward, std::vector<AIPathSegment>& back)
{
	if (src.closed) {
		Segs opened = OpenAt(src, index);
		forward = ClipFrom(opened.pts, 0, true, dist);
		back = ClipFrom(opened.pts, (int)opened.pts.size() - 1, false, dist);
		return;
	}
	forward = ClipFrom(src.pts, index, true, dist);
	back = ClipFrom(src.pts, index, false, dist);
}

AIRealPoint LeaveOf(const std::vector<AIPathSegment>& clip)
{
	AIRealPoint none;
	none.h = 0;
	none.v = 0;
	if (clip.size() < 2) return none;
	return Depart(clip[0], clip[1]);
}

std::vector<AIPathSegment> ChooseClip(const std::vector<AIPathSegment>& forward, const std::vector<AIPathSegment>& back, const AIRealPoint& want)
{
	bool hasForward = forward.size() >= 2;
	bool hasBack = back.size() >= 2;
	if (hasForward && !hasBack) return forward;
	if (hasBack && !hasForward) return back;
	if (!hasForward) return forward;
	AIReal forwardDot = LeaveOf(forward).h * want.h + LeaveOf(forward).v * want.v;
	AIReal backDot = LeaveOf(back).h * want.h + LeaveOf(back).v * want.v;
	return forwardDot >= backDot ? forward : back;
}

int AnchorAtPoint(Segs& segs, const CurveHit& hit)
{
	int found = -1;
	AIReal best = 0.8f;
	for (int i = 0; i < (int)segs.pts.size(); ++i) {
		AIReal dist = Distance(segs.pts[i].p, hit.at);
		if (dist > best) continue;
		best = dist;
		found = i;
	}
	if (found >= 0) return found;
	return EnsureAnchor(segs, hit.seg, hit.t, kSegmentHitType);
}

bool ClipLeadsTo(AIArtHandle self, const AIRealPoint& from, const AIRealPoint& dir, AIReal dist, std::vector<AIPathSegment>& clip)
{
	AIArtHandle** matches = NULL;
	ai::int32 count = 0;
	AIMatchingArtSpec spec(kPathArt, 0, 0);
	if (sAIMatchingArt->GetMatchingArt(&spec, 1, &matches, &count) != kNoErr) return false;
	bool got = false;
	AIReal bestScore = 1e9f;
	for (ai::int32 i = 0; i < count; ++i) {
		AIArtHandle candidate = (*matches)[i];
		if (candidate == self || !UsablePath(candidate)) continue;
		Segs segs;
		if (ReadSegs(candidate, segs) != kNoErr || segs.pts.size() < 2) continue;
		ai::int32 attr = 0;
		bool selected = sAIArt->GetArtUserAttr(candidate, kArtSelected, &attr) == kNoErr && (attr & kArtSelected) != 0;
		AIReal allow = selected ? 30.0f * kPtPerMm : 20.0f * kPtPerMm;
		CurveHit found;
		if (!ClosestOnPath(segs, from, allow, found)) continue;
		AIRealPoint delta = SubPoint(found.at, from);
		AIReal gap = LengthPoint(delta);
		AIReal align = 1;
		AIReal dirLen = LengthPoint(dir);
		if (gap > 1.0f * kPtPerMm && dirLen > 0.01f) align = (delta.h * dir.h + delta.v * dir.v) / (gap * dirLen);
		if (!selected && align < 0 && gap > 3.0f * kPtPerMm) continue;
		Segs edited = segs;
		int at = AnchorAtPoint(edited, found);
		if (at < 0) continue;
		std::vector<AIPathSegment> forward;
		std::vector<AIPathSegment> back;
		ClipsAt(edited, at, dist, forward, back);
		std::vector<AIPathSegment> pick = ChooseClip(forward, back, dir);
		if (pick.size() < 2 || Distance(pick.front().p, pick.back().p) < 0.05f) continue;
		AIReal score = gap - align * (4.0f * kPtPerMm);
		if (selected) score -= 40.0f * kPtPerMm;
		if (score >= bestScore) continue;
		ShiftOnto(pick, from);
		clip = pick;
		bestScore = score;
		got = true;
	}
	if (matches) sAIMdMemory->MdMemoryDisposeHandle((AIMdMemoryHandle)matches);
	return got;
}

bool ExtendOpenEnd(std::vector<AIPathSegment>& pts, bool atStart, AIReal dist, AIArtHandle self)
{
	if (pts.size() < 2) return false;
	AIRealPoint from;
	AIRealPoint dir;
	if (atStart) {
		from = pts.front().p;
		dir = Depart(pts[0], pts[1]);
		dir.h = -dir.h;
		dir.v = -dir.v;
	}
	else {
		from = pts.back().p;
		dir = Arrive(pts[pts.size() - 2], pts.back());
	}
	std::vector<AIPathSegment> clip;
	if (!ClipLeadsTo(self, from, dir, dist, clip)) return false;
	Attach(pts, atStart, clip);
	return true;
}

AIRealPoint PathCentroid(const std::vector<AIPathSegment>& pts)
{
	AIRealPoint center;
	center.h = 0;
	center.v = 0;
	if (pts.empty()) return center;
	for (size_t i = 0; i < pts.size(); ++i) {
		center.h += pts[i].p.h;
		center.v += pts[i].p.v;
	}
	center.h /= (AIReal)pts.size();
	center.v /= (AIReal)pts.size();
	return center;
}

AIRealPoint OutsideNormal(const Segs& segs, int index)
{
	int n = (int)segs.pts.size();
	int next = index + 1;
	if (next >= n) next = segs.closed ? 0 : index;
	int prev = index - 1;
	if (prev < 0) prev = segs.closed ? n - 1 : 0;
	AIRealPoint dir = next != index ? Depart(segs.pts[index], segs.pts[next]) : Arrive(segs.pts[prev], segs.pts[index]);
	AIRealPoint unit = UnitPoint(dir);
	AIRealPoint left;
	left.h = -unit.v;
	left.v = unit.h;
	if (!segs.closed || LengthPoint(unit) < 0.5) return left;
	AIRealPoint center = PathCentroid(segs.pts);
	AIRealPoint outward = SubPoint(segs.pts[index].p, center);
	if (left.h * outward.h + left.v * outward.v < 0) {
		left.h = -left.h;
		left.v = -left.v;
	}
	return left;
}

void FadeTip(std::vector<AIPathSegment>& pts, bool atStart, AIReal steep, AIReal handle, const AIRealPoint& normal)
{
	if (pts.size() < 2 || fabs(steep) < 0.01) return;
	size_t tipIndex = atStart ? 0 : pts.size() - 1;
	size_t joinIndex = atStart ? 1 : pts.size() - 2;
	AIPathSegment join = pts[joinIndex];
	AIPathSegment on = pts[tipIndex];
	AIRealPoint towardTip = UnitPoint(SubPoint(on.p, join.p));
	if (LengthPoint(towardTip) < 0.5) return;
	const AIReal arc = (AIReal)0.5522847498;
	AIReal along = handle;
	if (along < 0.15) along = 0.15;
	AIReal side = fabs(steep);
	AIRealPoint sideDir = UnitPoint(ScalePoint(normal, steep));
	if (LengthPoint(sideDir) < 0.5) sideDir = normal;
	AIPathSegment tip = Straight(AddPoint(AddPoint(on.p, ScalePoint(towardTip, along)), ScalePoint(sideDir, side)));
	AIRealPoint tipHandle = ScalePoint(sideDir, -(side * arc));
	AIRealPoint pathHandle = ScalePoint(towardTip, along * arc);
	on.corner = false;
	tip.corner = false;
	if (atStart) {
		tip.in = tip.p;
		tip.out = AddPoint(tip.p, tipHandle);
		on.in = AddPoint(on.p, pathHandle);
		pts[tipIndex] = on;
		pts.insert(pts.begin(), tip);
	}
	else {
		tip.out = tip.p;
		tip.in = AddPoint(tip.p, tipHandle);
		on.out = AddPoint(on.p, pathHandle);
		pts[tipIndex] = on;
		pts.push_back(tip);
	}
}

ASErr Overlap(AIArtHandle path, Segs segs, int index)
{
	if (segs.pts.size() < 2 || index < 0 || index >= (int)segs.pts.size()) return kNoErr;
	ToolSettings cfg = LoadToolSettings();
	AIReal dist = (AIReal)(cfg.overlapMm * kPtPerMm);
	AIReal steep = (AIReal)(cfg.curveSteepnessMm * kPtPerMm);
	AIReal handle = (AIReal)(cfg.curveOffsetMm * kPtPerMm);
	AIRealPoint outside = OutsideNormal(segs, index);
	bool fade = cfg.fadeIn;
	if (segs.closed) {
		Segs open = OpenAt(segs, index);
		std::vector<AIPathSegment> endClip = ClipForward(open.pts, dist);
		std::vector<AIPathSegment> startClip = TakeInto(open.pts, false, dist);
		if (endClip.size() >= 2) Attach(open.pts, false, endClip);
		if (startClip.size() >= 2) Attach(open.pts, true, startClip);
		if (fade) {
			FadeTip(open.pts, true, steep, handle, outside);
			FadeTip(open.pts, false, steep, handle, outside);
		}
		return ReplaceWith(path, open, "Overlap");
	}
	int last = (int)segs.pts.size() - 1;
	if (index <= 0) {
		if (!ExtendOpenEnd(segs.pts, true, dist, path)) return kNoErr;
		segs.closed = false;
		if (fade) FadeTip(segs.pts, true, steep, handle, outside);
		return ReplaceWith(path, segs, "Overlap");
	}
	if (index >= last) {
		if (!ExtendOpenEnd(segs.pts, false, dist, path)) return kNoErr;
		segs.closed = false;
		if (fade) FadeTip(segs.pts, false, steep, handle, outside);
		return ReplaceWith(path, segs, "Overlap");
	}
	Segs left;
	Segs right;
	left.closed = false;
	right.closed = false;
	left.pts.assign(segs.pts.begin(), segs.pts.begin() + index + 1);
	right.pts.assign(segs.pts.begin() + index, segs.pts.end());
	std::vector<AIPathSegment> endClip = ClipForward(right.pts, dist);
	std::vector<AIPathSegment> startClip = TakeInto(left.pts, false, dist);
	if (endClip.size() >= 2) Attach(left.pts, false, endClip);
	if (startClip.size() >= 2) Attach(right.pts, true, startClip);
	if (fade) {
		FadeTip(left.pts, false, steep, handle, outside);
		FadeTip(right.pts, true, steep, handle, outside);
	}
	return ReplaceWithTwo(path, left, right, "Overlap");
}

void MarkUndo(const char* name)
{
	ai::UnicodeString undo("Undo ");
	undo.append(ai::UnicodeString(name));
	ai::UnicodeString redo("Redo ");
	redo.append(ai::UnicodeString(name));
	sAIUndo->SetUndoTextUS(undo, redo);
}

bool ViewPoint(const AIRealPoint& art, AIRealPoint& view)
{
	AIDocumentViewHandle doc = NULL;
	if (sAIDocumentView->GetNthDocumentView(0, &doc) != kNoErr || !doc) return false;
	return sAIDocumentView->FixedArtworkPointToViewPoint(doc, &art, &view) == kNoErr;
}

int NearestAnchor(const Segs& segs, const AIRealPoint& cursor)
{
	AIRealPoint cursorView;
	if (!ViewPoint(cursor, cursorView)) return -1;
	int best = -1;
	AIReal bestD = kAnchorPixels;
	for (int i = 0; i < (int)segs.pts.size(); ++i) {
		AIRealPoint anchorView;
		if (!ViewPoint(segs.pts[i].p, anchorView)) continue;
		AIReal d = Distance(cursorView, anchorView);
		if (d <= bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}

AIReal ReachForPixels(AIReal pixels)
{
	if (pixels < 1) pixels = 1;
	AIDocumentViewHandle doc = NULL;
	if (sAIDocumentView->GetNthDocumentView(0, &doc) != kNoErr || !doc) return pixels;
	AIRealPoint zero;
	zero.h = 0;
	zero.v = 0;
	AIRealPoint shift;
	shift.h = pixels;
	shift.v = 0;
	AIRealPoint from;
	AIRealPoint to;
	if (sAIDocumentView->FixedViewPointToArtworkPoint(doc, &zero, &from) != kNoErr) return pixels;
	if (sAIDocumentView->FixedViewPointToArtworkPoint(doc, &shift, &to) != kNoErr) return pixels;
	AIReal span = Distance(from, to);
	return span > 0.01f ? span : pixels;
}

struct PathPick {
	AIArtHandle path;
	Segs segs;
	int hitType;
	int seg;
	AIReal t;
};

bool ReadHit(AIHitRef hit, PathPick& pick)
{
	if (!hit || !sAIHitTest->IsHit(hit)) return false;
	AIArtHandle path = sAIHitTest->GetArt(hit);
	if (!UsablePath(path) || ReadSegs(path, pick.segs) != kNoErr) return false;
	pick.path = path;
	pick.hitType = (int)sAIHitTest->GetType(hit);
	pick.seg = (int)sAIHitTest->GetPathSegment(hit);
	pick.t = pick.hitType == kSegmentHitType ? sAIHitTest->GetPathParameter(hit) : 0;
	return true;
}

bool HitRequest(const AIRealPoint& at, ai::int32 request, PathPick& pick)
{
	AIHitRef hit = NULL;
	if (sAIHitTest->HitTestEx(NULL, &at, 8.0, request, &hit) != kNoErr) return false;
	return ReadHit(hit, pick);
}

bool PickPath(const AIRealPoint& at, PathPick& pick, bool scan)
{
	if (HitRequest(at, kStrokeHitRequest, pick)) return true;
	if (HitRequest(at, kNearestPointOnPathHitRequest, pick)) return true;
	if (HitRequest(at, kAllNoFillHitRequest, pick)) return true;
	if (!scan) return false;

	AIArtHandle** matches = NULL;
	ai::int32 count = 0;
	AIMatchingArtSpec spec(kPathArt, 0, 0);
	if (sAIMatchingArt->GetMatchingArt(&spec, 1, &matches, &count) != kNoErr) return false;
	AIReal limit = ReachForPixels(8);
	bool found = false;
	CurveHit best;
	best.dist = limit + 1;
	for (ai::int32 i = 0; i < count; ++i) {
		AIArtHandle candidate = (*matches)[i];
		if (!UsablePath(candidate)) continue;
		Segs segs;
		if (ReadSegs(candidate, segs) != kNoErr) continue;
		CurveHit on;
		if (!ClosestOnPath(segs, at, limit, on) || on.dist >= best.dist) continue;
		best = on;
		pick.path = candidate;
		pick.segs = segs;
		pick.hitType = kSegmentHitType;
		pick.seg = on.seg;
		pick.t = on.t;
		found = true;
	}
	if (matches) sAIMdMemory->MdMemoryDisposeHandle((AIMdMemoryHandle)matches);
	return found;
}

int AnchorOrNew(PathPick& pick, const AIRealPoint& at)
{
	int anchor = NearestAnchor(pick.segs, at);
	if (anchor >= 0) return anchor;
	CurveHit on;
	if (ClosestOnPath(pick.segs, at, 2000, on)) return EnsureAnchor(pick.segs, on.seg, on.t, kSegmentHitType);
	if (pick.hitType == kSegmentHitType) return EnsureAnchor(pick.segs, pick.seg, pick.t, kSegmentHitType);
	return -1;
}

} // namespace

AIRealPoint SnapCursor(const AIRealPoint& cursor, const AIEvent* event)
{
	AIRealPoint snapped = cursor;
	AIDocumentViewHandle view = NULL;
	if (!event) return snapped;
	if (sAIDocumentView->GetNthDocumentView(0, &view) != kNoErr || !view) return snapped;
	sAICursorSnap->HitTrack(view, cursor, event, "A v o", &snapped, true);
	return snapped;
}

ASErr EditPathAt(PathEditKind kind, const AIRealPoint& cursor, const AIEvent* event)
{
	PathPick pick;
	AIRealPoint aim = cursor;
	if (!PickPath(cursor, pick, true)) {
		aim = SnapCursor(cursor, event);
		if (!PickPath(aim, pick, true)) return kNoErr;
	}
	int index = AnchorOrNew(pick, cursor);
	if (index < 0) index = AnchorOrNew(pick, aim);
	if (index < 0 || index >= (int)pick.segs.pts.size()) return kNoErr;
	if (kind == kEditOverlap) return Overlap(pick.path, pick.segs, index);
	if (kind == kEditCutOver) return CutOver(pick.path, pick.segs, index);
	return SplitInward(pick.path, pick.segs, index);
}

int CursorMode(const AIRealPoint& cursor)
{
	PathPick pick;
	if (!PickPath(cursor, pick, false)) return 0;
	return NearestAnchor(pick.segs, cursor) >= 0 ? 2 : 1;
}

namespace {

ai::int32 ReverseArt(AIArtHandle art)
{
	if (!art) return 0;
	short type = 0;
	if (sAIArt->GetArtType(art, &type) != kNoErr) return 0;
	ai::int32 attr = 0;
	if (sAIArt->GetArtUserAttr(art, kArtLocked | kArtHidden, &attr) != kNoErr) return 0;
	if (attr & (kArtLocked | kArtHidden)) return 0;
	if (type == kPathArt) {
		AIBoolean guide = false;
		if (sAIPath->GetPathGuide(art, &guide) != kNoErr || guide) return 0;
		return sAIPath->ReversePathDirection(art) == kNoErr ? 1 : 0;
	}
	if (type != kGroupArt && type != kCompoundPathArt) return 0;
	ai::int32 changed = 0;
	AIArtHandle child = NULL;
	if (sAIArt->GetArtFirstChild(art, &child) != kNoErr) return 0;
	while (child) {
		changed += ReverseArt(child);
		AIArtHandle next = NULL;
		if (sAIArt->GetArtSibling(child, &next) != kNoErr) break;
		child = next;
	}
	return changed;
}

}

ASErr ReverseSelectedPaths()
{
	AIArtHandle** matches = NULL;
	ai::int32 count = 0;
	ASErr err = sAIMatchingArt->GetSelectedArt(&matches, &count);
	if (err) return err;
	ai::int32 changed = 0;
	for (ai::int32 i = 0; i < count; ++i) changed += ReverseArt((*matches)[i]);
	if (matches) sAIMdMemory->MdMemoryDisposeHandle((AIMdMemoryHandle)matches);
	if (!changed) return kNoErr;
	ai::UnicodeString undo("Undo Pfadrichtung umkehren");
	ai::UnicodeString redo("Redo Pfadrichtung umkehren");
	sAIUndo->SetUndoTextUS(undo, redo);
	return kNoErr;
}

void SelectOnePath(AIArtHandle path)
{
	AIArtHandle** matches = NULL;
	ai::int32 count = 0;
	if (sAIMatchingArt->GetSelectedArt(&matches, &count) == kNoErr) {
		for (ai::int32 i = 0; i < count; ++i) sAIArt->SetArtUserAttr((*matches)[i], kArtSelected, 0);
		if (matches) sAIMdMemory->MdMemoryDisposeHandle((AIMdMemoryHandle)matches);
	}
	sAIArt->SetArtUserAttr(path, kArtSelected, kArtSelected);
	ai::int16 points = 0;
	if (sAIPath->GetPathSegmentCount(path, &points) == kNoErr && points > 0) {
		std::vector<ai::int16> selected(points, kSegmentPointSelected);
		sAIPath->SetPathSegmentsSelected(path, 0, points, &selected[0]);
	}
	AIArtHandle parent = NULL;
	if (sAIArt->GetArtParent(path, &parent) != kNoErr) return;
	while (parent) {
		sAIArt->SetArtUserAttr(parent, kArtSelected, 0);
		AIArtHandle next = NULL;
		if (sAIArt->GetArtParent(parent, &next) != kNoErr) break;
		parent = next;
	}
}

ASErr ReverseClickedPath(const AIRealPoint& cursor, const AIEvent* event)
{
	PathPick pick;
	AIRealPoint aim = cursor;
	if (!PickPath(cursor, pick, true)) {
		aim = SnapCursor(cursor, event);
		if (!PickPath(aim, pick, true)) return kNoErr;
	}
	if (!ReverseArt(pick.path)) return kNoErr;
	SelectOnePath(pick.path);
	ai::UnicodeString undo("Undo Pfadrichtung umkehren");
	ai::UnicodeString redo("Redo Pfadrichtung umkehren");
	sAIUndo->SetUndoTextUS(undo, redo);
	return kNoErr;
}
