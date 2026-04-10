"use client";

import { useEffect, useRef } from "react";
import type { ViewerStreamPayload } from "@/lib/viewer-stream-types";

/**
 * Plays a short sound and triggers a haptic vibration pattern on mobile
 * whenever the auction result changes to "sold" or "unsold".
 *
 * - Fires at most once per unique `lastActionAt` timestamp (no re-render double-fire).
 * - Ignores stale events (> 30 s old) so opening the viewer after the fact is silent.
 * - Audio files are preloaded on mount to eliminate any play-time delay.
 * - No state mutations — zero effect on UI or renders.
 */
export function useAuctionResultFeedback(
  streamData: ViewerStreamPayload | null,
  isActive: boolean
) {
  const soldAudioRef = useRef<HTMLAudioElement | null>(null);
  const unsoldAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastSeenAtRef = useRef<string | null>(null);

  // Preload both audio files once on mount so they are ready to play instantly.
  useEffect(() => {
    soldAudioRef.current = new Audio("/sounds/sold.wav");
    soldAudioRef.current.preload = "auto";
    unsoldAudioRef.current = new Audio("/sounds/unsold.wav");
    unsoldAudioRef.current.preload = "auto";

    return () => {
      soldAudioRef.current = null;
      unsoldAudioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isActive || !streamData?.state?.lastActionAt) return;

    const at = streamData.state.lastActionAt;
    // Deduplicate: same timestamp = same event, already handled.
    if (lastSeenAtRef.current === at) return;

    // Skip events older than 30 s — viewer was opened after the result.
    const msAgo = Date.now() - new Date(at).getTime();
    if (Number.isFinite(msAgo) && msAgo > 30_000) return;

    lastSeenAtRef.current = at;

    const action = streamData.state.lastAction;
    if (action !== "sold" && action !== "unsold") return;

    // Sound — reset currentTime so rapid back-to-back results replay cleanly.
    const audio = action === "sold" ? soldAudioRef.current : unsoldAudioRef.current;
    if (audio) {
      audio.currentTime = 0;
      // Swallow autoplay policy rejections silently; sound is non-critical.
      audio.play().catch(() => {});
    }

    // Vibration — mobile only, no-op on desktop.
    if (typeof navigator !== "undefined" && navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  }, [isActive, streamData?.state?.lastAction, streamData?.state?.lastActionAt]);
}
