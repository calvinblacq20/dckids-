@echo off
REM ============================================================
REM  DC Kids Brand - server launcher
REM  Double-click this file to run the store + admin backend.
REM  Keep the window open. It auto-restarts if the server crashes.
REM  Visit:  http://localhost:3001  (store)
REM          http://localhost:3001/admin.html  (admin)
REM ============================================================
title DC Kids Server (keep open)
cd /d "%~dp0"

:loop
echo.
echo [%date% %time%]  Starting DC Kids server on http://localhost:3001 ...
node server\server.js
echo.
echo  *** Server stopped (exit code %errorlevel%). Restarting in 3 seconds... ***
echo  Close this window or press Ctrl+C to stop the store for good.
timeout /t 3 /nobreak >nul
goto loop
