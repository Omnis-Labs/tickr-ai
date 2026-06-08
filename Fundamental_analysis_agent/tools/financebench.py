"""FinanceBench — external public benchmark for financial-document QA.

FinanceBench (Islam et al., 2023; Patronus AI) — 150 open-source questions over real SEC filings,
each with a gold answer + the evidence passage. We run two settings:

  • oracle   — feed the gold evidence passage, ask the model to answer. Isolates financial-QA
               *reasoning* from retrieval. Complete (150/150), cheap, reliable.
  • openbook — download the filing PDF, lexically retrieve the top chunks for the question, then
               answer. The harder full-pipeline number (retrieve + reason); coverage depends on
               live doc links.

Answering and grading both go through the suite's LLMGateway (cost-ledgered, Tier.CHEAP = the same
cheap model the agents use). Grading is an LLM judge with numeric/unit tolerance — the standard
FinanceBench protocol.

    python tools/financebench.py --mode oracle
    python tools/financebench.py --mode openbook --limit 60
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import re
import urllib.request
from pathlib import Path

from shared.cost_ledger import init_db
from shared.llm_gateway import LLMGateway, LLMRequest, Tier

_ROOT = Path(__file__).resolve().parents[1]
_CACHE = _ROOT / "tools" / ".cache" / "financebench"     # not committed (large PDFs)
_OUT = _ROOT / "shared" / "reports" / "financebench.json"
_BASE = "https://raw.githubusercontent.com/patronus-ai/financebench/main/data/"
_STOP = set("the a an of to in for and or is are was were be been on at as by with from that this it its "
            "what how much many does did do new total fy year ended their company".split())
_SEM = asyncio.Semaphore(8)


def _http(url: str, binary: bool = False, timeout: int = 30):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    data = urllib.request.urlopen(req, timeout=timeout).read()
    return data if binary else data.decode("utf-8")


def load_dataset():
    _CACHE.mkdir(parents=True, exist_ok=True)
    qf, df = _CACHE / "questions.jsonl", _CACHE / "docs.jsonl"
    if not qf.exists():
        qf.write_text(_http(_BASE + "financebench_open_source.jsonl"))
    if not df.exists():
        df.write_text(_http(_BASE + "financebench_document_information.jsonl"))
    qs = [json.loads(l) for l in qf.read_text().splitlines() if l.strip()]
    docs = {json.loads(l)["doc_name"]: json.loads(l) for l in df.read_text().splitlines() if l.strip()}
    return qs, docs


def _pdf_text(doc_name: str, link: str) -> str | None:
    cache = _CACHE / f"{doc_name}.txt"
    if cache.exists():
        return cache.read_text(errors="ignore")
    try:
        raw = _http(link, binary=True, timeout=18)
        if raw[:5].lstrip()[:4] != b"%PDF":        # HTML landing page / redirect, not a PDF — skip fast
            return None
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(raw))
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
        if len(text) < 500:
            return None
        cache.write_text(text)
        return text
    except Exception:  # noqa: BLE001
        return None


def _retrieve(text: str, question: str, k: int = 5, chunk: int = 2600) -> str:
    terms = [t for t in re.findall(r"[a-zA-Z]{3,}", question.lower()) if t not in _STOP]
    nums = re.findall(r"\b(?:19|20)\d{2}\b", question)
    chunks = [text[i:i + chunk] for i in range(0, len(text), chunk)]
    scored = []
    for c in chunks:
        cl = c.lower()
        score = sum(cl.count(t) for t in terms) + 3 * sum(c.count(n) for n in nums)
        scored.append((score, c))
    scored.sort(key=lambda x: -x[0])
    return "\n---\n".join(c for s, c in scored[:k] if s > 0) or text[:chunk * k]


async def _answer(question: str, context: str, trace: str) -> str:
    async with _SEM:
        r = await LLMGateway.instance().call(LLMRequest(
            trace_id=trace, purpose="financebench.answer", tier=Tier.CHEAP,
            system=("You are a financial analyst. Answer the question using ONLY the provided filing "
                    "excerpts. Be concise: give the figure (with units/currency) or the direct fact. "
                    "If the excerpts do not contain it, say 'not found'. Reply as JSON {\"answer\": \"...\"}."),
            messages=[{"role": "user", "content": f"Excerpts:\n{context[:14000]}\n\nQuestion: {question}"}],
            max_tokens=300, temperature=0.0, response_format="json"))
    return (r.parsed_json or {}).get("answer", "") if r.parsed_json else (r.content or "")


async def _judge(question: str, gold: str, pred: str, trace: str) -> bool:
    async with _SEM:
        r = await LLMGateway.instance().call(LLMRequest(
            trace_id=trace, purpose="financebench.judge", tier=Tier.CHEAP,
            system=("You grade a predicted answer against the gold answer to a finance question. "
                    "Mark correct if they agree in substance: allow rounding, unit/scale equivalence "
                    "($M vs millions), and paraphrase. Mark incorrect if the number or fact differs or "
                    "the prediction is 'not found'. Reply with ONLY a JSON object: {\"correct\": true} "
                    "or {\"correct\": false}."),
            messages=[{"role": "user", "content": f"Question: {question}\nGold: {gold}\nPredicted: {pred}"}],
            max_tokens=60, temperature=0.0, response_format="json"))
    if r.parsed_json is not None:
        return bool(r.parsed_json.get("correct", False))
    m = re.search(r'"?correct"?\s*[:=]\s*(true|false)', (r.content or ""), re.I)   # fallback parse
    return bool(m and m.group(1).lower() == "true")


async def _grade_one(q, docs, mode):
    qid = q["financebench_id"]
    if mode == "oracle":
        ev = q.get("evidence") or []
        context = "\n---\n".join(e.get("evidence_text", "") for e in ev) if isinstance(ev, list) else str(ev)
        if not context.strip():
            return None
    else:
        link = docs.get(q["doc_name"], {}).get("doc_link")
        if not link:
            return None
        text = await asyncio.to_thread(_pdf_text, q["doc_name"], link)
        if not text:
            return {"id": qid, "type": q["question_type"], "covered": False, "correct": False}
        context = _retrieve(text, q["question"])
    pred = await _answer(q["question"], context, f"fb-{qid}")
    ok = await _judge(q["question"], str(q["answer"]), pred, f"fb-{qid}")
    return {"id": qid, "type": q["question_type"], "covered": True, "correct": ok}


async def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["oracle", "openbook"], default="oracle")
    ap.add_argument("--limit", type=int, default=0, help="cap #questions (0 = all 150)")
    ap.add_argument("--output", default=str(_OUT))
    args = ap.parse_args(argv)
    await init_db()
    qs, docs = load_dataset()
    if args.limit:
        qs = qs[:args.limit]

    results = [r for r in await asyncio.gather(*[_grade_one(q, docs, args.mode) for q in qs]) if r]
    covered = [r for r in results if r["covered"]]
    n_corr = sum(1 for r in covered if r["correct"])
    by_type = {}
    for t in ("metrics-generated", "domain-relevant", "novel-generated"):
        sub = [r for r in covered if r["type"] == t]
        by_type[t] = {"n": len(sub), "accuracy": round(sum(r["correct"] for r in sub) / len(sub), 3) if sub else None}

    out = {
        "benchmark": "FinanceBench (Patronus AI, 2023) — 150 open-source questions",
        "mode": args.mode,
        "judge_model": "Tier.CHEAP (suite gateway)",
        "n_questions": len(qs), "n_covered": len(covered),
        "coverage": round(len(covered) / len(qs), 3) if qs else 0,
        "accuracy": round(n_corr / len(covered), 3) if covered else None,
        "accuracy_by_type": by_type,
        "note": ("oracle = gold evidence passage supplied (isolates QA reasoning). "
                 "openbook = download filing + lexical retrieval (retrieve + reason; coverage = live links)."),
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"FinanceBench [{args.mode}] — {len(covered)}/{len(qs)} covered, accuracy {out['accuracy']}")
    for t, v in by_type.items():
        print(f"  {t:20} n={v['n']:<4} acc={v['accuracy']}")
    print(f"  written: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
