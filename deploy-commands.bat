@echo off
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
npm run deploy-commands
pause
