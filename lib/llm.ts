/**
 * LLM client that handles both development (Groq) and production (GitHub GPT-4) models
 */

import OpenAI from "openai";
import { Groq } from "groq-sdk";

type LLMProvider = "groq" | "github";

interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

function getLLMProvider(): LLMProvider {
  return process.env.NODE_ENV === "production" ? "github" : "groq";
}

function getLLMConfig() {
  const provider = getLLMProvider();

  if (provider === "github") {
    console.log("Using GitHub GPT-4 model for LLM interactions");
    return {
      provider: "github" as const,
      model: process.env.PRODUCTION_MODEL || "openai/gpt-4o",
      token: process.env.PRODUCTION_MODEL_TOKEN,
      endpoint: "https://models.github.ai/inference",
    };
  }

  console.log("Using Groq model for LLM interactions");
  return {
    provider: "groq" as const,
    model: process.env.DEVELOPMENT_MODEL || "llama-3.3-70b-versatile",
    token: process.env.DEVELOPMENT_MODEL_TOKEN,
  };
}

export async function callLLM(messages: LLMMessage[], temperature = 0.7): Promise<LLMResponse> {
  const config = getLLMConfig();

  if (!config.token) {
    throw new Error(`${config.provider.toUpperCase()} API token not configured`);
  }

  if (config.provider === "github") {
    const client = new OpenAI({
      baseURL: config.endpoint,
      apiKey: config.token,
    });

    const response = await client.chat.completions.create({
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature,
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || "";

    return {
      content,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  } else {
    // Groq provider
    const client = new Groq({ apiKey: config.token });

    const response = await client.chat.completions.create({
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature,
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || "";

    return {
      content,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

export async function analyzeConversation(
  userMessage: string,
  conversationHistory: LLMMessage[]
): Promise<{
  updatedState: {
    problemType?: string;
    summary: string;
    keyNeeds: string[];
    constraints?: string[];
    urgency?: "low" | "medium" | "high";
    domain?: string;
  };
  missingFields: string[];
  clarificationQuestions: string[];
  confidence: number;
  nextAction: "clarify" | "ready_to_recommend";
}> {
  const systemPrompt = `You are an expert at understanding problems and identifying which people in a network could help solve them.

Analyze the user's message and conversation history to extract a structured problem state.

REQUIRED fields:
- problemType
- summary
- keyNeeds

OPTIONAL fields:
- constraints
- urgency
- domain

Rules:
- Only include REQUIRED fields in missingFields.
- Do not ask clarifying questions about OPTIONAL fields unless the user explicitly asks for that depth.
- Ask at most 2 clarification questions.
- If required fields are reasonably inferred, return confidence >= 0.7.
- Prefer moving forward to recommendations over over-questioning.

Respond with ONLY valid JSON, no markdown or extra text:
{
  "updatedState": {
    "problemType": "string or null",
    "summary": "string",
    "keyNeeds": ["string"],
    "constraints": ["string or null"],
    "urgency": "low|medium|high or null",
    "domain": "string or null"
  },
  "missingFields": ["problemType|summary|keyNeeds"],
  "clarificationQuestions": ["string"],
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const response = await callLLM(messages, 0.5);

  try {
    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch?.[0] || response.content);

    const updatedState = parsed.updatedState || {};
    const requiredMissing = ["problemType", "summary", "keyNeeds"].filter((field) => {
      if (field === "keyNeeds") {
        return !Array.isArray(updatedState.keyNeeds) || updatedState.keyNeeds.length === 0;
      }

      return !updatedState[field] || String(updatedState[field]).trim().length === 0;
    });

    const clarificationQuestions = Array.isArray(parsed.clarificationQuestions)
      ? parsed.clarificationQuestions.slice(0, 2)
      : [];

    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;

    return {
      updatedState,
      missingFields: requiredMissing,
      clarificationQuestions,
      confidence,
      nextAction:
        requiredMissing.length === 0 && confidence >= 0.6
          ? "ready_to_recommend"
          : "clarify",
    };
  } catch (error) {
    console.error("Failed to parse LLM response:", response.content, error);
    // Fallback
    return {
      updatedState: { summary: userMessage, keyNeeds: [] },
      missingFields: ["problemType", "keyNeeds"],
      clarificationQuestions: ["Can you describe what you need help with?"],
      confidence: 0.3,
      nextAction: "clarify",
    };
  }
}

export async function rankContacts(
  problemState: {
    summary: string;
    keyNeeds: string[];
    constraints?: string[];
    urgency?: string;
    domain?: string;
  },
  contacts: Array<{
    id: string;
    name: string;
    title: string;
    organization: string;
    summary?: string;
    skills?: string[];
    experience?: string;
  }>
): Promise<
  Array<{
    contactId: string;
    score: number;
    why: string;
    strengthsMatched: string[];
    uncertainty: string[];
  }>
> {
  if (contacts.length === 0) {
    return [];
  }

  // If too many contacts, filter first
  let filteredContacts = contacts;
  if (contacts.length > 20) {
    const filterPrompt = `Given this problem, which of these ${contacts.length} people would be worth enriching and investigating further?
    
Problem needs: ${problemState.keyNeeds.join(", ")}
Domain: ${problemState.domain || "unspecified"}

Return up to 10 contact IDs that seem most relevant. Respond with only a JSON array of IDs like ["id1", "id2", ...]:

Contacts:
${contacts.map((c) => `- ${c.id}: ${c.name} (${c.title} at ${c.organization})`).join("\n")}`;

    const filterResponse = await callLLM(
      [{ role: "user", content: filterPrompt }],
      0.3
    );

    try {
      const filtered = JSON.parse(filterResponse.content);
      filteredContacts = contacts.filter((c) => filtered.includes(c.id));
    } catch {
      // If filtering fails, use top contacts by name match
      filteredContacts = contacts.slice(0, 10);
    }
  }

  const rankingPrompt = `You are matching people to solve a specific problem.

PROBLEM:
${JSON.stringify(problemState, null, 2)}

CANDIDATES:
${filteredContacts
  .map(
    (c) => `
ID: ${c.id}
Name: ${c.name}
Title: ${c.title}
Organization: ${c.organization}
Summary: ${c.summary || "Not provided"}
Skills: ${c.skills?.join(", ") || "Not provided"}
Experience: ${c.experience || "Not provided"}
`
  )
  .join("\n---\n")}

For each candidate, provide a JSON object with:
- score (0-1): How relevant they are
- why: 1-2 sentence explanation
- strengthsMatched: array of specific strengths that match the problem
- uncertainty: array of factors that make you uncertain (missing info, potential mismatches)

Scoring rules:
- Use low scores (0.0-0.35) when evidence is weak or missing.
- Only use score >= 0.6 when there is clear evidence from title/skills/summary.
- If no candidate is a strong fit, you may return an empty array.

Respond with ONLY a JSON array, no markdown:
[
  {
    "contactId": "id",
    "score": 0.0-1.0,
    "why": "string",
    "strengthsMatched": ["string"],
    "uncertainty": ["string"]
  }
]`;

  const rankResponse = await callLLM(
    [{ role: "user", content: rankingPrompt }],
    0.3
  );

  try {
    const jsonMatch = rankResponse.content.match(/\[[\s\S]*\]/);
    const parsed = JSON.parse(jsonMatch?.[0] || rankResponse.content);

    // Sort by score descending, drop weak matches, and return top 5.
    return parsed
      .filter(
        (r: { score?: number; contactId?: string }) =>
          typeof r.score === "number" && Number.isFinite(r.score) && r.score >= 0.35 && !!r.contactId
      )
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, 5);
  } catch (error) {
    console.error("Failed to parse ranking response:", rankResponse.content, error);
    return [];
  }
}
