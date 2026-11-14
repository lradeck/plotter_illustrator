#include "IllustratorSDK.h"
#include "DoubleCutToolSuites.h"

extern "C" {
	AIMenuSuite* sAIMenu = NULL;
	AIToolSuite* sAITool = NULL;
	AIUnicodeStringSuite* sAIUnicodeString = NULL;
	AIPluginSuite* sAIPlugin = NULL;
	SPBlocksSuite* sSPBlocks = NULL;
	AIUndoSuite* sAIUndo = NULL;
	AIArtSuite* sAIArt = NULL;
	AIPathSuite* sAIPath = NULL;
	AIHitTestSuite* sAIHitTest = NULL;
	AIRealBezierSuite* sAIRealBezier = NULL;
	AIMatchingArtSuite* sAIMatchingArt = NULL;
	AIMdMemorySuite* sAIMdMemory = NULL;
	AIPreferenceSuite* sAIPreference = NULL;
	AIDocumentViewSuite* sAIDocumentView = NULL;
	AICursorSnapSuite* sAICursorSnap = NULL;
}

ImportSuite gImportSuites[] = {
	kAIMenuSuite, kAIMenuSuiteVersion, &sAIMenu,
	kAIToolSuite, kAIToolVersion, &sAITool,
	kAIUnicodeStringSuite, kAIUnicodeStringVersion, &sAIUnicodeString,
	kAIPluginSuite, kAIPluginSuiteVersion, &sAIPlugin,
	kSPBlocksSuite, kSPBlocksSuiteVersion, &sSPBlocks,
	kAIUndoSuite, kAIUndoSuiteVersion, &sAIUndo,
	kAIArtSuite, kAIArtVersion, &sAIArt,
	kAIPathSuite, kAIPathSuiteVersion, &sAIPath,
	kAIHitTestSuite, kAIHitTestVersion, &sAIHitTest,
	kAIRealBezierSuite, kAIRealBezierVersion, &sAIRealBezier,
	kAIMatchingArtSuite, kAIMatchingArtVersion, &sAIMatchingArt,
	kAIMdMemorySuite, kAIMdMemoryVersion, &sAIMdMemory,
	kAIPreferenceSuite, kAIPreferenceVersion, &sAIPreference,
	kAIDocumentViewSuite, kAIDocumentViewVersion, &sAIDocumentView,
	kAICursorSnapSuite, kAICursorSnapVersion, &sAICursorSnap,
	nullptr, 0, nullptr
};
