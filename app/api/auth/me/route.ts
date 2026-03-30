import { NextResponse } from "next/server";
import { getAdminFromToken } from "@/lib/auth";

export async function GET() {
  try {
    const admin = await getAdminFromToken();

    if (!admin) {
      return NextResponse.json(
        { authenticated: false },
        { status: 401 }
      );
    }

    return NextResponse.json({
      authenticated: true,
      admin: {
        id: admin._id?.toString(),
        username: admin.username,
      },
    });
  } catch (error) {
    console.error("Auth check error:", error);
    return NextResponse.json(
      { authenticated: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
