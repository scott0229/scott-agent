---
description: "新增或修改資料庫欄位與資料表時的必做事項 (包含備份系統的同步)"
globs: ["migrations/*.sql", "src/app/api/users/export/route.ts", "src/app/api/users/import/route.ts"]
---

# 資料庫結構變更規範 (Database Schema Changes)

當使用者要求新增資料庫欄位 (Columns) 或新增完整的資料表 (Tables) 時，除了建立 Migration SQL 與更新相關的 API 之外，**你必須嚴格遵守以下連帶更新規範**。

因為使用者過去常常遇到「新增了功能/欄位，卻忘記把它加進備份系統中」的慘痛經驗，因此這是最高指導原則！

## 必做事項：同步更新備份與還原系統 (Export / Import)

本系統有一套 JSON 備份與還原機制，它是「手動指定」匯出/匯入的資料表與欄位，而**不是**全自動映射的。因此，當你改變了資料庫的 Schema，你**必須、絕對要**同步去修改以下兩個核心檔案：

### 1. 更新匯出邏輯 (Export Route)
- **檔案路徑**：`src/app/api/users/export/route.ts`
- **你需要做的事**：
  - **新增欄位**：請確保該資料表的 `SELECT` 語法有把新欄位選出來（如果該查詢是明確列出欄位名稱，則必須將新欄位加上去）。
  - **新增資料表**：你必須在匯出的 JSON 結構中新增一個區塊，撈取這張新表的所有資料並打包進回傳的 JSON Payload 中。

### 2. 更新匯入邏輯 (Import Route)
- **檔案路徑**：`src/app/api/users/import/route.ts`
- **你需要做的事**：
  - **新增欄位**：請在對應資料表的 `INSERT INTO ... VALUES ...` 以及 `ON CONFLICT DO UPDATE SET ...` 等語法中，將新的欄位與綁定參數補上。
  - **新增資料表**：你必須在檔案內撰寫全新的匯入區塊，解析上傳 JSON 裡面的陣列，並安全地 `INSERT OR REPLACE` 進入這張新的資料表中。

## 檢查清單 (Checklist)
每次幫使用者寫完新的資料庫 Migration 後，請自我審查：
- [ ] 欄位是否有適當的預設值 (Default Value) 以防舊資料報錯？
- [ ] `export/route.ts` 已經正確包含新欄位/新表了嗎？
- [ ] `import/route.ts` 已經寫好對應的解析與寫入邏輯了嗎？
- [ ] 記得主動跟使用者報告：「因為新增了欄位，我也一併幫您把備份功能 (Export/Import) 都更新好了喔！」
