/**
 * Conversation state management using Firebase
 * Scoped by workspace to support multi-workspace deployments
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
  workspaceId: string;
  userId: string;
  messages: Message[];
  problemState: ProblemState;
  state: "clarifying" | "ready_to_recommend" | "recommending";
  confidence: number;
  lastUpdated: Date;
  version: number;
}

const CONVERSATIONS_COLLECTION = "conversations";

export async function getConversation(workspaceId: string, userId: string): Promise<ConversationRecord | null> {
  try {
    const db = getFirestore();
    const docSnap = await db
      .collection(CONVERSATIONS_COLLECTION)
      .doc(workspaceId)
      .collection("users")
      .doc(userId)
      .get();

    if (!docSnap.exists) {
      return null;
    }

    return docSnap.data() as ConversationRecord;
  } catch (error) {
    console.error(`Failed to get conversation for workspace ${workspaceId} user ${userId}:`, error);
    return null;
  }
}

export async function createConversation(workspaceId: string, userId: string): Promise<ConversationRecord> {
  const newConversation: ConversationRecord = {
    workspaceId,
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
    await db
      .collection(CONVERSATIONS_COLLECTION)
      .doc(workspaceId)
      .collection("users")
      .doc(userId)
      .set(newConversation);
    return newConversation;
  } catch (error) {
    console.error(`Failed to create conversation for workspace ${workspaceId} user ${userId}:`, error);
    throw error;
  }
}

export async function addMessageToConversation(
  workspaceId: string,
  userId: string,
  message: Omit<Message, "timestamp">,
  problemState: ProblemState,
  confidence: number,
  newState: "clarifying" | "ready_to_recommend" | "recommending"
): Promise<ConversationRecord> {
  try {
    const db = getFirestore();
    const docRef = db
      .collection(CONVERSATIONS_COLLECTION)
      .doc(workspaceId)
      .collection("users")
      .doc(userId);

    const messageWithTimestamp: Message = {
      ...message,
      timestamp: Date.now(),
    };

    // Use atomic operations to prevent race conditions:
    // - arrayUnion() for safe concurrent message appends
    // - increment() for version counter
    // - set() for other fields (overwrites OK since we're updating state)
    const admin = await import("firebase-admin");
    await docRef.update({
      messages: admin.firestore.FieldValue.arrayUnion(messageWithTimestamp),
      problemState,
      state: newState,
      confidence,
      lastUpdated: new Date(),
      version: admin.firestore.FieldValue.increment(1),
    });

    const updated = await getConversation(workspaceId, userId);
    return updated!;
  } catch (error) {
    console.error(`Failed to add message to conversation for workspace ${workspaceId} user ${userId}:`, error);
    throw error;
  }
}

export async function resetConversation(workspaceId: string, userId: string): Promise<ConversationRecord> {
  try {
    const newConversation: ConversationRecord = {
      workspaceId,
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
    await db
      .collection(CONVERSATIONS_COLLECTION)
      .doc(workspaceId)
      .collection("users")
      .doc(userId)
      .set(newConversation);
    return newConversation;
  } catch (error) {
    console.error(`Failed to reset conversation for workspace ${workspaceId} user ${userId}:`, error);
    throw error;
  }
}

export async function getConversationMessages(workspaceId: string, userId: string): Promise<Message[]> {
  const conversation = await getConversation(workspaceId, userId);
  return conversation?.messages || [];
}
