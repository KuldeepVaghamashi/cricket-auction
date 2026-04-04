import { NextRequest, NextResponse } from "next/server";
import { clearAuthCookieOptions } from "@/lib/auth-cookies";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({
    success: true,
    message: "Logout successful",
  });

  response.cookies.set("auth_token", "", clearAuthCookieOptions(request.headers));

  return response;
}
