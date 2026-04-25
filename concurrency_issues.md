I'll examine how the system handles concurrent users and multi-workspace scenarios. Let me check the key files:

Read [](file:///home/fatima/Desktop/slack-butterfly/lib/contacts.ts#1-1), lines 1 to 80

Read [](file:///home/fatima/Desktop/slack-butterfly/lib/conversations.ts)

Read [](file:///home/fatima/Desktop/slack-butterfly/lib/firebase.ts)

Read [](file:///home/fatima/Desktop/slack-butterfly/lib/contacts.ts#80-80), lines 80 to 150

Searched for regex `workspace|team|SLACK_BOT_TOKEN|SLACK_WORKSPACE` (`**/app/api/slack/events/route.ts`), 4 results

Read [](file:///home/fatima/Desktop/slack-butterfly/lib/contacts.ts#150-150), lines 150 to 250

Searched for text `export async function getAllContacts` (`**/lib/contacts.ts`), 1 result

Read [](file:///home/fatima/Desktop/slack-butterfly/lib/contacts.ts#362-362), lines 362 to 430

Searched for text `async function fetchSlackUsers` (`**/lib/contacts.ts`), 1 result

Read [](file:///home/fatima/Desktop/slack-butterfly/lib/contacts.ts#488-488), lines 488 to 530

Searched for text `async function saveContactsToFirestore` (`**/lib/contacts.ts`), 1 result

Read [](file:///home/fatima/Desktop/slack-butterfly/lib/contacts.ts#333-333), lines 333 to 360

Based on the code, there are **two significant concurrency issues**:

## 🔴 **Multi-Workspace Problem (Blocking)**

The bot uses a **single `SLACK_BOT_TOKEN`** and stores everything by plain `userId` with no workspace identifier. If installed in multiple workspaces:

| Issue | Impact |
|-------|--------|
| **Single token only works in one workspace** | Bot can't authenticate in other workspaces—requests will fail |
| **User ID collisions across workspaces** | User `U123` in Workspace A and `U123` in Workspace B are treated as **the same person** in Firestore |
| **Shared contact data** | Contact enrichments (Tavily results) are mixed across workspaces |
| **Shared conversation history** | Different workspace users sharing an ID lose conversational isolation |

**Example failure:**

```
Workspace A: User U123 talks to bot → creates conversation doc
Workspace B: User U123 talks to bot → overwrites same conversation doc in Firestore
→ Workspace A's context is lost
```

---

## 🟡 **Concurrent User Problem (Same Workspace)**

In conversations.ts, the `addMessageToConversation` function uses a **read-then-write pattern**:

```typescript
const currentDoc = await docRef.get();  // Read
const currentData = currentDoc.data();

await docRef.update({
  messages: (currentData?.messages || []).concat(messageWithTimestamp),  // Write
});
```

**Race condition scenario:**

1. User sends message A at t=0ms → reads `messages = []`
2. User sends message B at t=5ms → reads `messages = []` (update from A hasn't persisted)
3. Update from A: `messages = [A]` ✅
4. Update from B: `messages = [B]` ❌ **Overwrites A!**

This is **less likely** if the same user sends messages slowly, but possible with rapid fire.

---

## ✅ **What Actually Works Fine**

Two different users in the **same workspace** don't interfere:

- User U123 has `conversations/U123` doc
- User U456 has `conversations/U456` doc
- Firebase handles concurrent writes to different docs safely

---

**To fix these:**

1. **Multi-workspace**: Add workspace ID to Firestore doc paths: `conversations/{workspaceId}/{userId}` + support multiple tokens per workspace
2. **Race condition**: Replace read-then-write with Firestore's atomic `arrayUnion()`:

   ```typescript
   messages: admin.firestore.FieldValue.arrayUnion(messageWithTimestamp)
   ```
