@echo off
setlocal
title Gerar instalador do MetralhaHub
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
set "NPM=%ProgramFiles%\nodejs\npm.cmd"
if not exist "%NPM%" set "NPM=npm.cmd"
call "%NPM%" --version >nul 2>nul
if errorlevel 1 (
  echo Node.js LTS nao foi encontrado. Instale Node.js e abra este arquivo novamente.
  echo https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\electron-builder\out\cli\cli.js" call "%NPM%" install
if errorlevel 1 (
  pause
  exit /b 1
)
call "%NPM%" run dist
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo Instalador pronto na pasta release.
pause
