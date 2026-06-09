'use client';

export type ClientDiagnosticSection = 'auth' | 'proposal' | 'orders' | 'protection' | 'swap';
export type LogSeverity = 'info' | 'success' | 'warning' | 'error';
export type DiagnosticStatus = 'healthy' | 'watch' | 'risk' | 'unknown';

export interface LogDiagnostic {
  hypothesis: string;
  status: DiagnosticStatus;
  detail: string;
}

export interface ClientDiagnosticEvent {
  id: string;
  timestamp: string;
  section: ClientDiagnosticSection;
  step: string;
  summary: string;
  severity: LogSeverity;
  diagnostics: LogDiagnostic[];
  latencyMs: number;
  payload?: unknown;
  response?: unknown;
  error?: string;
  errorDetail?: unknown;
}

export type ClientDiagnosticInput = Omit<ClientDiagnosticEvent, 'id' | 'timestamp'> & {
  id?: string;
  timestamp?: string;
};

export interface DecodedSolanaError {
  code: number | null;
  classifier: string;
  context: Record<string, string>;
}

const EVENT_NAME = 'hunch:dev-diagnostic';
const STORAGE_KEY = 'hunch:dev-diagnostics:v1';
const MAX_EVENTS = 80;
const MAX_STRING_CHARS = 900;
const MAX_ARRAY_ITEMS = 8;
const MAX_OBJECT_KEYS = 36;
const MAX_DEPTH = 5;

let loaded = false;
let buffer: ClientDiagnosticEvent[] = [];

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function requestId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function truncateText(value: string, max = MAX_STRING_CHARS): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}... [truncated ${value.length - max} chars]`;
}

function redactLongField(key: string, value: string): string {
  if (
    !/(^|\.)(transaction|signedTransaction|serializedTransaction|rawTransaction|signature|txSignature|accessToken|authorization|walletAddress|address|privyWalletId|ownerId)$/i.test(
      key,
    )
  ) {
    return truncateText(value);
  }
  if (value.length <= 24) return '[redacted]';
  return `[redacted ${value.length} chars, ${value.slice(0, 8)}...${value.slice(-8)}]`;
}

export function decodeSolanaError(message: string): DecodedSolanaError | null {
  const codeMatch = message.match(/Solana error #(-?\d+)/);
  const commandMatch = message.match(/decode --\s+-?\d+\s+'([^']+)'/);
  const code = codeMatch ? Number(codeMatch[1]) : null;
  if (code == null && !commandMatch) return null;

  const context: Record<string, string> = {};
  if (commandMatch?.[1] && typeof globalThis.atob === 'function') {
    try {
      const params = new URLSearchParams(globalThis.atob(commandMatch[1]));
      for (const [key, value] of params.entries()) context[key] = value;
    } catch {
      context.__decode = 'failed';
    }
  }

  const noProgramLogs = context.logs === '[]';
  const noCompute = context.unitsConsumed === '0n' || context.unitsConsumed === '0';
  const classifier =
    code === -32002 && noProgramLogs && noCompute
      ? 'pre-execution simulation/precheck failure'
      : code === -32002
        ? 'transaction simulation failed'
        : 'solana rpc error';

  return { code, classifier, context };
}

export function compactDiagnosticError(err: unknown): unknown {
  if (err instanceof Error) {
    const record = err as Error & { cause?: unknown } & Record<string, unknown>;
    const ownFields: Record<string, unknown> = {};
    for (const key of Object.keys(record).slice(0, MAX_OBJECT_KEYS)) {
      if (key === 'name' || key === 'message' || key === 'stack' || key === 'cause') continue;
      ownFields[key] = sanitizeDiagnosticValue(record[key], key, 1);
    }
    return {
      name: err.name,
      message: truncateText(err.message),
      decodedSolanaError: decodeSolanaError(err.message),
      ...(record.cause !== undefined
        ? { cause: sanitizeDiagnosticValue(record.cause, 'cause', 1) }
        : {}),
      ...(Object.keys(ownFields).length > 0 ? { fields: ownFields } : {}),
    };
  }
  return sanitizeDiagnosticValue(err);
}

export function sanitizeDiagnosticValue(value: unknown, key = 'value', depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactLongField(key, value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value instanceof Error) return compactDiagnosticError(value);
  if (Array.isArray(value)) {
    const sample = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item, index) => sanitizeDiagnosticValue(item, `${key}[${index}]`, depth + 1));
    if (value.length <= MAX_ARRAY_ITEMS) return sample;
    return { count: value.length, sample, truncated: value.length - MAX_ARRAY_ITEMS };
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '[object depth truncated]';
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const out: Record<string, unknown> = {};
    for (const childKey of keys.slice(0, MAX_OBJECT_KEYS)) {
      out[childKey] = sanitizeDiagnosticValue(record[childKey], childKey, depth + 1);
    }
    if (keys.length > MAX_OBJECT_KEYS) {
      out.__truncatedKeys = keys.length - MAX_OBJECT_KEYS;
    }
    return out;
  }
  return String(value);
}

function readStored(): ClientDiagnosticEvent[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ClientDiagnosticEvent[]) : [];
  } catch {
    return [];
  }
}

function ensureLoaded(): void {
  if (loaded) return;
  buffer = readStored().slice(-MAX_EVENTS);
  loaded = true;
}

function writeStored(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(buffer.slice(-MAX_EVENTS)));
  } catch {
    /* storage may be disabled; live subscribers still receive events */
  }
}

export function emitDevDiagnostic(input: ClientDiagnosticInput): ClientDiagnosticEvent {
  ensureLoaded();
  const entry: ClientDiagnosticEvent = {
    ...input,
    id: input.id ?? requestId(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    latencyMs: input.latencyMs ?? 0,
    diagnostics: input.diagnostics ?? [],
    payload: sanitizeDiagnosticValue(input.payload),
    response: sanitizeDiagnosticValue(input.response),
    error: input.error ? truncateText(input.error) : undefined,
    errorDetail: sanitizeDiagnosticValue(input.errorDetail),
  };

  buffer = [entry, ...buffer.filter((item) => item.id !== entry.id)].slice(0, MAX_EVENTS);
  writeStored();
  if (isBrowser()) {
    window.dispatchEvent(new CustomEvent<ClientDiagnosticEvent>(EVENT_NAME, { detail: entry }));
  }
  return entry;
}

export function getDevDiagnostics(): ClientDiagnosticEvent[] {
  ensureLoaded();
  return buffer.slice();
}

export function subscribeDevDiagnostics(fn: (entry: ClientDiagnosticEvent) => void): () => void {
  if (!isBrowser()) return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ClientDiagnosticEvent>).detail;
    if (detail) fn(detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
