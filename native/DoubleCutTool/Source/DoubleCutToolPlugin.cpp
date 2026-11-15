#include "IllustratorSDK.h"
#include "DoubleCutToolPlugin.h"
#include "PathEdit.h"
#include "AIRuntime.h"
#include "AIMenuGroups.h"
#include "AIToolNames.h"
#include "resource.h"

#include <windows.h>
#include <string.h>

Plugin* AllocatePlugin(SPPluginRef pluginRef)
{
	return new DoubleCutToolPlugin(pluginRef);
}

void FixupReload(Plugin* plugin)
{
	DoubleCutToolPlugin::FixupVTable((DoubleCutToolPlugin*)plugin);
}

DoubleCutToolPlugin::DoubleCutToolPlugin(SPPluginRef pluginRef)
	: Plugin(pluginRef),
	fShutdownNotifier(NULL),
	fResourceMgr(NULL)
{
	fTool[0] = fTool[1] = fTool[2] = fTool[3] = NULL;
	fMenu[0] = fMenu[1] = fMenu[2] = fMenu[3] = NULL;
	strncpy(fPluginName, kDoubleCutToolPluginName, kMaxStringLength);
	fPluginName[kMaxStringLength - 1] = 0;
}

ASErr DoubleCutToolPlugin::Message(char* caller, char* selector, void* message)
{
	ASErr error = kNoErr;
	try {
		error = Plugin::Message(caller, selector, message);
	}
	catch (ai::Error& ex) {
		error = ex;
	}
	catch (...) {
		error = kCantHappenErr;
	}
	if (error && error != kUnhandledMsgErr) Plugin::ReportError(error, caller, selector, message);
	return error;
}

ASErr DoubleCutToolPlugin::StartupPlugin(SPInterfaceMessage* message)
{
	ASErr error = Plugin::StartupPlugin(message);
	if (error) return error;
	error = AddTools(message);
	if (error) return error;
	error = AddMenus(message);
	if (error) return error;
	return sAINotifier->AddNotifier(fPluginRef, "DoubleCut Shutdown", kAIApplicationShutdownNotifier, &fShutdownNotifier);
}

ASErr DoubleCutToolPlugin::PostStartupPlugin()
{
	return sAIUser->CreateCursorResourceMgr(fPluginRef, &fResourceMgr);
}

ASErr DoubleCutToolPlugin::Notify(AINotifierMessage* message)
{
	if (message->notifier == fShutdownNotifier && fResourceMgr) {
		sAIUser->DisposeCursorResourceMgr(fResourceMgr);
		fResourceMgr = NULL;
	}
	return kNoErr;
}

ASErr DoubleCutToolPlugin::AddTools(SPInterfaceMessage* message)
{
	const char* names[4] = { kCutOverToolName, kSplitInToolName, kOverlapToolName, kReverseToolName };
	const char* titles[4] = {
		"Cut over. Click a path, including between anchors. An anchor is added there and the path is cut over. Double-click for millimetres and the loop.",
		"Split inward. Click a path, including between anchors. An anchor is added there and both cuts start at that point. Double-click for details.",
		"Overlap. Click a path. Each end continues along the path it leads into. With fade in, click the path, then drag the side: along the path sets curve offset, away from it sets steepness. Double-click for settings.",
		"Pfadrichtung umkehren. Click one path, including inside a group, and its direction reverses. Assign the shortcut under Keyboard Shortcuts, Tools."
	};
	ai::uint32 icons[4] = { kCutOverIconResID, kSplitInIconResID, kOverlapIconResID, kReverseIconResID };
	for (int i = 0; i < 4; ++i) {
		AIAddToolData data;
		data.title = ai::UnicodeString(names[i]);
		data.tooltip = ai::UnicodeString(titles[i]);
		data.normalIconResID = icons[i];
		data.darkIconResID = icons[i];
		data.iconType = ai::IconType::kSVG;
		if (i == 0) {
			data.sameGroupAs = kNoTool;
			data.sameToolsetAs = kNoTool;
		}
		else {
			ASErr found = sAITool->GetToolNumberFromName(names[0], &data.sameGroupAs);
			if (found) return found;
			found = sAITool->GetToolNumberFromName(names[0], &data.sameToolsetAs);
			if (found) return found;
		}
		ai::int32 options = kToolWantsToTrackCursorOption;
		if (i == 3) options |= kToolWantsAlternateSelectionTool;
		ASErr error = sAITool->AddTool(message->d.self, names[i], data, options, &fTool[i]);
		if (error) return error;
		if (i == 3) sAITool->SetAlternateSelectionToolName(fTool[i], kDirectSelectTool);
	}
	return kNoErr;
}

ASErr DoubleCutToolPlugin::AddMenus(SPInterfaceMessage* message)
{
	AIPlatformAddMenuItemDataUS root;
	root.groupName = kWindowUtilsMenuGroup;
	root.itemText = ai::UnicodeString("DoubleCut");
	AIMenuItemHandle parent = NULL;
	ASErr error = sAIMenu->AddMenuItem(message->d.self, "DoubleCut Menu", &root, 0, &parent);
	if (error) return error;
	AIMenuGroup group = NULL;
	error = sAIMenu->AddMenuGroupAsSubMenu("DoubleCut Group", 0, parent, &group);
	if (error) return error;

	const char* labels[4] = { "Cut over", "Split inward", "Overlap", "Pfadrichtung umkehren" };
	const char* keys[4] = { "DoubleCut Cut Over", "DoubleCut Split Inward", "DoubleCut Overlap", "DoubleCut Reverse Path" };
	const char cmds[3] = { 'C', 'S', 'O' };
	ai::int16 mods = (ai::int16)(kMenuItemCmdControlModifier | kMenuItemCmdOptionModifier | kMenuItemCmdShiftModifier);
	for (int i = 0; i < 4; ++i) {
		AIPlatformAddMenuItemDataUS item;
		item.groupName = "DoubleCut Group";
		item.itemText = ai::UnicodeString(labels[i]);
		error = sAIMenu->AddMenuItem(message->d.self, keys[i], &item, 0, &fMenu[i]);
		if (error) return error;
		if (i < 3) {
			error = sAIMenu->SetItemCmd(fMenu[i], cmds[i], mods);
			if (error) return error;
		}
	}
	return kNoErr;
}

ASErr DoubleCutToolPlugin::GoMenuItem(AIMenuMessage* message)
{
	for (int i = 0; i < 4; ++i) {
		if (message->menuItem == fMenu[i] && fTool[i]) return sAITool->SetSelectedTool(fTool[i]);
	}
	return kNoErr;
}

int DoubleCutToolPlugin::ToolIndex(AIToolHandle tool) const
{
	for (int i = 0; i < 3; ++i) if (tool == fTool[i]) return i;
	return 0;
}

ASErr DoubleCutToolPlugin::EditTool(AIToolMessage* message)
{
	if (message->tool == fTool[3]) return kNoErr;
	return EditToolOptions((PathEditKind)ToolIndex(message->tool));
}

static void PaintCursorBit(BYTE* andPlane, BYTE* xorPlane, int x, int y, bool white)
{
	if (x < 0 || y < 0 || x >= 32 || y >= 32) return;
	int bit = 7 - (x & 7);
	BYTE mask = (BYTE)(1 << bit);
	BYTE* a = andPlane + y * 4 + (x >> 3);
	BYTE* xplane = xorPlane + y * 4 + (x >> 3);
	*a = (BYTE)(*a & ~mask);
	if (white) *xplane = (BYTE)(*xplane | mask);
	else *xplane = (BYTE)(*xplane & ~mask);
}

static void PaintPlus(BYTE* andPlane, BYTE* xorPlane, int cx, int cy)
{
	for (int i = -4; i <= 4; ++i) {
		PaintCursorBit(andPlane, xorPlane, cx + i, cy - 1, true);
		PaintCursorBit(andPlane, xorPlane, cx + i, cy, true);
		PaintCursorBit(andPlane, xorPlane, cx + i, cy + 1, true);
		PaintCursorBit(andPlane, xorPlane, cx - 1, cy + i, true);
		PaintCursorBit(andPlane, xorPlane, cx, cy + i, true);
		PaintCursorBit(andPlane, xorPlane, cx + 1, cy + i, true);
	}
	for (int i = -3; i <= 3; ++i) {
		PaintCursorBit(andPlane, xorPlane, cx + i, cy, false);
		PaintCursorBit(andPlane, xorPlane, cx, cy + i, false);
	}
}

static HCURSOR MakeCursor(int kind)
{
	BYTE andPlane[128];
	BYTE xorPlane[128];
	memset(andPlane, 0xFF, sizeof andPlane);
	memset(xorPlane, 0x00, sizeof xorPlane);
	if (kind < 3) {
		for (int i = 1; i < 31; ++i) {
			PaintCursorBit(andPlane, xorPlane, 15, i, false);
			PaintCursorBit(andPlane, xorPlane, 16, i, true);
			PaintCursorBit(andPlane, xorPlane, i, 15, false);
			PaintCursorBit(andPlane, xorPlane, i, 16, true);
		}
	}
	else {
		for (int i = 0; i < 14; ++i) {
			PaintCursorBit(andPlane, xorPlane, 4, 4 + i, false);
			PaintCursorBit(andPlane, xorPlane, 4 + i, 4, false);
			if (i > 0 && i < 13) PaintCursorBit(andPlane, xorPlane, 5, 4 + i, true);
		}
		for (int i = 0; i < 11; ++i) PaintCursorBit(andPlane, xorPlane, 5 + i, 15, false);
		for (int y = 5; y < 15; ++y) {
			for (int x = 5; x < 4 + (15 - y); ++x) PaintCursorBit(andPlane, xorPlane, x, y, true);
		}
	}
	if (kind == 1 || kind == 2) PaintPlus(andPlane, xorPlane, 24, 24);
	if (kind == 4 || kind == 5) {
		for (int y = 16; y <= 21; ++y) {
			for (int x = 16; x <= 21; ++x) {
				bool edge = x == 16 || x == 21 || y == 16 || y == 21;
				if (kind == 5 && !edge) continue;
				PaintCursorBit(andPlane, xorPlane, x, y, kind == 4 && !edge);
				if (edge) PaintCursorBit(andPlane, xorPlane, x, y, false);
			}
		}
	}
	if (kind == 2) {
		for (int y = 8; y <= 23; ++y) {
			for (int x = 8; x <= 23; ++x) {
				int dx = x - 15;
				int dy = y - 15;
				int d2 = dx * dx + dy * dy;
				if (d2 >= 26 && d2 <= 40) PaintCursorBit(andPlane, xorPlane, x, y, false);
			}
		}
	}
	int hot = kind >= 3 ? 4 : 15;
	return CreateCursor(NULL, hot, hot, 32, 32, andPlane, xorPlane);
}

ASErr DoubleCutToolPlugin::TrackToolCursor(AIToolMessage* message)
{
	AIRealPoint at = message->cursor;
	AIDocumentViewHandle view = NULL;
	if (message->event && sAIDocumentView->GetNthDocumentView(0, &view) == kNoErr && view)
		sAICursorSnap->HitTrack(view, message->cursor, message->event, "A v o", &at, true);
	static HCURSOR cursors[6] = { NULL, NULL, NULL, NULL, NULL, NULL };
	int mode = message->tool == fTool[2] ? OverlapCursorMode(message->cursor) : CursorMode(message->cursor);
	if (mode < 0 || mode > 2) mode = 0;
	if (message->tool == fTool[3]) mode += 3;
	if (!cursors[mode]) cursors[mode] = MakeCursor(mode);
	if (cursors[mode]) SetCursor(cursors[mode]);
	return kNoErr;
}

ASErr DoubleCutToolPlugin::ToolMouseDown(AIToolMessage* message)
{
	if (message->tool == fTool[3]) return ReverseClickedPath(message->cursor, message->event);
	return EditPathAt((PathEditKind)ToolIndex(message->tool), message->cursor, message->event);
}

ASErr DoubleCutToolPlugin::ToolMouseDrag(AIToolMessage* message)
{
	if (message->tool == fTool[2]) return DragFadePreview(message->cursor);
	return kNoErr;
}

ASErr DoubleCutToolPlugin::ToolMouseUp(AIToolMessage* message)
{
	if (message->tool == fTool[2]) return FinishFadePreview(message->cursor);
	return kNoErr;
}
