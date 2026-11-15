#ifndef __TOOLSETTINGS_H__
#define __TOOLSETTINGS_H__

#include "PathEdit.h"

struct ToolSettings {
	double cutOverMm;
	bool connectLoops;
	double loopMm;
	double overlapMm;
	bool fadeIn;
	double curveOffsetMm;
	double curveSteepnessMm;
};

ToolSettings LoadToolSettings();
void SaveToolSettings(const ToolSettings& settings);
ASErr ShowToolSettings(PathEditKind kind);

#endif
