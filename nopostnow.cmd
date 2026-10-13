@echo off
rem NoPostNow launcher. Double-click to set up and start, or run from a terminal.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0nopostnow.ps1" %*
if errorlevel 1 pause
