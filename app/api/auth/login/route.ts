import { NextRequest, NextResponse } from "next/server";
import { attemptAdminLogin } from "@/lib/auth";
import { authSessionCookieOptions } from "@/lib/auth-cookies";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";

    const result = await attemptAdminLogin(username, password);

    if (!result.ok) {
      const status =
        result.error === "Username and password are required" ? 400 : 401;
      return NextResponse.json({ error: result.error }, { status });
    }

    const response = NextResponse.json({
      success: true,
      message: "Login successful",
    });

    response.cookies.set(
      "auth_token",
      result.token,
      authSessionCookieOptions(request.headers)
    );

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
