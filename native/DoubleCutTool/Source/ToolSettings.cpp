#include "IllustratorSDK.h"
#include "ToolSettings.h"
#include "DoubleCutToolSuites.h"
#include "resource.h"

#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace {

const char* kPref = "DoubleCutTool";
const char* kFile = "C:\\Users\\Leon\\Downloads\\doublecut\\tool-settings.json";

bool ReadNumber(const char* text, const char* key, double& value)
{
	const char* found = strstr(text, key);
	if (!found) return false;
	found += strlen(key);
	while (*found == '"' || *found == ' ' || *found == ':' || *found == '\t') ++found;
	char* end = NULL;
	double number = strtod(found, &end);
	if (end == found || number <= 0) return false;
	value = number;
	return true;
}

bool ReadFlag(const char* text, const char* key, bool& value)
{
	const char* found = strstr(text, key);
	if (!found) return false;
	found += strlen(key);
	while (*found == '"' || *found == ' ' || *found == ':' || *found == '\t') ++found;
	if (strncmp(found, "true", 4) == 0) {
		value = true;
		return true;
	}
	if (strncmp(found, "false", 5) == 0) {
		value = false;
		return true;
	}
	return false;
}

void LoadFile(ToolSettings& settings)
{
	HANDLE file = CreateFileA(kFile, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
	if (file == INVALID_HANDLE_VALUE) return;
	char text[512];
	DWORD got = 0;
	BOOL ok = ReadFile(file, text, sizeof(text) - 1, &got, NULL);
	CloseHandle(file);
	if (!ok || got == 0) return;
	if (got >= sizeof(text)) got = sizeof(text) - 1;
	text[got] = 0;
	ReadNumber(text, "cutOverMm", settings.cutOverMm);
	ReadNumber(text, "loopMm", settings.loopMm);
	ReadNumber(text, "overlapMm", settings.overlapMm);
	ReadFlag(text, "connectLoops", settings.connectLoops);
}

void SaveFile(const ToolSettings& settings)
{
	char text[256];
	sprintf_s(text,
		"{\n  \"cutOverMm\": %.4f,\n  \"connectLoops\": %s,\n  \"loopMm\": %.4f,\n  \"overlapMm\": %.4f\n}\n",
		settings.cutOverMm,
		settings.connectLoops ? "true" : "false",
		settings.loopMm,
		settings.overlapMm);
	HANDLE file = CreateFileA(kFile, GENERIC_WRITE, FILE_SHARE_READ, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
	if (file == INVALID_HANDLE_VALUE) return;
	DWORD wrote = 0;
	WriteFile(file, text, (DWORD)strlen(text), &wrote, NULL);
	CloseHandle(file);
}

HMODULE Module()
{
	HMODULE module = NULL;
	GetModuleHandleExA(
		GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
		(LPCSTR)&ShowToolSettings,
		&module);
	return module;
}

void FormatMm(double value, char* text, size_t count)
{
	sprintf_s(text, count, "%.2f", value);
	for (char* p = text; *p; ++p) if (*p == '.') *p = ',';
}

double ParseMm(const char* text, double fallback)
{
	char buf[64];
	buf[63] = 0;
	strncpy_s(buf, 64, text, _TRUNCATE);
	for (char* p = buf; *p; ++p) if (*p == ',') *p = '.';
	char* end = NULL;
	double value = strtod(buf, &end);
	if (end == buf || value <= 0) return fallback;
	return value;
}

void ReadBox(HWND dlg, int id, double& value)
{
	char text[64];
	GetDlgItemTextA(dlg, id, text, 64);
	value = ParseMm(text, value);
}

INT_PTR CALLBACK CutProc(HWND dlg, UINT msg, WPARAM wp, LPARAM lp)
{
	ToolSettings* settings = (ToolSettings*)GetWindowLongPtr(dlg, GWLP_USERDATA);
	if (msg == WM_INITDIALOG) {
		settings = (ToolSettings*)lp;
		SetWindowLongPtr(dlg, GWLP_USERDATA, lp);
		char text[64];
		FormatMm(settings->cutOverMm, text, 64);
		SetDlgItemTextA(dlg, IDC_CUT_MM, text);
		FormatMm(settings->loopMm, text, 64);
		SetDlgItemTextA(dlg, IDC_LOOP_MM, text);
		CheckDlgButton(dlg, IDC_CONNECT, settings->connectLoops ? BST_CHECKED : BST_UNCHECKED);
		return TRUE;
	}
	if (msg == WM_COMMAND && settings) {
		int id = LOWORD(wp);
		int code = HIWORD(wp);
		if (id == IDC_CUT_MM && code == EN_CHANGE) {
			ReadBox(dlg, IDC_CUT_MM, settings->cutOverMm);
			SaveToolSettings(*settings);
			return TRUE;
		}
		if (id == IDC_LOOP_MM && code == EN_CHANGE) {
			ReadBox(dlg, IDC_LOOP_MM, settings->loopMm);
			SaveToolSettings(*settings);
			return TRUE;
		}
		if (id == IDC_CONNECT && code == BN_CLICKED) {
			settings->connectLoops = IsDlgButtonChecked(dlg, IDC_CONNECT) == BST_CHECKED;
			SaveToolSettings(*settings);
			return TRUE;
		}
		if (id == IDOK) {
			ReadBox(dlg, IDC_CUT_MM, settings->cutOverMm);
			ReadBox(dlg, IDC_LOOP_MM, settings->loopMm);
			settings->connectLoops = IsDlgButtonChecked(dlg, IDC_CONNECT) == BST_CHECKED;
			SaveToolSettings(*settings);
			EndDialog(dlg, IDOK);
			return TRUE;
		}
	}
	if (msg == WM_COMMAND && LOWORD(wp) == IDCANCEL) {
		EndDialog(dlg, IDCANCEL);
		return TRUE;
	}
	return FALSE;
}

INT_PTR CALLBACK SplitProc(HWND dlg, UINT msg, WPARAM wp, LPARAM)
{
	if (msg == WM_INITDIALOG) return TRUE;
	if (msg == WM_COMMAND && (LOWORD(wp) == IDOK || LOWORD(wp) == IDCANCEL)) {
		EndDialog(dlg, LOWORD(wp));
		return TRUE;
	}
	return FALSE;
}

INT_PTR CALLBACK OverlapProc(HWND dlg, UINT msg, WPARAM wp, LPARAM lp)
{
	ToolSettings* settings = (ToolSettings*)GetWindowLongPtr(dlg, GWLP_USERDATA);
	if (msg == WM_INITDIALOG) {
		settings = (ToolSettings*)lp;
		SetWindowLongPtr(dlg, GWLP_USERDATA, lp);
		char text[64];
		FormatMm(settings->overlapMm, text, 64);
		SetDlgItemTextA(dlg, IDC_OVERLAP_MM, text);
		return TRUE;
	}
	if (msg == WM_COMMAND && settings && LOWORD(wp) == IDC_OVERLAP_MM && HIWORD(wp) == EN_CHANGE) {
		ReadBox(dlg, IDC_OVERLAP_MM, settings->overlapMm);
		SaveToolSettings(*settings);
		return TRUE;
	}
	if (msg == WM_COMMAND && LOWORD(wp) == IDOK && settings) {
		ReadBox(dlg, IDC_OVERLAP_MM, settings->overlapMm);
		SaveToolSettings(*settings);
		EndDialog(dlg, IDOK);
		return TRUE;
	}
	if (msg == WM_COMMAND && LOWORD(wp) == IDCANCEL) {
		EndDialog(dlg, IDCANCEL);
		return TRUE;
	}
	return FALSE;
}

} // namespace

ToolSettings LoadToolSettings()
{
	ToolSettings settings;
	settings.cutOverMm = 0.5;
	settings.connectLoops = false;
	settings.loopMm = 2.0;
	settings.overlapMm = 0.5;
	double value = 0;
	if (sAIPreference->GetRealPreference(kPref, "cutOverMm", &value) == kNoErr && value > 0) settings.cutOverMm = value;
	if (sAIPreference->GetRealPreference(kPref, "loopMm", &value) == kNoErr && value > 0) settings.loopMm = value;
	if (sAIPreference->GetRealPreference(kPref, "overlapMm", &value) == kNoErr && value > 0) settings.overlapMm = value;
	AIBoolean flag = false;
	if (sAIPreference->GetBooleanPreference(kPref, "connectLoops", &flag) == kNoErr) settings.connectLoops = flag != false;
	LoadFile(settings);
	return settings;
}

void SaveToolSettings(const ToolSettings& settings)
{
	SaveFile(settings);
	sAIPreference->PutRealPreference(kPref, "cutOverMm", settings.cutOverMm);
	sAIPreference->PutRealPreference(kPref, "loopMm", settings.loopMm);
	sAIPreference->PutRealPreference(kPref, "overlapMm", settings.overlapMm);
	sAIPreference->PutBooleanPreference(kPref, "connectLoops", settings.connectLoops ? true : false);
}

ASErr EditToolOptions(PathEditKind kind)
{
	return ShowToolSettings(kind);
}

ASErr ShowToolSettings(PathEditKind kind)
{
	ToolSettings settings = LoadToolSettings();
	INT_PTR result = IDCANCEL;
	if (kind == kEditCutOver) result = DialogBoxParam(Module(), MAKEINTRESOURCE(IDD_CUTOVER), GetActiveWindow(), CutProc, (LPARAM)&settings);
	else if (kind == kEditSplitInward) result = DialogBoxParam(Module(), MAKEINTRESOURCE(IDD_SPLIT), GetActiveWindow(), SplitProc, 0);
	else result = DialogBoxParam(Module(), MAKEINTRESOURCE(IDD_OVERLAP), GetActiveWindow(), OverlapProc, (LPARAM)&settings);
	if (result == IDOK) SaveToolSettings(settings);
	return kNoErr;
}
