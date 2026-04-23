import { getFirestore } from "@/lib/firebase";
import { NextResponse } from "next/server";

export async function GET() {
  const db = getFirestore();
  const ref = db.collection("test").doc("hello");

  await ref.set({
    message: "Firestore is working",
    timestamp: Date.now(),
  });

  const snap = await ref.get();

  return NextResponse.json(snap.data());
}
