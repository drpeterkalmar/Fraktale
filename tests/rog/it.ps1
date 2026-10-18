$a = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File $env:USERPROFILE\q3i.ps1"
$p = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
try { Register-ScheduledTask -TaskName "fk-gltest" -Action $a -Principal $p -Force | Out-Null; "registered" } catch { "REG FAIL: $_" }
Start-ScheduledTask -TaskName "fk-gltest"; Start-Sleep 25
Get-Content "$env:TEMP\fkq3i.txt" -ErrorAction SilentlyContinue | Select-String GLRES
(Get-ScheduledTaskInfo -TaskName fk-gltest).LastTaskResult
