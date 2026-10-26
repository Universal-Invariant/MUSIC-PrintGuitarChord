@echo off
set "ACTION_FILE=%TEMP%\vite_action_35ss442.tmp"
if exist "%ACTION_FILE%" del "%ACTION_FILE%"


:loop
del "%ACTION_FILE%" 2>nul
set "cmd=%1"

if "%cmd%"=="B" (
  git fetch origin
  git reset --hard origin/main
  git log --oneline -1
  call npm install
  call npm install-scripts approve esbuild
  call npm audit fix --force
)
call npx tsc -b
REM copy /Y vite.config.ts web\ > nul

REM start /b powershell -WindowStyle Hidden -File c:\Apps\Command\open-browser.ps1 -Url "http://localhost:5173/" -Port 5173 -WindowTitle "ViteTester" -ProfileName "Harmonia"

call npm run dev
if not exist "%ACTION_FILE%" goto end

set /p ACTION=<"%ACTION_FILE%"

if "%ACTION%"=="rebuild" (
  set "cmd=B"
  goto loop
)


:end
del "%ACTION_FILE%" 2>nul




