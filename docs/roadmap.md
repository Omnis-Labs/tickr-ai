# Hunch It — Unified Roadmap (Test + Deploy)

整合 [`test-plan.md`](./test-plan.md) 的測試 tier 跟 local→docker→GCP 部署階段。

按「上一步未完成 → 下一步無法做 / 風險過高」排序。每步註明：
- **Owner**（誰做）— 我 (Claude) / 你 (人) / 雙方
- **時間估**
- **依賴**（前置完成才能開始）
- **產出**（為何要做、做完代表什麼）

---

## 🟢 Stage 1 — Local Happy Path（demo 前必通）

> 目的：先用真錢包證明 buy/sell 整鏈在 local Docker 跑得起來，再上雲。

### S1.1 Rebuild docker image，把最近 UI 改動 live

- **Owner**：我
- **時間**：5 min
- **依賴**：無
- **做啥**：`docker compose build web && docker compose up -d web`
- **產出**：market-hours banner / proposal modal 餘額檢查 / Settings delegation warning 在瀏覽器看得到

### S1.2 [Tier 0.1] Jupiter Trigger v2 API Paper Review ⚠️

- **Owner**：我
- **時間**：30 min
- **依賴**：S1.1
- **做啥**：對 Jupiter docs 比對 `apps/web/lib/jupiter/trigger.ts` + `apps/ws-server/src/orders/tracker/auto-exits.ts`
- **產出**：`docs/jupiter-api-audit.md`，列出哪些 endpoint shape 對 / 不對，**不對的 PR 修掉**
- **為何擋 S1.3**：trigger.ts 自己 comment 說「best-effort，未驗證」，沒 review 直接讓你充 $5 USDC 走 happy path 等於用真錢測沒測過的 endpoint

### S1.3 Privy console 設定

- **Owner**：你
- **時間**：10 min
- **依賴**：S1.1
- **做啥**：
  - Allowed origins 加 `http://localhost:3000`
  - Embedded Wallets / Solana 開
  - `NEXT_PUBLIC_PRIVY_APP_ID` + `PRIVY_APP_SECRET` 灌到 `.env`
- **產出**：登入 console 沒 Privy 錯誤

### S1.4 [Tier 0.3 + Deploy A.3] Local Happy Path 走完

- **Owner**：你 + 我陪
- **時間**：30 min
- **依賴**：S1.2 + S1.3
- **做啥**：
  1. Landing → Login（email Privy）
  2. Onboarding 4 步走完
  3. Mandate 設定 + 存
  4. Desk 顯示出來
  5. **真錢包充 $5 USDC + 0.01 SOL** ← 你做
  6. 設 `BYPASS_MARKET_HOURS=true`（或等盤內）讓 proposal 出現
  7. 點 Approve（trigger 設離當前價 +50%，保證不 fill）→ Privy 簽 → Jupiter 收單
  8. 看 DB Order 寫入、Position 創出來
  9. 點 Cancel 收回
- **產出**：bug list（記到 `docs/manual-smoke.md`）

### S1.5 修 happy path bug

- **Owner**：我
- **時間**：0–3 hr 看 S1.4 結果
- **依賴**：S1.4
- **做啥**：當下修 + commit
- **產出**：S1.4 重跑全綠

### S1.6 [Tier 0.2] Jupiter mainnet round-trip 證據

- **Owner**：你 + 我
- **時間**：包含在 S1.4，無額外時間
- **依賴**：S1.4 通過
- **做啥**：截圖 + 記下 jupiterOrderId + tx signature
- **產出**：`docs/manual-smoke.md`，將來上雲後 prod smoke 對照基準

**Stage 1 總計：~1.5–4 hr，Stage 1 完成代表「這套在 local 真的能買賣」**

---

## 🟡 Stage 2 — 核心邏輯單元測（避免 prod 才發現 regression）

> 目的：用 mock 把 signal generator + tracker 的關鍵分支鎖住。寫測前完成 S1，寫測時才知道哪些 fixture 要用真實值。

### S2.1 [Tier 1.1] vitest infrastructure

- **Owner**：我
- **時間**：1 hr
- **依賴**：S1 完成（不然測的是 broken code）
- **做啥**：加 vitest、`vitest.config.ts`、一個示範 test
- **產出**：`pnpm test` 跑得起來

### S2.2 [Tier 1.2] Signal Engine 單元測

- **Owner**：我
- **時間**：2 hr
- **依賴**：S2.1
- **覆蓋**：evaluateFreshness / isUsMarketOpen / computeIndicators / proposal-generator 共 8+ test
- **產出**：核心 signal 邏輯 regression 護網

### S2.3 [Tier 1.3] Order Tracker 單元測

- **Owner**：我
- **時間**：2 hr
- **依賴**：S2.1
- **覆蓋**：applyFill BUY / TP / SL、tryDelegatedCancel、tryAutoPlaceExits 共 10+ test
- **產出**：tracker 邏輯 regression 護網（最複雜的部分）

**Stage 2 總計：~5 hr，Stage 2 完成代表「core 改動不會無聲打壞」**

---

## 🔵 Stage 3 — Production-ready Docker

> 目的：把 image 從「能跑」升級到「能在雲上 24/7 跑」。

### S3.1 [Deploy B.1] Dockerfile production 收尾

- **Owner**：我
- **時間**：30 min
- **依賴**：S1 完成（本機證明 image 能跑）
- **做啥**：移 dev tooling、image size 縮小、HEALTHCHECK 完善
- **產出**：web < 250MB、ws-server < 200MB

### S3.2 [Deploy B.2] ws-server graceful shutdown

- **Owner**：我
- **時間**：20 min
- **依賴**：S3.1
- **做啥**：SIGTERM handler 停 cron / 等 in-flight 完成 / close DB pool / close socket.io
- **產出**：`docker stop` 看 log 有 "graceful shutdown"，Cloud Run 10s grace 期內結束乾淨

### S3.3 [Deploy B.3] docker-compose.prod.yml

- **Owner**：我
- **時間**：15 min
- **依賴**：S3.1
- **做啥**：拆 prod compose（不掛 source、Postgres internal-only、restart: always、log size limit）
- **產出**：用於選 GCP VM 路線時的部署檔

### S3.4 [Deploy B.4] .env.production template

- **Owner**：我
- **時間**：10 min
- **依賴**：無
- **做啥**：列 prod 才需要的 env（DATABASE_URL with SSL、不同 NEXT_PUBLIC_APP_URL、CRON_SECRET）
- **產出**：`.env.production.example`

**Stage 3 總計：~1.25 hr，Stage 3 完成代表「container 在雲環境不會莫名死掉」**

---

## 🟣 Stage 4 — GCP 部署

> 目的：上雲，拿 https URL，給人試用。
> 路線預設：Cloud Run（推薦，scale-to-zero 省錢）

### S4.1 [Deploy C.1] GCP project 開通

- **Owner**：你
- **時間**：15 min
- **依賴**：S3 完成（不然推上去也沒用）
- **做啥**：開 project、啟 billing、enable services、`gcloud auth login`
- **產出**：`gcloud config list` 能看到 project ID

### S4.2 [Deploy C.2] Cloud SQL Postgres + migrate

- **Owner**：我寫 script，你跑
- **時間**：30 min
- **依賴**：S4.1
- **做啥**：`scripts/gcp/01-create-cloudsql.sh` + 跑 `prisma migrate deploy`
- **產出**：拿到 prod connection string、schema 8 張表都在

### S4.3 [Deploy C.3] Artifact Registry + Build push

- **Owner**：我
- **時間**：30 min
- **依賴**：S4.1
- **做啥**：`scripts/gcp/02-build-push.sh`，push 兩個 image 上去
- **產出**：Artifact Registry 看到 `ws-server:latest` + `web:latest`

### S4.4 [Deploy C.4] Cloud Run deploy

- **Owner**：我
- **時間**：30 min
- **依賴**：S4.2 + S4.3
- **做啥**：`scripts/gcp/03-deploy-cloudrun.sh`，deploy 兩個 service
- **產出**：兩個 https URL 都 200

### S4.5 [Deploy C.5] Cloud Scheduler 取代 Vercel cron

- **Owner**：我
- **時間**：20 min
- **依賴**：S4.4（要先有 ws-server URL）
- **做啥**：三條 cron job 直接打 ws-server `/cron/{generate,evaluate,track-orders}`
- **產出**：Cloud Scheduler 看到三條，第一次觸發成功

### S4.6 [Deploy C.6] Privy console 加 prod origin

- **Owner**：你
- **時間**：5 min
- **依賴**：S4.4
- **做啥**：Privy → Allowed origins 加 prod URL
- **產出**：prod URL 登入成功

### S4.7 [Deploy C.7] Prod smoke

- **Owner**：你 + 我陪
- **時間**：30 min
- **依賴**：S4.5 + S4.6
- **做啥**：S1.4 整套在 prod URL 重跑一次
- **產出**：截圖 + tx signature 對照 `docs/manual-smoke.md`，本地 vs prod 行為一致

**Stage 4 總計：~2.5 hr，Stage 4 完成代表「有公開 URL 可給人用」**

---

## ⚫ Stage 5 — 維運護欄（上雲後立刻補）

> 目的：上雲後出事不要靠 stdout 看 log。

### S5.1 [Tier 5.1] 結構化 logging（pino）

- **Owner**：我
- **時間**：2 hr
- **依賴**：S4 完成
- **做啥**：ws-server 改 pino JSON log、加 traceId、level 分明
- **產出**：可 grep traceId 串起單一 user 整條 journey

### S5.2 [Tier 5.2] Sentry / error tracking

- **Owner**：你開帳號，我接
- **時間**：1 hr
- **依賴**：S4 完成
- **做啥**：web + ws-server uncaught exception → Sentry
- **產出**：故意 throw → Sentry 收到

### S5.3 [Tier 5.3] /api/healthz + uptime alert

- **Owner**：我
- **時間**：1 hr
- **依賴**：S4
- **做啥**：web 加 healthz 含 DB ping，GCP Cloud Monitoring uptime check
- **產出**：故意停 ws → 5 min 內 alert email

**Stage 5 總計：~4 hr，Stage 5 完成代表「掛了會知道」**

---

## 🔴 Stage 6 — 開放給真實用戶前

> 目的：不只是「跑得起來」，還要「不會把用戶錢搞丟」。

### S6.1 [Tier 1.4] Web API route 整合測

- **Owner**：我
- **時間**：2 hr
- **依賴**：S2 + S5
- **覆蓋**：12+ test，POST /api/orders、GET /api/portfolio、PATCH /api/users/delegation 等

### S6.2 [Tier 2.1] React 元件測

- **Owner**：我
- **時間**：3 hr
- **依賴**：S5
- **覆蓋**：MarketHoursBanner / ProposalModal / DelegationCard / HoldingsList / OpenOrders 共 15+ test

### S6.3 [Tier 3.1] Load test

- **Owner**：我
- **時間**：2 hr
- **依賴**：S4 + S5
- **做啥**：k6 打 /api/portfolio 100 RPS、socket 100 並發
- **產出**：p99 < 1s 的證據

### S6.4 [Tier 3.2] 安全掃描

- **Owner**：我 + 你（pnpm audit）
- **時間**：2 hr
- **依賴**：S2
- **做啥**：pnpm audit / gitleaks / XSS grep / CORS 檢查
- **產出**：所有 high/critical 修掉

### S6.5 [Tier 3.4] 容錯 chaos test

- **Owner**：我
- **時間**：1.5 hr
- **依賴**：S5
- **做啥**：mock Anthropic / Pyth / Jupiter / DB 各掛掉一次，看 graceful
- **產出**：每個 fault 都不 crash 的證據

### S6.6 [Tier 5.4] Trade audit log

- **Owner**：我
- **時間**：1.5 hr
- **依賴**：S5
- **做啥**：新表 AuditLog、每筆 server-signed 寫入、Settings 加查詢頁
- **產出**：用戶看得到所有 server 簽的東西

**Stage 6 總計：~12 hr，Stage 6 完成代表「能正式發布」**

---

## ⚪ Stage 7 — Privy Pro 升級後（auto TP/SL 真生效）

> 觸發條件：你的 Privy app 升級到 Pro plan
> 在那之前 auto TP/SL silent fail，Settings 已有 warning banner 提示用戶。

### S7.1 [Tier 4.1] Privy server signer 真實測

- **Owner**：我
- **時間**：2 hr
- **依賴**：Privy Pro

### S7.2 [Tier 4.2] Auto TP/SL 真實 round-trip

- **Owner**：你 + 我
- **時間**：1 hr
- **依賴**：S7.1

### S7.3 [Tier 4.3] OCO sibling cancel 真實測

- **Owner**：你 + 我
- **時間**：30 min
- **依賴**：S7.2

**Stage 7 總計：~3.5 hr**

---

## 📊 全圖總覽

```
S1 Local Happy Path  (~1.5–4 hr)
  ├─ S1.1 Rebuild image            [我]   5 min
  ├─ S1.2 Jupiter API paper review [我]   30 min  ⚠️ 必先
  ├─ S1.3 Privy console            [你]   10 min
  ├─ S1.4 Happy path 走一次        [雙]   30 min
  ├─ S1.5 修 bug                   [我]   0–3 hr
  └─ S1.6 mainnet 證據紀錄         [雙]   含 S1.4
        │
        ▼
S2 核心單元測  (~5 hr)
  ├─ S2.1 vitest infra             [我]   1 hr
  ├─ S2.2 Signal engine test       [我]   2 hr
  └─ S2.3 Order tracker test       [我]   2 hr
        │
        ▼
S3 Production Docker  (~1.25 hr)
  ├─ S3.1 Dockerfile prod 化       [我]   30 min
  ├─ S3.2 Graceful shutdown        [我]   20 min
  ├─ S3.3 compose.prod             [我]   15 min
  └─ S3.4 .env.production          [我]   10 min
        │
        ▼
S4 GCP 部署  (~2.5 hr)
  ├─ S4.1 GCP project 開通         [你]   15 min
  ├─ S4.2 Cloud SQL + migrate      [雙]   30 min
  ├─ S4.3 Build & push             [我]   30 min
  ├─ S4.4 Cloud Run deploy         [我]   30 min
  ├─ S4.5 Cloud Scheduler          [我]   20 min
  ├─ S4.6 Privy prod origin        [你]   5 min
  └─ S4.7 Prod smoke               [雙]   30 min
        │
        ▼
S5 維運護欄  (~4 hr)
  ├─ S5.1 結構化 logging           [我]   2 hr
  ├─ S5.2 Sentry                   [雙]   1 hr
  └─ S5.3 healthz + alert          [我]   1 hr
        │
        ▼
S6 開放用戶前  (~12 hr)
  ├─ S6.1 API route test           [我]   2 hr
  ├─ S6.2 React 元件 test          [我]   3 hr
  ├─ S6.3 Load test                [我]   2 hr
  ├─ S6.4 安全掃描                 [雙]   2 hr
  ├─ S6.5 Chaos test               [我]   1.5 hr
  └─ S6.6 Audit log                [我]   1.5 hr
        │
        ▼
S7 Privy Pro 後  (~3.5 hr)  ← 跟前面解耦，Privy 升了再做
  ├─ S7.1 Server signer test       [我]   2 hr
  ├─ S7.2 Auto TP/SL 真實          [雙]   1 hr
  └─ S7.3 OCO 真實                 [雙]   30 min
```

**全部走完總計：~30 hr**

---

## 三條建議路徑

### 🏃 路徑 A：「Hackathon 衝 demo」最快路線
**S1 → S3 → S4** = ~5–7 hr
- 跳過 S2 單元測（demo 期接受 regression 風險）
- 跳過 S5/S6/S7
- 拿到一個 https URL 可以給 judge 點

### 🚶 路徑 B：「Hackathon 後一週要給朋友用」穩健路線
**S1 → S2.2/S2.3 → S3 → S4 → S5 → S6.4(安全掃描)** = ~14 hr
- 跳過全 UI test 跟 load test
- 至少有 logging + 安全 baseline

### 🛡️ 路徑 C：「兩週後正式 launch」完整路線
**S1 → S2 → S3 → S4 → S5 → S6** = ~26 hr (S7 看 Privy 升級時機)
- 全部該做的都做

---

## 老兵建議：先做哪一段

**現在就動 S1.1 + S1.2** ——

- S1.1（rebuild）我可以馬上跑，不擋你
- S1.2（Jupiter paper review）我可以同時做，產出 `docs/jupiter-api-audit.md`
- S1.3（你做）跟 S1.2 並行，~10 min 可完成

兩個都好了之後 S1.4（happy path）一起走。今晚 S1 就能收尾。

要我開動嗎？

---

_Last updated: 2026-05-01_
_References: [`test-plan.md`](./test-plan.md) Tier 0–5_
