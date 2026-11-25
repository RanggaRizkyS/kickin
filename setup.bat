@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
echo Installing dependencies...
npm install
if errorlevel 1 goto error
echo.
echo Setup selesai. Edit .env kemudian jalankan deploy-commands.bat dan start.bat.
pause
exit /b 0
:error
echo Setup gagal. Pastikan Node.js 20+ dan koneksi internet tersedia.
pause
exit /b 1
