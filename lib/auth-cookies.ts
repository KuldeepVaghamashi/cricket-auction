/**
 * `Secure` must only be true when the client connected over HTTPS.
 * Using NODE_ENV === "production" breaks `next start` on http://localhost (cookie never stored).
 */
export function authSessionCookieOptions(headerList: Headers): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
} {
  const raw = headerList.get("x-forwarded-proto");
  const proto = raw?.split(",")[0]?.trim().toLowerCase();
  const secure = proto === "https";

  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: 60 * 60 * 24,
    path: "/",
  };
}

export function clearAuthCookieOptions(headerList: Headers): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
} {
  return {
    ...authSessionCookieOptions(headerList),
    maxAge: 0,
  };
}
