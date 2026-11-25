@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
if not exist node_modules call npm install
npm run check
if errorlevel 1 goto error
npm start
exit /b 0
:error
echo Pemeriksaan project gagal. Periksa pesan error di atas.
pause
exit /b 1
