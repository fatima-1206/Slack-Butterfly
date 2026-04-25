/**
 * LLM client that handles both development (Groq) and production (GitHub GPT-4) models
 */

import OpenAI from "openai";
import { Groq } from "groq-sdk";
import { validateContact } from "@/lib/contacts";

type LLMProvider = "groq" | "github";

type ProblemState = {
  problemType?: string;
  summary: string;
  keyNeeds: string[];
  constraints?: string[];
  urgency?: "low" | "medium" | "high";
  domain?: string;
};

type ConversationAction = "clarify" | "ready_to_recommend" | "refine" | "reset";

type RecommendationRefinement = {
  preferredDirections: string[];
  avoidSignals: string[];
  excludedContactIds: string[];
  summary?: string;
};

type RawProblemState = Partial<ProblemState>;

type RawAnalysisResponse = {
  updatedState?: RawProblemState;
  missingFields?: unknown;
  clarificationQuestions?: unknown;
  confidence?: unknown;
  nextAction?: unknown;
  refinement?: Partial<RecommendationRefinement>;
  reasoning?: unknown;
};

type RankedContactRecord = {
  contactId: string;
  score: number;
  why: string;
  strengthsMatched: string[];
  uncertainty: string[];
  suggestedAsk?: string;
};

export type ConversationAnalysis = {
  updatedState: ProblemState;
  missingFields: string[];
  clarificationQuestions: string[];
  confidence: number;
  nextAction: ConversationAction;
  refinement: RecommendationRefinement;
  reasoning?: string;
};

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

type LLMConfig = {
  provider: LLMProvider;
  model: string;
  token?: string;
  endpoint?: string;
};

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseJsonFromResponse<T>(content: string, fallback: T): T {
  try {
    // Try parsing the content as-is first
    try {
      const parsed = JSON.parse(content);
      return parsed as T;
    } catch {
      // If that fails, try to extract JSON by finding brackets
    }
    
    // For arrays, look for the first [ and last ]
    if (Array.isArray(fallback)) {
      const arrayStart = content.indexOf("[");
      const arrayEnd = content.lastIndexOf("]");
      if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
        const jsonStr = content.substring(arrayStart, arrayEnd + 1);
        const parsed = JSON.parse(jsonStr);
        return parsed as T;
      }
    } else {
      // For objects, look for the first { and last }
      const objStart = content.indexOf("{");
      const objEnd = content.lastIndexOf("}");
      if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
        const jsonStr = content.substring(objStart, objEnd + 1);
        const parsed = JSON.parse(jsonStr);
        return parsed as T;
      }
    }

    // Last resort: try the old regex method
    const jsonMatch = content.match(/\{[\s\S]*?\}/) || content.match(/\[[\s\S]*?\]/);
    const jsonStr = jsonMatch?.[0] || content;
    const parsed = JSON.parse(jsonStr);
    return parsed as T;
  } catch (error) {
    console.error("[Parser] Failed to extract JSON from content (length:", content.length, ", error:", (error as Error).message, ")");
    return fallback;
  }
}

function extractFallbackSignals(text: string): {
  preferredDirections: string[];
  avoidSignals: string[];
  excludedContactIds: string[];
} {
  const lower = text.toLowerCase();
  const preferredDirections: string[] = [];
  const avoidSignals: string[] = [];

  const directionPatterns = [
    { pattern: /more\s+(backend|frontend|design|product|ml|data|security|devops)\b/g, label: "$1" },
    { pattern: /\b(senior|staff|principal|lead)\b/g, label: "$1" },
    { pattern: /\b(backend|frontend|design|product|ml|data|security|devops)\b/g, label: "$1" },
  ];

  for (const { pattern } of directionPatterns) {
    const matches = lower.match(pattern);
    if (matches) {
      for (const match of matches) {
        preferredDirections.push(match.replace(/\bmore\s+/g, "").trim());
      }
    }
  }

  if (lower.includes("not relevant") || lower.includes("wrong person")) {
    avoidSignals.push("not relevant");
  }
  if (lower.includes("too junior") || lower.includes("more senior")) {
    avoidSignals.push("more senior");
  }

  return {
    preferredDirections: [...new Set(preferredDirections.filter(Boolean))],
    avoidSignals: [...new Set(avoidSignals)],
    excludedContactIds: [],
  };
}

function buildContactSignalText(contact: {
  name: string;
  title: string;
  organization: string;
  summary?: string;
  skills?: string[];
  experience?: string;
}): string {
  return [
    contact.name,
    contact.title,
    contact.organization,
    contact.summary || "",
    contact.skills?.join(" ") || "",
    contact.experience || "",
  ]
    .join(" ")
    .toLowerCase();
}

function computeHeuristicMatchScore(
  problemState: ProblemState,
  contact: {
    name: string;
    title: string;
    organization: string;
    summary?: string;
    skills?: string[];
    experience?: string;
  },
  refinement?: RecommendationRefinement
): number {
  const text = buildContactSignalText(contact);
  const signals = [
    ...problemState.keyNeeds,
    ...(problemState.domain ? [problemState.domain] : []),
    ...(problemState.constraints || []),
    ...(refinement?.preferredDirections || []),
  ]
    .map((signal) => signal.toLowerCase().trim())
    .filter(Boolean);

  if (signals.length === 0) {
    return 0;
  }

  let matchedSignals = 0;
  for (const signal of signals) {
    const normalized = signal.replace(/[^a-z0-9+\s-]/g, "").trim();
    if (!normalized) {
      continue;
    }

    if (text.includes(normalized)) {
      matchedSignals += 1;
    }
  }

  const baseScore = matchedSignals / signals.length;
  const bonus = contact.skills?.length ? Math.min(contact.skills.length * 0.03, 0.12) : 0;
  return Math.min(1, baseScore + bonus);
}

function mergeSignals(existing: string[] = [], incoming: string[] = []): string[] {
  return [...new Set([...existing, ...incoming].map((item) => item.trim()).filter(Boolean))];
}

function getLLMProvider(): LLMProvider {
  return process.env.NODE_ENV === "production" ? "github" : "groq";
}

function getProviderConfig(provider: LLMProvider): LLMConfig {
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

function getLLMConfig(): LLMConfig {
  const provider = getLLMProvider();
  const config = getProviderConfig(provider);
  console.log(`Using ${provider === "github" ? "GitHub GPT-4" : "Groq"} model for LLM interactions`);
  return config;
}

function getFallbackProvider(provider: LLMProvider): LLMProvider {
  return provider === "github" ? "groq" : "github";
}

function isTransientLLMError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = "status" in error ? Number((error as { status?: unknown }).status) : NaN;
  if ([408, 409, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  if (["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENOTFOUND"].includes(code)) {
    return true;
  }

  const message = "message" in error ? String((error as { message?: unknown }).message || "").toLowerCase() : "";
  return message.includes("server had an error") || message.includes("temporarily") || message.includes("timeout");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callProvider(
  config: LLMConfig,
  messages: LLMMessage[],
  temperature: number,
  maxTokens: number
): Promise<LLMResponse> {
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
      max_tokens: maxTokens,
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

  const client = new Groq({ apiKey: config.token });

  const response = await client.chat.completions.create({
    model: config.model,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature,
    max_tokens: maxTokens,
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

export async function callLLM(messages: LLMMessage[], temperature = 0.7, maxTokens = 1024): Promise<LLMResponse> {
  const primaryConfig = getLLMConfig();
  const fallbackConfig = getProviderConfig(getFallbackProvider(primaryConfig.provider));
  const providers: LLMConfig[] = [primaryConfig, fallbackConfig];

  let lastError: unknown;

  for (const providerConfig of providers) {
    if (!providerConfig.token) {
      console.warn(`[LLM] Skipping ${providerConfig.provider}: token not configured`);
      continue;
    }

    const maxAttempts = providerConfig.provider === primaryConfig.provider ? 2 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (providerConfig.provider !== primaryConfig.provider) {
          console.warn(`[LLM] Falling back to ${providerConfig.provider} provider`);
        }
        return await callProvider(providerConfig, messages, temperature, maxTokens);
      } catch (error) {
        lastError = error;
        const transient = isTransientLLMError(error);
        const status =
          error && typeof error === "object" && "status" in error
            ? (error as { status?: unknown }).status
            : "unknown";
        console.error(
          `[LLM] ${providerConfig.provider} attempt ${attempt}/${maxAttempts} failed (status=${String(status)}, transient=${transient})`
        );

        if (!transient || attempt === maxAttempts) {
          break;
        }

        await sleep(350 * attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("LLM request failed after retries and provider fallback");
}

export async function analyzeConversation(
  userMessage: string,
  conversationHistory: LLMMessage[]
): Promise<ConversationAnalysis> {
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
- If the user is giving feedback on previous recommendations, set nextAction to "refine" and populate refinement.
- If the user asks to start over, set nextAction to "reset".
- If required fields are reasonably inferred, return confidence >= 0.7.
- Prefer moving forward to recommendations over over-questioning.
- Preserve the original problem statement when the user is refining recommendations; update it only if the user's feedback changes the goal.

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
  "nextAction": "clarify|ready_to_recommend|refine|reset",
  "refinement": {
    "preferredDirections": ["string"],
    "avoidSignals": ["string"],
    "excludedContactIds": ["string"],
    "summary": "string"
  },
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
    const parsed = parseJsonFromResponse<RawAnalysisResponse>(response.content, {});

    const updatedState: ProblemState = {
      summary:
        typeof parsed.updatedState?.summary === "string" && parsed.updatedState.summary.trim().length > 0
          ? parsed.updatedState.summary.trim()
          : userMessage,
      keyNeeds: normalizeStringArray(parsed.updatedState?.keyNeeds),
      problemType:
        typeof parsed.updatedState?.problemType === "string" &&
        parsed.updatedState.problemType.trim().length > 0
          ? parsed.updatedState.problemType.trim()
          : undefined,
      constraints: normalizeStringArray(parsed.updatedState?.constraints),
      urgency:
        parsed.updatedState?.urgency === "low" ||
        parsed.updatedState?.urgency === "medium" ||
        parsed.updatedState?.urgency === "high"
          ? parsed.updatedState.urgency
          : undefined,
      domain:
        typeof parsed.updatedState?.domain === "string" && parsed.updatedState.domain.trim().length > 0
          ? parsed.updatedState.domain.trim()
          : undefined,
    };

    const requiredMissing = (["problemType", "summary", "keyNeeds"] as const).filter((field) => {
      if (field === "keyNeeds") {
        return updatedState.keyNeeds.length === 0;
      }

      const value = updatedState[field];
      return typeof value !== "string" || value.trim().length === 0;
    });

    const clarificationQuestions = normalizeStringArray(parsed.clarificationQuestions).slice(0, 2);

    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    const parsedNextAction = typeof parsed.nextAction === "string" ? parsed.nextAction : undefined;
    const refinementSignals = parsed.refinement || {};

    const fallbackSignals = extractFallbackSignals(userMessage);
    const normalizedRefinement: RecommendationRefinement = {
      preferredDirections: mergeSignals(
        normalizeStringArray(refinementSignals.preferredDirections),
        fallbackSignals.preferredDirections
      ),
      avoidSignals: mergeSignals(
        normalizeStringArray(refinementSignals.avoidSignals),
        fallbackSignals.avoidSignals
      ),
      excludedContactIds: mergeSignals(
        normalizeStringArray(refinementSignals.excludedContactIds),
        fallbackSignals.excludedContactIds
      ),
      summary:
        typeof refinementSignals.summary === "string" && refinementSignals.summary.trim().length > 0
          ? refinementSignals.summary.trim()
          : undefined,
    };

    const nextActionFromModel: ConversationAction =
      parsedNextAction === "refine" || parsedNextAction === "reset" || parsedNextAction === "clarify"
        ? parsedNextAction
        : requiredMissing.length === 0 && confidence >= 0.6
          ? "ready_to_recommend"
          : "clarify";

    const refinementDrivenAction: ConversationAction =
      nextActionFromModel === "clarify" && normalizedRefinement.preferredDirections.length > 0
        ? "refine"
        : nextActionFromModel;

    return {
      updatedState,
      missingFields: requiredMissing,
      clarificationQuestions,
      confidence,
      nextAction: refinementDrivenAction,
      refinement: normalizedRefinement,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : undefined,
    };
  } catch (error) {
    console.error("Failed to parse LLM response:", response.content, error);
    const fallbackSignals = extractFallbackSignals(userMessage);
    const hasEnoughContext = /\b(help|need|need help|looking for|who should|recommend|find|backend|frontend|design|ml|data)\b/i.test(
      userMessage
    );
    // Fallback
    return {
      updatedState: { summary: userMessage, keyNeeds: fallbackSignals.preferredDirections },
      missingFields: hasEnoughContext ? ["problemType"] : ["problemType", "keyNeeds"],
      clarificationQuestions: ["What kind of help do you need, and what should I optimize for?"],
      confidence: hasEnoughContext ? 0.55 : 0.3,
      nextAction: hasEnoughContext ? "refine" : "clarify",
      refinement: fallbackSignals,
    };
  }
}

export async function analyzeRecommendationFeedback(
  userMessage: string,
  currentProblemState: ProblemState,
  conversationHistory: LLMMessage[]
): Promise<ConversationAnalysis> {
  const systemPrompt = `You interpret feedback on prior recommendations.

The user may be:
- rejecting one or more people
- asking for more of a specific profile
- refining the target (for example: more senior, more backend, more design, more domain-specific)
- starting over

Return the same JSON shape as the conversation analyzer, but focus on refining the problem state and recommendation signals.

Rules:
- If the user explicitly asks to start over, set nextAction to "reset".
- If the user is asking for a different recommendation angle, set nextAction to "refine".
- Keep the original problem summary unless the user clearly changes the task.
- Update keyNeeds and constraints to reflect the feedback.
- Populate refinement.preferredDirections with concrete direction words.
- Populate refinement.avoidSignals when the user indicates what not to show again.

Respond with ONLY valid JSON, no markdown or extra text.`;

  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "system",
      content: `Current problem state: ${JSON.stringify(currentProblemState)}`,
    },
    ...conversationHistory,
    { role: "user", content: userMessage },
  ];

  const response = await callLLM(messages, 0.35);

  const parsed = parseJsonFromResponse<RawAnalysisResponse>(response.content, {});
  const fallbackSignals = extractFallbackSignals(userMessage);
  const refinedPreferredDirections = mergeSignals(
    normalizeStringArray(parsed?.refinement?.preferredDirections),
    fallbackSignals.preferredDirections
  );
  const refinedAvoidSignals = mergeSignals(
    normalizeStringArray(parsed?.refinement?.avoidSignals),
    fallbackSignals.avoidSignals
  );

  const mergedState: ProblemState = {
    ...currentProblemState,
    problemType:
      typeof parsed?.updatedState?.problemType === "string" && parsed.updatedState.problemType.trim().length > 0
        ? parsed.updatedState.problemType.trim()
        : currentProblemState.problemType,
    summary:
      typeof parsed?.updatedState?.summary === "string" && parsed.updatedState.summary.trim().length > 0
        ? parsed.updatedState.summary.trim()
        : currentProblemState.summary,
    keyNeeds: mergeSignals(
      currentProblemState.keyNeeds,
      normalizeStringArray(parsed?.updatedState?.keyNeeds)
        .concat(refinedPreferredDirections)
        .concat(fallbackSignals.preferredDirections)
    ),
    constraints: mergeSignals(
      currentProblemState.constraints || [],
      normalizeStringArray(parsed?.updatedState?.constraints).concat(refinedAvoidSignals)
    ),
    urgency:
      parsed?.updatedState?.urgency === "low" ||
      parsed?.updatedState?.urgency === "medium" ||
      parsed?.updatedState?.urgency === "high"
        ? parsed.updatedState.urgency
        : currentProblemState.urgency,
    domain:
      typeof parsed?.updatedState?.domain === "string" && parsed.updatedState.domain.trim().length > 0
        ? parsed.updatedState.domain.trim()
        : currentProblemState.domain,
  };

  const nextAction: ConversationAction =
    typeof parsed?.nextAction === "string" &&
    (parsed.nextAction === "refine" || parsed.nextAction === "reset" || parsed.nextAction === "clarify")
      ? parsed.nextAction
      : "refine";

  return {
    updatedState: mergedState,
    missingFields: [],
    clarificationQuestions: normalizeStringArray(parsed?.clarificationQuestions).slice(0, 2),
    confidence: typeof parsed?.confidence === "number" ? parsed.confidence : 0.7,
    nextAction,
    refinement: {
      preferredDirections: refinedPreferredDirections,
      avoidSignals: refinedAvoidSignals,
      excludedContactIds: mergeSignals(
        normalizeStringArray(parsed?.refinement?.excludedContactIds),
        fallbackSignals.excludedContactIds
      ),
      summary:
        typeof parsed?.refinement?.summary === "string" && parsed.refinement.summary.trim().length > 0
          ? parsed.refinement.summary.trim()
          : undefined,
    },
    reasoning: typeof parsed?.reasoning === "string" ? parsed.reasoning : undefined,
  };
}

export async function rankContacts(
  problemState: ProblemState,
  contacts: Array<{
    id: string;
    name: string;
    title: string;
    organization: string;
    summary?: string;
    skills?: string[];
    experience?: string;
  }>,
  refinement?: RecommendationRefinement,
  requesterRole?: "developer" | "pm" | "designer" | "leadership" | "other"
): Promise<RankedContactRecord[]> {

  console.log("DEBUG: Starting contact ranking with", contacts.length, "contacts, requesterRole:", requesterRole, "and refinement:", refinement);
  const excludedContactIds = new Set(refinement?.excludedContactIds || []);
  const candidatePool = contacts.filter((contact) => !excludedContactIds.has(contact.id));

  console.log("DEBUG: Candidate pool size after filtering:", candidatePool.length);

  if (candidatePool.length === 0) {
    return [];
  }

  // If too many contacts, filter first
  let filteredContacts = candidatePool;
  if (candidatePool.length > 20) {

    console.log(`Filtering down from ${candidatePool.length} contacts before ranking...`);
    const filterPrompt = `Given this problem, which of these ${candidatePool.length} people would be worth investigating further?
    
Problem needs: ${problemState.keyNeeds.join(", ")}
Domain: ${problemState.domain || "unspecified"}
Refinement signal: ${refinement?.preferredDirections.join(", ") || "none"}
Avoid signal: ${refinement?.avoidSignals.join(", ") || "none"}

Return up to 10 contact IDs that seem most relevant. Respond with only a JSON array of IDs like ["id1", "id2", ...]:

Contacts:
${candidatePool.map((c) => `- ${c.id}: ${c.name} (${c.title} at ${c.organization})`).join("\n")}`;

    const filterResponse = await callLLM(
      [{ role: "user", content: filterPrompt }],
      0.3
    );

    try {
      const filtered = normalizeStringArray(parseJsonFromResponse(filterResponse.content, []));
      filteredContacts = candidatePool.filter((c) => filtered.includes(c.id));
    } catch {
      // If filtering fails, use top contacts by name match
      console.log("LLM filtering failed, falling back to heuristic name matching...");
      filteredContacts = candidatePool.slice(0, 10);
    }
  }

  if (filteredContacts.length === 0) {

    console.log("LLM filtering resulted in no candidates, falling back to heuristic filtering...");
    filteredContacts = candidatePool.slice(0, 10);
  }

  const rankingPrompt = `You are matching people to solve a specific problem.

REQUESTER CONTEXT:
- Role: ${requesterRole || "unknown"}
- Note: Different roles have different needs. A developer may want implementation details, while a PM may want strategy/roadmap input.

PROBLEM:
${JSON.stringify(problemState, null, 2)}

REFINEMENT:
${JSON.stringify(refinement || { preferredDirections: [], avoidSignals: [], excludedContactIds: [] }, null, 2)}

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
- suggestedAsk: a specific question you should ask them about your problem (e.g., "Can you share your experience with llama models in production?")

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
    "uncertainty": ["string"],
    "suggestedAsk": "string"
  }
]`;

  const rankResponse = await callLLM(
    [{ role: "user", content: rankingPrompt }],
    0.3,
    2048 // Increase max_tokens for ranking - needs space for detailed JSON
  );

  console.log("[Ranking] LLM Response (length:", rankResponse.content.length, "):");
  console.log("[Ranking] Full response:", rankResponse.content);

  try {
    const parsed = parseJsonFromResponse<
      Array<Partial<RankedContactRecord>>
    >(rankResponse.content, []);
    console.log("[Ranking] Parsed", parsed.length, "candidates from LLM response");

    const scored: RankedContactRecord[] = parsed
      .filter(
        (record): record is RankedContactRecord =>
          typeof record.contactId === "string" &&
          typeof record.score === "number" &&
          Number.isFinite(record.score) &&
          typeof record.why === "string" &&
          Array.isArray(record.strengthsMatched) &&
          Array.isArray(record.uncertainty) &&
          (typeof record.suggestedAsk === "string" || record.suggestedAsk === undefined)
      )
      .map((rec) => {
        const contact = filteredContacts.find((item) => item.id === rec.contactId);
        if (!contact) {
          return rec;
        }

        // Patch: ensure contact has all required Contact fields for validation
        const contactForValidation = { email: '', ...contact };

        // Validate that we matched the right person
        const validation = validateContact(contactForValidation, problemState.keyNeeds);
        if (!validation.isValid) {
          console.log(`[Ranking] Contact ${contact.name} failed validation:`, validation.issues);
        }

        const heuristicScore = computeHeuristicMatchScore(problemState, contact, refinement);
        let blendedScore = Math.min(1, Math.max(0, rec.score * 0.8 + heuristicScore * 0.2));
        
        // Apply validation confidence penalty
        blendedScore = blendedScore * validation.confidence;
        
        console.log(`[Ranking] ${contact.name}: LLM=${rec.score.toFixed(2)}, heuristic=${heuristicScore.toFixed(2)}, validationConfidence=${validation.confidence.toFixed(2)}, final=${blendedScore.toFixed(2)}`);

        const strengthsMatched = new Set(normalizeStringArray(rec.strengthsMatched));

        const signalText = buildContactSignalText(contact);
        [...problemState.keyNeeds, ...(refinement?.preferredDirections || [])].forEach((signal) => {
          const normalized = signal.toLowerCase().trim();
          if (normalized && signalText.includes(normalized)) {
            strengthsMatched.add(signal);
          }
        });

        // Add validation issues to uncertainty
        const uncertainty = [...rec.uncertainty];
        if (validation.issues.length > 0) {
          uncertainty.push(...validation.issues);
        }

        return {
          ...rec,
          score: blendedScore,
          strengthsMatched: [...strengthsMatched],
          uncertainty,
        };
      });

    // Sort by score descending
    const sorted = scored.sort((a, b) => b.score - a.score);
    
    // Apply smart filtering:
    // 1. Always require score >= 0.40 at minimum
    // 2. If top candidate is good (>= 0.55), be stricter with others (require 0.40)
    // 3. If top candidate is weak, require at least 0.30
    // 4. Look for big gaps in scores and stop there
    
    const topScore = sorted[0]?.score || 0;
    const minScoreThreshold = topScore >= 0.55 ? 0.40 : 0.35;
    
    const filtered: RankedContactRecord[] = [];
    for (let i = 0; i < sorted.length && filtered.length < 5; i++) {
      const candidate = sorted[i];
      
      // Skip if below minimum threshold
      if (candidate.score < minScoreThreshold) {
        console.log("[Ranking] Skipping", candidate.contactId, "score", candidate.score, "< min", minScoreThreshold);
        break;
      }
      
      // Check for significant score gap (drop of > 0.25 between consecutive candidates)
      if (filtered.length > 0) {
        const prev = filtered[filtered.length - 1];
        const gap = prev.score - candidate.score;
        if (gap > 0.25 && candidate.score < 0.50) {
          console.log("[Ranking] Breaking at gap:", gap.toFixed(2), "between score", prev.score.toFixed(2), "and", candidate.score.toFixed(2));
          break;
        }
      }
      
      filtered.push(candidate);
    }
    
    if (filtered.length === 0 && sorted.length > 0) {
      console.log("[Ranking] No confident matches found; returning top 2 low-confidence candidates");
      const fallback = sorted.slice(0, 2).map((candidate) => ({
        ...candidate,
        why: `I could not find a confident match, but ${candidate.why}`,
        uncertainty: [
          "No confident matches met the threshold; these are best-effort suggestions.",
          ...candidate.uncertainty,
        ],
      }));

      console.log(
        "[Ranking] Fallback results:",
        fallback.map((r) => ({ contactId: r.contactId, score: (r.score * 100).toFixed(1) + "%" }))
      );
      return fallback;
    }

    console.log("[Ranking] After smart filtering:", filtered.length, "candidates remaining");
    console.log("[Ranking] Results:", filtered.map((r) => ({ contactId: r.contactId, score: (r.score * 100).toFixed(1) + "%" })));
    return filtered;
  } catch (error) {
    console.error("[Ranking] Failed to parse ranking response:", rankResponse.content, error);
    console.log("[Ranking] Falling back to heuristic scoring for", filteredContacts.length, "contacts");
    const heuristicResults = filteredContacts
      .map((contact) => ({
        contactId: contact.id,
        score: computeHeuristicMatchScore(problemState, contact, refinement),
        why: `${contact.name} appears relevant based on title, summary, or skills, but the model response could not be parsed.`,
        strengthsMatched: mergeSignals(problemState.keyNeeds, refinement?.preferredDirections || []).filter(
          (signal) => buildContactSignalText(contact).includes(signal.toLowerCase())
        ),
        uncertainty: ["Model parsing failed, so this ranking is heuristic only."],
        suggestedAsk: `Can you share your experience with ${problemState.keyNeeds.slice(0, 2).join(" and ")}?`,
      }))
      .filter((candidate) => candidate.score >= 0.20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
    console.log("[Ranking] Heuristic fallback returned", heuristicResults.length, "candidates");
    return heuristicResults;
  }
}
