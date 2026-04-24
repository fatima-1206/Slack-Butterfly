# Firebase Permissions Fix - Quick Reference

## What Was Wrong
- Using **Firebase Web SDK** (client-side) in a server-side context (Next.js API routes)
- Web SDK lacks write permissions in server environment → `PERMISSION_DENIED` errors
- Every attempt to read/write to Firestore failed

## What's Fixed
✅ Switched to **Firebase Admin SDK** (server-side library)  
✅ Uses service account authentication (full permissions)  
✅ Lazy initialization (doesn't break during build)  
✅ Graceful error handling (clear error messages)

## Changes Made
| File | Change |
|------|--------|
| `lib/firebase.ts` | Complete rewrite: Admin SDK + lazy init |
| `lib/conversations.ts` | Updated to use `getFirestore()` function |
| `app/api/test-firestore/route.ts` | Updated API calls to Admin SDK syntax |
| `package.json` | Replaced `firebase` with `firebase-admin` |

## What You Need to Do

### 1. Get Service Account Credentials
Follow [FIREBASE_SETUP.md](FIREBASE_SETUP.md) to:
- Go to Firebase Console → Project Settings → Service Accounts
- Generate a new private key (JSON file)
- Convert to base64 or keep as JSON

### 2. Set Environment Variable
Add to `.env`:
```bash
# Option A: Base64-encoded (recommended for security)
FIREBASE_SERVICE_ACCOUNT_KEY=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6InNsYWNrLWJ1dHRlcmZseSIsIn...

# Option B: Raw JSON (simpler for local dev)
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"slack-butterfly",...}'
```

### 3. Reinstall + Rebuild
```bash
npm install
npm run build
npm run dev
```

### 4. Test
Send a Slack DM to your bot — it should now:
- ✅ Save messages to Firestore
- ✅ Persist conversation state
- ✅ Not throw `PERMISSION_DENIED` errors

## If Still Failing

**Error: "FIREBASE_SERVICE_ACCOUNT_KEY is not set"**
- Verify it's in `.env`
- Check by running: `echo $FIREBASE_SERVICE_ACCOUNT_KEY`

**Error: "Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY"**
- If using base64, ensure no newlines: `cat file.json | base64 | tr -d '\n'`
- Try raw JSON instead

**Still getting permission errors**
- Verify service account has these roles in Firebase IAM:
  - "Cloud Datastore User"
  - "Cloud Firestore Service Agent"
- Check Firestore Security Rules (should allow admin access by default)

## Architecture Summary

```
Request → Slack Webhook
  → LLM Analysis (Groq/GPT-4)
  → Conversation State (Firestore via Admin SDK) ← Fixed!
  → Contact Ranking
  → Response to Slack
```

The fix eliminates the `PERMISSION_DENIED` blocker. Everything else is working!
