# MR-003 Review — Relevance Ranking for Chat Context

## Card
**MR-003: Relevance Ranking for Chat Context**

## Result
Completed

---

## Goals
Upgrade the keyword relevance scoring from a simple token-overlap check into a robust, explainable, stopword-aware + Jaccard-normalised matching system. Make relevance ranking work without external keywords being pre-supplied.

---

## What Was Done

### 1. New `computeKeywordRelevance()` Function

Replaces the legacy `context.keywords` token-overlap path in `scoreEntry()`.

```typescript
function computeKeywordRelevance(
  userMessage: string,
  entry: MemoryEntry
): { score: number; matchedKeywords: string[]; unionSize: number }
```

**Key improvements:**

| Aspect | v1 (MR-001) | v3 (MR-003) |
|---|---|---|
| Input | `context.keywords` (external, often empty) | `userMessage` directly |
| Token filtering | None (all non-trivial tokens) | Stopword-filtered (EN + CN) |
| Matching | Exact string match only | Exact + stem equivalence |
| Score scale | 0–10 pts | 0–15 pts |
| Long-text safety | None (long texts inflate score) | Jaccard normalisation |
| Matched output | Array of strings | Array of strings |

**Scoring formula:**
```
perMatchBonus = min(matchedKeywords × 3, 12)
jaccard       = intersection / union
score         = min(15, perMatchBonus + jaccard × 3)
```

### 2. Enhanced `extractTokens()`

```typescript
function extractTokens(text: string): string[]
```

**Improvements:**
- Keeps Chinese characters (`\u4e00-\u9fff`) alongside English letters
- Filters both English stopwords (60+ words) and Chinese stopwords (40+ words)
- Applies `simpleStem()` to normalise word forms

**`simpleStem()` examples:**
- `"preferences"` → `"preferenc"` (strips `"s"`)
- `"programming"` → `"program"` (strips `"ing"`)
- `"用户的"` → `"用户"` (strips `"的"`)

### 3. `scoreEntry()` Upgrade

```typescript
// Before (MR-001):
const keywordScore = context.keywords
  ? Math.min(10, context.keywords.filter(kw => allTokens.has(kw)).length * 5)
  : 0;

// After (MR-003):
const kw = computeKeywordRelevance(context.userMessage, entry);
if (kw.score > 0) reasons.push(`keyword=${kw.score}pts(${kw.matchedKeywords.join(",")})`);
```

The function now requires only `context.userMessage` (guaranteed to be present), removing the dependency on `context.keywords`.

### 4. Stopword Lists

Two sets of stopwords are maintained:
- **English** (~80 common function words, articles, pronouns, auxiliary verbs)
- **Chinese** (~40 common particles and high-frequency characters)

Stopwords are stored in a `Set<string>` for O(1) lookup.

### 5. TypeScript Build
Zero errors.

---

## Design Decisions

### 1. Why Jaccard Normalisation?
A naive token-overlap score always favours longer memory entries (more tokens = more chances to match). Jaccard (`|intersection| / |union|`) punishes large token sets that contain irrelevant tokens, making the score a proportion rather than a raw count.

### 2. Why Stemming?
Users describe concepts inconsistently: "prefers coffee" vs "preferred coffee" vs "preference". Without stemming, the system treats these as different signals. `simpleStem()` handles the most common English/CN suffixes with zero external dependencies.

### 3. Why Not Remove `keywords` from the Type?
`MemoryRetrievalContext.keywords` is kept for forward compatibility. MR-003 uses `userMessage` directly, but future MR steps (e.g., explicit keyword extraction from the message) could populate `keywords` and the existing path would still work.

### 4. Why Cap Keyword Score at 15?
The previous cap was 10 pts (50% of importance score). MR-003 raises it to 15 pts but keeps it below the recency component (20 pts), preserving the primacy of recency while giving relevance a meaningful but bounded influence.

---

## Scope Boundary (What Was NOT Done)

- **No embeddings / vector search**: Out of scope for v2
- **No external keyword extraction model**: Still uses `userMessage` directly
- **No category schema changes**: `instruction`/`preference`/`fact`/`context` unchanged
- **No new repo methods**: Scoring stays in application layer

---

## File Changes

| File | Change |
|---|---|
| `backend/src/services/memory-retrieval.ts` | `STOPWORDS` Set + `simpleStem()` + `extractTokens()` rewrite + `computeKeywordRelevance()` + `scoreEntry()` keyword section upgrade |

---

## Regression Safety

- `runRetrievalPipeline()` calls `scoreEntry()` with the same interface — no call-site change needed
- `buildCategoryAwareMemoryText()` is unaffected — purely formatting logic
- Empty `userMessage` case: `extractTokens([])` returns `[]` → Jaccard is 0 → score is 0 → entry passes or fails based on importance + recency only → same as v1
- No new dependencies introduced

---

## MR-003 Assessment

MR-003 was the most impactful card in Sprint 04 for pure retrieval quality. The keyword matching upgrade turns a noisy, long-text-biased signal into a stopword-filtered, stem-normalised, Jaccard-proportional relevance score. This directly improves the ranking quality without touching the scoring pipeline architecture.
