@echo off
chcp 65001 >nul
title Install AI GenFill (permanent) - Run as Administrator
rem ============================================================
rem  Permanently install this UXP plugin into Photoshop by
rem  copying it into the system UXP extensions folder.
rem  This does NOT need Creative Cloud or an Adobe account.
rem  Works for PS 2023+ (incl. cracked installs).
rem ============================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   This installer needs Administrator rights.
  echo   Right-click this file -^> "Run as administrator".
  echo.
  pause
  exit /b
)

set "SRC=%~dp0"
set "EXT=C:\Program Files\Common Files\Adobe\UXP\extensions\com.community.psgenaifill"

echo Installing to:
echo   %EXT%
echo.

if exist "%EXT%" rmdir /s /q "%EXT%"
mkdir "%EXT%"

copy "%SRC%manifest.json" "%EXT%\" >nul
copy "%SRC%index.html"   "%EXT%\" >nul
copy "%SRC%styles.css"   "%EXT%\" >nul
xcopy "%SRC%src"   "%EXT%\src\"   /e /i /y >nul
xcopy "%SRC%icons" "%EXT%\icons\" /e /i /y >nul

echo.
echo   DONE - files copied.
echo   1) FULLY quit Photoshop (not just close the window).
echo   2) Reopen Photoshop.
echo   3) Look under the  Plugins  menu for "AI 生成填充".
echo.
echo   If it does not show up, the manual UDT method still works.
echo.
pause
