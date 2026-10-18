for ($i = 0; $i -lt 10; $i++) {
  $ps = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match 'fk-cdp-profile' }
  if (-not $ps) { break }
  $ps | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 700
}
