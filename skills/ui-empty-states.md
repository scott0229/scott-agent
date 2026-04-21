---
description: "空狀態與防呆介面設計規範"
globs: ["**/*.tsx", "src/components/**/*.tsx"]
---

# 空狀態與防呆介面規範 (UI Empty States)

即使系統內完全沒有任何資料紀錄或處於被清空狀態時，也要為使用者提供充滿專業感與結構一致性的引導與外觀。

## 1. 虛線外框的標準設計 (Dashed Formats)
- 當主要的列表、方塊區域或版面呈現「空」的預設情境時，請使用淺色附帶極低透明度的背景，並加上虛線外框來表示。
- **標準化的 Tailwind CSS 寫法範例**：
  ```tsx
  <div className="text-center py-12 text-muted-foreground bg-secondary/10 rounded-lg border border-dashed">
      尚無資料或紀錄
  </div>
  ```
- 這樣的設計遠比直接不顯示任何東西，或只放一段小字來得更有框架感。

## 2. 嚴格禁止隱藏結構 (Fallback Avoidance)
- 如果一個元件或表格是屬於標準 Dashboard 面板結構的一部分（比如每個使用者都有的「個人績效統計表」），**即使這位使用者沒有任何資料**，也「絕對不可以」把整個 `<table\>` 節點透過條件渲染隱藏起來。
- 解決方式：請繼續渲染並保留表頭列 (Table Headers)，並在下方呈現維持版型佈局的空行，或是在所有的數值位置填補顯示 `0` 或 `0.00%`。這能保持應用程式的結構完整性，並告訴使用者這個功能區域還在只是還沒有內容。
