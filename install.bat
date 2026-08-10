@echo off
echo ==========================================
echo Dungeon Raid - Install Script
echo ==========================================
echo.

cd /d "%~dp0"

echo [1/3] Creating Python virtual environment...
python -m venv venv
if errorlevel 1 (
    echo ERROR: Python not found! Please install Python 3.10+
    pause
    exit /b 1
)

echo.
echo [2/3] Activating virtual environment...
call venv\Scripts\activate.bat

echo.
echo [3/3] Installing packages...
pip install -r backend\requirements.txt

echo.
echo ==========================================
echo DONE! Installation complete.
echo ==========================================
echo.
echo Run start_server.bat to start the server.
echo.
pause
