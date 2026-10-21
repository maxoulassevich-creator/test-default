@echo off
rem Optional: download Playwright Chromium (about 150 MB).
rem Usually NOT needed - the processor uses the installed Microsoft Edge or Google Chrome.
setlocal
cd /d "%~dp0"
set "NODE_EXE=node"
if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
echo Downloading Chromium for Playwright into %%LOCALAPPDATA%%\ms-playwright ...
"%NODE_EXE%" "%~dp0processor\node_modules\playwright-core\cli.js" install chromium
echo.
pause
