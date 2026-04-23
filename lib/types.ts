/**
 * Type definitions for the Slack butterfly agent
 */

export type ProblemType = 'technical' | 'organizational' | 'research' | 'career' | 'product' | 'other';
export type UrgencyLevel = 'low' | 'medium' | 'high';
export type ConversationState = 'unclear' | 'clarifying' | 'ready_to_recommend' | 'executing';
export type FeedbackType = 'reject' | 'refine' | 'accept_partial' | 'request_more';

/**
 * Structured problem representation
 */
export interface StructuredProblem {
  problemType?: ProblemType;
  summary?: string;
  keyNeeds: string[];
  constraints?: string[];
  urgency?: UrgencyLevel;
  domain?: string;
  entities?: {
    tools?: string[];
    domains?: string[];
    systems?: string[];
  };
}

/**
 * Problem state - evolves as conversation progresses
 */
export interface ProblemState {
  rawConversation: ConversationMessage[];
  structured: Partial<StructuredProblem>;
  confidence: number; // 0.0 to 1.0
  lastUpdated: number; // timestamp
  version: number;
}

/**
 * Single message in a conversation
 */
export interface ConversationMessage {
  role: 'user' | 'bot';
  content: string;
  timestamp: number;
}

/**
 * Conversation record for a user
 */
export interface Conversation {
  userId: string;
  teamId: string;
  channelId?: string;
  messages: ConversationMessage[];
  state: ConversationState;
  problemState: ProblemState;
  createdAt: number;
  updatedAt: number;
}

/**
 * Basic contact from Slack
 */
export interface SlackContact {
  id: string;
  name: string;
  email?: string;
  title?: string;
  organization?: string;
  avatar?: string;
}

/**
 * Enriched contact with additional data
 */
export interface EnrichedContact extends SlackContact {
  skills: string[];
  experience: string;
  summary: string;
  sources: string[]; // where enrichment came from
  keywords: string[];
  lastUpdated: number;
}

/**
 * Contact with relevance scoring
 */
export interface ScoredContact extends EnrichedContact {
  relevanceScore: number; // 0.0 to 1.0
  matchedSkills: string[];
  reasoning: string;
  uncertainty?: string[];
}

/**
 * A single recommendation
 */
export interface Recommendation {
  contactId: string;
  contact: ScoredContact;
  score: number; // 0–1
  why: string; // human explanation
  strengthsMatched: string[];
  uncertainty?: string[];
}

/**
 * Output from the recommendation engine
 */
export interface RecommendationOutput {
  recommendations: Recommendation[];
  summary: string; // short natural explanation
  confidence: number; // overall confidence in the set of recommendations
  suggestedNextAction: 'wait_for_user' | 'refine_query' | 'ask_clarifying_question';
}

/**
 * User feedback on recommendations
 */
export interface RecommendationFeedback {
  type: FeedbackType;
  message: string;
  rejectedContacts?: string[];
  preferredDirection?: string[];
}

/**
 * LLM reasoning output for problem analysis
 */
export interface ProblemAnalysisOutput {
  updatedStructuredState: Partial<StructuredProblem>;
  missingFields: string[];
  clarificationQuestions: string[];
  confidence: number;
}
