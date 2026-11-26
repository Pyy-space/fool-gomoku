@echo off
REM ============================================================
REM  GomokuAI launcher
REM  NOTE: keep this file PURE ASCII. cmd.exe parses .bat with the
REM  local OEM code page (GBK on Chinese Windows), so UTF-8 Chinese
REM  text here gets mangled into garbage commands. All Chinese
REM  messages are printed by run.py (Python handles UTF-8 fine).
REM ============================================================
chcp 65001 >nul 2>&1
setlocal

REM Force Python to emit UTF-8, matching the code page set above.
REM Without this, Python prints GBK and Chinese becomes garbage in the console.
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"

cd /d "%~dp0"

REM ---- pick interpreter: the conda env used for development ----
set "PY=D:\anaconda3\envs\AI_boardroom\python.exe"
if not exist "%PY%" set "PY=python"

echo ============================================================
echo   GomokuAI
echo   interpreter: %PY%
echo ============================================================
echo.

"%PY%" --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found: %PY%
    echo         Install Python 3.10+ or edit the PY= line in this file.
    pause
    exit /b 1
)

REM ---- dependency check ----
"%PY%" -c "import flask, flask_socketio, numpy, cv2, mss, win32gui" >nul 2>&1
if errorlevel 1 (
    echo [WARN] dependencies missing, installing from requirements.txt ...
    echo.
    "%PY%" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [ERROR] pip install failed. Run it manually:
        echo    "%PY%" -m pip install -r requirements.txt
        pause
        exit /b 1
    )
)

echo Starting ... browser will open automatically.
echo Press Ctrl+C to stop.
echo.

"%PY%" run.py %*

set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
    echo.
    echo [ERROR] exited with code %RC%
    pause
)
endlocal
exit /b %RC%
