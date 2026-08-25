@echo off
chcp 65001 >nul
title NEXUS 一键安装 (Windows)
setlocal EnableDelayedExpansion

echo ╔══════════════════════════════════════╗
echo ║      NEXUS 一键安装 (Windows)        ║
echo ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

REM ── 1. 检查 Node.js ──────────────────────────────
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [X] 未检测到 Node.js，请先安装 Node.js 18+
    echo     下载地址: https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js:
node --version

REM ── 2. 安装依赖 ───────────────────────────────────
echo.
echo [1/4] 安装主项目依赖（约 1-2 分钟）...
call npm install --no-audit --no-fund
if %errorlevel% neq 0 (
    echo [X] 主项目依赖安装失败
    pause
    exit /b 1
)

echo [2/4] 安装流式服务依赖...
pushd mini-services\nexus-stream
call npm install --no-audit --no-fund
popd
if %errorlevel% neq 0 (
    echo [X] 流式服务依赖安装失败
    pause
    exit /b 1
)

REM ── 3. 初始化数据库 + 编译 stream 服务 ───────────
echo [3/4] 初始化数据库 + 编译 stream 服务...
call node scripts\nexus.mjs setup
if %errorlevel% neq 0 (
    echo [X] 环境配置失败
    pause
    exit /b 1
)

REM ── 4. 把项目目录加入用户 PATH（nexus 命令全局可用） ──
echo [4/5] 添加项目目录到用户 PATH（nexus 命令可全局使用）...
powershell -NoProfile -Command "$dir = (Get-Location).Path; $p = [Environment]::GetEnvironmentVariable('Path','User'); if ($p -and ($p.Split(';') -contains $dir)) { Write-Host '[OK] 已在 PATH 中' } else { $next = if ($p) { $p.TrimEnd(';') + ';' + $dir } else { $dir }; [Environment]::SetEnvironmentVariable('Path', $next, 'User'); Write-Host '[OK] 已添加，请重新打开终端后再使用 nexus 命令' }"
if %errorlevel% neq 0 (
    echo [X] PATH 设置失败（不影响使用，可直接运行 .\nexus web）
)

REM ── 5. 创建桌面快捷启动脚本 ──────────────────────
echo [5/5] 创建一键启动脚本 start-nexus.bat...
(
echo @echo off
echo chcp 65001 ^>nul
echo title NEXUS
echo cd /d "%%~dp0"
echo echo 正在启动 NEXUS，就绪后会自动打开浏览器...
echo node scripts\nexus.mjs web
echo pause
) > start-nexus.bat

echo.
echo ╔══════════════════════════════════════╗
echo ║            安装完成！                ║
echo ╠══════════════════════════════════════╣
echo ║ 以后使用：双击 start-nexus.bat       ║
echo ║ 或在命令行运行: nexus web            ║
echo ║ （重开终端后 nexus 已全局可用）      ║
echo ║ 访问: http://localhost:3000          ║
echo ╚══════════════════════════════════════╝
echo.
echo 现在要立即启动 NEXUS 吗？(Y/N)
set /p LAUNCH=
if /i "!LAUNCH!"=="Y" (
    echo 正在启动...
    node scripts\nexus.mjs web
) else (
    echo 已跳过。之后双击 start-nexus.bat 启动。
)
pause
