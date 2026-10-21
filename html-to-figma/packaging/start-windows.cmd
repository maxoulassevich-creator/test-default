@echo off
rem HTML -> Figma: local processor launcher for Windows.
rem Messages of the processor itself are printed in Russian by Node.js.
setlocal
cd /d "%~dp0"
title HTML to Figma - local processor

set "NODE_EXE="
if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if not defined NODE_EXE (
  where node >nul 2>nul && set "NODE_EXE=node"
)
if defined NODE_EXE (
  "%NODE_EXE%" -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>nul || set "NODE_EXE="
)
if not defined NODE_EXE (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\get-node.ps1"
  if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
)
if not defined NODE_EXE (
  echo.
  echo Node.js 20 or newer was not found.
  echo Install Node.js LTS from https://nodejs.org and run start-windows.cmd again.
  echo.
  pause
  exit /b 1
)

"%NODE_EXE%" "%~dp0processor\processor.cjs" %*
echo.
pause
