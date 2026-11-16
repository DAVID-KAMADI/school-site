@echo off
rem ==========================================================================
rem  REGIONAL CENTRE TRAINING INSTITUTE - build the site and deploy it to IIS.
rem  Double-click this file (or run it from a terminal in the project folder).
rem
rem    Website  ->  IIS site "SchoolSite"      http://localhost:8081
rem    API      ->  IIS site "SchoolSite-API"  http://127.0.0.1:8082
rem    Files    ->  C:\inetpub\school-site\{web,api}
rem
rem  Steps: check tools, build the API and the website in a temporary folder
rem  (your dev servers and backend\dist are not touched), pause the IIS sites
rem  (app_offline.htm), copy the new files, install API packages if they
rem  changed, run new database migrations, bring the sites back and check them.
rem
rem  Kept as they are: api\.env, web.config, iis-start.mjs, uploaded files
rem  (api\storage), backups and logs. The previous version is saved to
rem  C:\inetpub\school-site\_previous for a rollback. No admin rights needed.
rem
rem  Keep this file saved as UTF-8 with Windows (CRLF) line endings.
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion

set "PROJECT=%~dp0"
if "%PROJECT:~-1%"=="\" set "PROJECT=%PROJECT:~0,-1%"
set "SITE_NAME=REGIONAL CENTRE TRAINING INSTITUTE"
set "TARGET=C:\inetpub\school-site"
set "WEB_URL=http://localhost:8081/"
set "API_URL=http://127.0.0.1:8082/api/v1/public/popups"
set "STAGE=%TEMP%\school-site-deploy"
set "LOG=%STAGE%\deploy.log"
set "DONE=%STAGE%\done.txt"
set "TOTAL=7"

rem Background jobs (run with a spinner) call this same file: deploy-to-iis.bat :job <name>
if "%~1"==":job" goto :job_%~2

chcp 65001 >nul
title %SITE_NAME% - Deploy to IIS
cd /d "%PROJECT%"

rem ANSI colours.
for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
set "GREEN=%ESC%[92m" & set "RED=%ESC%[91m" & set "YELLOW=%ESC%[93m"
set "CYAN=%ESC%[96m" & set "DIM=%ESC%[90m" & set "BOLD=%ESC%[1m" & set "RESET=%ESC%[0m"
set "BLUE=%ESC%[38;2;77;141;255m" & set "ORANGE=%ESC%[38;2;239;109;0m"
set "CLEARLINE=%ESC%[2K%ESC%[1G"
rem Spinner frames: a dot bouncing along a track.
set "F0=●∙∙∙∙" & set "F1=∙●∙∙∙" & set "F2=∙∙●∙∙" & set "F3=∙∙∙●∙"
set "F4=∙∙∙∙●" & set "F5=∙∙∙●∙" & set "F6=∙∙●∙∙" & set "F7=∙●∙∙∙"

rem Hide the cursor while the spinners run.
<nul set /p "=%ESC%[?25l"
call :now START_CS

cls
echo.
echo   %ESC%[38;2;77;141;255m██████╗   ██████╗ ████████╗ ██╗%RESET%
echo   %ESC%[38;2;64;120;240m██╔══██╗ ██╔════╝ ╚══██╔══╝ ██║%RESET%
echo   %ESC%[38;2;90;110;210m██████╔╝ ██║         ██║    ██║%RESET%
echo   %ESC%[38;2;170;110;140m██╔══██╗ ██║         ██║    ██║%RESET%
echo   %ESC%[38;2;230;115;60m██║  ██║ ╚██████╗    ██║    ██║%RESET%
echo   %ESC%[38;2;239;109;0m╚═╝  ╚═╝  ╚═════╝    ╚═╝    ╚═╝%RESET%
echo.
echo   %BOLD%%SITE_NAME%%RESET%
echo   %DIM%Light for every learner%RESET%
echo.
echo   %BLUE%━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%RESET%
echo     %BOLD%Deploy to IIS%RESET%   %DIM%website%RESET% :8081   %DIM%API%RESET% :8082
echo     %DIM%From%RESET%  %PROJECT%
echo     %DIM%To%RESET%    %TARGET%
echo   %BLUE%━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%RESET%

rem ---------------------------------------------------------------- 1. Checks
call :step 1 "Checking tools and folders"
where node >nul 2>&1 || (call :fail "Node.js is not installed or not on PATH." & goto :end)
where npm  >nul 2>&1 || (call :fail "npm is not installed or not on PATH." & goto :end)
if not exist "%PROJECT%\backend\package.json"  (call :fail "backend folder not found next to this script." & goto :end)
if not exist "%PROJECT%\frontend\package.json" (call :fail "frontend folder not found next to this script." & goto :end)
if not exist "%TARGET%\api\web.config" (call :fail "%TARGET%\api is not set up for IIS (web.config missing)." & goto :end)
if not exist "%TARGET%\web\web.config" (call :fail "%TARGET%\web is not set up for IIS (web.config missing)." & goto :end)
if not exist "%TARGET%\api\.env"       (call :fail "%TARGET%\api\.env is missing." & goto :end)
if not exist "%PROJECT%\backend\node_modules"  (call :fail "Run npm install in backend first." & goto :end)
if not exist "%PROJECT%\frontend\node_modules" (call :fail "Run npm install in frontend first." & goto :end)
rem A fresh staging folder every time (an old incremental build file would skip emitting files).
if exist "%STAGE%" rmdir /s /q "%STAGE%"
mkdir "%STAGE%" || (call :fail "Cannot create %STAGE%." & goto :end)
rem The script each background job runs: this file with ":job <name>", exit code to done.txt.
> "%STAGE%\job.cmd" (
  echo @echo off
  echo call "%~f0" :job %%1 ^>^> "%LOG%" 2^>^&1
  echo ^> "%DONE%" echo %%errorlevel%%
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
for /f "delims=" %%v in ('npm -v') do set "NPMV=%%v"
call :ok "Node !NODEV!  ·  npm !NPMV!  ·  IIS folders ready"

rem ------------------------------------------------------------- 2. Build API
call :step 2 "Building the API"
call :spin "Compiling the API (TypeScript)" build_api
if not "!RC!"=="0" (call :fail "API build failed. Nothing was changed in IIS." & call :showlog & goto :end)

rem --------------------------------------------------------- 3. Build website
call :step 3 "Building the website"
call :spin "Building the website (about a minute)" build_web
if not "!RC!"=="0" (call :fail "Website build failed. Nothing was changed in IIS." & call :showlog & goto :end)

rem ------------------------------------------------------------ 4. Go offline
call :step 4 "Pausing the IIS sites"
call :spin "Showing the 'updating' page and stopping node" offline
if not "!RC!"=="0" (call :fail "Cannot write to %TARGET%. Check folder permissions." & call :online & goto :end)

rem ------------------------------------------------------------- 5. Copy files
call :step 5 "Copying the new files"
call :spin "Saving the old version and copying the new one" copy
if not "!RC!"=="0" (call :fail "Copying failed (files still in use?)." & call :showlog & call :online & goto :end)

rem ------------------------------------- 6. API packages and database changes
call :step 6 "Updating API packages and the database"
set "PKG_CHANGED=1"
if exist "%TARGET%\api\package-lock.json" (
  fc /b "%PROJECT%\backend\package-lock.json" "%TARGET%\api\package-lock.json" >nul 2>&1 && set "PKG_CHANGED=0"
)
if not exist "%TARGET%\api\node_modules" set "PKG_CHANGED=1"
copy /y "%PROJECT%\backend\package.json" "%TARGET%\api\package.json" >nul
if "!PKG_CHANGED!"=="1" (
  copy /y "%PROJECT%\backend\package-lock.json" "%TARGET%\api\package-lock.json" >nul
  call :spin "Installing API packages (a few minutes)" packages
  if not "!RC!"=="0" (call :fail "npm ci failed in %TARGET%\api." & call :showlog & call :online & goto :end)
) else (
  call :ok "API packages unchanged"
)
call :spin "Applying database migrations" migrate
if not "!RC!"=="0" (
  call :warn "Database migrations FAILED. Is MySQL running? The site may show errors."
  findstr /i "error" "%STAGE%\migrations.log"
  set "MIGRATION_FAILED=1"
) else (
  set "MIGS=0"
  for /f %%c in ('findstr /c:"has been executed successfully" "%STAGE%\migrations.log" ^| find /c /v ""') do set "MIGS=%%c"
  if "!MIGS!"=="0" (call :info "Database already up to date") else (call :info "!MIGS! new migration(s) applied")
)

rem ------------------------------------------------------------- 7. Go online
call :step 7 "Bringing the sites back online"
call :online
call :spin "Waiting for the website and API to answer" health
set "API_CODE=000" & set "WEB_CODE=000"
if exist "%STAGE%\health.txt" for /f "usebackq tokens=1,2" %%a in ("%STAGE%\health.txt") do (set "API_CODE=%%a" & set "WEB_CODE=%%b")
if "!API_CODE!"=="200" (call :info "API answers on :8082") else (call :warn "API not answering yet (HTTP !API_CODE!). See %TARGET%\api\logs")
if "!WEB_CODE!"=="200" (call :info "Website answers on :8081") else (call :warn "Website not answering yet (HTTP !WEB_CODE!). See %TARGET%\web\logs")

rem ---------------------------------------------------------------- Summary
call :now END_CS
set /a "TOOK=END_CS-START_CS" & if !TOOK! lss 0 set /a "TOOK+=8640000"
call :fmt !TOOK! TOOK_TEXT
set "OUTCOME=ok"
if not "!API_CODE!!WEB_CODE!"=="200200" set "OUTCOME=warn"
if defined MIGRATION_FAILED set "OUTCOME=warn"
if "!OUTCOME!"=="ok" (set "BOX=%GREEN%" & set "HEAD=√  Deployed successfully") else (set "BOX=%YELLOW%" & set "HEAD=▲  Deployed with warnings (see above)")
echo.
echo   !BOX!╭──────────────────────────────────────────────────────╮%RESET%
call :boxline "%BOLD%!HEAD!%RESET%" "!HEAD!"
call :boxline "" ""
call :boxline "%DIM%Website%RESET%   %WEB_URL%" "Website   %WEB_URL%"
call :boxline "%DIM%API%RESET%       http://127.0.0.1:8082" "API       http://127.0.0.1:8082"
call :boxline "%DIM%Time%RESET%      !TOOK_TEXT!" "Time      !TOOK_TEXT!"
echo   !BOX!╰──────────────────────────────────────────────────────╯%RESET%
echo.
echo   %DIM%Log: %LOG%%RESET%
if "!OUTCOME!"=="warn" echo   %DIM%Roll back: copy %TARGET%\_previous back over api\dist and web\{browser,server}%RESET%
goto :end


rem ======================================================================
rem  Background jobs. Each runs in its own cmd, output to %LOG%.
rem ======================================================================
:job_build_api
pushd "%PROJECT%\backend"
call npx tsc -p tsconfig.build.json --outDir "%STAGE%\api\dist"
set "RC=%errorlevel%"
popd
if "%RC%"=="0" if not exist "%STAGE%\api\dist\main.js" set "RC=1"
exit /b %RC%

:job_build_web
pushd "%PROJECT%\frontend"
call npx ng build --output-path "%STAGE%\web"
set "RC=%errorlevel%"
popd
if "%RC%"=="0" if not exist "%STAGE%\web\server\server.mjs" set "RC=1"
exit /b %RC%

:job_offline
rem Written with delayed expansion off, because the page contains "!".
setlocal DisableDelayedExpansion
> "%STAGE%\app_offline.htm" (
  echo ^<!doctype html^>^<html lang="en"^>^<head^>^<meta charset="utf-8"^>^<meta name="viewport" content="width=device-width,initial-scale=1"^>
  echo ^<meta http-equiv="refresh" content="15"^>^<title^>Updating - %SITE_NAME%^</title^>
  echo ^<style^>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#002680;color:#fff;text-align:center;padding:1rem}p{opacity:.8}^</style^>
  echo ^</head^>^<body^>^<div^>^<h1^>We are updating the website^</h1^>^<p^>%SITE_NAME%^<br^>Please wait a moment. This page refreshes by itself.^</p^>^</div^>^</body^>^</html^>
)
copy /y "%STAGE%\app_offline.htm" "%TARGET%\api\app_offline.htm" || exit /b 1
copy /y "%STAGE%\app_offline.htm" "%TARGET%\web\app_offline.htm" || exit /b 1
rem Give IIS a few seconds to stop node and release its files.
ping -n 7 127.0.0.1 >nul
exit /b 0

:job_copy
set "PREV=%TARGET%\_previous"
set "RC_OPTS=/MIR /NFL /NDL /NJH /NJS /NP"
robocopy "%TARGET%\api\dist"    "%PREV%\api\dist"    %RC_OPTS% /R:2 /W:2
robocopy "%TARGET%\web\browser" "%PREV%\web\browser" %RC_OPTS% /R:2 /W:2
robocopy "%TARGET%\web\server"  "%PREV%\web\server"  %RC_OPTS% /R:2 /W:2
if exist "%TARGET%\api\package-lock.json" copy /y "%TARGET%\api\package-lock.json" "%PREV%\api\package-lock.json"
robocopy "%STAGE%\api\dist"    "%TARGET%\api\dist"    %RC_OPTS% /R:5 /W:3
if errorlevel 8 exit /b 1
robocopy "%STAGE%\web\browser" "%TARGET%\web\browser" %RC_OPTS% /R:5 /W:3
if errorlevel 8 exit /b 1
robocopy "%STAGE%\web\server"  "%TARGET%\web\server"  %RC_OPTS% /R:5 /W:3
if errorlevel 8 exit /b 1
for %%f in (3rdpartylicenses.txt prerendered-routes.json) do (
  if exist "%STAGE%\web\%%f" copy /y "%STAGE%\web\%%f" "%TARGET%\web\%%f"
)
exit /b 0

:job_packages
pushd "%TARGET%\api"
call npm ci --omit=dev --no-audit --no-fund
set "RC=%errorlevel%"
popd
exit /b %RC%

:job_migrate
rem New migrations run against the database in api\.env.
pushd "%TARGET%\api"
call npx typeorm migration:run -d dist/database/data-source.js > "%STAGE%\migrations.log" 2>&1
set "RC=%errorlevel%"
popd
type "%STAGE%\migrations.log"
exit /b %RC%

:job_health
set "A=000" & set "W=000"
for /l %%i in (1,1,30) do (
  if not "!A!"=="200" for /f %%c in ('curl.exe -s -o nul -m 10 -w "%%{http_code}" "%API_URL%" 2^>nul') do set "A=%%c"
  if not "!W!"=="200" for /f %%c in ('curl.exe -s -o nul -m 20 -w "%%{http_code}" "%WEB_URL%" 2^>nul') do set "W=%%c"
  if "!A!!W!"=="200200" goto :job_health_done
  ping -n 3 127.0.0.1 >nul
)
:job_health_done
> "%STAGE%\health.txt" echo !A! !W!
if "!A!!W!"=="200200" exit /b 0
exit /b 1


rem ======================================================================
rem  Display helpers
rem ======================================================================

rem :step <n> "<label>"   ━ 3/7 ━  ████████░░░░░░░░░░░░  43%%  label
:step
set /a "FILL=%~1*20/TOTAL, PCT=%~1*100/TOTAL"
set "BAR="
for /l %%i in (1,1,20) do (
  if %%i leq !FILL! (set "BAR=!BAR!█") else (set "BAR=!BAR!░")
)
set "PCT=  !PCT!" & set "PCT=!PCT:~-3!"
echo.
echo   %CYAN%%BOLD%%~1/%TOTAL%%RESET%  %BLUE%!BAR!%RESET% %DIM%!PCT!%%%RESET%  %BOLD%%~2%RESET%
exit /b 0

rem :spin "<label>" <job>   runs the job in the background with an animated
rem spinner and a timer. Sets RC to the job's exit code.
:spin
set "LABEL=%~1"
if exist "%DONE%" del /f /q "%DONE%"
call :now T0
start "" /b cmd /d /c ""%STAGE%\job.cmd" %~2" <nul
set /a "N=0"
:spin_wait
if exist "%DONE%" goto :spin_read
set /a "K=N %% 8"
call :now T1
set /a "EL=T1-T0" & if !EL! lss 0 set /a "EL+=8640000"
call :fmt !EL! ELT
for %%k in (!K!) do set "FR=!F%%k!"
<nul set /p "=%CLEARLINE%      %ORANGE%!FR!%RESET%  !LABEL!  %DIM%!ELT!%RESET%"
ping -n 1 -w 120 192.0.2.1 >nul 2>&1
set /a "N+=1"
goto :spin_wait
:spin_read
set "RC="
set /p RC=<"%DONE%"
if not defined RC (ping -n 1 -w 100 192.0.2.1 >nul 2>&1 & goto :spin_read)
set "RC=!RC: =!"
call :now T1
set /a "EL=T1-T0" & if !EL! lss 0 set /a "EL+=8640000"
call :fmt !EL! ELT
if "!RC!"=="0" (
  echo %CLEARLINE%      %GREEN%√%RESET%      !LABEL!  %DIM%!ELT!%RESET%
) else (
  echo %CLEARLINE%      %RED%×%RESET%      !LABEL!  %DIM%!ELT!%RESET%
)
exit /b 0

:ok
echo       %GREEN%√%RESET%      %~1
exit /b 0

:info
echo       %DIM%·      %~1%RESET%
exit /b 0

:warn
echo       %YELLOW%▲      %~1%RESET%
exit /b 0

:fail
echo.
echo       %RED%%BOLD%×  %~1%RESET%
exit /b 0

rem :boxline "<coloured text>" "<plain text>"   pads the plain length to the box width.
:boxline
set "PLAIN=%~2"
set "PAD=                                                      "
set "LEN=0"
if defined PLAIN (
  set "TMP=!PLAIN!"
  for %%n in (64 32 16 8 4 2 1) do (
    if not "!TMP:~%%n,1!"=="" (set /a "LEN+=%%n" & set "TMP=!TMP:~%%n!")
  )
  set /a "LEN+=1"
)
set /a "SPACES=52-LEN"
if !SPACES! lss 0 set "SPACES=0"
for %%s in (!SPACES!) do set "PAD=!PAD:~0,%%s!"
echo   !BOX!│%RESET%  %~1!PAD!!BOX!│%RESET%
exit /b 0

:showlog
echo.
echo       %DIM%Last lines of %LOG%:%RESET%
powershell -NoProfile -Command "Get-Content -LiteralPath $env:LOG -Tail 25 | ForEach-Object { '         ' + $_ }"
exit /b 0

:online
if exist "%TARGET%\api\app_offline.htm" del /f /q "%TARGET%\api\app_offline.htm"
if exist "%TARGET%\web\app_offline.htm" del /f /q "%TARGET%\web\app_offline.htm"
exit /b 0

rem :now <var>   centiseconds since midnight.
:now
set "_T=%TIME: =0%"
for /f "tokens=1-4 delims=:.," %%a in ("%_T%") do set /a "%~1=(((1%%a-100)*60+(1%%b-100))*60+(1%%c-100))*100+(1%%d-100)"
exit /b 0

rem :fmt <centiseconds> <var>   m:ss
:fmt
set /a "_S=%~1/100, _M=_S/60, _S=_S%%60"
if !_S! lss 10 set "_S=0!_S!"
set "%~2=!_M!:!_S!"
exit /b 0

:end
rem Show the cursor again.
<nul set /p "=%ESC%[?25h"
echo.
endlocal
pause
