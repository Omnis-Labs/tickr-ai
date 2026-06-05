# AI Coding Test (2026 Update)

## About This Test

This test is not about whether you can produce working code — AI tools have made that relatively easy. What we want to see is how you collaborate with AI to turn one-off prototypes into reliable systems when facing **ambiguous, messy, judgment-requiring** problems.

A few things we care about:

- **Evaluation discipline** — how you know your system is correct
- **Systematic thinking** — decomposing messy real-world data that fails in many ways
- **Engineering tradeoffs** — judgment about cost, latency, and reliability
- **AI collaboration quality** — whether your interaction with AI amplifies your output

## Tasks

Two tasks below. **Complete at least one**; completing both is a significant plus.

- Task 1: Generalized Browser Automation Agent
- Task 2: SEC 10-K Item-level Structured Extraction

## Common Requirements

1. **AI-assisted workflow** — use any AI coding tools you find effective. We care less about the specific tool and more about how you used it to reason, implement, evaluate, and iterate.
2. **Git** — public repo with commit history that reflects your actual development process
3. **Frontend presentation** — every submitted task must be presented through a publicly accessible web frontend. Zeabur ([https://zeabur.com/](https://zeabur.com/)) is one acceptable deployment option, but not required. Do not submit only an API; include a URL where we can operate or inspect the system from the browser.
4. **Prompt records** — keep a `prompts/` folder in the repo root with your key prompts — we will actually read them
5. **README** — how to run, key design decisions, where AI helped you
6. **Analysis report** — include your analysis of runtime performance, cost, scalability, and how you verify correctness
7. Public or self-created material only.

---

## Task 1: Generalized Browser Automation Agent

Build a browser agent that accepts **natural language task descriptions** and reliably executes them across different sites. Beyond basic execution, the agent should demonstrate:

- **Self-correction** — diagnose the cause on failure and try different strategies
- **Self-maintenance** — detect UI or selector changes and adjust locator strategies dynamically

Build your own evaluation set to test reliability (covering diverse domains and task types), and provide a web frontend that accepts tasks, shows execution progress/results, and makes failures inspectable. We will verify with our own unseen tasks.

In your README or frontend, clearly list:

- Which websites are currently supported, and what operations can be performed on each
- Which websites or task types are currently problematic, unreliable, or unsupported, with concrete examples

**What we'll look at**: substance of the self-correction / self-maintenance mechanisms (not just try/except retries), depth of the evaluation set, silent-failure prevention, and your analysis of runtime performance, cost, scalability, and correctness verification.

---

## Task 2: SEC 10-K Item-level Structured Extraction

10-K annual reports filed by U.S. listed companies have an SEC-specified structure (Items 1–16 across Parts I–IV), but actual file formats vary enormously.

Build a pipeline that extracts individual items from a raw 10-K filing so they can be consumed independently. Build your own evaluation set to verify reliability, and provide a web frontend where we can submit or select filings, inspect extracted items, and understand extraction confidence or failure cases. We will verify with our own selected filings.

In your README or frontend, clearly list:

- Filings or companies where you believe the extraction currently works well, with examples
- Filings or companies that are still difficult, unreliable, or unsupported, with concrete failure cases

**What we'll look at**: how you stay robust under format variance, how you verify yourself without public ground truth, edge case handling, cost discipline, and your analysis of runtime performance, scalability, and correctness verification.

---

## How We Evaluate

After submission we run held-out tests against your deployed system using data outside your eval set, read your code, documentation and prompt records, and discuss design decisions with you in the interview.

Roughly three levels:

- **A** — eval design has depth, system shows layered/weighted tradeoffs, performance/cost/scalability analysis is concrete, failure modes honestly surfaced, prompt records show high-quality AI collaboration
- **B** — basic functionality works, but eval and analysis stay on the surface
- **C** — only the happy path works

## Submission

Send: public Git repo URL, frontend URL(s), and any supplementary notes. Good luck.
