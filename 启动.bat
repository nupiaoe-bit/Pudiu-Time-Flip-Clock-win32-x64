@echo off
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title Pudiu Time Desktop

rem 某些开发环境会注入 ELECTRON_RUN_AS_NODE=1，会让 Electron 以纯 Node 模式运行（窗口不起来、无报错）
set ELECTRON_RUN_AS_NODE=
set ELECTRON_NO_ATTACH_CONSOLE=1

echo ============================================
echo   Pudiu Time 桌面版 - 启动器
echo   目录：%~dp0
echo ============================================

rem 1) 优先用已打包好的程序（不需要 node_modules）
if exist "dist\win-unpacked\PudiuTime.exe" (
  echo [run] 启动已打包程序：dist\win-unpacked\PudiuTime.exe
  start "" "dist\win-unpacked\PudiuTime.exe"
  exit /b 0
)

rem 2) 否则用源码模式（需要 Electron 依赖）
if not exist "main.js" (
  echo [错误] 当前目录下找不到 main.js，请在 PudiuTime 文件夹里运行本脚本。
  echo 当前目录：%CD%
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [setup] 首次运行，正在安装依赖（约 1-3 分钟）...
  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  call npm install --registry=https://registry.npmmirror.com
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [错误] Electron 安装失败，请检查网络后重试。
  pause
  exit /b 1
)

echo [run] 源码模式启动...
start "" "node_modules\electron\dist\electron.exe" "%~dp0"
exit /b 0
