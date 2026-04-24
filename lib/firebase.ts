import * as admin from "firebase-admin";

let app: admin.app.App | null = null;
let db: FirebaseFirestore.Firestore | null = null;

function isFirestoreSettingsAlreadyLocked(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("settings") &&
    (message.includes("already") || message.includes("can only be called before"))
  );
}

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
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch (settingsError) {
      if (!isFirestoreSettingsAlreadyLocked(settingsError)) {
        throw settingsError;
      }

      // In dev/hot-reload, Firestore may already be initialized before this module reloads.
      // In that case settings cannot be changed and we should continue using the existing client.
      console.warn("Firestore settings already initialized; continuing with existing client settings.");
    }
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