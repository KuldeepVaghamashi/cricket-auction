/**
 * @deprecated Use pushAuctionEvent from lib/socket-hub.ts directly.
 * This shim exists only so any remaining callers don't break during migration.
 */
export { pushAuctionEvent as notifyAuctionSubscribers } from "@/lib/socket-hub";
