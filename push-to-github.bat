@echo off
rem ==========================================================================
rem  Push the school site to GitHub.
rem  Double-click this file (or run it from a terminal in the project folder).
rem  It commits every change and pushes it to the repository below.
rem  Secrets (.env, database/setup-local.sql), backups and uploads are never
rem  sent: they are listed in .gitignore and checked again before committing.
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion
title Push School Site to GitHub
cd /d "%~dp0"

set "REMOTE_URL=https://github.com/DAVID-KAMADI/school-site.git"
set "TOTAL=6"
set "WORK=%TEMP%\school-site-push"
set "LOG=%WORK%\output.log"
set "DONE=%WORK%\done.txt"
if not exist "%WORK%" mkdir "%WORK%"

rem Carriage return (to redraw the spinner on one line) and ANSI colours.
for /f %%a in ('copy /z "%~f0" nul') do set "CR=%%a"
for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
set "GREEN=%ESC%[92m" & set "RED=%ESC%[91m" & set "YELLOW=%ESC%[93m"
set "CYAN=%ESC%[96m" & set "DIM=%ESC%[90m" & set "RESET=%ESC%[0m"

echo.
echo %CYAN%  ==================================================%RESET%
echo %CYAN%     School Site  -^>  GitHub%RESET%
echo %CYAN%  ==================================================%RESET%
echo %DIM%     %REMOTE_URL%%RESET%

rem ---------------------------------------------------------------- 1. Git
call :progress 1 "Checking Git"
where git >nul 2>&1
if errorlevel 1 (
  call :fail "Git is not installed. Install it from https://git-scm.com/download/win and run this file again."
  goto :end
)
for /f "tokens=3" %%v in ('git --version') do echo %DIM%     Git %%v found%RESET%

rem --------------------------------------------------------- 2. Repository
call :progress 2 "Preparing the repository"
if not exist ".git" (
  git init -q
  if errorlevel 1 ( call :fail "Could not create the Git repository." & goto :end )
  echo %DIM%     New repository created%RESET%
)
git config user.name >nul 2>&1
if errorlevel 1 (
  set "GIT_NAME="
  set /p "GIT_NAME=     Your name for commits: "
  if not defined GIT_NAME ( call :fail "A name is needed for commits." & goto :end )
  git config user.name "!GIT_NAME!"
)
git config user.email >nul 2>&1
if errorlevel 1 (
  set "GIT_EMAIL="
  set /p "GIT_EMAIL=     Your GitHub email: "
  if not defined GIT_EMAIL ( call :fail "An email is needed for commits." & goto :end )
  git config user.email "!GIT_EMAIL!"
)
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin "%REMOTE_URL%"
) else (
  git remote set-url origin "%REMOTE_URL%"
)
rem A brand-new repository starts on "main".
git rev-parse --verify -q HEAD >nul 2>&1
if errorlevel 1 git symbolic-ref HEAD refs/heads/main
for /f "delims=" %%b in ('git branch --show-current') do set "BRANCH=%%b"
echo %DIM%     Branch: !BRANCH!%RESET%

rem ------------------------------------------------------------ 3. Files
call :progress 3 "Collecting changed files"
set "JOB=git add -A"
call :spin "Adding files"
if not "!RC!"=="0" ( call :fail "Could not add the files." & call :showlog & goto :end )

rem Safety net: stop if anything secret or private was picked up.
git diff --cached --name-only > "%WORK%\staged.txt"
git diff --cached --name-only -- ":(glob,icase)**/.env" ":(glob,icase)**/.env.local" ":(glob,icase)**/setup-local.sql" ":(glob)**/backups/**" ":(glob)**/storage/**" ":(glob)**/node_modules/**" > "%WORK%\blocked.txt"
set "BLOCKED=0"
for %%F in ("%WORK%\blocked.txt") do if %%~zF gtr 0 set "BLOCKED=1"
if "!BLOCKED!"=="1" (
  git reset -q
  echo.
  echo %RED%     These files must never be uploaded:%RESET%
  type "%WORK%\blocked.txt"
  call :fail "Nothing was sent. Add them to .gitignore, then run this again."
  goto :end
)
set "COUNT=0"
for /f "usebackq delims=" %%c in ("%WORK%\staged.txt") do set /a "COUNT+=1"
echo %DIM%     !COUNT! changed file(s)%RESET%

rem ------------------------------------------------------------ 4. Commit
call :progress 4 "Saving a snapshot (commit)"
if "!COUNT!"=="0" (
  git rev-parse --verify -q HEAD >nul 2>&1
  if errorlevel 1 ( call :fail "There are no files to upload." & goto :end )
  echo %DIM%     No new changes - pushing existing commits%RESET%
) else (
  set "MSG="
  set /p "MSG=     Describe the changes (Enter for a default message): "
  if not defined MSG set "MSG=Update school site !DATE! !TIME:~0,5!"
  > "%WORK%\message.txt" echo(!MSG!
  set "JOB=git commit -q -F "%WORK%\message.txt""
  call :spin "Committing"
  if not "!RC!"=="0" ( call :fail "The commit failed." & call :showlog & goto :end )
)

rem -------------------------------------------------------------- 5. Push
call :progress 5 "Uploading to GitHub"
set "GIT_TERMINAL_PROMPT=0"
set "JOB=git push -u origin !BRANCH!"
call :spin "Uploading"
set "GIT_TERMINAL_PROMPT="

if not "!RC!"=="0" (
  "%SystemRoot%\System32\findstr.exe" /i /c:"rejected" /c:"fetch first" /c:"non-fast-forward" "%LOG%" >nul
  if not errorlevel 1 (
    echo.
    echo %YELLOW%     GitHub already has commits that are not on this computer%RESET%
    echo %YELLOW%     ^(for example a README created on the website^).%RESET%
    set "ANSWER="
    set /p "ANSWER=     Combine them with your work and upload again? [Y/N] "
    if /i not "!ANSWER!"=="Y" ( call :fail "Nothing was uploaded." & goto :end )
    set "JOB=git pull --no-rebase --no-edit --allow-unrelated-histories origin !BRANCH!"
    call :spin "Combining with GitHub"
    if not "!RC!"=="0" (
      call :fail "The two versions could not be combined automatically. Open the project in VS Code to resolve the conflicts, then run this again."
      call :showlog
      goto :end
    )
    set "GIT_TERMINAL_PROMPT=0"
    set "JOB=git push -u origin !BRANCH!"
    call :spin "Uploading"
    set "GIT_TERMINAL_PROMPT="
  )
)

if not "!RC!"=="0" (
  rem Usually a first-time sign-in: run the push in the open so GitHub can ask for it.
  echo.
  echo %YELLOW%     GitHub needs you to sign in. A sign-in window may open.%RESET%
  echo.
  git push -u origin !BRANCH!
  if errorlevel 1 (
    call :fail "The upload failed. Check your internet connection and that you have access to the repository."
    goto :end
  )
)

rem -------------------------------------------------------------- 6. Done
call :progress 6 "Finished"
for /f "delims=" %%L in ('git log -1 --format^="%%h  %%s"') do set "LAST=%%L"
echo.
echo %GREEN%  ==================================================%RESET%
echo %GREEN%     Upload complete%RESET%
echo %GREEN%  ==================================================%RESET%
echo      Latest commit: !LAST!
echo      View it at:    %REMOTE_URL:.git=%
echo.
goto :end


rem ======================================================================
rem  :progress <step> "<label>"   draws  [########------------] 40%  label
rem ======================================================================
:progress
set /a "FILL=%~1*20/TOTAL, PCT=%~1*100/TOTAL"
set "BAR="
for /l %%i in (1,1,20) do (
  if %%i leq !FILL! (set "BAR=!BAR!#") else (set "BAR=!BAR!-")
)
echo.
echo %CYAN%  [!BAR!] !PCT!%%%RESET%  Step %~1 of %TOTAL%: %~2
exit /b

rem ======================================================================
rem  :spin "<label>"   runs %JOB% in the background with a spinner.
rem  Sets RC to the command's exit code; its output goes to %LOG%.
rem ======================================================================
:spin
if exist "%DONE%" del "%DONE%"
> "%WORK%\job.cmd" (
  echo @echo off
  echo !JOB! ^> "%LOG%" 2^>^&1
  echo ^> "%DONE%" echo %%errorlevel%%
)
rem /c (not the /k that "start" uses for batch files) so the job exits and never reads the keyboard.
start "" /b cmd /d /c ""%WORK%\job.cmd"" <nul
set "FRAMES=|/-\"
set /a "N=0"
:spin_wait
if exist "%DONE%" goto :spin_read
set /a "K=N %% 4"
for %%k in (!K!) do set "F=!FRAMES:~%%k,1!"
<nul set /p "=%YELLOW%  [!F!]%RESET% %~1...!CR!"
ping -n 1 -w 150 192.0.2.1 >nul 2>&1
set /a "N+=1"
goto :spin_wait
:spin_read
set "RC="
set /p RC=<"%DONE%"
if not defined RC ( ping -n 1 -w 100 192.0.2.1 >nul 2>&1 & goto :spin_read )
set "RC=!RC: =!"
if "!RC!"=="0" (
  echo %GREEN%  [OK]%RESET% %~1
) else (
  echo %RED%  [X]%RESET% %~1
)
exit /b

:showlog
echo %DIM%
type "%LOG%"
echo %RESET%
exit /b

:fail
echo.
echo %RED%  [X] %~1%RESET%
exit /b

:end
echo.
pause
endlocal
