<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

---

## **Overall Status: 75% Working MVP**

✅ **What's Working Well:**

- Slack integration is solid (signature verification, DM filtering, dedup)
- LLM reasoning is well-structured (conversation analysis + contact ranking)
- Firestore is functional (lazy init, good error handling, two-tier caching)
- Dual LLM support (Groq/GitHub GPT-4o)
- Contact enrichment pipeline (Slack → Tavily → cache)

---

## **Firestore Usage Assessment: MOSTLY CORRECT, BUT NEEDS FIXES**

**✅ Doing Right:**

- Lazy initialization prevents duplicate apps
- Service account auth (base64/JSON fallback) is flexible
- Two-tier caching (5min memory + 7-day Firestore) is efficient
- Error handling with graceful fallbacks

**⚠️ NEEDS FIXING:**

| Issue | Severity | Why It Matters | Fix |
|-------|----------|----------------|-----|
| **No security rules** | 🔴 HIGH | Unprotected Firestore in production | Create `firestore.rules`, restrict to bot service account only |
| **Concurrent update race condition** | 🔴 HIGH | Two simultaneous messages could lose data | Use `arrayUnion` instead of read-then-write in conversations.ts |
| **Batch operations inefficient** | 🟡 MED | 500 contacts = 500 writes; poor billing | Use Firestore batch API (combine up to 500 ops per batch) |
| **Manual cache invalidation** | 🟡 MED | No automatic cleanup of stale docs | Configure Firestore TTL policy or improve query filtering |
| **No indexes** | 🟡 MED | Unoptimized queries on `lastUpdated` field | Create `firestore.indexes.json` to define indexes |
| **No audit logging** | 🟡 MED | Can't track data changes | Add Cloud Logging or app-level audit trail |

---

## **What's Missing (Blocking Features)**

### 1. **NO FEEDBACK LOOP** ❌ (Biggest Gap)

Your bot gives recommendations then stops. Users can't:

- Ask for "more backend people"
- Say "that person isn't relevant"
- Refine the problem further

**Impact:** Violates the core plan requirement for incremental refinement


### 3. **Single Enrichment Source** 🟡

- Only Tavily web search (plan mentioned LinkedIn/GitHub)
- No cross-validation of contacts (could match wrong person)

### 4. **Missing Email Scope** 🟡

- Slack profile `email` field often empty
- `users:read.email` not in manifest scopes

### 5. **UI/UX** 🔵

- Plain text recommendations (no Block Kit buttons)
- No interactive refinement options

---

## **Comparison to Plan: Where You Veered Off**

| From Plan | Your Implementation | Status |
|-----------|-------------------|--------|
| Multi-turn feedback & refinement | ✗ Only one recommendation round | ❌ **Missing critical feature** |
| Multiple enrichment sources | ✓ Tavily only (simplified) | ⚠️ Acceptable for MVP |
| Contact validation/confidence threshold | ✗ No validation step | ⚠️ Risky if enrichment gets wrong person |
| Large contact pool pre-filtering | ✓ LLM filters >20 to ~10 | ✅ Reasonable |
| Firestore schema + state machine | ✓ Implemented cleanly | ✅ On track |
| Dual LLM support | ✓ Groq + GitHub | ✅ On track |

---

## **Recommended Next Steps (Prioritized)**

2. **Create Firestore Security Rules** (15 min)
   - Lock down reads/writes to bot service account only
   - Deploy rules via Firebase CLI

3. **Fix Concurrent Update Race** (20 min)
   - In conversations.ts, replace the read-then-update pattern with `arrayUnion`:

   ```typescript
   messages: admin.firestore.FieldValue.arrayUnion(messageWithTimestamp)
   ```


### **Phase 3: Robustness (2–3 hours)**

1. Optimize batch saves using Firestore batch API
2. Add error instrumentation (e.g., Sentry)
3. Improve enrichment retry logic (exponential backoff)
4. Define Firestore indexes

### **Phase 4: Polish (1–2 hours)** *(if time)*

1. Block Kit formatting & clickable recommendations
2. Better error messages
3. Pagination for large contact lists

---


I've saved a detailed plan to session memory. **What would you like to tackle first — should I help you implement the feedback loop, or start with deployment + Firestore fixes?**

