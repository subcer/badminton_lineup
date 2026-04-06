# 🏸 Badminton Pro Lineup (羽球排點系統)

A premium, real-time interactive badminton lineup management system designed for clubs and casual play.
Built with HTML5, CSS3 (Glassmorphism), and Firebase Realtime Database.

![UI Preview](uploaded_image_1768547696176.png)

## ✨ Features (功能特色)

### 1. 拖曳排點 (Drag & Drop)
*   **直覺操作**：直接從右側名單拖曳球員到場地或等待列。
*   **多人選取**：支援滑鼠框選 (Marquee Selection) 或點擊多選，一次拖曳多人。
*   **自由擺放**：名單區像畫布一樣，球員位置可自由移動擺放，不怕找不到人。

### 2. 即時同步 (Real-time Sync)
*   **多裝置連線**：所有操作透過 Firebase 即時同步，多人同時檢視或操作皆會同步更新。
*   註：因採用即時全畫面同步機制，若多人「同時」進行拖曳操作，可能會因畫面刷新而導致動作中斷，建議以此為輪流操作的工具。

### 3. 智慧序列 (Smart Queue)
*   **等待隊伍**：可將球員拉至左側等待區排隊。
*   **合併組別**：將球員拖曳至「已排隊的組別」上，可自動加入該組 (Merge)。
*   **自動輪轉**：開啟「自動輪轉」開關後，當場地結束比賽 (按「結束」)，系統會自動抓取第一組等待的隊伍上場。

### 4. 場地管理 (Court Management)
*   **計時與計分**：每個場地獨立計時，支援簡易計分板模式。
*   **自動開始**：從等待區上場時，計時器會自動開始。
*   **狀態顯示**：清楚區分「比賽中 (Active)」與「閒置」場地 (金色邊框效果)。

### 5. 響應式設計 (Mobile Friendly / RWD)
*   **手機支援**：專為手機優化的垂直介面。
    *   球員名單可防呆捲動，不怕名單太長被卡掉。
    *   等待列在手機上採垂直堆疊 + 橫向排列，節省空間且易讀。
    *   新增懸浮按鈕 (FAB) 方便手機快速加入列隊。

### 6. 全域操作鎖定 (Global Lock) 🔒
*   **防衝突機制**：當某位使用者正在進行關鍵操作（如拖曳球員）時，系統會自動鎖定，其他使用者的畫面會顯示「操作中」遮罩，防止多人同時送出指令造成畫面跳動。
*   **智慧解鎖**：操作結束或斷線時自動解鎖，確保系統流暢。

### 7. 質感主題切換 (Dynamic Theme) 🌙
*   **Midnight Maroon (極致深色)**：打造質感極佳的深紅酒黑背景，搭配無邊框毛玻璃 (Glassmorphism) 卡片，大幅提升夜間打球的視覺舒適度與電競感。
*   **一鍵切換**：支援手動切換亮/暗色模式並自動記憶，手機側邊欄與電腦面板均完美適配。

### 8. 進階計分機制 (Advanced Scoreboard) 🔢
*   **防誤觸設計**：除了超大面積的加分熱區，計分板兩側更添置了專屬「微型減分鍵」，以防激烈比賽中手抖多按一分。
*   **賽果視覺化**：結束比賽後的「近期比賽紀錄」面板會完整呈現左紅、右綠的清晰計分對比。

### 9. 語音廣播與 QR 報到 (Smart Utilities) 📢
*   **語音叫號 (Text-to-Speech)**：內建場地專屬「廣播小喇叭」，一鍵自動以語音呼叫「第 X 場地，請 YYY、ZZZ 上場」。
*   **QR 掃碼快速報到**：內建對應的網址 QR Code 產生器，群主可直接出示面板，球友手機一掃即可連線大廳。

### 10. 戰績榜與星座分析 (Player Stats & Zodiac) 🏆
*   **全球名人堂**：自動累計並排行所有參賽球員的「出賽次數」，讓誰是體力怪獸一目了然。
*   **趣味星座大數據**：自帶趣味分析模組，點開「星座分析」還能看見精美的深色浮雕卡片，計算這場大亂鬥是由哪些星象的球員主宰！

## 🛠️ 技術細節 (Tech Stack)
*   **Frontend**: Native JavaScript (ES6+), jQuery
*   **Styling**: Pure CSS3 with Glassmorphism (磨砂玻璃) design system
*   **Backend**: Google Firebase Realtime Database
*   **Assets**: FontAwesome Icons, Google Fonts (Outfit)

## 🌐 部署教學 (Deployment) — GitHub Pages
您可以在現有的 GitHub 帳號下，建立無限多個「專案網頁」：

1.  **建立新倉庫 (Repository)**：在 GitHub 建立一個新專案，例如 `badminton-lineup`。
2.  **上傳程式碼**：將本資料夾內所有檔案推送到該倉庫。
3.  **開啟 Pages**：
    *   進入倉庫的 **Settings** > **Pages**。
    *   在 **Source** 選擇 `main` branch (或 `master`)。
    *   儲存後，您的網站就會在 `https://您的帳號.github.io/badminton-lineup/` 上線！
4.  **注意**：這不會影響您原本的 `您的帳號.github.io` 主網站，兩者是可以並存的。

## 🚀 如何使用 (Usage)
1.  **新增球員**：點擊右上角 "+" 按鈕，或用手機右下角 FAB 按鈕。
2.  **排隊**：框選球員後，拖曳至左側 "Queue" 區塊，或點擊「加入列隊」。
3.  **上場**：將等待列的隊伍拖曳至空閒場地。
4.  **結束**：點擊場地右下角「結束」按鈕，球員會自動回到閒置名單，若開啟自動輪轉，下一組會自動補上。

## ⚠️ 注意事項
*   **多人操作衝突**：由於系統會即時監聽資料庫變動並重繪畫面，若 A 使用者正在拖曳時，B 使用者更新了資料 (如新增球員)，A 的畫面會刷新，導致拖曳中斷。這是為了確保資料一致性的設計。

---
*Created by Antigravity*