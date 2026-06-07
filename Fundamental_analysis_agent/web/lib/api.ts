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
