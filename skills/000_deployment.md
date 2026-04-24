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
- **【強制技術限制】**：使用 `run_command` 發起背景指令後，**你必須**連續調用 `command_status` 工具，並設定 `WaitDurationSeconds` (如 60 秒) 進行等待與追蹤。
- 在 `command_status` 工具回傳 `Status: DONE` 並且取得明確的 Exit Code 之前，**絕對不允許結束你的回合 (Turn) 或輸出任何文字回覆給使用者**。
- **嚴禁**在部署還在 RUNNING 時就提前跟使用者說「我正在部署」。你必須在背景默默等完。
- 當指令完全結束 (Exit code: 0) 後，你才能**一次性**回覆使用者，告知部署已經順利完成，並請他們重新整理網頁查看最新結果。

## 4. 故障排除 (Troubleshooting)
- 如果在部署時遇到 Cloudflare 相關的 API 授權錯誤 (例如：`The given account is not valid or is not authorized to access this service [code: 7403]`)，這代表本機的 Wrangler 憑證過期。
- 此時，你**必須直接幫使用者執行** `npx wrangler login`，這會自動在他們的電腦上彈出瀏覽器視窗讓他們進行授權。執行後請提示使用者去瀏覽器完成登入，然後再由你重新執行部署指令。
