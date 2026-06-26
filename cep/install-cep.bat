@echo off
title Install AI GenFill (CEP) - no admin needed
setlocal

set "SRC=%~dp0"
set "DST=%APPDATA%\Adobe\CEP\extensions\com.community.psgenai.cep"

echo ============================================================
echo   Install "AI GenFill" as a CEP extension
echo   No admin rights, no Creative Cloud, no Adobe login needed.
echo   Works on cracked Photoshop 2021+ .
echo ============================================================
echo.

echo [1/2] Enabling PlayerDebugMode (allow unsigned CEP extensions)...
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1

echo [2/2] Copying files to:
echo       %DST%
if exist "%DST%" rmdir /s /q "%DST%"
mkdir "%DST%"
xcopy "%SRC%CSXS" "%DST%\CSXS\" /e /i /y >nul
xcopy "%SRC%css"  "%DST%\css\"  /e /i /y >nul
xcopy "%SRC%host" "%DST%\host\" /e /i /y >nul
xcopy "%SRC%js"   "%DST%\js\"   /e /i /y >nul
xcopy "%SRC%lib"  "%DST%\lib\"  /e /i /y >nul
copy  "%SRC%index.html" "%DST%\" >nul

echo.
echo DONE.
echo   1) Completely quit and restart Photoshop.
echo   2) Menu:  Window  -^>  Extensions (legacy)  -^>  AI GenFill
echo.
pause
