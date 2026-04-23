@AGENTS.md


# Slack butterfly

Build a Slack bot that acts as an intelligent co-pilot for surfacing the right people to solve a problem. The agent should:

• Engage the user in a short conversation to understand their core challenge — asking clarifying questions until it has enough context to act

• Distill that conversation into a structured problem statement

• Cross-reference a list of contacts (your own mock data — build whatever makes the demo compelling) to identify who has relevant experience or connections to help

• Return a ranked, actionable summary: who to reach out to, why they're relevant, and a suggested ask

The quality of the conversation design and the reasoning behind the matches are what we're evaluating — not the size of the dataset or the polish of the UI.

You choose how the agent verifies relevance (web search, LinkedIn lookup, LLM reasoning against profile data, etc.) — be ready to defend your approach in the walkthrough.

Please submit the following deliverables:

• A working Slack bot (we'll add it to a test workspace — share the invite or manifest)

• A short README covering your architecture, how the agent reasons, and what you'd improve with more time

## Plan

We implemented a single agent with a dynamic policy layer that switches between information-gathering and execution based on structured state confidence. The system maintains a persistent problem representation that evolves over time, enabling incremental reasoning rather than one-shot summarization.

### Architecture

- **Tech Stack**: Vercel for deployment, Next.js for the backend API, Slack API for the plugin, LLM for natural language processing and reasoning. UI can be built using Slack's Block Kit. Additionally, we can use firebase for caching enriched contact data to optimize performance and reduce redundant API calls. Firebase can also be used for chat history and state management, allowing the bot to maintain context across conversations.

Tavily API for enriching contact data, which provides detailed professional profiles based on minimal input (e.g., name, title and company). This will allow the agent to make more informed recommendations without relying on extensive training data.

Serp API for web search to verify the relevance of contacts based on their public online presence.

- The LLM needs to provide an explicit reasoning trace for its recommendations, which will be included in the response to the user.

- No training data will be used — the agent will rely on real-time reasoning and a mock dataset of contacts.

- We can get user profiles with title, name, and organization from slack API, and we can enrich that data through webscraping linkedin profiles or using a third-party API that provides professional data.

- Google search can also be used to verify the relevance of contacts based on their public online presence.

- When this enriching is being done it should be made sure that the data is of the same person as the one in the slack profile, to avoid mismatches. This can be ensured by cross-referencing multiple data points (e.g., name, title, organization) and using a confidence threshold for matches.

- If the data enriching process fails to find relevant information for a contact, the agent should gracefully handle this by providing a small disclaimer in the response, indicating that the recommendation is based on limited information. It should still be able to provide a recommendation bassed on the available data from slack profiles, but it should be transparent about the limitations of the data.

- If there is a lot of contacts, there needs to be a way to filter them down before enriching, to avoid unnecessary API calls and web scraping. This can be done by using the LLM to analyze the problem statement and identify key skills or keywords that are relevant to the problem, and then filtering the contacts based on those keywords before enriching.

- After that initial filtering, the contacts should be filtered again based on the enriched data, to minimize token usage when the LLM is doing the final reasoning and ranking.

- This filtering mechanism must only be triggered when the number of contacts exceeds a certain threshold, to ensure that we are not filtering out potentially relevant contacts unnecessarily.

- Accuracy must be prioritized. The agent should err on the side of caution, providing fewer but more relevant recommendations rather than overwhelming the user with less relevant contacts.

### Reasoning

- The agent will use the LLM to analyze the structured problem statement and the enriched contact data to identify relevant connections.

- The LLM will provide a reasoning trace that explains why each recommended contact is relevant, based on their profile data and the problem statement.

- The agent will rank the recommendations based on relevance, which can be determined by a combination of factors such as the contact's experience, connections, and the confidence level of the match.

### Improvements with more time

- Implementing a feedback loop where users can provide feedback on the relevance of the recommendations, which can be used to improve the agent's reasoning over time.
- Expanding the dataset of contacts to include more detailed information, such as specific projects they've worked on, skills, and endorsements.
- Integrating additional data sources for enriching contact profiles, such as GitHub for developers or research publications for academics.
- Enhancing the UI to allow users to easily reach out to recommended contacts directly from the Slack interface, perhaps by providing pre-written messages or templates based on the problem statement.
- Implementing a more sophisticated ranking algorithm that takes into account not just relevance but also factors like the contact's availability, past interactions with the user, and mutual connections.
- Organizations may be able to provide access to data such as the resumes of their employees, which would allow for much richer profiles and more accurate recommendations. If such data were available, the agent could be designed to leverage it effectively while ensuring privacy and security considerations are met.

## Development Steps

1. Set up Next.js + deploy to Vercel + connect Slack app
2. Slack API → fetch workspace members
3. Tavily enrichment → cache in Firebase
4. Conversation flow + state management
5. LLM reasoning + ranking
6. Block Kit formatting
7. End-to-end testing
8. README

# Data Model

```
contacts: {
  "U123": {
    name: "Ali Khan",
    title: "ML Engineer",
    organization: "Acme Inc",

    slackData: {
      email: "...",
      avatar: "...",
    },

    enrichedData: {
      skills: ["python", "nlp", "ml"],
      experience: "Worked on recommendation systems",
      sources: ["linkedin", "github"]
    },

    keywords: ["ml", "ai", "data"],

    "summary": "Worked on transformer-based NLP systems", 


    lastUpdated: "timestamp"
  }
}
```

```

conversations: {
  "slackUserId": {
    messages: [
      {
        role: "user",
        content: "I need help with NLP project",
        timestamp: "..."
      },
      {
        role: "bot",
        content: "Can you clarify…",
        timestamp: "..."
      }
    ],

    state: "clarifying" 
    // or: "ready_to_recommend"
  }
}

```

```
recommendations: {
  "requestId": {
    userId: "U123",

    problemSummary: "User needs help with NLP model optimization",

    matches: [
      {
        contactId: "U456",
        score: 0.92,
        reason: "Worked on NLP + transformers"
      }
    ],

    createdAt: "timestamp"
  }
}


doc(db, "contacts", slackUserId)
```

- Every user message refines the problem statement and updates the conversation state until it's ready for recommendations. The decision to move from "clarifying" to "ready_to_recommend" can be based on a combination of factors, such as the number of messages exchanged, the presence of certain keywords in the conversation, or an explicit signal from the user (e.g., "I think that's all the info you need"). The LLM can also be used to analyze the conversation and determine if it has enough context to make recommendations.

- user message → partial problem state → LLM detects missing fields → asks targeted questions → updates state

```
problemState: {
  rawConversation: Message[],

  structured: {
    problemType: "technical" | "organizational" | "research" | "career" | ...,

    summary: string,

    keyNeeds: string[],        // e.g. ["nlp", "deployment", "scalability"]
    constraints: string[],     // e.g. ["fast turnaround", "production system"]
    urgency: "low" | "medium" | "high",

    entities: {
      tools?: string[],
      domains?: string[],
      systems?: string[]
    }
  },

  confidence: number,

  lastUpdated: timestamp,

  version: number
}
```

- There needs to be some notion of required vs optional fields in the problem state, to help guide the conversation.

```
  problemSchema = {
  problemType: required,
  summary: required,
  keyNeeds: required,
  constraints: optional,
  urgency: optional,
  domain: optional
}
```

- LLM Output:

```
{
  updatedStructuredState: {...},
  missingFields: ["keyNeeds", "urgency"],
  clarificationQuestions: [
    "What kind of work is this related to (e.g., ML, backend, design)?",
    "How urgent is this problem?"
  ],
  confidence: 0.72
}
```

structured problem (finalized)
→ retrieve + filter contacts
→ enrich + score
→ rank matches
→ explain + suggest outreach

if (confidence > 0.8 && requiredFieldsComplete) {
  state = "ready_to_recommend"
}

Instead of binary states, use a continuum:

0.0 – 0.3 → unclear
0.3 – 0.7 → clarifying
0.7 – 1.0 → executing

Recommendation Mode:

input → ranked list + explanation → user feedback → updated problem state → re-run ranking

```
RecommendationInput = {
  userId: string,

  problemState: {
    summary: string,
    keyNeeds: string[],
    constraints?: string[],
    urgency?: "low" | "medium" | "high",
    domain?: string
  },

  contacts: Contact[]  // pre-filtered or full pool

  conversationContext?: {
    lastUserMessage: string,
    previousRecommendations?: RecommendationSet
  }
}
```

```
RecommendationOutput = {
  recommendations: [
    {
      contactId: string,
      score: number, // 0–1

      why: string,   // human explanation

      strengthsMatched: string[],
      uncertainty: string[] // what’s missing / weak signal
    }
  ],

  summary: string, // short natural explanation

  confidence: number,

  suggestedNextAction: "wait_for_user" | "refine_query" | "ask_clarifying_question"
}
```

```
User feedback input
RecommendationFeedback = {
  type: "reject" | "refine" | "accept_partial" | "request_more",

  message: string, // "this is not relevant", "I need more backend people"

  rejectedContacts?: string[],
  preferredDirection?: string[]
}
```

- There needs to be a decision layer that determines when to ask for feedback and how to incorporate it. For example, if the user rejects a recommendation, the agent can analyze the feedback message to identify what was wrong (e.g., "not relevant", "need more senior people") and then update the problem state or adjust the ranking criteria accordingly before generating new recommendations.

- And if the user needs a new set of recommendations, for a different problem, the agent should be able to reset the conversation state and start fresh.
