$ErrorActionPreference = "Stop"
$src = "C:\Users\Leon\Downloads\doublecut\native\output\x64\Release\DoubleCutTool.aip"
$dest = "C:\Program Files\Adobe\Adobe Illustrator 2026\Plug-ins\DoubleCutTool.aip"
$log = "C:\Users\Leon\Downloads\doublecut\native\output\install-log.txt"
try {
  Copy-Item -Force $src $dest
  $item = Get-Item $dest
  "ok $($item.Length) $($item.LastWriteTime.ToString('s'))" | Set-Content $log
} catch {
  $_.Exception.Message | Set-Content $log
}
