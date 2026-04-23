---
description: "如何將專案部署至 Staging (測試環境) 或 Production (正式環境)"
globs: ["**/*"]
---

# 部署至 Staging / Production (Deploy to Staging or Production)

當使用者要求將專案部署到 Staging (測試機) 或 Production (正式環境) 時，請嚴格遵守以下標準流程。**絕對不要使用 Github Actions 或 CI/CD Pipeline 來觸發部署**。

## 1. 提交程式碼 (Commit & Push)
在開始部署之前，請先確保所有變更都已經加入版控，並推送到遠端：
1. `git add .`
2. `git commit -m "你的 commit 訊息"`
3. `git push`

## 2. 執行本機部署指令 (Run Deployment Command)
使用背景終端機 (background command) 在專案根目錄執行對應的指令：

**部署至 Staging (測試機)：**
```bash
npm run deploy:staging
```

**部署至 Production (正式機)：**
```bash
npm run deploy:production
```
這會自動觸發 D1 資料庫遷移以及 Cloudflare Pages 的打包部署。

## 3. 監控部署狀態並主動回報 (Monitor and Actively Report)
- 由於部署通常需要花費 1~2 分鐘，執行背景指令後，**你必須主動使用工具持續追蹤背景指令的進度與狀態**。
- **絕對不要讓使用者主動開口問你「好了沒」**。你需要一直確認狀態直到完成為止。
- 當終端機指令完全結束 (Exit code: 0) 並且部署成功後，你必須**主動回覆使用者**，告知部署已經順利完成，並請他們重新整理網頁查看最新結果。
