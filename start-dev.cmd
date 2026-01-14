@echo off
REM Scott Agent - 開發環境快速啟動腳本 (批次檔版本)
REM 此腳本會自動執行 migrations、重建 worker bundle，並啟動開發伺服器

echo ========================================
echo Scott Agent - 開發環境啟動中...
echo ========================================
echo.

REM 步驟 1: 應用資料庫 migrations
echo 步驟 1/3: 應用資料庫 migrations...
call npm run migrate:local
if errorlevel 1 (
    echo ❌ Migrations 執行失敗！
    echo 請檢查錯誤訊息或手動執行: npm run migrate:local
    exit /b 1
)
echo ✅ Migrations 完成
echo.

REM 步驟 2: 重新建置 Worker bundle
echo 步驟 2/3: 重新建置 Worker bundle...
call npm run build:cf
if errorlevel 1 (
    echo ❌ Worker bundle 建置失敗！
    echo 請檢查錯誤訊息或手動執行: npm run build:cf
    exit /b 1
)
echo ✅ Worker bundle 建置完成
echo.

REM 步驟 3: 啟動開發伺服器
echo 步驟 3/3: 啟動開發伺服器...
echo 伺服器將在 http://localhost:8080 啟動
echo.
echo 提示: 按 Ctrl+C 可停止伺服器
echo ========================================
echo.

call npm run dev
