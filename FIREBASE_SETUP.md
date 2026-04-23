# Firebase Setup Guide

## Issue Fixed
Changed from Firebase Web SDK (client-side, read-only in server context) to **Firebase Admin SDK** (server-side, full permissions).

## Setup Instructions

### 1. Create a Firebase Service Account

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: `slack-butterfly`
3. Click **Settings** (gear icon) → **Project Settings**
4. Go to **Service Accounts** tab
5. Click **Generate New Private Key**
6. Save the downloaded JSON file (keep it secure!)

### 2. Add Service Account to Environment

You have two options:

#### Option A: Base64-Encode the Service Account (Recommended for Vercel)

```bash
# Convert service account JSON to base64
cat /path/to/service-account.json | base64 | tr -d '\n'

# Copy the output and add to .env:
FIREBASE_SERVICE_ACCOUNT_KEY=<base64-string-here>
```

#### Option B: Direct JSON String

```bash
# Read the service account JSON and add to .env:
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"...","...}'
```

### 3. Update .env File

Replace the old Firebase config:
```bash
# OLD (remove these):
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...

# NEW (add this):
FIREBASE_SERVICE_ACCOUNT_KEY=<your-base64-encoded-key-here>
```

### 4. Reinstall Dependencies

```bash
npm install
```

### 5. Update Vercel Environment

If deployed on Vercel:
1. Go to Vercel dashboard → Your Project Settings
2. Go to **Environment Variables**
3. Add `FIREBASE_SERVICE_ACCOUNT_KEY` with the base64-encoded value
4. Redeploy

## Validation

After setup, you should:
1. See no more `PERMISSION_DENIED` errors
2. Conversations save successfully to Firestore
3. Messages persist across Slack DM sessions

## Troubleshooting

### "FIREBASE_SERVICE_ACCOUNT_KEY is not set"
- Check that you added it to `.env`
- Verify it's base64-encoded properly (no newlines)

### "Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY"
- Ensure the base64 string has no newlines
- Try the raw JSON approach instead

### Still getting permission errors
- Verify service account has roles:
  - "Cloud Datastore User"
  - "Cloud Firestore Service Agent"
- Check Firestore security rules allow admin access (they should by default)

## Security Notes

- **Never commit** `service-account.json` to git
- Use `.gitignore` to exclude `*.json` keys
- On Vercel, use encrypted environment variables
- Rotate the service account key periodically
- Use Firestore Security Rules to restrict data access if needed (future improvement)
