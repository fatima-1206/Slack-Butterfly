import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc } from "firebase/firestore";
import { NextResponse } from "next/server";

export async function GET() {
  const ref = doc(db, "test", "hello");

  await setDoc(ref, {
    message: "Firestore is working",
    timestamp: Date.now(),
  });

  const snap = await getDoc(ref);

  return NextResponse.json(snap.data());
}
