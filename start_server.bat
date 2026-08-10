@echo off
chcp 65001 >nul
set PYTHONUTF8=1
echo ==========================================
echo Dungeon Raid Server
echo ==========================================
echo.

cd /d "%~dp0"

if exist "venv\Scripts\activate.bat" (
    call venv\Scripts\activate.bat
)

cd backend
python server.py

pause
