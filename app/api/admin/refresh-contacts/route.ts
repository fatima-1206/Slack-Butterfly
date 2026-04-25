import { getAllContacts } from "@/lib/contacts";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId") || process.env.SLACK_WORKSPACE_ID;
    if (!workspaceId) {
      return Response.json(
        {
          success: false,
          error: "Missing workspaceId. Provide ?workspaceId=... or set SLACK_WORKSPACE_ID.",
        },
        { status: 400 }
      );
    }

    console.log("[Admin] Triggering contact refresh...");
    
    const contacts = await getAllContacts(workspaceId, { allowEnrichment: true });
    
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