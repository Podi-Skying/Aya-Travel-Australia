# 設計討論紀錄：DESIGN v2（Claude × Codex）

日期：2026-10-23（Australia/Hobart）。擁有者要求：「請跟 codex（ChatGPT）討論 weya.com.tw/esg 的設計理念，並且要兼顧 Apple design，優化設計規範。」
參與：Claude（主持、實作）、Codex CLI（codex-cli 0.163.0，模型 gpt-6-luna，唯讀沙盒，session 01a164a8-0116-7a13-99c7-722eedb032c2）。另一位 Claude（設計討論串）提供 Apple 流暢度實測（APPLE-REVIEW）與 fluid-walk patch。
結果：2 輪收斂，Codex 對第 2 輪的 9 點全部同意並輸出 v2 全文，存為 docs/DESIGN.md。

## weya 實地觀察（Claude，桌機與 375px，以瀏覽器實際開啟）
- 主角（騎腳踏車的人）固定在畫面下方，捲動時場景從旁經過；每章換一種背景色。
- 每屏一句置中短標題、大量留白；故事線：問題 → 為何重要 → 對象 → 做法 → 成果 → 行動。
- 扁平向量插畫（細線＋平塗），單一品牌薄荷綠 #46efa3；底部固定導覽列；右上 SDG 徽章當章節標記。
- 手機 375px 有橫向溢出與固定元素遮擋——不照抄。

---
## 第 1 輪：Claude 提問
你是資深產品設計師。請和我（Claude）一起討論，為「南方散步」旅遊網站（Aya 的雪梨＋塔斯馬尼亞 25 天行程，私人使用，手機為主）制定 DESIGN v2 規格。用繁體中文回答。

## 擁有者 Kai 的要求
「參考 weya.com.tw/esg 的設計理念，並且兼顧 Apple design，優化設計規範。」風格目前是「手繪精緻簡約」，首頁第一屏＝每日路線散步（往下捲動，小人沿路線走過每天景點）。

## 現況（請閱讀這些檔案）
- 目前規格：附在下方（DESIGN v1）。
- 實作：web/src/components/walk/walk.ts（散步引擎）、web/src/components/walk/WalkView.tsx、web/src/app/walk.css（首頁樣式）、web/src/app/globals.css 結尾的「hand-drawn restyle」段（/plan 行程管理頁）、web/src/components/TripApp.tsx（/plan 結構：大標、分頁、每日行程、預算、待安排景點、資訊、版本與分享）。
- 線上：https://aya-travel-australia.vercel.app （/ 散步首頁、/plan 行程、/journey 3D 頁）。

## 我實際觀察 weya.com.tw/esg（桌機＋375px）
1. 主角（騎腳踏車的人）固定在畫面下方中央，往下捲動時場景（城市、工廠、風機、飛機、地球）從旁邊經過；捲動＝前進，人物是「錨點」。
2. 每一屏只有一句置中的短標題（16–24px，無襯線 PingFang，字重 400），大量留白；一屏一個訊息，故事線：問題 → 為何重要 → 對象 → 做法 → 成果 → 行動。
3. 插畫：扁平向量（細黑線＋平塗色塊），灰階遠景＋單一品牌色（薄荷綠 #46efa3）；每章整個背景換成一種飽和底色（白→綠→紫）作為章節轉場。
4. 右上角用 SDG 徽章當「目前章節」標記；底部固定一條薄荷綠導覽列（3 個連結）；開頭有膠囊形的捲動提示。
5. 下半部是正常的內容頁（說明、服務、客戶獎項列表、聯絡表單）。
6. 缺點：手機 375px 有橫向溢出、裁切，固定元素蓋住內容；字很小、對比低；文字密集段落沒有層級。

## Apple 設計原則（WWDC，翻成 web）
- Response：按下就回饋，不要人為延遲；捲動/拖曳時持續 1:1 回饋（小人必須 1:1 跟著捲動，不要 easing 延遲）。
- Interruptibility：任何動畫（換日、線稿畫出、面板）都能從目前畫面上的值被中斷、反轉；UI 用臨界阻尼彈簧（不回彈），只有甩動後才允許回彈；手勢相關不要用固定時長的 CSS transition。
- Momentum：換日的滑動要依放手速度投影決定目標；第一天/最後一天要 rubber-band，不要硬停。
- Spatial consistency：元素從哪裡進就從哪裡出；彈出面板從觸發點長出來。
- Materials：頂部導覽/日期條用半透明層（backdrop-filter），內容從下面滑過；用捲動邊緣漸隱取代硬分隔線；不要半透明疊半透明。
- Typography：字距依字級變化（大標約 -0.02em，內文約 0）；大字行高緊、內文鬆；層級用字重＋字級＋行高；用 rem 讓使用者字級能放大版面；在紙紋上要清楚。
- Accessibility：prefers-reduced-motion → 交叉淡化，不要視差與畫線動態；prefers-reduced-transparency → 實色條；prefers-contrast: more → 更深墨色。
- Foundations：簡單不等於極簡（最重要的最明顯）；導航定位（每頁都回答：我在哪、能去哪、怎麼離開，尤其散步 ↔ 行程 ↔ 某一天）；具體標籤；工藝（每個間距/時間都有理由）；觸控目標 ≥44px。

## 請你做
1. 批評目前 v1 規格與實作（具體到檔案/行為），指出和 weya 理念、Apple 原則不一致或有風險之處（含無障礙、手機、效能）。
2. 說明 weya 的哪些理念值得採用、哪些不該照抄（例如飽和色塊章節、扁平向量 vs 手繪），以及和「手繪精緻簡約」如何調和。
3. 提出 DESIGN v2 草案：設計代號（顏色、字級表含字距/行高、間距尺度、圓角、線條）、首頁散步的互動規則（含換日、到站、速度、可中斷）、導航與定位（walk ↔ plan ↔ day）、/plan 頁版面原則、材質、動態數值（彈簧參數）、無障礙、驗收清單。要具體可實作，數值都要寫出來。
4. 列出你不確定、需要我回應的 3–5 個問題。


（附 DESIGN v1 全文，略）

## 第 1 輪：Codex 回覆
# DESIGN v2 草案｜南境手札

以下以你貼的 v1 與專案原始碼為依據。線上頁面在目前環境無法開啟，所以我沒有把以下內容說成實際截圖檢查；we ya 的部分沿用你提供的桌機與 375px 觀察。

## 1. v1 規格與目前實作的落差

### 散步首頁

- **小人還不是固定錨點。** 引擎把小人放在世界座標，再平移路線讓小人約在畫面 42% 處；相機受邊界限制，所以起點約在 22%，行程尾端也會偏移。這與 weya「人物固定在下方中央、場景從旁邊經過」的感受不同。[walk.ts](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/walk/walk.ts:276>) [walk.ts](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/walk/walk.ts:367>)

- **捲動路線是直接回饋，周邊動畫則有固定時長。** `requestAnimationFrame` 將捲動映射到路線與小人位置，這點符合 1:1；但暈染用 1.2–1.4 秒 transition、站點文字用 0.6 秒、小人對話用 0.4 秒。反向捲動時，這些效果可能繼續補完一段時間，和「捲動停，畫面效果也停」不一致。[walk.ts](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/walk/walk.ts:441>) [walk.css](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/app/walk.css:39>)

- **減少動態偏好只處理一部分。** 目前會停掉線稿繪製與腿部擺動，但飛機升降、背景視差、標題位移仍保留；也沒有在使用者切換系統偏好時重新讀取設定。[walk.ts](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/walk/walk.ts:177>)

- **375px 上有裁切與遮擋風險。** 舞台固定 `100svh`，但路線高度與座標用 `innerHeight` 計算；手機瀏覽器工具列變化時，兩者可能不同步。上下交錯的站點插畫可能延伸到舞台底部，而舞台本身 `overflow:hidden`，底部日期列又固定蓋在畫面上。標題也有 `white-space:nowrap`，大字放大時較容易超出寬度。[walk.css](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/app/walk.css:33>) [walk.css](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/app/walk.css:62>)

- **手機上導覽不完整，觸控區也偏小。** 680px 以下只保留「行程」連結，預算與 3D 旅程會消失。底部前後日按鈕只有約 30px 高，未達 44px 觸控目標。`WalkView` 的底列還把整個日期狀態區設為 `aria-live="polite"`，引擎每次捲動都更新內容，螢幕閱讀器可能反覆播報。[walk.css](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/app/walk.css:91>) [WalkView.tsx](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/walk/WalkView.tsx:125>)

- **插畫與交通圖示有錯配風險。** `train` 目前會套用公車圖示；`waterfall` 的關鍵字規則只比對 `falls` 或「瀑布」，英文單數可能落到預設 town 插畫。[walk.ts](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/walk/walk.ts:78>)

- **質感效果可能壓低可讀性與效能。** 全站與散步頁各自疊一層紙紋；散步頁紙紋的 `z-index` 高於頂部及底部導覽。線稿濾鏡使用 `feTurbulence`，每次字體載入完成又會重跑 `layout()`，重建所有路線與站點 SVG。這不代表一定掉幀，但 25 天、手機瀏覽器下需要特別量測。[globals.css](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/app/globals.css:282>) [WalkView.tsx](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/walk/WalkView.tsx:65>) [walk.ts](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/walk/walk.ts:462>)

### `/plan` 行程頁

- **手機日選列藏掉了重要資訊。** 680px 以下日期列把日標題 `.t` 隱藏；提醒圓點也在 `.t` 裡，於是手機上看不到日名與提醒，只剩日期。[globals.css](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/app/globals.css:235>)

- **頁面之間的定位不連續。** 散步頁有「預算」連結指向 `#budget`，但 `/plan` 是分頁按鈕控制，沒有用該 fragment 切換分頁。`/plan` 的分頁也沒有 `aria-controls` 與面板 ID 關聯，鍵盤操作規則不完整。[WalkView.tsx](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/walk/WalkView.tsx:88>) [TripApp.tsx](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/components/TripApp.tsx:327>)

- **無障礙對比需要調整。** 以目前紙色 `#FAF7F0` 計算，`#7A756B` 約 4.28:1、朱紅 `#D2483A` 約 4.15:1，低於一般文字 4.5:1 的目標；`#B9B2A4` 約 1.97:1，適合遠景裝飾，不適合必要資訊。CSS 也把全站 focus ring 改成 1.5px 虛線。[globals.css](</Users/tanghuakui/Downloads/claude/Aya澳洲旅遊規劃/Aya Australia Travel/web/src/app/globals.css:283>)

## 2. weya 值得採用的做法

| weya 做法 | 南方散步的採用方式 |
|---|---|
| 捲動代表向前走 | 保留垂直捲動控制路線，讓進度與手指保持同步 |
| 主角是視覺錨點 | 小人固定在畫面下方中央，路線與風景從身旁移過 |
| 每屏一個焦點 | 每天先給一句日題與當日進度；時間、交通與站點做次級資訊 |
| 章節能被辨認 | 用「第 03 / 25 天」與雪梨／塔州地名作章節標記 |
| 遠景簡化 | 遠景可用少量平面色塊，近處保留手繪線稿與紙本暈色 |

不建議直接套用薄荷綠飽和大底或整套扁平向量。它們會蓋過目前的紙色與朱紅識別，也容易讓旅程看起來像企業 ESG 敘事。視覺上可以讓**近景有手繪筆觸，遠景更簡潔；介面文字與控制則保持清晰、穩定**。章節換色以低彩度暖色和山海綠為限，不整屏改成強烈色塊。

## 3. DESIGN v2 草案

### 設計代號與基礎代碼

**設計代號：南境手札**。保留紙色、手繪路線與朱紅圍巾；以穩定的排版、可預期的動態和手機觸控規格承載旅程。

#### 色彩

| Token | 值 | 用途 |
|---|---|---|
| paper | `#FAF7F0` | 主背景 |
| paper-raised | `#F3EEE3` | 提示、分組底色 |
| ink | `#292823` | 標題、正文，對紙色約 13.8:1 |
| ink-secondary | `#625E55` | 次要文字，約 6.0:1 |
| ink-muted | `#68645B` | 日期、輔助說明，約 5.5:1 |
| rule | `#918978` | 控制邊界與焦點周邊，約 3.2:1 |
| vermilion | `#B83A2E` | 路線進度、目前站點、重要行動，約 5.3:1 |
| syd | `#81563D` | 雪梨地區標記，約 5.9:1 |
| tas | `#35675D` | 塔州地區標記，約 6.0:1 |
| scene-syd / scene-tas | `#FBF5EE` / `#F3F6F1` | 章節背景淡色轉換 |
| wash | `#F2E4D6`、`#E1EBE9`、`#E6ECDD`、`#F3E9C9` | 景點插畫底下的低彩度暈色 |

朱紅作為唯一主要動作色；雪梨、塔州色只表示地區，不單靠顏色傳達提醒或狀態。

#### 字級、字距與行高

使用 `rem`，根字級 16px；繁中字體優先系統字型，避免依賴遠端字型才能完成版面。

| 層級 | 字級 | 行高 | 字距 |
|---|---:|---:|---:|
| 首屏主標 | `clamp(2rem, 7vw, 3.5rem)` | 1.12 | `-0.02em` |
| 每日標題 | `1.75rem` / 28px | 1.2 | `-0.02em` |
| 區段標題 | `1.375rem` / 22px | 1.25 | `-0.01em` |
| 景點名稱 | `1.125rem` / 18px | 1.4 | `0` |
| 內文 | `1rem` / 16px | 1.65 | `0` |
| 次要資訊 | `0.875rem` / 14px | 1.5 | `0.01em` |
| 純裝飾小標 | `0.75rem` / 12px | 1.4 | `0.08em` |

大標題可用 Noto Serif TC 或系統襯線字；內文用 PingFang TC、Noto Sans TC、系統無襯線字。內文不使用 300 字重；表單輸入字級至少 16px。

#### 版面與線條

- 間距尺度：`4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96px`。
- 手機左右留白：`20px`；桌面內容最大寬度 `1152px`。
- 圓角：互動控制 `12px`、內容面板 `16px`、膠囊 `999px`。
- 景點線稿 `1.5px`，主路線 `2px`，目前走過的線 `3px`；點位直徑 `8px`。
- 手繪變形只套在插畫，不套在文字、控制或焦點外框。紙紋只保留一層，透明度不超過 `0.05`。

### 首頁散步與換日

- 每日舞台使用 `100svh`。小人腳底固定在 `x = 50vw`、`y = min(72svh, 舞台底部 − 日期列高度 − 安全區 − 24px)`。
- 頁面捲動直接決定路線進度：`p = clamp((scrollY − dayStart) / scrollSpan, 0, 1)`。不對 `p` 加 easing；景物和路線在下一個畫面更新內跟手移動。
- 每日捲動距離：`scrollSpan = svh × max(0.6, 0.36 × 景點數 + 0.45)`；舞台總高度為 `100svh + scrollSpan`。每個景點約占 `0.36svh`，並保留起步與收尾空間。
- 遠景以 `0.25×` 進度移動，前景路線以 `1×` 移動。平面色塊只用在遠景；景點仍採手繪線稿與淡彩。
- 線稿顯示比例直接跟站點距離綁定，倒著捲就倒著收回；已走過的景點保留完整插畫。角色步伐以路線移動距離計算，每約 `48px` 路徑完成一個步伐循環；捲動停下時角色也停下。
- 站點進入相鄰路段的 `±3%` 範圍時顯示「到站・景點名」與時間資訊，離開 `±5%` 範圍後關閉。標籤從站點位置出現；畫面呈現由捲動位置決定，不另外等待固定時長。
- 交通方式取自站點之間的行程資料。步行、開車、火車、渡輪與飛機使用不同圖示，避免把火車畫成公車。
- 每日自然相接，不強制吸附日界線。日期列提供前後日按鈕、日期選單與 25 日滑動列；日期列使用原生水平捲動與 `scroll-snap-type: x mandatory`，依瀏覽器放手慣性選擇目標日。自訂拖曳時採 10px 手勢門檻、1:1 跟手、`decelerationRate = 0.998` 投影，再吸附到最近日期；邊界 rubber-band 常數 `0.55`、視覺行程 `56px`。
- 點選日期或前後日按鈕後，以目前畫面位置與放手速度為起點移到目標日；可中途反向或取消。離散面板／日期跳轉彈簧採 `mass=1`、`stiffness=225`、`damping=30`，阻尼比 `1.0`、回應約 `0.42s`，不回彈。

### 導覽與位置感

所有頁面固定呈現同一組主要入口：**散步、行程、3D 旅程**，目前頁以文字與 `aria-current="page"` 標明。手機頂部導覽保留可讀文字，不只留圖示；按鈕觸控範圍至少 `44×44px`。

- 散步的日期列顯示「第幾天／日期／每日標題」，另提供「查看當日完整行程」。
- 每日行程用 `?day=YYYY-MM-DD#days` 定位；分享頁保留 token，例如 `/s/{token}/plan?day=YYYY-MM-DD#days`。
- 預算等分頁用 `?tab=budget` 這類可直接定位的網址狀態，不用無效的 fragment。
- `/journey` 與分享版 3D 頁沿用相同主導覽；回到行程或散步時保留日期。

### `/plan` 行程管理頁

- 保留總覽、每日行程、地圖、預算、待安排景點、資訊與警示、版本與分享等內容。
- 手機日期列仍顯示日期、日名與提醒標記；標題在目前日的主區塊清楚呈現。觸控目標至少 `44×44px`。
- 每日頁先顯示日期、地區、當日標題和主要提醒，再顯示活動時間線；手機地圖排在活動清單後方或可收合。
- 重要提醒與操作保留明確的底色／邊界分組，不把所有內容改成卡片，也不把所有分隔都移除。
- 分頁提供完整的 `tablist` 鍵盤操作與 `aria-controls` 關聯。切到某一天後，畫面標題、日期列選中狀態和 URL 同步更新。

### 材質、動態與無障礙

- 頂部導覽與底部日期列各自使用單層半透明暖紙材質：背景 `rgba(250,247,240,.88)`、模糊 `14px`。用 `::before` 邊緣淡化內容，不用硬線分隔；頁面內容底部留出日期列高度與安全區。
- `prefers-reduced-transparency: reduce` 改用實色 `#FAF7F0`；`prefers-contrast: more` 使用更深墨色和至少 3px 焦點框。
- `prefers-reduced-motion: reduce` 停止視差、腿部循環與線稿繪製；改成靜態路線與完整插畫。明確換日只用最多 `120ms` 交叉淡化。
- 視覺日期列不設為 live region。另設一個螢幕閱讀器專用狀態區，只在「換日」或「到站」時播報一次。
- 保留縮放，不設 `maximum-scale=1`；支援安全區，文字放大到 200% 仍可用；焦點框使用 `3px solid`；重要文字對比至少 `4.5:1`。
- 避免每次捲動重建所有 SVG；只更新目前日與相鄰日的動畫。路線幾何預先計算，靜態紙紋使用小型圖樣，不在捲動期間重繪整屏濾鏡。

## 4. 驗收清單

- 375px 與 320px 寬度、iPhone Safari 安全區下沒有水平溢出，站點插畫不被舞台或固定列裁切。
- 捲動時小人位置固定在錨點 ±2px；路線進度與捲動方向一致，反向捲動立即反向。
- 日期列快速滑動會依放手速度投影到目標日；首末日能感受到阻力，仍可立即反向。
- 所有按鈕至少 `44×44px`；200% 文字放大及鍵盤操作仍可讀、可達。
- 螢幕閱讀器不會在連續捲動時逐幀播報，只在換日或到站時播報。
- 減少動態、增加對比、減少透明度設定各自符合上述替代狀態。
- 以 60Hz 手機作參考，捲動時目標為 P95 畫面更新不超過 `16.7ms`，且無超過 `50ms` 的捲動主執行緒長工作；最後需用真機確認。

## 需要你回應的問題

1. 你希望小人全程固定在下方中央、由路線從腳下經過嗎？我建議採這種方式；目前實作是透過平移鏡頭讓人物大致維持在 42%。
2. 主要識別色要保留朱紅圍巾與路線嗎？雪梨暖色、塔州山海綠只做淡背景與地區標籤；你希望章節色再明顯一些嗎？
3. `/plan` 打開時，你比較常先看總覽，還是直接看每日行程？這會決定手機上的預設分頁。
4. 你接受「近景手繪、遠景簡化平面色塊」的混合插畫嗎？還是希望所有景物都維持手繪線稿？

---
## 第 2 輪：Claude 回應
# 第 2 輪：Claude 的回應

謝謝，大部分同意。補充兩個新輸入，再請你產出可直接放進 repo 的 docs/DESIGN.md v2 全文。

## 新輸入 A：另一位設計者的 Apple 流暢度實測（APPLE-REVIEW，摘要）
- 實測：捲動 p50 33ms → 套 patch 後 16.7ms。原因：會動的朱紅路線在 feTurbulence 濾鏡群組內每格重算；每格讀 offsetTop 造成 layout thrashing；每格重寫 DOM。
- 已套用的 patch（現在工作目錄就是套用後的版本，請讀 web/src/components/walk/walk.ts、WalkView.tsx、app/walk.css）：路線移出濾鏡；幾何快取；差異寫入；進度條改 scaleX；滑鼠滾輪才用臨界阻尼彈簧（response 0.2s、從畫面值追目標、可中斷），觸控維持 1:1；跨超過一天的跳轉改 140ms 淡出→瞬移→淡入；←/→ 走到上/下一個景點、[ ] 換天；點景點直接走過去；觸控用 scroll-snap proximity 錨點停在景點附近；底部按鈕 44px＋按下縮放；獨立 #rw-live 只在換天時播報；header 下方紙色漸層。
- /plan 發現：和首頁像兩個網站（沒有共用 header）；時間軸綠/赭兩套色違反單一朱紅；emoji 圖示和手繪不搭；日期/地點/倒數有底線像連結；地區卡文字貼色條；手機分頁列溢出無提示；8 個目標 <32px；/journey 深色亮度突變。

## 我（Claude）對你草案的意見
1. 小人錨點：同意固定錨點，但建議 x = 40vw（不是 50vw）——行進方向前方留 60% 空間，符合 Apple「往動作方向提示」；手機 x = 34vw。y 依你的公式。請採用並說明。
2. 字體：同意內文用系統無襯線（PingFang TC 優先）、字重 400、字距 0；但「手繪精緻」的識別靠標題，所以大標、每日標題保留 Noto Serif TC（有系統襯線後備），其他一律系統字。中文小字不要 0.2–0.3em 的大字距（目前首頁大量使用），只有 ≤12px 的英文裝飾小標可用 0.08em。
3. 顏色：同意你的對比修正。朱紅分兩個：文字/控制用 #B83A2E（5.3:1），路線/插畫筆畫可保留 #D2483A（非文字，3:1 足夠）。地區色只用於小標籤，不用在大面積時間軸；時間軸改墨色深淺＋線型（雪梨實線、塔州點線）區分。
4. weya 章節轉場：採用「低彩度底色漸變」：雪梨日 #FBF5EE、塔州日 #F3F6F1，換日時 300ms 交叉淡化（減少動態時直接切換）。不用飽和色塊。遠景維持線稿，但允許一層極淡平塗（opacity ≤ .35）讓層次更清楚——等於你說的「近景手繪、遠景簡化」。
5. 日期列：不要再加 25 日橫向滑動條（會和頁面垂直捲動手勢衝突、增加複雜度）。保留 ‹ › ＋日期選單＋進度線＋「查看當日行程」；手勢動量交給原生捲動與 proximity snap。
6. 共用導覽：所有頁（/、/plan、/journey、分享頁）同一個 header：logo「南方散步」(→ 散步首頁)、散步、行程、3D、登入/登出；目前頁 aria-current。預算是行程頁的分頁，不放主導覽（用 /plan?tab=budget 進入）。
7. /plan：手機預設分頁——旅行期間（11/3–11/27）預設「每日行程」並選到今天，其他時間預設「總覽」。emoji 換成同筆觸線條 icon；卡片恢復輕量分組（paper-raised 底、16px 圓角、無陰影）——純線分隔讓資訊密集頁難掃讀，這點我和原 v1「不用卡片框」的規則調整。
8. 紙紋：只留一層、opacity .05、放在背景（不要 fixed 覆蓋＋multiply 疊在內容上，會影響對比與合成效能）。
9. /journey：v2 不改 3D 場景本身，只加共用 header 與進場淡入，記錄為已知差異。

## 請你做
- 對 1–9 逐點回覆同意或反對（反對要給理由與替代方案）。
- 然後輸出 docs/DESIGN.md v2 **全文**（繁體中文，Markdown），包含：設計理念（weya＋Apple 取捨）、設計代號表（色、字級表、間距、圓角、線條、材質）、首頁散步互動規則（含 patch 已實作的行為與數值）、導航與定位（含 URL 規則）、/plan 版面規則、/journey 差異、動態數值表（彈簧、淡化時間）、無障礙（三種偏好）、效能規則、驗收清單。數值要具體。不要寫「待定」。


## 第 2 輪：Codex 回覆（逐點）
## 1–9 點回覆

1. **同意。** 桌面固定在 `x = 40vw`，前方保留 60% 畫面；手機固定在 `x = 34vw`，前方保留 66%。這讓角色視線與路線前進方向都有空間。腳底的 y 座標沿用上一輪公式，並為底部日期列與安全區留空。
2. **同意。** Noto Serif TC 只用於首屏大標與每日標題；內文、站點名、介面控制用系統無襯線、字重 400、字距 0。中文小字不加寬字距；`0.08em` 只給 12px 以下的英文裝飾小標。
3. **同意。** `#B83A2E` 用於文字與控制；`#D2483A` 保留給路線與插畫等非文字筆畫。雪梨／塔州用小標籤及實線／點線辨識，不用兩套地區色鋪滿時間軸。
4. **同意。** 雪梨日 `#FBF5EE`、塔州日 `#F3F6F1`，換日背景 300ms 交叉淡化；減少動態偏好下直接切換。遠景仍以線稿為主，平塗不超過 `opacity: .35`。
5. **同意。** 日期列維持 ‹ ›、日期選單、進度線和「查看當日行程」；不加 25 日橫滑列。手機手勢交給原生垂直捲動與站點 proximity snap。另有兩個實作差異需列入規格：目前彈簧由 `(pointer:fine)` 判斷，無法只限滑鼠滾輪；目前 scroll-snap 設在全站 `html`，應限縮到散步頁。
6. **同意。** 所有頁共用「南方散步」標誌、散步、行程、3D、登入／登出；預算是行程內分頁，使用 `/plan?tab=budget`。
7. **同意。** `11/3–11/27` 期間依 `Australia/Hobart` 當地日期預設每日行程並選中今天；其餘日期預設總覽。換成同筆觸線條 icon，並在密集資訊頁恢復 `paper-raised`、16px 圓角、無陰影的輕量分組。
8. **同意。** 紙紋只留一層，透明度 `0.05`，置於背景後方，不固定覆蓋內容，也不使用 multiply 疊色。
9. **同意。** `/journey` 保留深色 3D 場景，只加入共用導覽與 180ms 進場淡入；頁面明暗轉換記錄為已知差異，不在本版改 3D 場景。

目前工作區唯讀，以下是可直接存成 `docs/DESIGN.md` 的全文，沒有寫入檔案。



## 結論
docs/DESIGN.md v2 為唯一規格；prototypes/route-walk/DESIGN.md（v1）與 APPLE-REVIEW.md 已併入，不再另立規格。
