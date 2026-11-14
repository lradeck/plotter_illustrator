#ifndef __DOUBLECUTTOOLSUITES_H__
#define __DOUBLECUTTOOLSUITES_H__

#include "IllustratorSDK.h"
#include "Suites.hpp"
#include "AIHitTest.h"
#include "AIRealBezier.h"
#include "AIMatchingArt.h"
#include "AIMdMemory.h"
#include "AIPreference.h"
#include "AIDocumentView.h"
#include "AICursorSnap.h"

extern "C" AIMenuSuite* sAIMenu;
extern "C" AIToolSuite* sAITool;
extern "C" AIUnicodeStringSuite* sAIUnicodeString;
extern "C" AIPluginSuite* sAIPlugin;
extern "C" SPBlocksSuite* sSPBlocks;
extern "C" AIUndoSuite* sAIUndo;
extern "C" AIArtSuite* sAIArt;
extern "C" AIPathSuite* sAIPath;
extern "C" AIHitTestSuite* sAIHitTest;
extern "C" AIRealBezierSuite* sAIRealBezier;
extern "C" AIMatchingArtSuite* sAIMatchingArt;
extern "C" AIMdMemorySuite* sAIMdMemory;
extern "C" AIPreferenceSuite* sAIPreference;
extern "C" AIDocumentViewSuite* sAIDocumentView;
extern "C" AICursorSnapSuite* sAICursorSnap;

#endif
