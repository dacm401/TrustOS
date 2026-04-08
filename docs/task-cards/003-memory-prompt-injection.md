# Task Card 003: Memory Prompt Injection

## Goal
Inject relevant memory entries into the prompt flow so the AI can see user memories within a chat session.

---

## Scope

### Config Addition
In `backend/src/config.ts`, add:
```ts
memory: {
  maxEntriesToInject: 5,     // max top memories injected per request
  maxTokensPerEntry: 150,    // hard cap per entry to prevent runaway injection
  enabled: process.env.MEMORY_INJECTION_ENABLED !== "false",
}
```

### Prompt Injection in `prompt-assembler.ts`
Modify `assemblePrompt()` call in `chat.ts`:
1. Before calling `assemblePrompt()`, fetch top memories:
   ```ts
   const memories = config.memory.enabled
     ? await MemoryEntryRepo.getTopForUser(userId, config.memory.maxEntriesToInject)
     : [];
   ```
2. Build `taskSummary` object:
   ```ts
   const taskSummary = memories.length > 0
     ? {
         goal: "User memories:",
         summaryText: memories
           .map(m => `[${m.category}] ${m.content}`)
           .join("\n"),
         nextStep: null,
       }
     : undefined;
   ```
3. Pass `taskSummary` to `assemblePrompt({ mode, userMessage, taskSummary })`

**Token budget enforcement** (in `prompt-assembler.ts`):
- If assembled `task_summary` section exceeds `config.memory.maxTokensPerEntry * maxEntriesToInject` tokens, truncate to fit
- Use `countTokens()` from `models/token-counter.ts`

### Injection Policy by Mode
- `direct`: inject memories (user wants quick answer, but memory context still helps)
- `research`: inject memories (structured analysis benefits from knowing user context)

Both modes get the same injection logic. No mode skips memory.

---

## Constraints
- Do not change the section ordering in `assemblePrompt()` output — task_summary stays in position 3 if present
- Do not inject raw SQL or internal field names — always use human-readable formatting
- If `config.memory.enabled === false`, the flow must be identical to v1 (i.e., no memories fetched)

---

## Non-Goals
- Auto-extracting memories from chat history (future work)
- Priority-based injection beyond importance score
- Memory lifecycle beyond CRUD

---

## Acceptance Criteria
- `assemblePrompt()` with `taskSummary` produces a system prompt containing memory entries
- `assemblePrompt()` without `taskSummary` is unchanged from v1
- Token cap is respected
- `config.memory.enabled = false` bypasses all memory reads
- TypeScript build passes
- Regression: `/api/chat` direct and research modes both pass

---

## File Changes
```
backend/src/config.ts                     — ADD memory config section
backend/src/api/chat.ts                  — FETCH memories before assemblePrompt, pass taskSummary
backend/src/services/prompt-assembler.ts — ADD token cap enforcement for task_summary
```
