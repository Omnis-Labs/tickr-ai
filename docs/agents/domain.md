# Domain Docs

How engineering skills should consume this repo's domain documentation before changing code.

## Layout

This is a single-context repo.

- Read `CONTEXT.md` at the repo root for domain vocabulary.
- Read relevant ADRs under `docs/adr/` before changing architecture or behavior in an area covered by a decision.

## Current ADRs

- `docs/adr/0001-frozen-synthetic-trigger-architecture.md`
- `docs/adr/0002-canonical-asset-signal-data.md`
- `docs/adr/0003-opt-in-delegated-execution.md`

## Consumer rules

- Use the domain terms from `CONTEXT.md` in issue titles, implementation notes, test names, and refactor proposals.
- If a needed concept is missing from `CONTEXT.md`, note the gap instead of inventing parallel vocabulary.
- If proposed work conflicts with an ADR, call out the conflict explicitly before proceeding.
- If `CONTEXT.md` or `docs/adr/` is missing in a future branch, proceed silently unless the task is specifically about domain docs.
