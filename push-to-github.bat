@echo off
rem ==========================================================================
rem  REGIONAL CENTRE TRAINING INSTITUTE - push the school site to GitHub.
rem  Double-click this file (or run it from a terminal in the project folder).
rem
rem  Steps: check Git and the repository, collect every change, write a
rem  commit message from what changed (press Enter to use it or type your
rem  own), commit, and push the current branch to the repository below.
rem
rem  Secrets (.env, database/setup-local.sql), backups, uploads and
rem  node_modules are never sent: they are in .gitignore and are checked
rem  again before committing.
rem
rem  The commit-message writer is the PowerShell part at the end of this file.
rem  Keep this file saved as UTF-8 with Windows (CRLF) line endings.
rem ==========================================================================
setlocal EnableExtensions EnableDelayedExpansion

set "PROJECT=%~dp0"
if "%PROJECT:~-1%"=="\" set "PROJECT=%PROJECT:~0,-1%"
set "SELF=%~f0"
set "SITE_NAME=REGIONAL CENTRE TRAINING INSTITUTE"
set "REMOTE_URL=https://github.com/DAVID-KAMADI/school-site.git"
set "WORK=%TEMP%\school-site-push"
set "LOG=%WORK%\push.log"
set "DONE=%WORK%\done.txt"
set "TOTAL=6"

rem Background jobs (run with a spinner) call this same file: push-to-github.bat :job <name>
if "%~1"==":job" goto :job_%~2

chcp 65001 >nul
title %SITE_NAME% - Push to GitHub
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
echo     %BOLD%Push to GitHub%RESET%
echo     %DIM%From%RESET%  %PROJECT%
echo     %DIM%To%RESET%    %REMOTE_URL%
echo   %BLUE%━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━%RESET%

rem ------------------------------------------------------------ 1. Git + repo
call :step 1 "Checking Git and the repository"
where git >nul 2>&1 || (call :fail "Git is not installed. Get it from https://git-scm.com/download/win and run this again." & goto :end)
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%" || (call :fail "Cannot create %WORK%." & goto :end)
rem The script each background job runs: this file with ":job <name>", exit code to done.txt.
> "%WORK%\job.cmd" (
  echo @echo off
  echo call "%~f0" :job %%1 ^>^> "%LOG%" 2^>^&1
  echo ^> "%DONE%" echo %%errorlevel%%
)
if not exist ".git" (
  git init -q || (call :fail "Could not create the Git repository." & goto :end)
  call :info "New repository created"
)
git config user.name >nul 2>&1
if errorlevel 1 (
  set "GIT_NAME="
  set /p "GIT_NAME=      Your name for commits: "
  if not defined GIT_NAME (call :fail "A name is needed for commits." & goto :end)
  git config user.name "!GIT_NAME!"
)
git config user.email >nul 2>&1
if errorlevel 1 (
  set "GIT_EMAIL="
  set /p "GIT_EMAIL=      Your GitHub email: "
  if not defined GIT_EMAIL (call :fail "An email is needed for commits." & goto :end)
  git config user.email "!GIT_EMAIL!"
)
git remote get-url origin >nul 2>&1
if errorlevel 1 (git remote add origin "%REMOTE_URL%") else (git remote set-url origin "%REMOTE_URL%")
rem A brand-new repository starts on "main".
git rev-parse --verify -q HEAD >nul 2>&1
if errorlevel 1 git symbolic-ref HEAD refs/heads/main
for /f "delims=" %%b in ('git branch --show-current') do set "BRANCH=%%b"
for /f "tokens=3" %%v in ('git --version') do set "GITV=%%v"
call :ok "Git !GITV!  ·  branch !BRANCH!"

rem ------------------------------------------------------------- 2. Changes
call :step 2 "Collecting the changes"
call :spin "Adding changed files" add
if not "!RC!"=="0" (call :fail "Could not add the files." & call :showlog & goto :end)
rem Safety net: stop if anything secret or private was picked up.
git diff --cached --name-only -- ":(glob,icase)**/.env" ":(glob,icase)**/.env.local" ":(glob,icase)**/setup-local.sql" ":(glob)**/backups/**" ":(glob)**/storage/**" ":(glob)**/node_modules/**" > "%WORK%\blocked.txt"
for %%F in ("%WORK%\blocked.txt") do if %%~zF gtr 0 (
  git reset -q
  call :fail "These files must never be uploaded:"
  for /f "usebackq delims=" %%p in ("%WORK%\blocked.txt") do echo          %RED%%%p%RESET%
  call :info "Nothing was sent. Add them to .gitignore, then run this again."
  goto :end
)
set "COUNT=0"
for /f %%c in ('git diff --cached --name-only ^| find /c /v ""') do set "COUNT=%%c"
if "!COUNT!"=="0" (call :info "No new changes since the last commit") else (call :ok "!COUNT! changed file(s)")

rem ------------------------------------------------------ 3. Commit message
call :step 3 "Writing the commit message"
if "!COUNT!"=="0" (
  git rev-parse --verify -q HEAD >nul 2>&1 || (call :fail "There are no files to upload." & goto :end)
  call :info "Skipped - pushing the commits already saved"
) else (
  set "COMMIT_SUBJECT="
  call :message || (call :fail "Could not write the commit message." & goto :end)
  echo.
  set /p "COMMIT_SUBJECT=      %DIM%Press Enter to use it, or type your own summary:%RESET% "
  if defined COMMIT_SUBJECT (
    call :message >nul || (call :fail "Could not write the commit message." & goto :end)
    call :ok "Using your summary"
  ) else (
    call :ok "Using the suggested message"
  )
)

rem ------------------------------------------------------------- 4. Commit
call :step 4 "Saving a snapshot (commit)"
if "!COUNT!"=="0" (
  call :info "Nothing new to commit"
) else (
  call :spin "Committing !COUNT! file(s)" commit
  if not "!RC!"=="0" (call :fail "The commit failed." & call :showlog & goto :end)
)

rem --------------------------------------------------------------- 5. Push
call :step 5 "Uploading to GitHub"
call :spin "Pushing !BRANCH! to origin" push
if not "!RC!"=="0" (
  findstr /i /c:"rejected" /c:"fetch first" /c:"non-fast-forward" "%WORK%\push-out.log" >nul
  if not errorlevel 1 (
    call :warn "GitHub has commits that are not on this computer (e.g. a README made on the website)."
    set "ANSWER="
    set /p "ANSWER=      Combine them with your work and upload again? [Y/N] "
    if /i not "!ANSWER!"=="Y" (call :fail "Nothing was uploaded." & goto :end)
    call :spin "Combining with GitHub" pull
    if not "!RC!"=="0" (
      call :fail "The two versions could not be combined automatically. Resolve the conflicts in VS Code, then run this again."
      call :showlog
      goto :end
    )
    call :spin "Pushing !BRANCH! to origin" push
  )
)
if not "!RC!"=="0" (
  rem Usually a first-time sign-in: run the push in the open so GitHub can ask for it.
  call :warn "GitHub needs you to sign in. A sign-in window may open."
  echo.
  git push -u origin !BRANCH!
  if errorlevel 1 (call :fail "The upload failed. Check your internet connection and access to the repository." & goto :end)
  call :ok "Pushed after signing in"
)

rem ----------------------------------------------------------- 6. Summary
call :step 6 "Done"
for /f "delims=" %%h in ('git rev-parse --short HEAD') do set "HASH=%%h"
if "!COUNT!"=="0" (
  set "SHORT=(no new changes)"
) else (
  set "SHORT="
  if exist "%WORK%\short.txt" set /p SHORT=<"%WORK%\short.txt"
)
set "WEB=%REMOTE_URL:.git=%"
set "WEB_SHORT=!WEB:https://=!"
call :now END_CS
set /a "TOOK=END_CS-START_CS" & if !TOOK! lss 0 set /a "TOOK+=8640000"
call :fmt !TOOK! TOOK_TEXT
set "BOX=%GREEN%" & set "HEAD=√  Pushed to GitHub"
echo.
echo   !BOX!╭──────────────────────────────────────────────────────╮%RESET%
call :boxline "%BOLD%!HEAD!%RESET%" "!HEAD!"
call :boxline "" ""
call :boxline "%DIM%Branch%RESET%    !BRANCH!" "Branch    !BRANCH!"
call :boxline "%DIM%Commit%RESET%    !HASH!  !SHORT!" "Commit    !HASH!  !SHORT!"
call :boxline "%DIM%Files%RESET%     !COUNT! changed" "Files     !COUNT! changed"
call :boxline "%DIM%GitHub%RESET%    !WEB_SHORT!" "GitHub    !WEB_SHORT!"
call :boxline "%DIM%Time%RESET%      !TOOK_TEXT!" "Time      !TOOK_TEXT!"
echo   !BOX!╰──────────────────────────────────────────────────────╯%RESET%
echo.
echo   %DIM%Log: %LOG%%RESET%
goto :end


rem ======================================================================
rem  Background jobs. Each runs in its own cmd, output to %LOG%.
rem ======================================================================
:job_add
git add -A
exit /b %errorlevel%

:job_commit
git commit -q -F "%WORK%\message.txt"
exit /b %errorlevel%

:job_push
set "GIT_TERMINAL_PROMPT=0"
git push -u origin %BRANCH% > "%WORK%\push-out.log" 2>&1
set "RC=%errorlevel%"
type "%WORK%\push-out.log"
exit /b %RC%

:job_pull
git pull --no-rebase --no-edit --allow-unrelated-histories origin %BRANCH%
exit /b %errorlevel%


rem ======================================================================
rem  Commit message: runs the PowerShell part at the end of this file. It
rem  writes message.txt (subject + file list) and short.txt (for the box),
rem  and prints a preview. COMMIT_SUBJECT, if set, replaces the subject.
rem ======================================================================
:message
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f=[IO.File]::ReadAllText($env:SELF); iex $f.Substring($f.IndexOf('##PS'+'BEGIN'))"
exit /b %errorlevel%


rem ======================================================================
rem  Display helpers
rem ======================================================================

rem :step <n> "<label>"   ━ 3/6 ━  ████████░░░░░░░░░░░░  50%%  label
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
<nul set /p "=%ESC%[?25l"
call :now T0
start "" /b cmd /d /c ""%WORK%\job.cmd" %~2" <nul
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
<nul set /p "=%ESC%[?25h"
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
<nul set /p "=%ESC%[?25h"
echo.
endlocal
pause
exit /b


##PSBEGIN - commit-message writer (PowerShell; cmd never runs past "exit /b" above)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$work = $env:WORK

$rows = @(git -c core.quotepath=off diff --cached --name-status -M)
$stat = (git diff --cached --shortstat | Out-String).Trim()
$files = @(foreach ($r in $rows) {
  $p = $r -split "`t"
  $old = $null
  if ($p.Count -gt 2) { $old = $p[1] }
  New-Object psobject -Property @{ S = $p[0].Substring(0, 1); Path = $p[-1]; Old = $old }
})
if ($files.Count -eq 0) { exit 1 }

# A short, readable name for the part of the site a file belongs to.
function Get-Topic([string]$path) {
  $leaf = Split-Path $path -Leaf
  $parent = Split-Path $path -Parent
  $dir = ''
  if ($parent) { $dir = Split-Path $parent -Leaf }
  if ($path -match '(^|/)migrations/') { return 'database migrations' }
  if ($leaf -match '^package(-lock)?\.json$') {
    if ($path -like 'frontend/*') { return 'website packages' }
    if ($path -like 'backend/*') { return 'API packages' }
    return 'packages'
  }
  if ($leaf -match '\.(bat|cmd|ps1)$') { return ([IO.Path]::GetFileNameWithoutExtension($leaf) + ' script') }
  if ($leaf -match '\.md$') { return [IO.Path]::GetFileNameWithoutExtension($leaf) }
  $name = $leaf -replace '\..*$', ''
  if ($name -eq '') { return $leaf.TrimStart('.') }
  if (@('index', 'main', 'app', 'styles', 'server', 'types', 'models', 'utils', 'routes') -contains $name -and $dir) { $name = $dir }
  $name = ($name -replace '[-_]+', ' ').Trim().ToLower()
  if ($path -like 'frontend/src/app/admin/*' -and $name -notlike 'admin*') { return "admin $name" }
  if ($path -like 'backend/*' -and $name -notmatch '\bapi\b') { return "$name API" }
  return $name
}

# Topics, most-changed first (ties keep their order).
$topics = [ordered]@{}
foreach ($f in $files) {
  $t = Get-Topic $f.Path
  if ($topics.Contains($t)) { $topics[$t]++ } else { $topics[$t] = 1 }
}
$i = 0
$names = @($topics.GetEnumerator() | ForEach-Object { New-Object psobject -Property @{ Name = $_.Key; Count = $_.Value; Index = $i++ } } |
  Sort-Object @{ Expression = 'Count'; Descending = $true }, @{ Expression = 'Index'; Descending = $false } |
  ForEach-Object { $_.Name })

$statuses = @($files | ForEach-Object { $_.S })
if (@($statuses | Where-Object { $_ -ne 'A' }).Count -eq 0) { $verb = 'Add' }
elseif (@($statuses | Where-Object { $_ -ne 'D' }).Count -eq 0) { $verb = 'Remove' }
else { $verb = 'Update' }

if ($names.Count -eq 1) { $list = $names[0] }
elseif ($names.Count -le 3) { $list = ($names[0..($names.Count - 2)] -join ', ') + ' and ' + $names[-1] }
else { $list = "$($names[0]), $($names[1]) and $($names.Count - 2) other areas" }
$subject = "$verb $list"
if ($subject.Length -gt 72) { $subject = $subject.Substring(0, 69).TrimEnd() + '...' }

if ($env:COMMIT_SUBJECT -and $env:COMMIT_SUBJECT.Trim()) { $subject = $env:COMMIT_SUBJECT.Trim() }

# Body: the change count, then the files grouped by what happened to them.
$body = New-Object Collections.Generic.List[string]
$body.Add($stat)
$groups = [ordered]@{ A = 'Added'; M = 'Changed'; T = 'Changed'; R = 'Renamed'; C = 'Copied'; D = 'Removed' }
foreach ($label in @('Added', 'Changed', 'Renamed', 'Copied', 'Removed')) {
  $codes = @($groups.Keys | Where-Object { $groups[$_] -eq $label })
  $set = @($files | Where-Object { $codes -contains $_.S })
  if ($set.Count -eq 0) { continue }
  $body.Add('')
  $body.Add("${label}:")
  foreach ($f in ($set | Select-Object -First 25)) {
    if ($f.Old) { $body.Add("  - $($f.Old) -> $($f.Path)") } else { $body.Add("  - $($f.Path)") }
  }
  if ($set.Count -gt 25) { $body.Add("  - ...and $($set.Count - 25) more") }
}

$utf8 = New-Object Text.UTF8Encoding $false
[IO.File]::WriteAllText((Join-Path $work 'message.txt'), $subject + "`n`n" + ($body -join "`n") + "`n", $utf8)
$short = $subject -replace '["!%^&<>|]', ''
if ($short.Length -gt 32) { $short = $short.Substring(0, 29).TrimEnd() + '...' }
[IO.File]::WriteAllText((Join-Path $work 'short.txt'), $short, $utf8)

# Preview.
$e = [char]27
Write-Output ''
Write-Output "      ${e}[1m$subject${e}[0m"
Write-Output "      ${e}[90m$stat${e}[0m"
$marks = @{ A = "${e}[92m+"; M = "${e}[93m~"; T = "${e}[93m~"; R = "${e}[96m>"; C = "${e}[96m>"; D = "${e}[91m-" }
foreach ($f in ($files | Select-Object -First 8)) { Write-Output "        $($marks[$f.S])${e}[0m ${e}[90m$($f.Path)${e}[0m" }
if ($files.Count -gt 8) { Write-Output "        ${e}[90m...and $($files.Count - 8) more${e}[0m" }
exit 0
