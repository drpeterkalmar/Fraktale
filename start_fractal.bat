@echo off
title Mandelbrot Explorer Starter
color 0B

echo.
echo  =========================================
echo     MANDELBROT EXPLORER - INFINITE ZOOM
echo  =========================================
echo.
echo  [*] Pruefe Python Installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] FEHLER: Python wurde nicht gefunden!
    echo      Bitte installiere Python oder starte manuell.
    pause
    exit /b
)

echo  [*] Starte lokalen Webserver auf Port 8000...
echo  [*] Oeffne Browser: http://localhost:8000
echo.
echo  -----------------------------------------
echo    DRUECKE STRG+C ZUM BEENDEN DES SERVERS
echo  -----------------------------------------
echo.

:: Startet den Browser verzögert, damit der Server Zeit zum Hochfahren hat
start "" "http://localhost:8000"

:: Startet den Python Server
python -m http.server 8000
