# <img src="public/icons8-butterfly-pieces-96.png" width="32" height="32" alt="logo" valign="middle"> Slack Butterfly

[![Next.js](https://img.shields.io/badge/Next.js-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)](https://vercel.com)
[![Slack](https://img.shields.io/badge/Slack-4A154B?logo=slack&logoColor=white)](https://slack.com)
[![Firebase](https://img.shields.io/badge/Firestore-FFCA28?logo=firebase&logoColor=black)](https://firebase.google.com)
[![Groq](https://img.shields.io/badge/Groq-F55036?logo=groq&logoColor=white)](https://groq.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-412991?logo=openai&logoColor=white)](https://openai.com)
[![Tavily](https://img.shields.io/badge/Tavily-000000?logo=tavily&logoColor=white)](https://tavily.com)

A Slack bot that finds the right people in your workspace to solve a problem. Short conversation → structured problem state → ranked contact recommendations with reasoning.

## How It Works

1. **You describe a problem** in a DM
2. **Bot asks 1–2 clarifying questions** until it has enough context
3. **Bot recommends people** from your workspace with scores, reasoning, and a suggested ask

## Quick Demo

```
You: We need help optimizing our NLP model for low-latency inference

Bot: Great! I found 2 people who might help:

1. *Alice Chen* (ML Engineer) — Built transformer-based NLP pipelines
   Score: 87% | Ask: "Can you share your experience optimizing
   transformer models for low-latency inference?"

2. *Diego Rodriguez* (Data Scientist) — Specializes in model compression
   Score: 72% | Ask: "What quantization approaches have you found
   most effective for NLP models in production?"
```

## Architecture

```
Slack DM → Slack Events API → Next.js API Route
                                 ↓
                    Firebase Firestore (state + cache)
                                 ↓
              LLM analyzes conversation & ranks contacts
                                 ↓
              Tavily enriches Slack profiles (skills, experience)
                                 ↓
                         Slack DM reply
```

**State machine:** confidence continuum `0.0–0.3` unclear → `0.3–0.7` clarifying → `0.7–1.0` recommending.

**Ranking:** LLM scores skill match + experience, blended with heuristic validation. Low-confidence matches are dropped. Disclaimers shown when data is limited.

## File Structure

```
app/api/slack/events/route.ts    # Webhook handler (events + buttons)
lib/llm.ts                        # Conversation analysis + contact ranking
lib/conversations.ts              # Firestore state management
lib/contacts.ts                   # Slack users + Tavily enrichment
lib/firebase.ts                   # Firebase Admin init
```

## Setup

### 1. Env Vars

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...

# LLM (dev = Groq, prod = GitHub Models GPT-4o)
DEVELOPMENT_MODEL_TOKEN=...
PRODUCTION_MODEL_TOKEN=...

# Firebase (base64 service account JSON)
FIREBASE_SERVICE_ACCOUNT_KEY=...

# Optional enrichment
TAVILY_API_KEY=tvly-...
```

### 2. Slack App

1. Create app at [api.slack.com/apps](https://api.slack.com/apps)
2. **Event Subscriptions** → URL: `/api/slack/events` → subscribe to `message.im`
3. **Interactivity** → URL: `/api/slack/events`
4. **OAuth Scopes:** `chat:write`, `users:read`, `users:read.email`
5. Install to workspace

### 3. Firebase

Create project → enable Firestore → base64-encode service account key → paste into `FIREBASE_SERVICE_ACCOUNT_KEY`. See `FIREBASE_SETUP.md` for details.

### 4. Run

```bash
npm install
npm run dev        # localhost:3000/api/slack/events
```

Deploy to Vercel: `vercel --prod`

## Commands

| Command | Action |
|---------|--------|
| `help` | Show commands |
| `status` | See current problem state |
| `reset` | Start fresh |
| *(anything else)* | Describe a problem |

## What We'd Improve

- **Feedback loop:** accept/reject buttons that refine future rankings
- **Rich UI:** Block Kit cards with contact details and DM templates
- **More enrichment:** GitHub, LinkedIn for deeper profiles
- **Advanced reasoning:** availability, mutual connections, past interactions
- **Team formation:** break big problems into sub-problems and recommend teams

