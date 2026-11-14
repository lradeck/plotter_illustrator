#ifndef __TOOLSETTINGS_H__
#define __TOOLSETTINGS_H__

#include "PathEdit.h"

struct ToolSettings {
	double cutOverMm;
	bool connectLoops;
	double loopMm;
	double overlapMm;
};

ToolSettings LoadToolSettings();
void SaveToolSettings(const ToolSettings& settings);
ASErr ShowToolSettings(PathEditKind kind);

#endif
