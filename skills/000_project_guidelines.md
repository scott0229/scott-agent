---
description: "專案全局開發規範與 AI 行為準則 (Global System Prompt)"
globs: ["**/*"]
---

# Scott Agent 專案開發規範與 AI 行為準則 (Global System Prompt)

這份文件定義了本專案的全局開發規範，AI 在處理使用者的任何請求時，都必須優先遵守此文件的指導原則。

## 1. 角色與回覆風格 (Communication Style)
- **語言**：一律使用**繁體中文 (Traditional Chinese)** 與使用者溝通。
- **態度**：專業、精確、簡潔。只回覆與解決問題相關的資訊，避免冗長無謂的解釋。
- **先確認後行動**：遇到需求不明確、涉及核心商業邏輯變更，或是可能產生破壞性結果（如大規模刪除資料庫欄位）的操作時，**必須先向使用者提問確認**，嚴禁自行猜測。

## 2. 技術棧與開發標準 (Tech Stack & Coding Standards)
- **核心技術**：Next.js (App Router), React, TypeScript, Tailwind CSS。
- **UI 與樣式**：
  - 樣式修改一律使用 Tailwind CSS。
  - 優先使用專案內建的 UI 元件（如 shadcn/ui 的 Button, Dialog, Select, Table 等），保持整體視覺與互動體驗一致。
- **TypeScript 規範**：
  - 盡可能保持型別安全，**極力避免使用 `any`**。
  - API 回傳的資料結構，請確實定義對應的 `interface` 或 `type`。
- **React 開發**：
  - 確保 Hooks (如 `useEffect`, `useCallback`) 的 dependency array 完整且正確，避免不必要的重新渲染或無限迴圈。
  - 客戶端元件必須在檔案頂部加上 `'use client';`。

## 3. 專案架構與資料庫 (Architecture & Database)
- **資料庫系統**：Cloudflare D1 (SQLite)。
- **資料庫異動 (Migrations)**：
  - 若需修改資料表結構 (Schema)，**必須建立新的 migration SQL 檔案**於 `migrations/` 目錄。
  - **絕對不允許**修改或刪除過去已執行的 migration 檔案，以維護資料庫版本歷史。
  - 所有 SQL 查詢必須使用參數化查詢 (Parameterized Queries) 以防止 SQL Injection。
- **API 路由**：使用 Next.js App Router 的 Route Handlers (`src/app/api/.../route.ts`)。需注意回傳的 HTTP 狀態碼與 JSON 格式的一致性。

## 4. 部署與環境管理 (Deployment & Environments)
- **部署流程**：本專案的部署流程有嚴格規定，請**絕對遵守** `skills/000_deployment.md` 中的所有步驟。
- **腳本執行**：部署至 Staging 或 Production 必須透過專屬的 npm 腳本 (`npm run deploy:staging` / `npm run deploy:production`) 執行，且 AI 必須在背景等待其完全結束後才能回報。

## 5. 程式碼修改原則 (Code Modification Principles)
- **最小化修改 (Minimal Context)**：只針對使用者要求的範圍進行修改，**請勿**擅自重構或刪除與任務無關的現有程式碼、註解或匯入套件 (imports)。
- **錯誤處理 (Error Handling)**：
  - API 端必須有 `try...catch` 保護，並回傳明確的錯誤訊息。
  - 前端發送請求時，應處理 isLoading 狀態，發生錯誤時需使用 `toast` 或其他 UI 元件友善地通知使用者。
- **除錯與測試**：若修改了複雜的資料處理邏輯，請務必再三檢查迴圈與條件判斷，確保資料準確性（特別是與淨值、盈虧計算相關的數字）。
