/**
 * Conversation state management using Firebase
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  Timestamp,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

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
    const docRef = doc(db, CONVERSATIONS_COLLECTION, userId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
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
    lastUpdated: serverTimestamp(),
    version: 1,
  };

  try {
    const docRef = doc(db, CONVERSATIONS_COLLECTION, userId);
    await setDoc(docRef, newConversation);
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
    const docRef = doc(db, CONVERSATIONS_COLLECTION, userId);

    const messageWithTimestamp: Message = {
      ...message,
      timestamp: Date.now(),
    };

    await updateDoc(docRef, {
      messages: (await getDoc(docRef)).data()?.messages?.concat(messageWithTimestamp) || [messageWithTimestamp],
      problemState,
      state: newState,
      confidence,
      lastUpdated: serverTimestamp(),
      version: ((await getDoc(docRef)).data()?.version || 0) + 1,
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
      lastUpdated: serverTimestamp(),
      version: 1,
    };

    const docRef = doc(db, CONVERSATIONS_COLLECTION, userId);
    await setDoc(docRef, newConversation, { merge: false });
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
