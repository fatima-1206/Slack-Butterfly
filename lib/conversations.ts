/**
 * Conversation state management using Firebase
 */

import { getFirestore } from "./firebase";

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ProblemState {
  problemType?: string;
  summary: string;
  keyNeeds: string[];
  constraints?: string[];
  urgency?: "low" | "medium" | "high";
  domain?: string;
}

export interface ConversationRecord {
  userId: string;
  messages: Message[];
  problemState: ProblemState;
  state: "clarifying" | "ready_to_recommend" | "recommending";
  confidence: number;
  lastUpdated: any;
  version: number;
}

const CONVERSATIONS_COLLECTION = "conversations";

export async function getConversation(userId: string): Promise<ConversationRecord | null> {
  try {
    const db = getFirestore();
    const docSnap = await db.collection(CONVERSATIONS_COLLECTION).doc(userId).get();

    if (!docSnap.exists) {
      return null;
    }

    return docSnap.data() as ConversationRecord;
  } catch (error) {
    console.error(`Failed to get conversation for user ${userId}:`, error);
    return null;
  }
}

export async function createConversation(userId: string): Promise<ConversationRecord> {
  const newConversation: ConversationRecord = {
    userId,
    messages: [],
    problemState: {
      summary: "",
      keyNeeds: [],
    },
    state: "clarifying",
    confidence: 0,
    lastUpdated: new Date(),
    version: 1,
  };

  try {
    const db = getFirestore();
    await db.collection(CONVERSATIONS_COLLECTION).doc(userId).set(newConversation);
    return newConversation;
  } catch (error) {
    console.error(`Failed to create conversation for user ${userId}:`, error);
    throw error;
  }
}

export async function addMessageToConversation(
  userId: string,
  message: Omit<Message, "timestamp">,
  problemState: ProblemState,
  confidence: number,
  newState: "clarifying" | "ready_to_recommend" | "recommending"
): Promise<ConversationRecord> {
  try {
    const db = getFirestore();
    const docRef = db.collection(CONVERSATIONS_COLLECTION).doc(userId);
    const currentDoc = await docRef.get();
    const currentData = currentDoc.data() as ConversationRecord | undefined;

    const messageWithTimestamp: Message = {
      ...message,
      timestamp: Date.now(),
    };

    await docRef.update({
      messages: (currentData?.messages || []).concat(messageWithTimestamp),
      problemState,
      state: newState,
      confidence,
      lastUpdated: new Date(),
      version: ((currentData?.version || 0) + 1),
    });

    const updated = await getConversation(userId);
    return updated!;
  } catch (error) {
    console.error(`Failed to add message to conversation for user ${userId}:`, error);
    throw error;
  }
}

export async function resetConversation(userId: string): Promise<ConversationRecord> {
  try {
    const newConversation: ConversationRecord = {
      userId,
      messages: [],
      problemState: {
        summary: "",
        keyNeeds: [],
      },
      state: "clarifying",
      confidence: 0,
      lastUpdated: new Date(),
      version: 1,
    };

    const db = getFirestore();
    await db.collection(CONVERSATIONS_COLLECTION).doc(userId).set(newConversation);
    return newConversation;
  } catch (error) {
    console.error(`Failed to reset conversation for user ${userId}:`, error);
    throw error;
  }
}

export async function getConversationMessages(userId: string): Promise<Message[]> {
  const conversation = await getConversation(userId);
  return conversation?.messages || [];
}
