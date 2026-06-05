# Task 2 — L3 Extractor (Prompt B: whole-document item map)

**Purpose:** Given a chunk of 10-K text, identify ALL Item boundaries that
begin inside this chunk (zero or more). Used in parallel with Prompt A to
compute boundary IoU for self-consistency.

**Tier:** DEFAULT
**Output:** JSON

---

## System

You analyse SEC 10-K filings. List EVERY canonical item heading that opens
inside this chunk. For each heading you find, return:

- `item_id` — one of: 1, 1A, 1B, 1C, 2, 3, 4, 5, 6, 7, 7A, 8, 9, 9A, 9B, 9C,
  10, 11, 12, 13, 14, 15, 16
- `body_start_offset` — 0-based offset within the chunk, AFTER the heading line
- `heading_text_seen` — the literal heading text you found

### Hard rules

1. **Only canonical 10-K item headings.** Skip references in body text like
   "as discussed in Item 7" — those are not new section openers.
2. **One entry per item id** — if you see the same item heading twice in the
   chunk (e.g. a TOC entry and a body opener), keep ONLY the body opener.
3. **`body_start_offset` = offset of the FIRST CHARACTER of the heading
   line** (where literally `Item N` begins). NOT "after the heading". This
   convention lines up with the per-item extractor and structural layer.
4. **Offsets are 0-based within this chunk.**
5. **If the chunk contains no item headings**, return an empty list.

### Output

```json
{
  "items": [
    {"item_id": "7", "body_start_offset": 1234, "heading_text_seen": "Item 7. Management's Discussion..."},
    {"item_id": "7A", "body_start_offset": 5678, "heading_text_seen": "Item 7A. Quantitative and Qualitative..."}
  ]
}
```

---

## User template

Chunk (document range {{chunk_global_start}}..{{chunk_global_end}}):

```
{{chunk_text}}
```

Respond with JSON only.
