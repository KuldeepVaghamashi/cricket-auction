/**
 * Server-Sent Events fallback transport (Vercel / environments without WebSocket).
 *
 * Architecture change: push-driven rather than poll-driven.
 *
 * Before: setInterval(600ms) per SSE connection reading MongoDB directly.
 *         200 viewers = 200 independent DB polls every 600 ms.
 *
 * After:  Each SSE connection registers in lib/auction-rooms.ts alongside
 *         WebSocket clients.  When a mutation fires pushAuctionEvent() the
 *         Redis subscriber in auction-rooms fans the event to all clients on
 *         this instance — WS and SSE — in one broadcastToRoom() call.
 *
 * On connect: one initial SnapshotEvent (full ViewerStreamPayload + seq) is
 * sent so the client has a baseline.  Subsequent events arrive via push.
 * No polling interval is started.
 */

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { joinRoom } from "@/lib/auction-rooms";
import { buildViewerStreamPayload } from "@/lib/build-viewer-stream-payload";
import { getCachedSnap, setCachedSnap, getSeq } from "@/lib/auction-cache";
import type { SnapshotEvent } from "@/lib/socket-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Long-lived connection; raise on Vercel (Project Settings → Functions) if it drops early. */
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!ObjectId.isValid(id)) {
    return new Response("Invalid auction ID", { status: 400 });
  }

  const encoder = new TextEncoder();
  const auctionId = new ObjectId(id);

  const stream = new ReadableStream({
    async start(controller) {
      // ── Initial snapshot ────────────────────────────────────────────────────
      // Build (or serve from cache) the full ViewerStreamPayload once on connect.
      // This establishes the client's baseline and anchors gap detection via seq.

      let initialRaw = await getCachedSnap(id, "full");
      let initialPayload: ReturnType<typeof buildViewerStreamPayload> extends Promise<infer T>
        ? T
        : never;

      if (initialRaw) {
        initialPayload = JSON.parse(initialRaw);
      } else {
        initialPayload = await buildViewerStreamPayload(auctionId, "full");
        void setCachedSnap(id, "full", initialPayload);
      }

      const seq = await getSeq(id);
      const snapshotEvent: SnapshotEvent = {
        ...(initialPayload as any),
        v: 2,
        type: "snapshot",
        seq,
      };

      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(snapshotEvent)}\n\n`)
      );

      // ── Join room — future events arrive via push ───────────────────────────
      // The enqueue wrapper serialises the raw event string (already JSON) into
      // an SSE frame and writes it to the ReadableStream controller.
      const leave = joinRoom(id, {
        kind: "sse",
        enqueue: (raw: string) => {
          try {
            controller.enqueue(encoder.encode(`data: ${raw}\n\n`));
          } catch {
            // Controller may be closed if the client disconnected between
            // the abort event and this enqueue call — non-fatal.
          }
        },
      });

      // ── Cleanup on disconnect ───────────────────────────────────────────────
      request.signal.addEventListener("abort", () => {
        leave();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
