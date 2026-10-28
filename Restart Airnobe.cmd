@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\web-launch.ps1" restart
if errorlevel 1 pause
