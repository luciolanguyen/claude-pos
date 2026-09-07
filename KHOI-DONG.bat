@echo off
chcp 65001 >nul
title Tiem dien Thanh Hoa - Phan mem ban hang
cd /d "%~dp0"

echo.
echo  ============================================
echo    TIEM DIEN THANH HOA - PHAN MEM BAN HANG
echo  ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [LOI] Chua cai Node.js tren may nay.
  echo.
  echo  Hay tai va cai Node.js phien ban 22 tro len tai:
  echo      https://nodejs.org
  echo  Roi chay lai file nay.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo  Lan dau chay - dang cai dat thu vien, vui long doi...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  [LOI] Cai dat that bai. Kiem tra ket noi mang roi thu lai.
    pause
    exit /b 1
  )
)

if not exist "dist\index.html" (
  echo  Dang chuan bi giao dien, vui long doi...
  echo.
  call npm run build
  if errorlevel 1 (
    echo.
    echo  [LOI] Chuan bi giao dien that bai.
    pause
    exit /b 1
  )
)

if not exist "data\pos.db" (
  echo  Chua co du lieu - dang nap du lieu mau...
  echo.
  call npm run seed
)

echo.
echo  Dang khoi dong may chu...
echo  De tat phan mem: dong cua so nay hoac nhan Ctrl+C
echo.

start "" http://localhost:5175
node server/index.js

pause
