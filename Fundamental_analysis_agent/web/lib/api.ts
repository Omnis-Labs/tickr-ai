export const API_BASE =
  (typeof window !== "undefined" && (window as { __API_BASE__?: string }).__API_BASE__) ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000";

export type AgentState =
  | "PLAN" | "LOCATE" | "ACT" | "VERIFY" | "DIAGNOSE" | "DONE" | "ESCALATE";

export type JobStatus =
  | "pending" | "running" | "succeeded" | "failed" | "escalated" | "quarantined";

export interface StepEvent {
  job_id: string;
  sequence: number;
  state: AgentState;
  step_index: number | null;
  message: string;
  detail: Record<string, unknown> | null;
  timestamp: string;
}

export interface JobView {
  job_id: string;
  task_description: string;
  target_url: string | null;
  status: JobStatus;
  final_output: Record<string, unknown> | null;
  // `plan` and `steps` are typed loosely here because /task1 page only reads
  // the count; the inspector page narrows them via its own interfaces.
  plan: PlannedStep[];
  steps: StepResult[];
  recovery_attempts: number;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
}

export async function createJob(taskDescription: string): Promise<JobView> {
  const res = await fetch(`${API_BASE}/task1/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task_description: taskDescription }),
  });
  if (!res.ok) throw new Error(`createJob failed: ${res.status}`);
  return res.json();
}

export async function getJob(jobId: string): Promise<JobView> {
  const res = await fetch(`${API_BASE}/task1/jobs/${jobId}`);
  if (!res.ok) throw new Error(`getJob failed: ${res.status}`);
  return res.json();
}

export function subscribeEvents(
  jobId: string,
  onStep: (e: StepEvent) => void,
  onDone: (j: JobView) => void,
): () => void {
  const es = new EventSource(`${API_BASE}/task1/jobs/${jobId}/events`);
  es.addEventListener("step", (ev) => {
    try { onStep(JSON.parse((ev as MessageEvent).data)); } catch (e) { console.error(e); }
  });
  es.addEventListener("done", (ev) => {
    try { onDone(JSON.parse((ev as MessageEvent).data)); } catch (e) { console.error(e); }
    es.close();
  });
  es.onerror = () => es.close();
  return () => es.close();
}

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------

export interface EvalCase {
  id: string;
  category: string;
  passed: boolean;
  status: string;
  cost_usd: number;
  duration_ms: number;
  recovery_attempts: number;
  failure_reason: string | null;
  job_id: string | null;  // link to /jobs/{job_id}
}

export interface EvalReport {
  available: boolean;
  reason?: string;
  generated_at?: string;
  metrics?: {
    n_cases: number;
    n_pass: number;
    n_infra_error: number;
    pass_rate: number;
    pass_rate_ex_infra: number;
    cost_p50: number;
    cost_p95: number;
    duration_p50_ms: number;
    duration_p95_ms: number;
    recovery_rate: number;
    by_category: Record<string, { n: number; pass_rate: number; mean_cost_usd: number }>;
  };
  cases?: EvalCase[];
}

export interface CostByPurpose {
  purpose: string;
  calls: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface CostByModel {
  model: string;
  backend: string;
  calls: number;
  cost_usd: number;
}

export interface CostSummary {
  total_cost_usd: number;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  cache_hit_count: number;
  cache_hit_rate: number;
  by_purpose: CostByPurpose[];
  by_model: CostByModel[];
}

export interface RecentJob {
  job_id: string;
  task_description: string;
  status: string;
  n_steps: number;
  recovery_attempts: number;
  total_cost_usd: number;
  created_at: string;
  updated_at: string;
}

export interface CapabilitySite {
  domain?: string;
  pattern?: string;
  operations?: string[];
  reason?: string;
  notes?: string;
}

export interface Capabilities {
  supported_sites: CapabilitySite[];
  unsupported_or_unreliable: CapabilitySite[];
  allow_list: string[];
}

export async function getEvalReport(): Promise<EvalReport> {
  const res = await fetch(`${API_BASE}/task1/dashboard/eval`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getEvalReport failed: ${res.status}`);
  return res.json();
}

export async function getCostSummary(): Promise<CostSummary> {
  const res = await fetch(`${API_BASE}/task1/dashboard/cost-summary`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getCostSummary failed: ${res.status}`);
  return res.json();
}

// ---- divination-control null band (11 placebo systems vs the real agents) ----
export interface NullBand {
  available: boolean;
  reason?: string;
  n_draws?: number;
  panel?: string[];
  pooled_sharpe?: Record<string, number>;
  sharpe_p95_threshold?: number;
  by_system_mean_sharpe?: Record<string, number>;
  by_system_max_sharpe?: Record<string, number>;
  real_agent_overlay?: Record<string, { sharpe_median: number; sharpe_best: number; n_cases: number; clears_control_p95: boolean }>;
}
export async function getNullBand(): Promise<NullBand> {
  const res = await fetch(`${API_BASE}/task1/dashboard/divination-null-band`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getNullBand failed: ${res.status}`);
  return res.json();
}

export async function getRecentJobs(limit = 10): Promise<RecentJob[]> {
  const res = await fetch(`${API_BASE}/task1/dashboard/recent-jobs?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getRecentJobs failed: ${res.status}`);
  return res.json();
}

export async function getCapabilities(): Promise<Capabilities> {
  const res = await fetch(`${API_BASE}/task1/capabilities`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getCapabilities failed: ${res.status}`);
  return res.json();
}

// -----------------------------------------------------------------------------
// Task 2 capability matrix (richer schema: proven cases + known failures
// + refusal categories drawn from the eval baseline + VERIFICATION.md)
// -----------------------------------------------------------------------------

export interface ProvenSupportedFiling {
  label: string;
  industry?: string;
  url: string;
  items_extracted: number;
  overall_confidence: number;
  method_mix: string;
  cost_usd: number;
  notes?: string;
}

export interface KnownFailureCase {
  label: string;
  url: string;
  issue: string;
  root_cause: string;
  system_response: string;
  fix_direction?: string;
}

export interface RefusalCategory {
  category: string;
  example_input: string;
  system_response: string;
}

export interface UnsupportedFormat {
  pattern: string;
  example?: string;
  system_response: string;
}

export interface Task2Capabilities {
  proven_supported_filings: ProvenSupportedFiling[];
  known_failure_cases: KnownFailureCase[];
  format_categories: {
    supported: string[];
    unsupported_or_unreliable: UnsupportedFormat[];
  };
  refusal_categories: RefusalCategory[];
  extraction_layers: Record<string, string | number>;
  schema_version?: string;
  // Backward-compat fields:
  supported?: CapabilitySite[];
  unsupported_or_unreliable?: CapabilitySite[];
}

export async function getTask2Capabilities(): Promise<Task2Capabilities> {
  const res = await fetch(`${API_BASE}/task2/capabilities`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getTask2Capabilities failed: ${res.status}`);
  return res.json();
}

// -----------------------------------------------------------------------------
// Task 2 — 10-K extractor
// -----------------------------------------------------------------------------

export interface FilingMeta {
  cik: string | null;
  accession_number: string | null;
  fiscal_year: number | null;
  form_type: string;
  company_name: string | null;
  source_url: string;
  fetched_at: string;
}

export interface ExtractedItem {
  item_id: string;
  title: string;
  content: string;
  start_offset: number;
  end_offset: number;
  char_length: number;
  confidence: number;
  extraction_method: "L1" | "L2" | "L3";
  notes: string | null;
}

export interface FilingExtraction {
  job_id: string;
  filing: FilingMeta;
  items: ExtractedItem[];
  overall_confidence: number;
  quarantined: boolean;
  quarantine_reasons: string[];
  extraction_method_summary: Record<string, number>;
  n_expected_items: number;
  n_found_items: number;
  coverage_ratio: number;
  cost_usd: number;
  duration_ms: number;
  created_at: string;
}

export interface Task2Job {
  job_id: string;
  source_url: string;
  status: JobStatus;
  extraction: FilingExtraction | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export async function createExtraction(sourceUrl: string): Promise<Task2Job> {
  const res = await fetch(`${API_BASE}/task2/extractions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_url: sourceUrl }),
  });
  if (!res.ok) {
    // FastAPI returns 422 as {"detail":[{"loc":[...],"msg":"...","type":"..."}, ...]}
    // Parse so the UI can show "URL is too short" rather than a bare HTTP code.
    let detail = "";
    try {
      const body = await res.json();
      if (Array.isArray(body?.detail)) {
        detail = body.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ");
      } else if (typeof body?.detail === "string") {
        detail = body.detail;
      }
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createExtraction failed: ${res.status}`);
  }
  return res.json();
}

export interface EdgarLookupResult {
  ticker: string;
  company: string;
  cik: number;
  industry: string;
  fiscal_year: number;
  accession_number: string;
  filed_date: string;
  url: string;
}

export interface EdgarLookupError {
  kind: "ticker_unknown" | "filing_not_found" | "edgar_lookup_failed";
  message: string;
  supported_tickers?: string[];
}

export interface EdgarParseResult {
  url: string;
  interpretation: string;
  ticker?: string;
  year?: number;
  industry?: string;
  trace_id?: string;
  parse_cost_usd?: number;
}

export interface EdgarParseError {
  kind: "refuse" | "unsupported" | "ticker_unknown" | "filing_not_found" | "edgar_lookup_failed" | "llm_failed";
  reason?: string;
  message?: string;
  ticker?: string;
  company_guess?: string;
  year?: number;
}

export async function parseEdgarInput(input: string): Promise<EdgarParseResult> {
  const res = await fetch(`${API_BASE}/task2/edgar/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: EdgarParseError =
      body?.detail && typeof body.detail === "object"
        ? body.detail
        : { kind: "llm_failed", message: `HTTP ${res.status}` };
    throw err;
  }
  return res.json();
}

export async function lookupEdgar(
  ticker: string,
  year?: number,
): Promise<EdgarLookupResult> {
  const qs = new URLSearchParams({ ticker });
  if (year) qs.set("year", String(year));
  const res = await fetch(`${API_BASE}/task2/edgar/lookup?${qs.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: EdgarLookupError =
      body?.detail && typeof body.detail === "object"
        ? body.detail
        : { kind: "edgar_lookup_failed", message: `HTTP ${res.status}` };
    throw err;
  }
  return res.json();
}

export async function getExtraction(jobId: string): Promise<Task2Job> {
  const res = await fetch(`${API_BASE}/task2/extractions/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getExtraction failed: ${res.status}`);
  return res.json();
}

// -----------------------------------------------------------------------------
// Failure inspector — full job lookup with eval metadata
// -----------------------------------------------------------------------------

export interface Task1InspectorPayload {
  kind: "task1";
  job: JobView & { steps: StepResult[]; plan: PlannedStep[] };
  source: "memory" | "eval_sidecar";
  eval_metadata?: {
    case_id: string;
    passed: boolean;
    failure_reason: string | null;
    assertions: Record<string, unknown>;
    fault_inject: Record<string, unknown> | null;
    fault_status: Record<string, unknown> | null;
  };
}

export interface Task2InspectorPayload {
  kind: "task2";
  job: Task2Job;
}

export type JobInspectorPayload = Task1InspectorPayload | Task2InspectorPayload;

export interface PlannedStep {
  index: number;
  action: string;
  target_description: string;
  value: string | null;
  success_criteria: string;
  locator: Record<string, unknown> | null;
}

export interface ArtifactRef {
  key: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

export interface StepResult {
  step_index: number;
  state: AgentState;
  success: boolean;
  failure_kind: string | null;
  error_message: string | null;
  dom_snapshot_ref: ArtifactRef | null;
  screenshot_ref: ArtifactRef | null;
  duration_ms: number;
  cost_usd: number;
  started_at: string;
  ended_at: string;
}

export async function getJobInspector(jobId: string): Promise<JobInspectorPayload> {
  // Try Task 1 store + eval sidecars first
  const t1 = await fetch(`${API_BASE}/task1/jobs/${jobId}`, { cache: "no-store" });
  if (t1.ok) {
    const data = await t1.json();
    return { kind: "task1", ...data };
  }
  // Fall back to Task 2 store (10-K extractor jobs use a different namespace)
  if (t1.status === 404) {
    const t2 = await fetch(`${API_BASE}/task2/extractions/${jobId}`, { cache: "no-store" });
    if (t2.ok) {
      const job: Task2Job = await t2.json();
      return { kind: "task2", job };
    }
  }
  throw new Error(`getJobInspector failed: ${t1.status}`);
}

export async function getJobIdForCase(caseId: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/task1/jobs/by-case/${caseId}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getJobIdForCase failed: ${res.status}`);
  const data = await res.json();
  return data.job_id;
}

export function artifactUrl(key: string): string {
  // Key format: "{job_id}/{filename}" — preserve exactly one slash.
  const slash = key.indexOf("/");
  if (slash < 0) throw new Error(`bad artifact key: ${key}`);
  const jobId = key.slice(0, slash);
  const filename = key.slice(slash + 1);
  return `${API_BASE}/task1/artifacts/${encodeURIComponent(jobId)}/${encodeURIComponent(filename)}`;
}

export async function pollExtraction(
  jobId: string,
  onUpdate: (j: Task2Job) => void,
  intervalMs = 1000,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getExtraction(jobId);
      onUpdate(j);
      if (j.status === "succeeded" || j.status === "failed" || j.status === "quarantined") {
        return;
      }
    } catch (e) {
      console.error(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

// ===========================================================================
// Task 3 — fundamentals-driven strategy lab
// ===========================================================================

export interface ThesisCitation {
  item_id: string;
  item_title: string;
  quote: string;
}

export interface StrategySpec {
  entry_signal: "buy_and_hold" | "sma_cross" | "momentum" | "rsi_oversold";
  exit_signal: "hold" | "sma_reverse" | "rsi_overbought" | "time_exit";
  stance: "bullish" | "neutral" | "cautious";
  sma_fast: number; sma_slow: number;
  momentum_lookback_days: number; momentum_threshold_pct: number;
  rsi_period: number; rsi_oversold: number; rsi_overbought: number;
  time_exit_days: number; stop_loss_pct: number; take_profit_pct: number;
  thesis: string; rationale_entry: string; rationale_exit: string;
  citations: ThesisCitation[];
}

export interface PricePoint {
  date: string; open: number; high: number; low: number; close: number; volume: number;
}

export interface Trade {
  entry_date: string; entry_price: number;
  exit_date: string | null; exit_price: number | null;
  return_pct: number | null; exit_reason: string;
}

export interface EquityPoint { date: string; strategy: number; benchmark: number; market: number | null; }

export interface BacktestMetrics {
  total_return_pct: number; benchmark_return_pct: number; excess_return_pct: number;
  benchmark_from_entry_pct: number | null; excess_vs_entry_pct: number | null;
  market_return_pct: number | null; excess_vs_market_pct: number | null;
  cagr_pct: number; sharpe: number; max_drawdown_pct: number;
  win_rate_pct: number; n_trades: number; exposure_pct: number;
  days: number; transaction_cost_bps: number;
}

export interface BacktestResult {
  start_date: string; end_date: string;
  metrics: BacktestMetrics; trades: Trade[]; equity_curve: EquityPoint[];
}

export interface StrategyResult {
  job_id: string; ticker: string; company_name: string | null;
  filing_url: string; fiscal_year: number | null; filing_available_date: string;
  prices: PricePoint[]; strategy: StrategySpec; backtest: BacktestResult;
  caveats: string[]; cost_usd: number; created_at: string;
}

export interface Task3Job {
  job_id: string; ticker: string; status: JobStatus;
  result: StrategyResult | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export async function createStrategy(ticker: string): Promise<Task3Job> {
  const res = await fetch(`${API_BASE}/task3/strategies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createStrategy failed: ${res.status}`);
  }
  return res.json();
}

export async function getStrategy(jobId: string): Promise<Task3Job> {
  const res = await fetch(`${API_BASE}/task3/strategies/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getStrategy failed: ${res.status}`);
  return res.json();
}

export async function pollStrategy(
  jobId: string,
  onUpdate: (j: Task3Job) => void,
  intervalMs = 1500,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getStrategy(jobId);
      onUpdate(j);
      if (j.status === "succeeded" || j.status === "failed" || j.status === "quarantined") return;
    } catch (e) {
      console.error(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

// ===========================================================================
// Task 4 — technical-analysis-driven strategy lab
// Reuses the Task 3 PricePoint / Trade / EquityPoint / BacktestMetrics /
// BacktestResult interfaces above (identical shapes).
// ===========================================================================

export interface TechnicalSpec {
  entry_signal:
    | "buy_and_hold" | "sma_cross" | "macd_cross" | "rsi_oversold"
    | "bollinger_breakout" | "donchian_breakout" | "momentum";
  exit_signal:
    | "hold" | "sma_reverse" | "macd_reverse" | "rsi_overbought"
    | "bollinger_revert" | "donchian_stop" | "time_exit";
  stance: "bullish" | "neutral" | "cautious";
  sma_fast: number; sma_slow: number;
  macd_fast: number; macd_slow: number; macd_signal: number;
  rsi_period: number; rsi_oversold: number; rsi_overbought: number;
  bollinger_period: number; bollinger_k: number;
  donchian_period: number;
  momentum_lookback_days: number; momentum_threshold_pct: number;
  time_exit_days: number;
  require_volume_confirm: boolean; volume_fast: number; volume_slow: number; volume_confirm_ratio: number;
  stop_loss_pct: number; take_profit_pct: number;
  thesis: string; rationale_entry: string; rationale_exit: string;
}

export interface TechnicalResult {
  job_id: string; ticker: string; company_name: string | null;
  as_of_date: string;
  prices: PricePoint[]; strategy: TechnicalSpec; backtest: BacktestResult;
  indicator_readings: Record<string, number | string>;
  caveats: string[]; cost_usd: number; created_at: string;
}

export interface Task4Job {
  job_id: string; ticker: string; status: JobStatus;
  result: TechnicalResult | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export async function createAnalysis(ticker: string): Promise<Task4Job> {
  const res = await fetch(`${API_BASE}/task4/analyses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createAnalysis failed: ${res.status}`);
  }
  return res.json();
}

export async function getAnalysis(jobId: string): Promise<Task4Job> {
  const res = await fetch(`${API_BASE}/task4/analyses/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getAnalysis failed: ${res.status}`);
  return res.json();
}

export async function pollAnalysis(
  jobId: string,
  onUpdate: (j: Task4Job) => void,
  intervalMs = 1500,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getAnalysis(jobId);
      onUpdate(j);
      if (j.status === "succeeded" || j.status === "failed") return;
    } catch (e) {
      console.error(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

// ===========================================================================
// Task 5 — ensemble / multi-agent arbitration
// Fuses Task 3 (fundamental) + Task 4 (technical) into one combined-position
// backtest. Reuses the BacktestResult / PricePoint shapes above.
// ===========================================================================

export type CombineMode =
  | "and" | "or" | "weighted"
  | "fundamental_gated_technical" | "defer_fundamental" | "defer_technical";

export type Agreement = "agree" | "conflict" | "partial" | "single_leg";

export interface EnsemblePolicy {
  combine_mode: CombineMode;
  fundamental_weight: number;
  technical_weight: number;
  resolved_stance: "bullish" | "neutral" | "cautious";
  agreement: Agreement;
  arbitration_thesis: string;
  conflict_resolution: string;
}

export interface SubAgentSummary {
  agent: "fundamental" | "technical";
  available: boolean;
  stance: "bullish" | "neutral" | "cautious" | null;
  entry_signal: string | null;
  exit_signal: string | null;
  thesis: string;
  total_return_pct: number | null;
  excess_vs_market_pct: number | null;
  sharpe: number | null;
  n_trades: number | null;
  note: string;
}

export interface EnsembleResult {
  job_id: string; ticker: string; company_name: string | null;
  common_window_start: string; as_of_date: string;
  fundamental: SubAgentSummary; technical: SubAgentSummary;
  policy: EnsemblePolicy;
  backtest: BacktestResult;
  prices: PricePoint[];
  caveats: string[]; cost_usd: number; created_at: string;
}

export interface Task5Job {
  job_id: string; ticker: string; status: JobStatus;
  result: EnsembleResult | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export async function createEnsemble(ticker: string): Promise<Task5Job> {
  const res = await fetch(`${API_BASE}/task5/ensembles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createEnsemble failed: ${res.status}`);
  }
  return res.json();
}

export async function getEnsemble(jobId: string): Promise<Task5Job> {
  const res = await fetch(`${API_BASE}/task5/ensembles/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getEnsemble failed: ${res.status}`);
  return res.json();
}

export async function pollEnsemble(
  jobId: string,
  onUpdate: (j: Task5Job) => void,
  intervalMs = 1500,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getEnsemble(jobId);
      onUpdate(j);
      if (j.status === "succeeded" || j.status === "failed") return;
    } catch (e) {
      console.error(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

// ===========================================================================
// Task 6 — insider (SEC Form 4) agent
// Reuses the BacktestResult / PricePoint shapes above.
// ===========================================================================

export interface InsiderSpec {
  entry_signal: "buy_and_hold" | "any_insider_buy" | "cluster_buy" | "net_value_buy";
  exit_signal: "hold" | "time_exit" | "net_sell";
  stance: "bullish" | "neutral" | "cautious";
  lookback_days: number; min_distinct_buyers: number; min_net_value_usd: number;
  holding_days: number; stop_loss_pct: number; take_profit_pct: number;
  thesis: string; rationale_entry: string; rationale_exit: string;
}

export interface InsiderResult {
  job_id: string; ticker: string; company_name: string | null; cik: number | null;
  as_of_date: string;
  n_form4_filings: number; n_transactions: number; fetch_capped: boolean;
  prices: PricePoint[]; strategy: InsiderSpec; backtest: BacktestResult;
  insider_readings: Record<string, number | string>;
  caveats: string[]; cost_usd: number; created_at: string;
}

export interface Task6Job {
  job_id: string; ticker: string; status: JobStatus;
  result: InsiderResult | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export async function createInsider(ticker: string): Promise<Task6Job> {
  const res = await fetch(`${API_BASE}/task6/insiders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createInsider failed: ${res.status}`);
  }
  return res.json();
}

export async function getInsider(jobId: string): Promise<Task6Job> {
  const res = await fetch(`${API_BASE}/task6/insiders/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getInsider failed: ${res.status}`);
  return res.json();
}

export async function pollInsider(
  jobId: string,
  onUpdate: (j: Task6Job) => void,
  intervalMs = 1500,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getInsider(jobId);
      onUpdate(j);
      if (j.status === "succeeded" || j.status === "failed") return;
    } catch (e) {
      console.error(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

// ===========================================================================
// Task 7 — peer/sector relative-strength agent
// Reuses the BacktestResult / PricePoint shapes above.
// ===========================================================================

export interface RelativeSpec {
  entry_signal: "buy_and_hold" | "rs_uptrend" | "rs_breakout" | "rs_momentum";
  exit_signal: "hold" | "rs_downtrend" | "time_exit";
  stance: "bullish" | "neutral" | "cautious";
  rs_sma: number; rs_high_lookback: number;
  rs_momentum_lookback_days: number; rs_momentum_threshold_pct: number;
  holding_days: number; stop_loss_pct: number; take_profit_pct: number;
  thesis: string; rationale_entry: string; rationale_exit: string;
}

export interface RelativeResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string;
  sector_etf: string; sector_label: string;
  prices: PricePoint[]; strategy: RelativeSpec; backtest: BacktestResult;
  relative_readings: Record<string, number | string>;
  caveats: string[]; cost_usd: number; created_at: string;
}

export interface Task7Job {
  job_id: string; ticker: string; status: JobStatus;
  result: RelativeResult | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export async function createRelative(ticker: string): Promise<Task7Job> {
  const res = await fetch(`${API_BASE}/task7/relatives`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createRelative failed: ${res.status}`);
  }
  return res.json();
}

export async function getRelative(jobId: string): Promise<Task7Job> {
  const res = await fetch(`${API_BASE}/task7/relatives/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getRelative failed: ${res.status}`);
  return res.json();
}

export async function pollRelative(
  jobId: string,
  onUpdate: (j: Task7Job) => void,
  intervalMs = 1500,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getRelative(jobId);
      onUpdate(j);
      if (j.status === "succeeded" || j.status === "failed") return;
    } catch (e) {
      console.error(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

// ===========================================================================
// Task 10 — portfolio / risk & position-sizing agent
// equity_curve reuses the EquityPoint shape (date/strategy/benchmark/market).
// ===========================================================================

export interface PortfolioSpec {
  method: "equal_weight" | "inverse_vol" | "risk_parity" | "signal_proportional";
  max_weight: number; gross_cap: number; target_vol_pct: number;
  rebalance: "weekly" | "monthly" | "quarterly"; vol_lookback_days: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}

export interface Holding {
  ticker: string; available: boolean;
  stance: "bullish" | "neutral" | "cautious" | null;
  entry_signal: string | null; long_as_of: boolean;
  ann_vol_pct: number | null; standalone_return_pct: number | null;
  avg_weight_pct: number; note: string;
}

export interface PortfolioMetrics {
  total_return_pct: number; benchmark_return_pct: number; excess_return_pct: number;
  market_return_pct: number | null; excess_vs_market_pct: number | null;
  cagr_pct: number; sharpe: number; max_drawdown_pct: number;
  ann_vol_pct: number; target_vol_pct: number;
  avg_n_holdings: number; avg_gross_exposure_pct: number;
  n_rebalances: number; turnover_annual_pct: number;
  days: number; transaction_cost_bps: number;
}

export interface PortfolioResult {
  job_id: string; tickers: string[]; signal_source: string;
  as_of_date: string; common_window_start: string;
  spec: PortfolioSpec; holdings: Holding[]; metrics: PortfolioMetrics;
  equity_curve: EquityPoint[];
  universe_readings: Record<string, number | string>;
  caveats: string[]; cost_usd: number; created_at: string;
}

export interface Task10Job {
  job_id: string; tickers: string[]; status: JobStatus;
  result: PortfolioResult | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export async function createPortfolio(tickers: string): Promise<Task10Job> {
  const res = await fetch(`${API_BASE}/task10/portfolios`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createPortfolio failed: ${res.status}`);
  }
  return res.json();
}

export async function getPortfolio(jobId: string): Promise<Task10Job> {
  const res = await fetch(`${API_BASE}/task10/portfolios/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getPortfolio failed: ${res.status}`);
  return res.json();
}

export async function pollPortfolio(
  jobId: string,
  onUpdate: (j: Task10Job) => void,
  intervalMs = 2000,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getPortfolio(jobId);
      onUpdate(j);
      if (j.status === "succeeded" || j.status === "failed") return;
    } catch (e) {
      console.error(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

// ---- Task 21: cross-sectional ranker (reuses PortfolioMetrics + EquityPoint) ----
export interface RankSpec {
  factor: "momentum_12_1" | "low_volatility" | "near_52w_high" | "short_term_reversal";
  top_n: number; weight_method: "equal_weight" | "inverse_vol";
  rebalance: "weekly" | "monthly" | "quarterly"; lookback_days: number; max_weight: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface RankHolding {
  ticker: string; available: boolean; factor_value: number | null; rank: number | null;
  selected_now: boolean; avg_weight_pct: number; standalone_return_pct: number | null; note: string;
}
export interface RankResult {
  job_id: string; tickers: string[]; as_of_date: string; common_window_start: string;
  spec: RankSpec; holdings: RankHolding[]; metrics: PortfolioMetrics; equity_curve: EquityPoint[];
  universe_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task21Job { job_id: string; tickers: string[]; status: JobStatus; result: RankResult | null; error_message: string | null; created_at: string; updated_at: string; }

export async function createRanking(tickers: string): Promise<Task21Job> {
  const res = await fetch(`${API_BASE}/task21/rankings`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createRanking failed: ${res.status}`);
  }
  return res.json();
}
export async function getRanking(jobId: string): Promise<Task21Job> {
  const res = await fetch(`${API_BASE}/task21/rankings/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getRanking failed: ${res.status}`);
  return res.json();
}
export const pollRanking = _poll<Task21Job>(getRanking);

// ===========================================================================
// Task 8 — earnings-release (SEC 8-K Ex-99.1) agent
// Reuses the BacktestResult / PricePoint shapes above.
// ===========================================================================

export interface EarningsEvent {
  filing_date: string;
  sentiment: "bullish" | "neutral" | "bearish";
  guidance: "raised" | "maintained" | "lowered" | "none";
  beat_miss: "beat" | "inline" | "miss" | "unknown";
  quote: string;
}

export interface EarningsSpec {
  entry_signal: "any_earnings" | "bullish" | "bullish_or_raised" | "beat";
  exit_signal: "time_exit" | "next_earnings";
  holding_days: number; stop_loss_pct: number; take_profit_pct: number;
  stance: "bullish" | "neutral" | "cautious";
  thesis: string; rationale_entry: string; rationale_exit: string;
}

export interface EarningsResult {
  job_id: string; ticker: string; company_name: string | null; cik: number | null;
  as_of_date: string; n_releases: number; events: EarningsEvent[]; source: string;
  prices: PricePoint[]; strategy: EarningsSpec; backtest: BacktestResult;
  earnings_readings: Record<string, number | string>;
  caveats: string[]; cost_usd: number; created_at: string;
}

export interface Task8Job {
  job_id: string; ticker: string; status: JobStatus;
  result: EarningsResult | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export async function createEarnings(ticker: string): Promise<Task8Job> {
  const res = await fetch(`${API_BASE}/task8/earnings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createEarnings failed: ${res.status}`);
  }
  return res.json();
}

export async function getEarnings(jobId: string): Promise<Task8Job> {
  const res = await fetch(`${API_BASE}/task8/earnings/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getEarnings failed: ${res.status}`);
  return res.json();
}

export async function pollEarnings(
  jobId: string,
  onUpdate: (j: Task8Job) => void,
  intervalMs = 1500,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getEarnings(jobId);
      onUpdate(j);
      if (j.status === "succeeded" || j.status === "failed") return;
    } catch (e) {
      console.error(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

// ===========================================================================
// Task 9 — institutional / 13F superinvestor-tracking agent
// Reuses the BacktestResult / PricePoint shapes above.
// ===========================================================================

export interface FundSummary {
  fund_name: string;
  latest_shares: number;
  latest_filing_date: string | null;
  change: "new" | "added" | "trimmed" | "held" | "exited" | "absent";
}

export interface InstitutionalSpec {
  entry_signal: "any_holding" | "accumulating" | "new_buying";
  exit_signal: "hold" | "distributing" | "time_exit";
  accumulation_lookback_days: number; holding_days: number;
  stop_loss_pct: number; take_profit_pct: number;
  stance: "bullish" | "neutral" | "cautious";
  thesis: string; rationale_entry: string; rationale_exit: string;
}

export interface InstitutionalResult {
  job_id: string; ticker: string; company_name: string | null; cik: number | null;
  as_of_date: string; n_funds_tracked: number; n_funds_holding: number;
  funds: FundSummary[];
  prices: PricePoint[]; strategy: InstitutionalSpec; backtest: BacktestResult;
  institutional_readings: Record<string, number | string>;
  caveats: string[]; cost_usd: number; created_at: string;
}

export interface Task9Job {
  job_id: string; ticker: string; status: JobStatus;
  result: InstitutionalResult | null; error_message: string | null;
  created_at: string; updated_at: string;
}

export async function createInstitutional(ticker: string): Promise<Task9Job> {
  const res = await fetch(`${API_BASE}/task9/institutional`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createInstitutional failed: ${res.status}`);
  }
  return res.json();
}

export async function getInstitutional(jobId: string): Promise<Task9Job> {
  const res = await fetch(`${API_BASE}/task9/institutional/${jobId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`getInstitutional failed: ${res.status}`);
  return res.json();
}

export async function pollInstitutional(
  jobId: string,
  onUpdate: (j: Task9Job) => void,
  intervalMs = 2000,
): Promise<() => void> {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const j = await getInstitutional(jobId);
      onUpdate(j);
      if (j.status === "succeeded" || j.status === "failed") return;
    } catch (e) {
      console.error(e);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  };
  tick();
  return () => { stopped = true; };
}

// ===========================================================================
// Task 11 — quantitative fundamentals-trend (XBRL) · Task 12 — seasonality ·
// Task 13 — overnight/gap. All reuse the BacktestResult / PricePoint shapes.
// ===========================================================================

function _poll<J extends { status: JobStatus }>(
  get: (id: string) => Promise<J>,
) {
  return (jobId: string, onUpdate: (j: J) => void, intervalMs = 1500): Promise<() => void> => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const j = await get(jobId);
        onUpdate(j);
        if (j.status === "succeeded" || j.status === "failed") return;
      } catch (e) { console.error(e); }
      if (!stopped) setTimeout(tick, intervalMs);
    };
    tick();
    return Promise.resolve(() => { stopped = true; });
  };
}

async function _create(path: string, ticker: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail
        : Array.isArray(body?.detail) ? body.detail.map((d: { msg?: string }) => d.msg).join("; ") : "";
    } catch { /* not json */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `request failed: ${res.status}`);
  }
  return res.json();
}

async function _get(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`request failed: ${res.status}`);
  return res.json();
}

// ---- Task 11: fundamentals-trend ----
export interface QuarterPoint {
  end: string; filed: string; fy: number; fp: string;
  revenue: number | null; gross_profit: number | null; net_income: number | null;
}
export interface FundTrendSpec {
  entry_signal: "revenue_growth" | "earnings_growth" | "margin_expansion" | "growth_and_margin" | "any_improving";
  exit_signal: "deteriorating" | "time_exit" | "hold";
  revenue_growth_threshold_pct: number; earnings_growth_threshold_pct: number; holding_days: number;
  stop_loss_pct: number; take_profit_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale_entry: string; rationale_exit: string;
}
export interface FundTrendResult {
  job_id: string; ticker: string; company_name: string | null; cik: number | null; as_of_date: string;
  n_quarters: number; quarters: QuarterPoint[];
  prices: PricePoint[]; strategy: FundTrendSpec; backtest: BacktestResult;
  fundamentals_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task11Job { job_id: string; ticker: string; status: JobStatus; result: FundTrendResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createFundTrend = (t: string): Promise<Task11Job> => _create("/task11/fundamentals-trend", t);
export const getFundTrend = (id: string): Promise<Task11Job> => _get(`/task11/fundamentals-trend/${id}`);
export const pollFundTrend = _poll<Task11Job>(getFundTrend);

// ---- Task 12: seasonality ----
export interface SeasonalSpec {
  entry_signal: "buy_and_hold" | "best_months" | "sell_in_may" | "turn_of_month";
  months: number[]; tom_before: number; tom_after: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface SeasonalResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string;
  prices: PricePoint[]; strategy: SeasonalSpec; backtest: BacktestResult;
  seasonality_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task12Job { job_id: string; ticker: string; status: JobStatus; result: SeasonalResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createSeasonal = (t: string): Promise<Task12Job> => _create("/task12/seasonality", t);
export const getSeasonal = (id: string): Promise<Task12Job> => _get(`/task12/seasonality/${id}`);
export const pollSeasonal = _poll<Task12Job>(getSeasonal);

// ---- Task 13: overnight/gap ----
export interface GapSpec {
  entry_signal: "buy_and_hold" | "overnight" | "intraday" | "overnight_after_up";
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface GapResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string;
  prices: PricePoint[]; strategy: GapSpec; backtest: BacktestResult;
  gap_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task13Job { job_id: string; ticker: string; status: JobStatus; result: GapResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createGap = (t: string): Promise<Task13Job> => _create("/task13/overnight", t);
export const getGap = (id: string): Promise<Task13Job> => _get(`/task13/overnight/${id}`);
export const pollGap = _poll<Task13Job>(getGap);

// ===========================================================================
// Task 14 — volatility regime · Task 15 — buyback · Task 16 — short pressure
// ===========================================================================

export interface VolSpec {
  entry_signal: "buy_and_hold" | "calm_regime" | "trend_and_calm";
  vol_window: number; vol_threshold_pct: number; sma_window: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface VolResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string;
  prices: PricePoint[]; strategy: VolSpec; backtest: BacktestResult;
  volatility_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task14Job { job_id: string; ticker: string; status: JobStatus; result: VolResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createVol = (t: string): Promise<Task14Job> => _create("/task14/volatility", t);
export const getVol = (id: string): Promise<Task14Job> => _get(`/task14/volatility/${id}`);
export const pollVol = _poll<Task14Job>(getVol);

export interface SharePoint { end: string; filed: string; fy: number; fp: string; diluted_shares: number; }
export interface BuybackSpec {
  entry_signal: "buy_and_hold" | "buyback" | "aggressive_buyback";
  exit_signal: "stops_buyback" | "time_exit" | "hold";
  reduction_threshold_pct: number; holding_days: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface BuybackResult {
  job_id: string; ticker: string; company_name: string | null; cik: number | null; as_of_date: string;
  n_quarters: number; shares: SharePoint[]; prices: PricePoint[]; strategy: BuybackSpec; backtest: BacktestResult;
  buyback_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task15Job { job_id: string; ticker: string; status: JobStatus; result: BuybackResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createBuyback = (t: string): Promise<Task15Job> => _create("/task15/buyback", t);
export const getBuyback = (id: string): Promise<Task15Job> => _get(`/task15/buyback/${id}`);
export const pollBuyback = _poll<Task15Job>(getBuyback);

export interface ShortSpec {
  entry_signal: "buy_and_hold" | "squeeze" | "low_short" | "si_squeeze" | "low_si";
  exit_signal: "short_normalizes" | "time_exit" | "hold";
  svr_threshold_pct: number; dtc_threshold: number; sma_window: number; holding_days: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface ShortResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string; n_samples: number;
  prices: PricePoint[]; strategy: ShortSpec; backtest: BacktestResult;
  short_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task16Job { job_id: string; ticker: string; status: JobStatus; result: ShortResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createShort = (t: string): Promise<Task16Job> => _create("/task16/short", t);
export const getShort = (id: string): Promise<Task16Job> => _get(`/task16/short/${id}`);
export const pollShort = _poll<Task16Job>(getShort);

// ---- Task 17: fundamental quality (XBRL: F-Score / accruals / asset-growth) ----
export interface QualitySpec {
  entry_signal: "buy_and_hold" | "f_score" | "low_accruals" | "low_asset_growth" | "composite_quality";
  exit_signal: "deteriorating" | "time_exit" | "hold";
  f_threshold: number; max_accruals_pct: number; max_asset_growth_pct: number;
  holding_days: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface QualityResult {
  job_id: string; ticker: string; company_name: string | null; cik: number | null; as_of_date: string;
  prices: PricePoint[]; strategy: QualitySpec; backtest: BacktestResult;
  quality_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task17Job { job_id: string; ticker: string; status: JobStatus; result: QualityResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createQuality = (t: string): Promise<Task17Job> => _create("/task17/quality", t);
export const getQuality = (id: string): Promise<Task17Job> => _get(`/task17/quality/${id}`);
export const pollQuality = _poll<Task17Job>(getQuality);

// ---- Task 18: corporate events (8-K / 13D) ----
export interface EventRecord { date: string; kind: string; polarity: "positive" | "negative" | "neutral"; note: string; }
export interface EventSpec {
  entry_signal: "buy_and_hold" | "activist_drift" | "avoid_redflags";
  holding_days: number; redflag_window_days: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface EventResult {
  job_id: string; ticker: string; company_name: string | null; cik: number | null; as_of_date: string;
  n_events: number; events: EventRecord[]; prices: PricePoint[]; strategy: EventSpec; backtest: BacktestResult;
  event_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task18Job { job_id: string; ticker: string; status: JobStatus; result: EventResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createEvents = (t: string): Promise<Task18Job> => _create("/task18/events", t);
export const getEvents = (id: string): Promise<Task18Job> => _get(`/task18/events/${id}`);
export const pollEvents = _poll<Task18Job>(getEvents);

// ---- Task 19: price anomalies (52w-high / MAX / tax-loss) ----
export interface AnomalySpec {
  entry_signal: "buy_and_hold" | "near_52w_high" | "avoid_max_lottery" | "tax_loss_reversal";
  high_threshold_pct: number; max_daily_threshold_pct: number; max_window_days: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface AnomalyResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string;
  prices: PricePoint[]; strategy: AnomalySpec; backtest: BacktestResult;
  anomaly_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task19Job { job_id: string; ticker: string; status: JobStatus; result: AnomalyResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createAnomaly = (t: string): Promise<Task19Job> => _create("/task19/anomaly", t);
export const getAnomaly = (id: string): Promise<Task19Job> => _get(`/task19/anomaly/${id}`);
export const pollAnomaly = _poll<Task19Job>(getAnomaly);

// ---- Task 20: VIX regime gate (^VIX term structure / level) ----
export interface VixSpec {
  entry_signal: "buy_and_hold" | "vix_term_gate" | "vix_level_gate";
  term_threshold: number; level_threshold: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface VixResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string;
  prices: PricePoint[]; strategy: VixSpec; backtest: BacktestResult;
  vix_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task20Job { job_id: string; ticker: string; status: JobStatus; result: VixResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createVix = (t: string): Promise<Task20Job> => _create("/task20/vix", t);
export const getVix = (id: string): Promise<Task20Job> => _get(`/task20/vix/${id}`);
export const pollVix = _poll<Task20Job>(getVix);

// ---- Task 22: congressional trading (pluggable provider) ----
export interface CongressTrade {
  disclosure_date: string; transaction_date: string | null; member: string;
  chamber: "house" | "senate" | "unknown"; txn_type: "buy" | "sell" | "exchange";
  amount_low: number; amount_high: number; note: string;
}
export interface CongressSpec {
  entry_signal: "buy_and_hold" | "follow_buys" | "avoid_after_sells";
  holding_days: number; sell_window_days: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface CongressResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string;
  provider: string; n_trades: number; trades_recent: CongressTrade[];
  prices: PricePoint[]; strategy: CongressSpec; backtest: BacktestResult;
  congress_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task22Job { job_id: string; ticker: string; status: JobStatus; result: CongressResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createCongress = (t: string): Promise<Task22Job> => _create("/task22/congress", t);
export const getCongress = (id: string): Promise<Task22Job> => _get(`/task22/congress/${id}`);
export const pollCongress = _poll<Task22Job>(getCongress);

// ---- Task 23: pairs trading (long-short; reuses BacktestMetrics + EquityPoint) ----
export interface PairSpec {
  formation_window: number; z_entry: number; z_exit: number; stop_z: number; max_holding_days: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface PairResult {
  job_id: string; ticker_a: string; ticker_b: string; as_of_date: string; common_window_start: string;
  spec: PairSpec; metrics: BacktestMetrics; equity_curve: EquityPoint[]; trades: Trade[];
  pair_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task23Job { job_id: string; tickers: string[]; status: JobStatus; result: PairResult | null; error_message: string | null; created_at: string; updated_at: string; }
export async function createPairs(tickers: string): Promise<Task23Job> {
  const res = await fetch(`${API_BASE}/task23/pairs`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers }) });
  if (!res.ok) {
    let detail = ""; try { const b = await res.json(); detail = typeof b?.detail === "string" ? b.detail : ""; } catch { /* */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createPairs failed: ${res.status}`);
  }
  return res.json();
}
export const getPairs = (id: string): Promise<Task23Job> => _get(`/task23/pairs/${id}`);
export const pollPairs = _poll<Task23Job>(getPairs);

// ---- Task 24: earnings contagion (bellwether → peer; reuses EarningsEvent) ----
export interface ContagionSpec {
  entry_signal: "buy_and_hold" | "follow_positive" | "avoid_after_negative";
  drift_days: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface ContagionResult {
  job_id: string; bellwether: string; peer: string; company_name: string | null; as_of_date: string;
  n_events: number; events: EarningsEvent[]; prices: PricePoint[]; strategy: ContagionSpec; backtest: BacktestResult;
  contagion_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task24Job { job_id: string; tickers: string[]; status: JobStatus; result: ContagionResult | null; error_message: string | null; created_at: string; updated_at: string; }
export async function createContagion(tickers: string): Promise<Task24Job> {
  const res = await fetch(`${API_BASE}/task24/contagion`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tickers }) });
  if (!res.ok) {
    let detail = ""; try { const b = await res.json(); detail = typeof b?.detail === "string" ? b.detail : ""; } catch { /* */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `createContagion failed: ${res.status}`);
  }
  return res.json();
}
export const getContagion = (id: string): Promise<Task24Job> => _get(`/task24/contagion/${id}`);
export const pollContagion = _poll<Task24Job>(getContagion);

// ---- Task 25: financial astrology (CONTROL / PLACEBO) ----
export interface PlanetPosition { body: string; ecliptic_lon: number; sign: string; retrograde: boolean; }
export interface AstroSpec {
  entry_signal: "buy_and_hold" | "avoid_mercury_retrograde" | "moon_phase_long" | "benefic_aspect";
  aspect_orb_deg: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface AstroResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean;
  chart: PlanetPosition[]; aspects: string[]; reasoning_chain: string[];
  prices: PricePoint[]; strategy: AstroSpec; backtest: BacktestResult;
  astro_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task25Job { job_id: string; ticker: string; status: JobStatus; result: AstroResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createAstro = (t: string): Promise<Task25Job> => _create("/task25/astro", t);
export const getAstro = (id: string): Promise<Task25Job> => _get(`/task25/astro/${id}`);
export const pollAstro = _poll<Task25Job>(getAstro);

// ---- Task 26: 梅花易數 Plum-Blossom I Ching (CONTROL / PLACEBO) ----
export interface HexagramChart {
  upper: string; lower: string; moving_line: number; line_diagram: string[];
  ben_gua: string; hu_gua: string; bian_gua: string; ti: string; yong: string;
  ti_wuxing: string; yong_wuxing: string; relation: string; verdict: string; auspicious: boolean;
}
export interface MeihuaSpec {
  entry_signal: "buy_and_hold" | "ti_yong_auspicious" | "yang_ti";
  seed: number; stop_loss_pct: number;
  stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface MeihuaResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean;
  hexagram: HexagramChart; reasoning_chain: string[];
  prices: PricePoint[]; strategy: MeihuaSpec; backtest: BacktestResult;
  meihua_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task26Job { job_id: string; ticker: string; status: JobStatus; result: MeihuaResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createMeihua = (t: string): Promise<Task26Job> => _create("/task26/meihua", t);
export const getMeihua = (id: string): Promise<Task26Job> => _get(`/task26/meihua/${id}`);
export const pollMeihua = _poll<Task26Job>(getMeihua);

// ---- Task 27: 八字 Four Pillars (CONTROL / PLACEBO) ----
export interface Pillar {
  role: string; gz: string; stem: string; branch: string; stem_elem: string; branch_elem: string; zodiac: string;
}
export interface BaziChart {
  listing_date: string; listing_date_is_data_limit: boolean; pillars: Pillar[];
  day_master: string; dm_elem: string; strength_label: string; favourable: string[]; element_counts: Record<string, number>;
}
export interface BaziSpec {
  entry_signal: "buy_and_hold" | "favorable_year" | "favorable_month";
  stop_loss_pct: number; stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface BaziResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean;
  chart: BaziChart; reasoning_chain: string[];
  prices: PricePoint[]; strategy: BaziSpec; backtest: BacktestResult;
  bazi_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task27Job { job_id: string; ticker: string; status: JobStatus; result: BaziResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createBazi = (t: string): Promise<Task27Job> => _create("/task27/bazi", t);
export const getBazi = (id: string): Promise<Task27Job> => _get(`/task27/bazi/${id}`);
export const pollBazi = _poll<Task27Job>(getBazi);

// ---- Task 28: 紫微斗數 (四化飛星) (CONTROL / PLACEBO) ----
export interface ZiweiPalace {
  name: string; branch: string; is_body: boolean; stars: string[];
}
export interface ZiweiChart {
  listing_date: string; listing_date_is_data_limit: boolean;
  soul_star: string; body_star: string; five_elements_class: string;
  palaces: ZiweiPalace[]; liunian_stem: string; liunian_sihua: string;
  sihua_landing: Record<string, string>; target_palaces: string[];
}
export interface ZiweiSpec {
  entry_signal: "buy_and_hold" | "sihua_year" | "sihua_month";
  stop_loss_pct: number; stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface ZiweiResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean;
  chart: ZiweiChart; reasoning_chain: string[];
  prices: PricePoint[]; strategy: ZiweiSpec; backtest: BacktestResult;
  ziwei_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task28Job { job_id: string; ticker: string; status: JobStatus; result: ZiweiResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createZiwei = (t: string): Promise<Task28Job> => _create("/task28/ziwei", t);
export const getZiwei = (id: string): Promise<Task28Job> => _get(`/task28/ziwei/${id}`);
export const pollZiwei = _poll<Task28Job>(getZiwei);

// ---- Task 29: 四柱推命 Japanese Four Pillars (CONTROL / PLACEBO) ----
export interface SuimeiPillar {
  role: string; gz: string; stem: string; branch: string; twelve_fortune: string; hidden: string[];
}
export interface SuimeiChart {
  listing_date: string; listing_date_is_data_limit: boolean;
  day_master: string; day_master_elem: string; tenchusatsu: string; pillars: SuimeiPillar[];
  liunian_branch: string; liunian_fortune: string; liunian_in_tenchusatsu: boolean;
}
export interface SuimeiSpec {
  entry_signal: "buy_and_hold" | "twelve_fortune" | "avoid_tenchusatsu";
  stop_loss_pct: number; stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface SuimeiResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean;
  chart: SuimeiChart; reasoning_chain: string[];
  prices: PricePoint[]; strategy: SuimeiSpec; backtest: BacktestResult;
  suimei_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task29Job { job_id: string; ticker: string; status: JobStatus; result: SuimeiResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createSuimei = (t: string): Promise<Task29Job> => _create("/task29/suimei", t);
export const getSuimei = (id: string): Promise<Task29Job> => _get(`/task29/suimei/${id}`);
export const pollSuimei = _poll<Task29Job>(getSuimei);

// ---- Task 30: 七政四餘 Chinese horoscopic astrology (CONTROL / PLACEBO) ----
export interface QizhengStar { name: string; ecliptic_lon: number; sign: string; }
export interface QizhengChart {
  listing_date: string; listing_date_is_data_limit: boolean; ming_zhu_sign: string;
  seven: QizhengStar[]; siyu: QizhengStar[]; jupiter_sign: string; mars_sign: string; rahu_sign: string;
}
export interface QizhengSpec {
  entry_signal: "buy_and_hold" | "benefic_transit" | "avoid_malefic";
  stop_loss_pct: number; stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface QizhengResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean;
  chart: QizhengChart; reasoning_chain: string[];
  prices: PricePoint[]; strategy: QizhengSpec; backtest: BacktestResult;
  qizheng_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task30Job { job_id: string; ticker: string; status: JobStatus; result: QizhengResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createQizheng = (t: string): Promise<Task30Job> => _create("/task30/qizheng", t);
export const getQizheng = (id: string): Promise<Task30Job> => _get(`/task30/qizheng/${id}`);
export const pollQizheng = _poll<Task30Job>(getQizheng);

// ---- Task 31: 鐵板神數 Iron-Plate Numerology (CONTROL / PLACEBO) ----
export interface TiebanPillar { role: string; gz: string; taixuan: number; }
export interface TiebanChart {
  listing_date: string; listing_date_is_data_limit: boolean; pillars: TiebanPillar[];
  ming_number: number; liunian_verse_no: number; liunian_verdict: string; liunian_gua: string;
}
export interface TiebanSpec {
  entry_signal: "buy_and_hold" | "verse_fortune" | "avoid_inauspicious";
  stop_loss_pct: number; stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string;
}
export interface TiebanResult {
  job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean;
  chart: TiebanChart; reasoning_chain: string[];
  prices: PricePoint[]; strategy: TiebanSpec; backtest: BacktestResult;
  tieban_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string;
}
export interface Task31Job { job_id: string; ticker: string; status: JobStatus; result: TiebanResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createTieban = (t: string): Promise<Task31Job> => _create("/task31/tieban", t);
export const getTieban = (id: string): Promise<Task31Job> => _get(`/task31/tieban/${id}`);
export const pollTieban = _poll<Task31Job>(getTieban);

// ---- Task 32: 奇門遁甲 (CONTROL / PLACEBO) ----
export interface GatePalace { palace: string; gate: string; cls: string; }
export interface QimenChart { listing_date: string; listing_date_is_data_limit: boolean; dun: string; ju: string; active_gate: string; gate_class: string; layout: GatePalace[]; }
export interface QimenSpec { entry_signal: "buy_and_hold" | "auspicious_gate" | "avoid_ill_gate"; stop_loss_pct: number; stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string; }
export interface QimenResult { job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean; chart: QimenChart; reasoning_chain: string[]; prices: PricePoint[]; strategy: QimenSpec; backtest: BacktestResult; qimen_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string; }
export interface Task32Job { job_id: string; ticker: string; status: JobStatus; result: QimenResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createQimen = (t: string): Promise<Task32Job> => _create("/task32/qimen", t);
export const getQimen = (id: string): Promise<Task32Job> => _get(`/task32/qimen/${id}`);
export const pollQimen = _poll<Task32Job>(getQimen);

// ---- Task 33: 大六壬 (CONTROL / PLACEBO) ----
export interface LiurenChart { listing_date: string; listing_date_is_data_limit: boolean; day_master: string; yue_jiang: string; occupy_hour: string; yong_branch: string; relation: string; }
export interface LiurenSpec { entry_signal: "buy_and_hold" | "yong_supports" | "avoid_ke"; stop_loss_pct: number; stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string; }
export interface LiurenResult { job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean; chart: LiurenChart; reasoning_chain: string[]; prices: PricePoint[]; strategy: LiurenSpec; backtest: BacktestResult; liuren_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string; }
export interface Task33Job { job_id: string; ticker: string; status: JobStatus; result: LiurenResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createLiuren = (t: string): Promise<Task33Job> => _create("/task33/liuren", t);
export const getLiuren = (id: string): Promise<Task33Job> => _get(`/task33/liuren/${id}`);
export const pollLiuren = _poll<Task33Job>(getLiuren);

// ---- Task 34: 太乙神數 (CONTROL / PLACEBO) ----
export interface TaiyiChart { listing_date: string; listing_date_is_data_limit: boolean; accumulated_years: number; taiyi_palace: string; host_count: number; guest_count: number; verdict: string; }
export interface TaiyiSpec { entry_signal: "buy_and_hold" | "host_prevails" | "avoid_guest_win"; stop_loss_pct: number; stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string; }
export interface TaiyiResult { job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean; chart: TaiyiChart; reasoning_chain: string[]; prices: PricePoint[]; strategy: TaiyiSpec; backtest: BacktestResult; taiyi_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string; }
export interface Task34Job { job_id: string; ticker: string; status: JobStatus; result: TaiyiResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createTaiyi = (t: string): Promise<Task34Job> => _create("/task34/taiyi", t);
export const getTaiyi = (id: string): Promise<Task34Job> => _get(`/task34/taiyi/${id}`);
export const pollTaiyi = _poll<Task34Job>(getTaiyi);

// ---- Task 35: Jyotiṣa Vedic astrology (CONTROL / PLACEBO) ----
export interface Graha { name: string; sidereal_lon: number; rashi: string; }
export interface JyotishChart { listing_date: string; listing_date_is_data_limit: boolean; grahas: Graha[]; moon_nakshatra: string; moon_rashi: string; mahadasha_lord: string; dasha_nature: string; ayanamsa_deg: number; }
export interface JyotishSpec { entry_signal: "buy_and_hold" | "benefic_dasha" | "avoid_malefic_dasha"; stop_loss_pct: number; stance: "bullish" | "neutral" | "cautious"; thesis: string; rationale: string; }
export interface JyotishResult { job_id: string; ticker: string; company_name: string | null; as_of_date: string; is_control: boolean; chart: JyotishChart; reasoning_chain: string[]; prices: PricePoint[]; strategy: JyotishSpec; backtest: BacktestResult; jyotish_readings: Record<string, number | string>; caveats: string[]; cost_usd: number; created_at: string; }
export interface Task35Job { job_id: string; ticker: string; status: JobStatus; result: JyotishResult | null; error_message: string | null; created_at: string; updated_at: string; }
export const createJyotish = (t: string): Promise<Task35Job> => _create("/task35/jyotish", t);
export const getJyotish = (id: string): Promise<Task35Job> => _get(`/task35/jyotish/${id}`);
export const pollJyotish = _poll<Task35Job>(getJyotish);

// ---- Scanner (selection + multi-agent collaboration) ----
export interface ScanAgentMeta { key: string; label: string; kind: "real" | "market" | "placebo"; tier: "cleared" | "credible" | "weak" | "na"; dsr: number | null; }
export interface ScanRow { ticker: string; signals: Record<string, boolean | null>; real_bull: number; real_total: number; credible_bull: number; credible_total: number; cleared_bull: number; market_on: boolean | null; stance: string; error?: string | null; }
export interface ScanResult { as_of: string; agents: ScanAgentMeta[]; rows: ScanRow[]; n_tickers: number; n_dsr_cleared: number; }
export interface ScanJob { job_id: string; tickers: string[]; status: JobStatus; result: ScanResult | null; error_message: string | null; created_at: string; updated_at: string; }
export async function createScan(tickers: string[]): Promise<ScanJob> {
  const res = await fetch(`${API_BASE}/scanner/scan`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
  });
  if (!res.ok) {
    let detail = ""; try { const b = await res.json(); detail = typeof b?.detail === "string" ? b.detail : ""; } catch { /* */ }
    throw new Error(detail ? `${res.status} — ${detail}` : `scan failed: ${res.status}`);
  }
  return res.json();
}
export const getScan = (id: string): Promise<ScanJob> => _get(`/scanner/scan/${id}`);
export const pollScan = _poll<ScanJob>(getScan);
