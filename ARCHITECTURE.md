# Slack Butterfly - Architecture & Implementation

## Overview

Slack Butterfly is an intelligent Slack bot that helps users find the right people in their network to solve specific problems. It engages in natural conversation to understand the problem, then recommends relevant contacts with detailed reasoning.

## Architecture

### Tech Stack

- **Backend**: Next.js 16 (TypeScript) running on Vercel
- **LLM**: Dual-model strategy
  - **Development**: Groq's Meta Llama 3.3 70B (fast, cost-effective)
  - **Production**: GitHub's OpenAI GPT-4o (higher quality)
- **State Management**: Firebase Firestore (conversation history & problem state)
- **Bot Platform**: Slack API with Events API
- **Data**: Mock contact database with 10 professional profiles

### Data Model

#### Conversations Collection (Firebase)
```typescript
{
  userId: string           // Slack user ID
  messages: Message[]      // Chat history
  problemState: {
    problemType?: string   // technical|organizational|research|career
    summary: string        // User's problem description
    keyNeeds: string[]     // Required skills/expertise
    constraints?: string[] // Timeline, resources, etc.
    urgency?: "low"|"medium"|"high"
    domain?: string        // backend|frontend|ml|security
  }
  state: "clarifying" | "ready_to_recommend" | "recommending"
  confidence: number       // 0-1, confidence in problem understanding
  lastUpdated: timestamp
  version: number
}
```

#### Contacts
```typescript
{
  id: string               // Slack user ID
  name: string
  title: string
  organization: string
  summary?: string         // Profile description
  skills?: string[]        // Relevant expertise
  experience?: string      // Relevant background
  email: string
}
```

## Reasoning & Agent Policy

### Conversation Flow

The bot implements a **dynamic policy layer** that switches between two modes:

#### 1. **Clarification Mode** (Confidence: 0.0 - 0.7)
- Analyzes incomplete problem statements
- Identifies missing fields (problemType, keyNeeds, constraints, etc.)
- Generates targeted clarification questions
- Updates problem state incrementally with each message

**Questions Asked**:
- Problem domain and type
- Specific skills or expertise needed
- Timeline and urgency
- Technical constraints
- Success criteria

#### 2. **Recommendation Mode** (Confidence: 0.7 - 1.0)
- Triggered when all required fields are present
- Retrieves and filters the contact pool
- Ranks contacts using LLM reasoning
- Returns top 5 matches with detailed explanations

### Contact Classification & Ranking

**Pre-Filtering** (if >20 contacts):
1. LLM analyzes problem keyNeeds
2. Filters contacts by skill keywords
3. Reduces set to ~10 most relevant candidates

**Ranking Algorithm**:
For each candidate, LLM evaluates:
- **Skill match**: Direct alignment between contact's skills and problem needs
- **Experience**: Relevant background and project history
- **Confidence**: How certain the match is based on available data

**Output**:
```typescript
{
  contactId: string
  score: 0.0-1.0          // Ranking score
  why: string             // 1-2 sentence explanation
  strengthsMatched: []    // Specific skills that match
  uncertainty: []         // Missing info or weak signals
}
```

## Implementation Details

### LLM Integration (`lib/llm.ts`)

#### `analyzeConversation()`
- Takes user message + conversation history
- Returns structured problem state + missing fields + clarification questions
- Uses 0.5 temperature (deterministic)
- Handles JSON parsing with fallback logic

#### `rankContacts()`
- Pre-filters large contact pools to avoid tokenization overhead
- Batch-scores contacts using LLM reasoning
- Returns top 5 ranked recommendations
- Includes uncertainty indicators for transparency

### State Management (`lib/conversations.ts`)

- **Firebase Firestore** stores conversation state persistently
- Each message is added to history with timestamp
- Problem state evolves with each user input
- Version tracking enables future rollback/audit features

### Slack Integration (`app/api/slack/events/route.ts`)

- Verifies webhook signatures using HMAC-SHA256
- Filters for DM messages (ignores bots, thread replies, etc.)
- Maps Slack API calls → conversation updates → LLM analysis → Slack reply
- Handles "reset" command to start new conversation

## Key Design Decisions

### 1. **Incremental State Refinement**
Instead of one-shot summarization, the bot refines its understanding with each message:
- Captures raw conversation for context
- Maintains structured problem state alongside
- Confidence score guides when to recommend vs. clarify
- Enables iterative problem discovery

### 2. **Model Flexibility**
- Same API for Groq (development) and GitHub models (production)
- Abstracts differences in authentication and baseURL
- Allows easy switching for cost/quality trade-offs
- Fallback handling if LLM API calls fail

### 3. **Accuracy Over Coverage**
- Prioritizes fewer, higher-confidence matches
- Includes uncertainty indicators for each recommendation
- Disclaimers when contact data is limited
- Allows users to refine and re-rank on feedback

### 4. **Scalability Tiers**
- Contact pool <20: All contacts ranked
- Contact pool 20-100: LLM pre-filters to ~10
- Contact pool >100: Two-stage filtering (keywords + LLM)

## Conversation Examples

### Example 1: Clear Problem
```
User: "We need help optimizing our NLP model for low-latency inference"

Bot Analysis:
- problemType: "technical"
- keyNeeds: ["NLP", "optimization", "inference"]
- domain: "ML"
- confidence: 0.85

→ Recommendations: Alice Chen (ML Engineer), Diego Rodriguez (Data Scientist)
```

### Example 2: Vague Problem
```
User: "Help with our system"

Bot: "I'd like to understand this better. 
1. What type of system? (web app, infrastructure, API?)
2. What's the main challenge right now?"

Bot Analysis:
- confidence: 0.3
- missingFields: ["problemType", "keyNeeds"]
- → Clarify
```

## Future Improvements

### Short-term
1. **Feedback Loop**: Users can accept/reject recommendations
   - Rejected contacts are excluded from future queries
   - User feedback refines ranking criteria
   - Re-ranking based on feedback

2. **Block Kit UI**: Rich Slack formatting
   - Buttons to accept/reject contacts
   - Expandable contact details
   - Direct message templates

3. **Workspace Member Integration**
   - Fetch contacts from Slack workspace directly
   - Real enrichment from Slack profiles (title, bio, etc.)
   - Ask recommendations directly in Slack

### Medium-term
1. **Data Enrichment Pipeline**
   - Tavily API for professional profiles
   - LinkedIn profile scraping (with opt-in)
   - GitHub profile integration for technical skills
   - Cross-reference validation (name, title, org)
   - Caching layer to avoid redundant enrichment

2. **Advanced Reasoning**
   - Temporal factors: "Who's available?" and "Who's recently done this?"
   - Mutual connections: "Who knows the people involved?"
   - Past interactions: "Who's helped on similar problems?"
   - Team composition: "Find a diverse team, not just one person"

3. **Feedback-Driven Learning**
   - Track which recommendations led to successful outcomes
   - Learn ranking patterns from aggregate feedback
   - Fine-tune LLM prompts based on recommendation quality

### Long-term
1. **Multi-Problem Support**
   - Break large problems into sub-problems
   - Recommend specialists for each component
   - Orchestrate team formation and communication

2. **Organizational Integration**
   - Resume/skill data access (privacy-preserving)
   - Project history and contributions
   - Team dynamics and collaboration patterns
   - Availability calendars

3. **Continuous Improvement**
   - A/B testing different ranking algorithms
   - Sentiment analysis of user feedback
   - Performance metrics (recommendation success rate, match quality)
   - Prompt optimization

## Error Handling & Edge Cases

### Missing Environment Variables
- Falls back to defaults
- Logs warnings but continues
- Production defaults to GPT-4o, development to Llama

### Slack API Failures
- Retries with exponential backoff
- Graceful user-facing error messages
- Logging for debugging

### LLM Response Parsing
- JSON parsing catches malformed responses
- Fallback to basic problem state if parsing fails
- Partial reasoning preserved even if formatting broken

### Conversation State Loss
- Firebase writes are atomic
- New conversation created if state missing
- Message history never lost

## Testing & Development

### Local Development
```bash
npm run dev
# Listens on http://localhost:3000/api/slack/events
```

### Environment Variables
- `NODE_ENV`: controls model selection
- `DEVELOPMENT_MODEL_TOKEN`: Groq API key
- `PRODUCTION_MODEL_TOKEN`: GitHub PAT
- Firebase config: authentication to Firestore

### Firebase Setup
- Create project at https://console.firebase.google.com
- Enable Firestore
- Copy credentials to .env

## Deployment

Deployed on Vercel with:
- Auto-build on commit
- Environment variables configured in Vercel dashboard
- Slack webhook URL: `https://slack-butterfly.vercel.app/api/slack/events`

Commands:
```bash
npm run build      # TypeScript build (runs tsc)
npm run start      # Starts production server
npm run lint       # ESLint check
```

## File Structure

```
app/
└── api/slack/events/route.ts    # Slack webhook handler
lib/
├── llm.ts                        # LLM client & reasoning
├── conversations.ts              # State management
├── contacts.ts                   # Contact database
└── firebase.ts                   # Firebase initialization
```

## Conclusion

Slack Butterfly demonstrates:
1. **Multi-turn conversation design** with state tracking
2. **LLM-powered reasoning** for contact matching
3. **Scalable filtering** for large contact pools  
4. **Production-ready deployment** (handling auth, errors, types)
5. **Clear architecture** that extends naturally (enrichment, feedback, team formation)

The system prioritizes **quality of reasoning** (transparent, explainable matching) over **dataset size**, using the LLM to bridge gaps in contact data and provide human-understandable rationales for every recommendation.
