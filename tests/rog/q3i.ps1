$ud = "$env:TEMP\fk-cdp-profile-" + [guid]::NewGuid().ToString().Substring(0,8)
Get-ChildItem "$env:TEMP" -Directory -Filter 'fk-cdp-profile*' -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
$args2 = @("--headless=new","--remote-debugging-port=9333","--user-data-dir=$ud","--no-first-run","--use-angle=d3d11","--disable-gpu-shader-disk-cache","--window-size=1600,900","about:blank")
if (Test-Path "$env:USERPROFILE\fk-angle.txt") { $args2 += (Get-Content "$env:USERPROFILE\fk-angle.txt") }
Start-Process -FilePath "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList $args2
