/**
 * Default SWR fetch for dynamic auction APIs — avoids stale HTTP cache on the client.
 */
export async function swrJsonFetcher<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return res.json() as Promise<T>;
}
