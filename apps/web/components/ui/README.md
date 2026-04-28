# UI primitives — usage convention

> **Rule of thumb:** new code uses primitives. Old inline-styled pages migrate
> opportunistically (don't open a PR _just_ to migrate styling).

## What's here

shadcn primitives — leaf-level, props-only, no business logic:

| Component | When to use |
|---|---|
| `<Button>` | every clickable action. Variants: `default` (purple), `surface`, `ghost`, `outline`, `destructive`, `accent`, `link`. |
| `<Card>` | every panel grouping. Drop-in replacement for `className="card"`. |
| `<Dialog>` / `<Sheet>` | modals / side panels. Replaces hand-rolled overlays. |
| `<Input>` | every text/number input. |
| `<Badge>` | tag / status pills (BUY / SELL / Active / Closed). |
| `<ScrollArea>` | scrollable lists, esp. proposals feed. |
| `<Separator>` | horizontal / vertical dividers. |
| `<ErrorBoundary>` / `<ErrorState>` | graceful fail rendering. |

## Tokens (CSS vars)

The shadcn primitives reference `--color-{primary, on-primary, surface,
on-surface, outline, positive, negative, …}`. These are aliased onto our
existing dark-theme tokens in `app/globals.css`:

```
--color-primary       → var(--color-accent)        (purple)
--color-surface       → var(--color-panel)
--color-positive      → var(--color-buy)           (green)
--color-negative      → var(--color-sell)          (red)
```

So `<Button variant="default">` is a purple button on dark surface, etc.
**Don't import the branch's light cream/lime values** unless you're
deliberately re-skinning to a light theme — they're left as comments in
`globals.css` for that exact migration.

## What you can still hand-roll

- One-off layout (flex / grid wrappers) — Tailwind classes are fine.
- Visualisations (charts, MiniChart, etc.) — they have their own DOM.
- Animations on top of primitives — `framer-motion` over `<Card>` is fine.

## What you should NOT do

- ❌ `<button className="btn btn-primary">` in new files. Use `<Button>`.
- ❌ `<div className="card">…</div>` in new files. Use `<Card>`.
- ❌ Inline `style={{ background: 'var(--color-panel)', border: '1px solid var(--color-border)' }}`. Use `<Card>`.
- ❌ Custom modal overlays. Use `<Dialog>`.

The `.btn` / `.card` / `.badge` utility classes in `globals.css` will stay
until the inline-styled pages migrate; once they do, those classes can
be deleted in one sweep.
