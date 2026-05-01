# Hunch It — Full-Functional Test Plan

按「真實風險 × 影響面」排優先序。每項標 capability（誰做）+ 預估時間 + 驗收標準。

---

## 🔴 Tier 0：上線前必做（demo 前一天前完成）

### 0.1 Jupiter Trigger v2 API Paper Review

- **誰**：我（Claude）
- **時間**：30 min
- **做啥**：對 [Jupiter docs](https://dev.jup.ag/docs/trigger-api) 比對 `apps/web/lib/jupiter/trigger.ts` 跟 `apps/ws-server/src/orders/tracker/auto-exits.ts`，確認 endpoint URL、body shape、`triggerCondition` 字串值、response 欄位
- **驗收**：寫一份 diff report，列出對得上 / 對不上 / 文件沒寫（猜的）
- **產出**：`docs/jupiter-api-audit.md`

### 0.2 Jupiter Trigger 真實 mainnet 微額 round-trip

- **誰**：你 + 我陪
- **時間**：1 hr
- **做啥**：
  1. 你開 Privy 登入，我看 walletAddress
  2. 你充 $5 USDC + 0.01 SOL gas
  3. 我給你一個 mock proposal（trigger 設當前價 +50%，保證不 fill）
  4. 點 Approve，整路看 console + Jupiter response
  5. 點 Cancel 收回
- **驗收**：
  - DB Order row 寫入成功，jupiterOrderId 拿到
  - `/api/cron/track-orders`（→ tracker）能在 history 看到該 order
  - cancel 後 status 變 CANCELLED
- **產出**：`docs/manual-smoke.md` 跑過的證據（截圖 + tx signature）

### 0.3 Privy 登入 → Mandate → Desk happy path

- **誰**：你
- **時間**：15 min
- **做啥**：在 docker compose 跑著的 web 瀏覽器走完整流程
- **驗收**：每一步成功，沒 console error，DB 寫入符合預期
- **產出**：bug list（如有）

---

## 🟡 Tier 1：核心功能單元測（demo 後一週內）

### 1.1 ws-server 單元測試 infrastructure

- **誰**：我
- **時間**：1 hr
- **做啥**：
  - 加 `vitest` 到 ws-server devDeps
  - `apps/ws-server/vitest.config.ts`
  - 一個示例 test 確保 setup 跑得起來
- **驗收**：`pnpm --filter @hunch-it/ws-server test` 跑得過

### 1.2 Signal Engine 單元測

- **誰**：我
- **時間**：2 hr
- **檔**：`apps/ws-server/src/signals/__tests__/`
- **覆蓋**：
  - `evaluateFreshness`：marketOpen / marketClosed / bypass 三種狀態
  - `isUsMarketOpen`：weekday 邊界、weekend、跨日
  - `computeIndicators`：RSI / MACD / MA 對 fixture bars 的數值正確
  - `proposal-generator`：低信心 → SKIP，過 mandate → 寫 Proposal row（用 prisma mock）
- **驗收**：8+ test，全綠

### 1.3 Order Tracker 單元測

- **誰**：我
- **時間**：2 hr
- **檔**：`apps/ws-server/src/orders/tracker/__tests__/`
- **覆蓋**：
  - `applyFill` BUY filled → Position state ENTERING + Trade row 創
  - `applyFill` TP filled → Position CLOSED, realizedPnl 算對, sibling cancel emit 對
  - `tryDelegatedCancel` Privy 沒設 → false fast-path
  - `tryDelegatedCancel` Jupiter initiate 失敗 → false
  - `tryAutoPlaceExits` 沒 currentTpPrice/Sl → 0
  - `tryAutoPlaceExits` 已有 OPEN order → idempotent skip
  - `tryAutoPlaceExits` 兩腿成功 → Position state ACTIVE + 2 Order rows
- **驗收**：10+ test，prisma + fetch 都 mock，全綠

### 1.4 Web API route 整合測

- **誰**：我
- **時間**：2 hr
- **檔**：`apps/web/__tests__/api/`
- **覆蓋**：
  - `POST /api/orders` BUY trigger 成功 → 創 Order + Position(BUY_PENDING)
  - `POST /api/orders` 沒 auth → 401
  - `GET /api/portfolio` 回真實 cashUsd（mock readUsdcBalance）
  - `PATCH /api/users/delegation` 寫 active=true + walletId
  - `GET /api/users/me` demo / live 兩條路徑
  - `POST /api/positions/[id]/close` 路徑
- **驗收**：12+ test，db 用 prisma mock，全綠

---

## 🟢 Tier 2：UI 元件 + e2e（hackathon 後再做）

### 2.1 React 元件 test

- **誰**：我
- **時間**：3 hr
- **工具**：vitest + @testing-library/react
- **覆蓋**：
  - `MarketHoursBanner`：盤內隱藏 / 盤外顯示 / 倒數正確
  - `ProposalModal`：餘額不足 disabled、size 改變 R/R 算對、Skip 切換
  - `DelegationCard`：active+!walletId → warning banner 出
  - `HoldingsList`：empty / loading / 多筆 sort
  - `OpenOrders`：BUY pending 顯示 Cancel、TP/SL 顯示 Edit
- **驗收**：15+ test，snapshot + behavior，全綠

### 2.2 Playwright e2e

- **誰**：我
- **時間**：4 hr
- **工具**：`@playwright/test`
- **覆蓋**：
  - 未登入訪客：landing → login redirect
  - Privy mock 登入 → onboarding → mandate save → /desk
  - Mandate edit → 重新 redirect
  - Settings panic close（demo mode 就好）
  - Off-hours banner 顯示
- **驗收**：5+ scenario，全綠
- **依賴**：需要 Privy mock provider 或測試帳號

### 2.3 Lighthouse + 可訪問性

- **誰**：我
- **時間**：1 hr
- **覆蓋**：a11y、performance、PWA score
- **驗收**：a11y >90，performance >70

---

## 🔵 Tier 3：穩定性 / 效能 / 安全（pre-prod）

### 3.1 Load test

- **誰**：我
- **時間**：2 hr
- **工具**：k6 或 autocannon
- **覆蓋**：
  - `/api/portfolio` 100 RPS、每秒固定 500 個 user
  - WebSocket 100 並發 connection 持續推送
  - `/cron/generate` 每分鐘觸發下能不能消化
- **驗收**：p99 < 1s、無 error spike、DB connection 不爆

### 3.2 安全掃描

- **誰**：我 + 你（npm audit 跑）
- **時間**：2 hr
- **做啥**：
  - `pnpm audit` 跑過、嚴重的修
  - `gitleaks` 掃 commit history（防 secret 洩漏）
  - SQL injection：所有 raw query 檢查（其實全用 prisma，should be safe）
  - XSS：有沒有 dangerouslySetInnerHTML（用 grep）
  - JWT：Privy token 驗證流程審查
  - CORS：ws-server cors 是否限制 NEXT_PUBLIC_APP_URL（檢查程式碼）
- **驗收**：所有 high/critical 修掉

### 3.3 RPC failover 測試

- **誰**：我
- **時間**：1 hr
- **做啥**：cherry-pick `omnis/fix/solana-rpc-failover` 進來，驗證 round-robin / circuit breaker 邏輯
- **驗收**：故意把第一個 RPC 設成 invalid，確認自動切到下一個

### 3.4 容錯：Anthropic / Pyth / Jupiter 任一掛掉

- **誰**：我
- **時間**：1.5 hr
- **做啥**：寫 chaos test：
  - Anthropic 503 → signal generator 該 SKIP 不 crash
  - Pyth Hermes 503 → 整體 graceful
  - Jupiter 502 → tracker 不死，下次 retry
  - DB connection drop → reconnect 機制
- **驗收**：每個 fault 都驗證 graceful 不 crash

### 3.5 Prisma migration 不破壞性測試

- **誰**：我
- **時間**：1 hr
- **做啥**：
  - 開 fresh DB → migrate → seed 一些 fixture
  - 模擬下個 schema change → migrate → 看舊 row 還能 read
- **驗收**：migrate up/down 都過

---

## 🟣 Tier 4：Privy Pro 啟用後再做

### 4.1 Privy server signer 真實測

- **誰**：你升 Privy Pro，我寫 test
- **時間**：2 hr
- **做啥**：
  - delegate 一個 testnet wallet
  - server 簽一筆假交易
  - revoke 後再簽應失敗
- **驗收**：3 個 case 都對

### 4.2 Auto TP/SL 真實 round-trip

- **誰**：你 + 我
- **時間**：1 hr
- **做啥**：
  1. delegation 開
  2. 真下一個 BUY trigger，立刻 fill（trigger 設當前價）
  3. 觀察 ws-server log：tracker 偵測到 BUY filled → tryAutoPlaceExits 被呼叫 → Privy server signs → Jupiter 收 TP + SL → DB 寫 2 個 OPEN Order
  4. desk widget 看到 ACTIVE state
- **驗收**：完整鏈路 < 30 秒、Position 進 ACTIVE、用戶端不需簽任何東西

### 4.3 OCO sibling cancel

- **誰**：我（mock）+ 你（真實）
- **時間**：30 min
- **做啥**：
  - mock：`tryDelegatedCancel` unit test 已蓋
  - 真實：把 #4.2 那單的 TP 設離當前價很近，等他 fill → 觀察 SL 自動 cancel
- **驗收**：SL Order status 自動變 CANCELLED < 10 秒

---

## ⚫ Tier 5：可觀測性 / 維運

### 5.1 結構化 logging

- **誰**：我
- **時間**：2 hr
- **做啥**：
  - ws-server 改用 pino（JSON log）
  - 每個 cron run / signal generation / order place / fill 都有 traceId
  - level 分明（info/warn/error）
- **驗收**：log 格式 JSON、可 grep traceId 串起一個 user 的整條 journey

### 5.2 Sentry / error tracking

- **誰**：你開 Sentry account，我接
- **時間**：1 hr
- **覆蓋**：web + ws-server uncaught exceptions、Privy / Jupiter / Pyth 失敗
- **驗收**：故意 throw → Sentry 收到

### 5.3 健康檢查 + alert

- **誰**：我
- **時間**：1 hr
- **做啥**：
  - 加 `/api/healthz`(web)：DB ping + ws-server ping
  - ws-server 已有 `/healthz`，加 deps check（Pyth、DB）
  - GCP Cloud Monitoring uptime check
- **驗收**：故意停 ws-server → alert email 5 min 內到

### 5.4 Trade audit log

- **誰**：我
- **時間**：1.5 hr
- **做啥**：
  - 新表 `AuditLog`：userId / action / metadata / signedBy('user'|'server')
  - 每個 server-signed transaction 寫一筆
  - Settings 加 audit log 頁
- **驗收**：用戶看得到所有 server 簽過的東西

---

## 📊 總計

| Tier         | 項目  | 我做 | 你做     | 總時間       |
| ------------ | ----- | ---- | -------- | ------------ |
| 0 上線前     | 3     | 1    | 2        | ~2 hr        |
| 1 單元測核心 | 4     | 4    | 0        | ~7 hr        |
| 2 UI + e2e   | 3     | 3    | 0        | ~8 hr        |
| 3 穩定/安全  | 5     | 5    | 0        | ~7.5 hr      |
| 4 Privy Pro  | 3     | 2    | 2 (配合) | ~3.5 hr      |
| 5 維運       | 4     | 4    | 1 (setup) | ~5.5 hr      |
| **合計**     | **22** |      |          | **~33.5 hr** |

---

## 建議執行順序

- **Hackathon demo 前**：Tier 0 全做 + Tier 1.2/1.3（signal + tracker 單元測）— **5 hr**
- **Demo 後一週**：Tier 1 剩下 + Tier 2.1（元件 test）— **7 hr**
- **Pre-prod**：Tier 3 + Tier 5.1/5.2 — **9 hr**
- **Privy Pro 啟用當天**：Tier 4 — **3.5 hr**

---

## 風險紅旗（demo 第一個用戶就會踩到）

1. **Jupiter Trigger v2 endpoint 從沒驗證過**（trigger.ts comment 自己承認 best-effort）— Tier 0.1 + 0.2 必做
2. **Auto TP/SL 在 Privy Free silent 失敗** — Settings warning 已加（commit `d1a0920`），但實際 server signer fail 路徑沒測
3. **Pyth 過期 >15min signal SKIP，盤外 desk 0 提案** — Banner 已加，但用戶第一次看到還是會困惑
4. **OCO race**：TP/SL 同時 fill 沒處理
5. **partial fill** tracker 只更新 status，沒給用戶看到

---

_Last updated: 2026-05-01_
