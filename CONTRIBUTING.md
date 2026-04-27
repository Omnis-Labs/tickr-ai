# Contributing to Hunch It

Thanks for your interest in Hunch It. The project is still early, so the contribution process is intentionally simple: make focused changes, keep the product easy to understand, and update docs when behavior changes.

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- Git

## Setup

```bash
git clone https://github.com/Omnis-Labs/hunch-it.git
cd hunch-it
pnpm install
cp .env.example .env
```

For a quick local run, enable demo mode in `.env`:

```bash
DEMO_MODE=true
NEXT_PUBLIC_DEMO_MODE=true
```

Then:

```bash
cp .env apps/web/.env.local
cp .env apps/ws-server/.env
pnpm db:generate
pnpm dev
```

See [docs/getting-started.md](docs/getting-started.md) for live setup.

## How to Help

Useful contributions right now are usually small and concrete:

- Clarify product copy or documentation
- Improve mandate setup, proposal review, portfolio, or position flows
- Fix bugs in order state handling, realtime updates, or local setup
- Add or refine supported asset metadata in the shared asset registry
- Improve error messages so users understand what happened and what to do next

## Development Basics

1. Create a branch from `main`.
2. Make a focused change.
3. Run the relevant checks before sharing it:
   ```bash
   pnpm typecheck
   pnpm build
   ```
4. Update docs if setup, product behavior, API contracts, or user-facing flows changed.

## Code Style

- Use English for code, comments, commit messages, and docs.
- Keep TypeScript strict. Do not use `as any`, `@ts-ignore`, or `@ts-expect-error`.
- Prefer existing workspace patterns before introducing new dependencies.
- Use Zod for external data validation.
- Keep user-facing copy direct and practical; avoid exaggerated claims.

## Documentation Style

Docs should help a new user understand three things quickly:

1. What Hunch does.
2. How to run it locally.
3. How the mandate → proposal → order → position loop works.

When updating docs, prefer simple sections, short tables, and links to the deeper reference files in `/docs`.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0](LICENSE).
