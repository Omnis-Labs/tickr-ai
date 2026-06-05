# Whaleforce LLM Engineer 面試 — 系統規劃

> 目標：以**量化公司 production-grade** 紀律完成兩題（Task 1 瀏覽器 Agent + Task 2 SEC 10-K 抽取），爭取 A 級評分。
>
> 任務規格原文見 [`docs/spec/`](docs/spec/)。

---

## 0. 設計哲學

每個技術決策都從以下原則推導，文件中任何具體做法都應該能追溯到這六條：

| 原則 | 具體展現 |
|---|---|
| **Determinism & Replay** | 每筆輸出可從 `input + model_version + prompt_version + seed` 完整重現 |
| **Fail loud, never silent** | Confidence < threshold → 進 quarantine queue，不出汙染訊號 |
| **Cost as a first-class metric** | 每個 task / filing 帶 cost attribution，不是事後估算 |
| **Eval is a service, not a script** | 持續跑、有 dashboard、CI 阻擋 regression |
| **Layered fallback, not one big model** | rules → small model → large model → human，每層有 SLO |
| **Schema as contract** | 所有輸出 Pydantic 強型別 + 版本號，breaking change 走 v2 |

---

## 1. 系統總架構（兩題共用 backbone）

```
                   ┌──────────────────────────────────────┐
                   │   Web Frontend (Next.js, Zeabur)     │
                   │   Task submit · Live progress · Eval │
                   │   dashboards · Failure inspector     │
                   └────────────┬─────────────────────────┘
                                │ REST + SSE
                   ┌────────────▼─────────────────────────┐
                   │   API Gateway (FastAPI)              │
                   │   Auth · Rate limit · Idempotency    │
                   └────────────┬─────────────────────────┘
                                │ Job ID
              ┌─────────────────┼──────────────────┐
              │                 │                  │
   ┌──────────▼─────┐ ┌─────────▼────────┐ ┌──────▼──────────┐
   │ Task1 Worker   │ │ Task2 Worker     │ │ Eval Runner     │
   │ (Browser Agent)│ │ (10-K Extractor) │ │ (scheduled+CI)  │
   └────────┬───────┘ └────────┬─────────┘ └──────┬──────────┘
            │                  │                  │
            └──────────┬───────┴──────────────────┘
                       │
        ┌──────────────┼──────────────────┬────────────────┐
        ▼              ▼                  ▼                ▼
   ┌─────────┐  ┌─────────────┐  ┌──────────────┐  ┌───────────┐
   │ LLM     │  │ Object      │  │ Postgres     │  │ Redis     │
   │ Gateway │  │ Storage     │  │ (jobs, eval, │  │ (queue,   │
   │ (router │  │ (HTML, DOM, │  │  cost ledger,│  │  cache,   │
   │ +cache  │  │  screenshots│  │  schemas)    │  │  rate     │
   │ +cost)  │  │ )           │  │              │  │  limit)   │
   └─────────┘  └─────────────┘  └──────────────┘  └───────────┘
                       │
                       ▼
              ┌────────────────────┐
              │ OpenTelemetry      │ → Grafana / 內建 dashboard
              │ traces+metrics+logs│   (一個 trace = 一個 task)
              └────────────────────┘
```

### 1.1 共用核心元件

- **LLM Gateway**：所有 LLM 呼叫的單一入口。負責：
  - Model routing（cheap → expensive 分層）
  - Prompt cache（Anthropic prompt caching + 自建 semantic cache）
  - Cost attribution（每筆呼叫 `trace_id → tokens → $`）
  - Retry + circuit breaker
  - PII scrubbing
- **Cost Ledger**：Postgres table，每筆 LLM 呼叫一列（trace_id, model, in/out tokens, $, latency, cache_hit）。每個 task 結束 commit 一筆 aggregated cost。**分析報告的成本數字一律從這裡 query，不估算**。
- **Artifact Store**：所有 DOM snapshot / screenshot / 原始 HTML 存 object storage（Zeabur volume 或 S3 兼容），key = `{trace_id}/{step}.{ext}`。Failure inspector 直接 link。

### 1.2 目錄結構（最終形態）

```
whaleforce-llm-test/
├── PLAN.md                       # 本檔
├── README.md                     # 部署入口、URL、how to run（實作階段補）
├── docs/
│   ├── spec/                     # 面試題目原文
│   ├── adr/                      # Architectural Decision Records
│   └── analysis/
│       ├── task1_report.md       # 效能/成本/擴充性/正確性分析
│       └── task2_report.md
├── prompts/
│   ├── task1_browser/            # planner / locator-repair / verifier / diagnose
│   └── task2_10k/                # extractor_a / extractor_b / arbiter / confidence
├── shared/                       # LLM gateway, cost ledger, OTel, schemas
├── task1_browser_agent/
│   ├── agent/                    # planner, executor, self-healer, verifier
│   ├── eval/                     # eval set + harness + metrics
│   └── api/
├── task2_10k_extractor/
│   ├── pipeline/                 # L1 anchor → L2 structural → L3 LLM
│   ├── eval/
│   └── api/
├── web/                          # Next.js 前端，兩題共用
├── infra/                        # Dockerfile, zeabur.yaml, docker-compose.dev
└── .github/workflows/            # CI（lint, typecheck, eval regression）
```

---

## 2. Task 1：Browser Agent — Production-Grade

### 2.1 控制流：顯式 State Machine，不是 ReAct loop

```
[PLAN] → [LOCATE] → [ACT] → [VERIFY] → [DONE | REPLAN | ESCALATE]
   ↑         │ fail    │ fail    │ fail        │
   │         ▼         ▼         ▼             │
   └─── [DIAGNOSE root cause → choose recovery strategy]
```

**為什麼**：ReAct 每步讓 LLM 自由選 action → 貴、不可控、無法 SLO。State machine 的每個狀態有明確 contract、可單獨 unit test、失敗有歸屬。

### 2.2 Self-Correction（核心，非 try/except）

失敗時 **DIAGNOSE 階段**強制做：

1. **採證**：DOM snapshot + screenshot + 最近 3 步 action log + console errors
2. **分類**（LLM + rules 雙判）：
   - `STALE_SELECTOR` → 觸發 self-maintenance
   - `PAGE_NOT_LOADED` → 等待策略（network idle / 特定元素 visible）
   - `WRONG_STATE` → 回到上一個 checkpoint replay
   - `CAPTCHA / AUTH_WALL` → escalate（不嘗試繞過，合規禁忌）
   - `RATE_LIMITED` → backoff + 換 session
   - `INTENT_MISUNDERSTOOD` → 重新 plan，把 verifier 的 reject reason 餵回去
3. **策略對應表**：每類失敗一個 recovery handler，不是同一個 retry loop
4. **預算上限**：每 task 最多 N 次 recovery（預設 3）、成本上限 $X、時間上限 T → 超過直接 escalate，**不無限燒錢**

### 2.3 Self-Maintenance：Locator Resilience

**三聯定位策略**（任一存活即可定位）：

```python
class Locator:
    primary:   CSSSelector | XPath        # plan 階段生成
    semantic:  ARIARole + AccessibleName  # 跨 redesign 最穩
    visual:    TextContent + BoundingBox  # 最後手段
```

- 成功定位後寫入 `selector_history` table（site, action, working_selector, timestamp）
- 失敗時優先試 `semantic`，再試 `visual`，最後讓 LLM 看 DOM 重生 selector
- **Drift detection metric**：同一 (site, action) 的 primary selector 失敗率 > 20% 自動告警 → 進入「該網站需 review」隊列

### 2.4 Verifier — Silent Failure 的核心防線

每個 ACT 之後**強制驗證**：
- **結構驗證**：URL 符合預期 pattern、特定元素出現
- **語意驗證**：LLM judge 看 screenshot + 任務描述，判斷是否達成
- **業務不變量**：例如「填表單後購物車數量 +1」這類

Verifier 拒絕 → 視為失敗進 DIAGNOSE。**ACT 沒丟例外 ≠ 成功**。

### 2.5 Sandbox & Compliance

- 每個 task 一個獨立 Playwright context（cookies/session 隔離）
- Browser 跑在 Docker container，`--cap-drop=ALL`、無 host network 除 whitelist
- 永遠不執行 download、不繞 CAPTCHA、不嘗試需密碼登入（除非 task 提供 demo credentials）
- 所有 navigation 走 domain allow-list，防 prompt injection 把 agent 導去惡意網站

### 2.6 支援網站策略（深度 > 廣度）

初期鎖 **3 個**：

| 網站 | 任務類型 | 考驗點 |
|---|---|---|
| Wikipedia / arXiv | 資訊查詢 | Plan 的多步規劃、跨語言處理 |
| Amazon search | 電商搜尋 + filter | DOM 複雜、A/B test 多 → self-maintenance |
| HackerNews / 公開 demo form | 表單互動、登入 | Multi-step state、verifier 嚴格度 |

每個網站定義 **capability matrix**：可做什麼、不能做什麼、已知 fail case → 對應題目要求的「列出支援與不支援」。

---

## 3. Task 2：10-K Extractor — Production-Grade

### 3.1 Pipeline：分層 Fallback，Cost-Aware

```
Filing URL/Upload
    ↓
[INGEST]  抓檔 + canonicalize 成統一 IR             artifact: raw.html, normalized.json
    ↓
[L1 Anchor Extractor]              ── high conf → publish
    ↓ low conf
[L2 Structural Extractor]          ── high conf → publish
    ↓ low conf
[L3 LLM + Self-Consistency]        ── high conf → publish
    ↓ low conf
[QUARANTINE] → 人工檢查 queue，不出汙染資料
```

**Cost control 精髓**：L1 + L2 純規則/解析，成本 ~$0；只有 ~10–20% filing 走 L3。**對外宣稱「單 filing 平均 $X」必須這樣設計才壓得下來**。

### 3.2 L1 — Anchor Extractor

- 解析 SEC EDGAR iXBRL 標籤、TOC anchors（`<a name="item1">`）
- 正則匹配 `Item\s+[0-9]+[A-Z]?\.?\s+[A-Z]`
- 大綱對照（必須出現 1, 1A, 1B, 2, 3...的合理子集）

### 3.3 L2 — Structural Extractor

- DOM tree → heading hierarchy（font-size、bold、`<h*>` tag）
- 與 SEC 17 個 item 標準名稱做 fuzzy match（"Risk Factors" → Item 1A）
- TOC 反向對照：先抓 TOC，再用 TOC 連結反查正文位置

### 3.4 L3 — LLM + Self-Consistency

**兩個獨立 prompt 跑同一個 filing**：
- **Prompt A**：「找出 Item 1 的起始與結束位置」（逐 item）
- **Prompt B**：「把整份文件切成 16 個 item 區段」（一次切完）

**交叉驗證**：兩者 item boundary IoU > 0.9 → 高 confidence；否則 → 第三個 prompt 仲裁，仍不一致 → quarantine。

**為什麼這樣設計**：題目明問「沒有 public ground truth 怎麼自驗」—— self-consistency 是答案，且這是量化公司在無 label 下做模型自評的標準做法。

### 3.5 Calibrated Confidence Score（不是 LLM 自報）

```
confidence = w1 * anchor_coverage          # L1 找到幾個 item / 17
           + w2 * boundary_agreement       # L3 兩個 prompt 的 IoU
           + w3 * structural_invariant     # 順序正確、無重疊、總長 ratio 合理
           + w4 * cross_year_consistency   # 同公司歷年該 item 長度分布 z-score
```

權重用 20 筆人工標 dev set 跑 logistic regression 學出來，並做 **Platt scaling calibration** → 報出來的 0.85 confidence 真的對應 ~85% 正確率。

**ECE (Expected Calibration Error) 是分析報告必報數字**。

### 3.6 Schema & 版本控制

```python
class ExtractedItem(BaseModel):
    item_id: Literal["1","1A","1B","2","3",...,"16"]
    title: str
    content: str
    start_offset: int
    end_offset: int
    confidence: float                 # calibrated [0,1]
    extraction_method: Literal["L1","L2","L3"]
    schema_version: Literal["1.0.0"]
    extracted_at: datetime
    filing_metadata: FilingMeta       # CIK, accession, fiscal_year, form_type
```

10-K item 結構偶爾變（例：2005 年後加 Item 1B、9B）→ 用 `schema_version` 標清楚。**量化公司最痛恨 silently 改 schema**。

### 3.7 Eval Set 設計

| 維度 | 涵蓋 |
|---|---|
| **產業** | Tech (AAPL), Bank (JPM), Energy (XOM), Retail (WMT), Pharma (PFE), REIT (SPG) — 各 1 家 |
| **年份** | 同公司跨 2010 / 2018 / 2023（格式跨度大） |
| **規模** | 大型藍籌 + 中小型（small filer 常用簡化版） |
| **格式** | iXBRL 標準 / 老式純 HTML / 加密 PDF（escalate case） |

→ 約 **25–30 筆** ground truth set。

**Metrics**：
- Item-level **Precision / Recall / F1**
- **Boundary IoU**（mean + p10）
- **Coverage**（多少 % item 被找到）
- **Calibration**：ECE, Brier score
- **Cost per filing**（$, p50/p95）
- **Latency**（s, p50/p95）

---

## 4. Observability — 量化系統的命脈

### 4.1 Tracing（OpenTelemetry）

每個 task / filing 一個 root span，下面 nested span：
- `llm_call`（model, tokens, cost, cache_hit）
- `dom_action`（selector, success, retry_count）
- `extraction_layer`（L1/L2/L3, confidence_delta）

→ 開源 Jaeger 或直接寫進 Postgres + 自畫 dashboard（省 infra）

### 4.2 必備 Dashboard Metrics

| Metric | Why |
|---|---|
| Task success rate（overall + per site / industry） | SLO 基準 |
| p50/p95/p99 latency | Latency budget |
| Cost per task / filing（p50/p95） | 對應分析報告 |
| LLM cache hit rate | 證明 cost 優化有效 |
| Self-correction trigger rate + recovery success rate | 證明不是純 retry |
| Selector drift rate per site | 證明 self-maintenance 在做事 |
| Quarantine rate | 不可信輸出比例 |
| Calibration error (ECE) | confidence 是否可信 |

### 4.3 Structured Logging

所有 log JSON 化，帶 `trace_id`, `task_id`, `step`。**禁止 `print()`**。

---

## 5. Cost Governance

| 機制 | 細節 |
|---|---|
| **Per-call attribution** | LLM Gateway 強制帶 `trace_id`, `purpose`，未帶直接 reject |
| **Budget cap per task** | Task 1: $0.20/task；Task 2: $0.10/filing；超出 → quarantine |
| **Model routing** | 簡單分類 / verifier 走 Haiku；planner / extractor 走 Sonnet；只有 hard case 上 Opus |
| **Prompt caching** | Anthropic prompt caching（system + few-shot 永久 cache）+ semantic cache（同 filing 重抽走 cache） |
| **Pre-flight estimate** | 大 filing 進來先估 token，超預算先警告 |

---

## 6. Reliability Mechanisms

- **Idempotency**：所有 POST `/task`、`/extract` 帶 `Idempotency-Key`，重送不重跑
- **Job queue (Redis)**：worker crash 不丟 task，dead-letter queue 顯式可見
- **Circuit breaker**：對 OpenAI/Anthropic API failure rate > 50% 時短路 30s，避免雪崩
- **Graceful degradation**：LLM 不可用時 Task 2 仍可跑 L1+L2 出 best-effort 結果 + 低 confidence flag

---

## 7. 前端（Next.js + Tailwind + shadcn/ui）

**4 個關鍵頁面**：

| 頁面 | 內容 |
|---|---|
| `/` | 兩題入口 + 各自 supported / unsupported 矩陣 |
| `/task1` | 任務輸入 + 即時進度（SSE step-by-step + screenshot 縮圖）+ 失敗 inspector（DOM diff、recovery trace） |
| `/task2` | Filing 上傳 / EDGAR URL 輸入 + item 結果樹狀展開 + confidence 顯示 + 原文 highlight |
| `/dashboard` | Eval metrics、cost、latency、success rate 圖表 — **給面試官看分析報告用，至關重要** |

---

## 8. Phased Delivery（時間 = 唯一硬約束）

| Phase | 天數 | Deliverable | 通過標準 |
|---|---|---|---|
| **P0 Foundation** | 1d | Monorepo、Docker、Zeabur CI/CD、Postgres + Redis、LLM Gateway + Cost Ledger、OTel | "hello world" trace 完整端到端 |
| **P1 Task2 MVP** | 1.5d | L1 + L2、5 筆 eval、最小前端 | AAPL 2023 10-K 全 item 抽出，> 0.8 F1 |
| **P2 Task2 Hard** | 1.5d | L3 + Self-consistency、Calibration、25 筆 eval、Quarantine | ECE < 0.1、p95 cost < $0.10 |
| **P3 Task1 MVP** | 1.5d | State machine、Playwright sandbox、1 個網站打通 | Wikipedia 查詢任務 5/5 通過 |
| **P4 Task1 Hard** | 1.5d | Self-correct + self-maintain、3 網站、20 筆 eval | 跨網站 success > 75%、recovery rate > 50% |
| **P5 Polish** | 1d | Dashboard、failure inspector、prompt 整理、ADRs | 分析報告完整、所有 metric 有具體數字 |
| **Buffer** | 1d | held-out 自測、修 bug | — |

**總計 ~9 天**。任何 phase 過時 50% → 砍 scope 不延期（例：Task 1 砍到 2 網站）。

---

## 9. Architectural Decision Records

實作時要寫進 [`docs/adr/`](docs/adr/)：

- **ADR-001**：Why state machine over ReAct for browser agent
- **ADR-002**：Why layered L1/L2/L3 over single LLM call
- **ADR-003**：Self-consistency as ground-truth-free validation
- **ADR-004**：Confidence calibration methodology
- **ADR-005**：Schema versioning policy
- **ADR-006**：Cost attribution & budget cap policy

---

## 10. 面試 Demo 必須直接秀的 5 件事

1. **Dashboard 一頁有所有 metric**：success rate, cost p50/p95, latency, ECE, cache hit rate
2. **Failure inspector**：點一個 failed task → 看到 DOM snapshot + LLM diagnose 過程 + recovery 嘗試
3. **Cost ledger query**：「上次跑 10 個 filing 總花費 $0.73」這種具體數字
4. **Eval CI**：commit 改 prompt → 自動跑 eval → F1 掉 > 2% 自動擋 PR
5. **Quarantine queue**：低 confidence case 沒亂出 → 量化公司最在意這點

---

## 11. 待定決策（開工前需確認）

實作 P0 前需要確認：

- [ ] **LLM 預算**：總共願意花多少（影響 L3 強度、eval 跑幾輪）
- [ ] **部署**：Zeabur / Vercel + Railway / 純 Zeabur
- [ ] **資料庫**：Zeabur 自帶 service / Supabase / Upstash
- [ ] **技術棧確認**：Python (FastAPI) backend + TypeScript (Next.js) frontend
- [ ] **API Key 來源**：Anthropic / OpenAI 帳號是否就緒
