& "$env:USERPROFILE\killfk.ps1"
Start-ScheduledTask -TaskName "fk-gltest"
for ($i = 0; $i -lt 30; $i++) { Start-Sleep 1; $r = curl.exe -s -m 2 http://127.0.0.1:9333/json/version; if ($r) { "UP"; break } }
