#ifndef __PATHEDIT_H__
#define __PATHEDIT_H__

#include "IllustratorSDK.h"

enum PathEditKind {
	kEditCutOver = 0,
	kEditSplitInward = 1,
	kEditOverlap = 2
};

// Click is in artwork coordinates. A miss leaves the document unchanged.
ASErr EditPathAt(PathEditKind kind, const AIRealPoint& cursor, const AIEvent* event);

// 2 when the click will use an existing anchor, 1 when it will add one on the path, 0 otherwise.
int CursorMode(const AIRealPoint& cursor);

ASErr EditToolOptions(PathEditKind kind);

// Reverses every selected path. Does nothing when no path is selected.
ASErr ReverseSelectedPaths();

// Reverses only the path under the cursor, the way Direct Selection targets one path.
ASErr ReverseClickedPath(const AIRealPoint& cursor, const AIEvent* event);

#endif
