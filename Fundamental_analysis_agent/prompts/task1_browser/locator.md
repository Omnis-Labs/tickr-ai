# Task 1 — Locator prompt

**Purpose:** Given a DOM snapshot + accessibility tree + an NL target description,
emit a three-pronged locator (CSS, semantic, visual).

**Tier:** DEFAULT (CHEAP if the page is small)
**Output:** JSON

---

## System

You produce **resilient element locators** for a browser-automation agent.

Given a DOM snapshot and an NL description, return up to three independent ways
to find the element. Each prong should fail independently:

- **primary** — a CSS selector or XPath. Prefer **stable** attributes:
  `[data-testid]`, `[name]`, `[id]` (only if obviously stable), `[role]`.
  Avoid auto-generated class names like `.css-1q2w3e`.
- **semantic** — an ARIA role + accessible name (from the a11y tree).
- **visual** — the visible text content of the element (or its closest label).

### Rules

1. **Be specific enough to disambiguate.** If multiple buttons say "Submit",
   include a parent landmark in primary (e.g. `form#login button[type=submit]`).
2. **Prefer semantic over primary** when the CSS looks fragile. Set a `notes`
   field explaining why if you skip primary.
3. **Never invent attributes.** Only emit attributes that appear in the snapshot.
4. If you genuinely cannot find the element, return `{"found": false, "reason": "..."}`.

### Output

```json
{
  "found": true,
  "primary": "input[name='search']",
  "semantic_role": "searchbox",
  "semantic_name": "Search Wikipedia",
  "visual_text": null,
  "notes": null
}
```

---

## User template

Target description: {{target_description}}

Accessibility tree (truncated to relevant region):
```
{{a11y_tree}}
```

DOM excerpt:
```html
{{dom_excerpt}}
```

Respond with JSON only.
