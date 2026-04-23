import * as admin from "firebase-admin";

let app: admin.app.App | null = null;
let db: FirebaseFirestore.Firestore | null = null;

function ensureFirebaseInitialized() {
  if (db) {
    return db;
  }

  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (!serviceAccountKey) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_KEY environment variable is not set. " +
        "See FIREBASE_SETUP.md for setup instructions."
    );
  }

  try {
    // Parse service account key (support both base64 and JSON)
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(Buffer.from(serviceAccountKey, "base64").toString("utf-8"));
    } catch {
      serviceAccount = JSON.parse(serviceAccountKey);
    }

    // Initialize Firebase Admin
    if (admin.apps.length === 0) {
      app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    } else {
      app = admin.app();
    }

    db = admin.firestore(app);
    return db;
  } catch (error) {
    console.error("Failed to initialize Firebase:", error);
    throw error;
  }
}

// Export getter function for lazy initialization
export function getFirestore(): FirebaseFirestore.Firestore {
  return ensureFirebaseInitialized();
}