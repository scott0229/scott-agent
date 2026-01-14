# Scott Agent - 開發環境快速啟動腳本
# 此腳本會自動執行 migrations、重建 worker bundle，並啟動開發伺服器

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Scott Agent - 開發環境啟動中..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 步驟 1: 應用資料庫 migrations
Write-Host "步驟 1/3: 應用資料庫 migrations..." -ForegroundColor Yellow
npm run migrate:local
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Migrations 執行失敗！" -ForegroundColor Red
    Write-Host "請檢查錯誤訊息或手動執行: npm run migrate:local" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Migrations 完成" -ForegroundColor Green
Write-Host ""

# 步驟 2: 重新建置 Worker bundle
Write-Host "步驟 2/3: 重新建置 Worker bundle..." -ForegroundColor Yellow
npm run build:cf
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Worker bundle 建置失敗！" -ForegroundColor Red
    Write-Host "請檢查錯誤訊息或手動執行: npm run build:cf" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Worker bundle 建置完成" -ForegroundColor Green
Write-Host ""

# 步驟 3: 啟動開發伺服器
Write-Host "步驟 3/3: 啟動開發伺服器..." -ForegroundColor Yellow
Write-Host "伺服器將在 http://localhost:8080 啟動" -ForegroundColor Cyan
Write-Host ""
Write-Host "提示: 按 Ctrl+C 可停止伺服器" -ForegroundColor Gray
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

npm run dev
