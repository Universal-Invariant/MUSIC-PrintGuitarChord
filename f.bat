@echo off

:: %CD% captures the directory you are currently sitting in when you run the command
set "PROJECT_DIR=%CD%"

:: Generate a unique temporary file path in %TEMP%
set "ACTION_FILE=%TEMP%\vite_action_%RANDOM%%RANDOM%.tmp"
if exist "%ACTION_FILE%" del "%ACTION_FILE%"

set "cmd=%1"

:loop
if exist "%ACTION_FILE%" del "%ACTION_FILE%"

if "%cmd%"=="h" (
    git fetch origin
    git reset --hard origin/main
    git log --oneline -1
)

if "%cmd%"=="p" (
    git pull
)

if "%cmd%"=="n" (
    call npm install
    call npm install-scripts approve esbuild
    call npm audit fix --force
)

call npx tsc -b

:: Export the variable so Vite can read it
set "ACTION_FILE=%ACTION_FILE%"

call npm run dev

if not exist "%ACTION_FILE%" goto end

set /p ACTION=<"%ACTION_FILE%"

if "%ACTION%"=="h" (
    set "cmd=h"
    goto loop
)
if "%ACTION%"=="p" (
    set "cmd=p"
    goto loop
)
if "%ACTION%"=="n" (
    set "cmd=n"
    goto loop
)

:end
del "%ACTION_FILE%" 2>nul