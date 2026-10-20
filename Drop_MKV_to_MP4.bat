@echo off
setlocal enabledelayedexpansion
title Fast MKV to MP4 Converter (No Re-encoding)

if "%~1"=="" (
    echo.
    echo ============================================================
    echo           FAST MKV to MP4 CONVERTER (Remuxer)
    echo ============================================================
    echo.
    echo How to use:
    echo   Simply DRAG and DROP any .mkv file onto this script or shortcut!
    echo.
    echo This will repackage the file into MP4 in 5-10 seconds
    echo without loss of quality or 30-minute re-encoding.
    echo.
    pause
    exit /b
)

:loop
if "%~1"=="" goto finish

set "INPUT=%~1"
set "OUTPUT=%~dpn1.mp4"

echo.
echo ------------------------------------------------------------
echo Processing: "%~nx1"
echo Output will be: "%OUTPUT%"
echo ------------------------------------------------------------

ffmpeg -y -i "%INPUT%" -map 0 -c copy -movflags +faststart "%OUTPUT%"

if errorlevel 1 (
    echo.
    echo [Notice] Direct stream copy failed. Packaging with AAC audio...
    ffmpeg -y -i "%INPUT%" -c:v copy -c:a aac -movflags +faststart "%OUTPUT%"
)

shift
goto loop

:finish
echo.
echo ============================================================
echo   Conversion Complete! Your MP4 is ready in the same folder.
echo ============================================================
echo.
timeout /t 3 >nul
exit /b
