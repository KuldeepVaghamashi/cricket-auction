import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { buildViewerStreamPayload } from "@/lib/build-viewer-stream-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** JSON snapshot matching one SSE `data:` frame from /stream — used by WebSocket-driven viewer refresh. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!ObjectId.isValid(id)) {
      return NextResponse.json({ error: "Invalid auction ID" }, { status: 400 });
    }
    const mode = request.nextUrl.searchParams.get("mode") ?? "full";
    const payload = await buildViewerStreamPayload(new ObjectId(id), mode as any);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("viewer-snapshot error:", e);
    return NextResponse.json({ error: "Failed to load snapshot" }, { status: 500 });
  }
}
