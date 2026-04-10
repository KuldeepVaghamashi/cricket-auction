import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { buildViewerStreamPayload } from "@/lib/build-viewer-stream-payload";
import { getCachedSnap, setCachedSnap } from "@/lib/auction-cache";

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

    // Cache-first: all viewers for the same auction+mode share one DB read per 5 s window.
    // On a SELL event with N concurrent viewers, only the first cache miss hits MongoDB;
    // subsequent requests within the same cache window are served from Redis.
    const cached = await getCachedSnap(id, mode);
    if (cached) {
      return NextResponse.json(JSON.parse(cached), {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const payload = await buildViewerStreamPayload(new ObjectId(id), mode as any);
    // Non-blocking: populate cache for the next wave of requests.
    void setCachedSnap(id, mode, payload);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("viewer-snapshot error:", e);
    return NextResponse.json({ error: "Failed to load snapshot" }, { status: 500 });
  }
}
