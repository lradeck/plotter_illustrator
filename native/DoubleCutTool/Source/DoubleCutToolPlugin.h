#ifndef __DOUBLECUTTOOLPLUGIN_H__
#define __DOUBLECUTTOOLPLUGIN_H__

#include "Plugin.hpp"
#include "DoubleCutToolID.h"
#include "DoubleCutToolSuites.h"

Plugin* AllocatePlugin(SPPluginRef pluginRef);
void FixupReload(Plugin* plugin);

class DoubleCutToolPlugin : public Plugin
{
public:
	DoubleCutToolPlugin(SPPluginRef pluginRef);
	virtual ~DoubleCutToolPlugin() {}
	FIXUP_VTABLE_EX(DoubleCutToolPlugin, Plugin);
	virtual ASErr Notify(AINotifierMessage* message);

protected:
	virtual ASErr Message(char* caller, char* selector, void* message);
	virtual ASErr StartupPlugin(SPInterfaceMessage* message);
	virtual ASErr PostStartupPlugin();
	virtual ASErr GoMenuItem(AIMenuMessage* message);
	virtual ASErr EditTool(AIToolMessage* message);
	virtual ASErr TrackToolCursor(AIToolMessage* message);
	virtual ASErr ToolMouseDown(AIToolMessage* message);

private:
	AIToolHandle fTool[3];
	AIMenuItemHandle fMenu[3];
	AINotifierHandle fShutdownNotifier;
	AIResourceManagerHandle fResourceMgr;

	ASErr AddTools(SPInterfaceMessage* message);
	ASErr AddMenus(SPInterfaceMessage* message);
	int ToolIndex(AIToolHandle tool) const;
};

#endif
