# Agent Guidelines

> Language policy: write all code, comments, commit messages, PRs, and documentation in English.

Keep agent work simple, explicit, and reviewable. These rules bias toward caution over speed; use judgment for tiny tasks.

## Working Style

### Think before coding

- State important assumptions before acting.
- Surface ambiguity, tradeoffs, and simpler alternatives.
- Ask when a guess would be risky or expensive to undo.
- Push back on requests that would add avoidable complexity.

### Prefer simple code

- Write the minimum code that solves the requested problem.
- Avoid speculative features, one-off abstractions, and unused configurability.
- Do not add defensive handling for impossible scenarios.
- If the solution feels larger than the problem, simplify it.

### Make surgical changes

- Touch only the files and lines needed for the request.
- Match existing project style, even when you would personally choose another style.
- Clean up imports, variables, functions, and tests made unused by your own change.
- Mention unrelated dead code or cleanup opportunities instead of fixing them silently.

### Work from verifiable goals

- Convert vague work into concrete success criteria before implementation.
- For bugs, reproduce the failure or identify the expected behavior before fixing.
- For risky changes, state a short plan with the check for each step.
- Run the relevant checks, and report any checks you could not run.

### Keep commits focused

- Commit only after a coherent, verified checkpoint in non-trivial work.
- Check `git status` before committing.
- Include only intentional files, and do not bundle unrelated cleanup or generated noise.
- Use clear English commit messages that explain the change.

## Documentation Maintenance

When behavior, architecture, APIs, workflows, or setup change, update the relevant docs in the same change whenever practical.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `Omnis-Labs/hunch-it`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-label triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo with root `CONTEXT.md` and root `docs/adr/`. See `docs/agents/domain.md`.
