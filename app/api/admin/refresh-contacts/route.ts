import { getAllContacts } from "@/lib/contacts";

export async function POST(request: Request) {
  try {
    console.log("[Admin] Triggering contact refresh...");
    
    const contacts = await getAllContacts();
    
    console.log(`[Admin] Successfully fetched and cached ${contacts.length} contacts`);
    
    return Response.json({
      success: true,
      message: "Contacts fetched and cached successfully",
      count: contacts.length,
      contacts: contacts.slice(0, 5), // Return first 5 as preview
    });
  } catch (error) {
    console.error("[Admin] Error refreshing contacts:", error);
    return Response.json(
      {
        success: false,
        error: String(error),
      },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  // Allow GET for easier testing from browser
  return POST(request);
}