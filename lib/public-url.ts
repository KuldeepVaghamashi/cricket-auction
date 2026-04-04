/**
 * Public links (viewer, player register) should use the production domain when deployed.
 * Set NEXT_PUBLIC_VIEWER_BASE_URL (e.g. https://your-app.vercel.app) so copied links work from localhost admin.
 */
export function resolvePublicViewerBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_VIEWER_BASE_URL?.toString() ?? "";
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
