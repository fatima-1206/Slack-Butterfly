/**
 * LLM client that handles both development (Groq) and production (GitHub GPT-4) models
 */

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
    return {
      provider: "github" as const,
      model: process.env.PRODUCTION_MODEL || "openai/gpt-4o",
      token: process.env.PRODUCTION_MODEL_TOKEN,
      baseUrl: "https://models.inference.ai.azure.com",
    };
  }

  return {
    provider: "groq" as const,
    model: process.env.DEVELOPMENT_MODEL || "meta-llama/llama-3.3-70b-versatile",
    token: process.env.DEVELOPMENT_MODEL_TOKEN,
    baseUrl: "https://api.groq.com/openai/v1",
  };
}

export async function callLLM(messages: LLMMessage[], temperature = 0.7): Promise<LLMResponse> {
  const config = getLLMConfig();

  if (!config.token) {
    throw new Error(`${config.provider.toUpperCase()} API token not configured`);
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    console.error(`LLM API error: ${response.status}`, error);
    throw new Error(`LLM API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
    };
  };

  const content = data.choices[0]?.message?.content || "";

  return {
    content,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
        }
      : undefined,
  };
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

Analyze the user's message and conversation history to extract a structured problem state. Determine:
1. What type of problem this is (technical, organizational, research, career, etc.)
2. A clear summary of the problem
3. Key needs or skills required
4. Constraints (timeline, resources, etc.)
5. Urgency level
6. Domain (backend, frontend, ML, design, etc.)

Required fields: problemType, summary, keyNeeds
Optional fields: constraints, urgency, domain

After analysis, determine:
- Which fields are missing
- What clarifying questions would help (if any)
- Your confidence level (0-1) that you understand the problem enough to find relevant people

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
  "missingFields": ["string"],
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

    return {
      updatedState: parsed.updatedState,
      missingFields: parsed.missingFields || [],
      clarificationQuestions: parsed.clarificationQuestions || [],
      confidence: parsed.confidence || 0.5,
      nextAction:
        parsed.confidence > 0.75 && parsed.missingFields.length === 0
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

    // Sort by score descending and return top 5
    return parsed
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, 5);
  } catch (error) {
    console.error("Failed to parse ranking response:", rankResponse.content, error);
    return [];
  }
}
