import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { cookies } from "next/headers";
import { getDb } from "./mongodb";
import type { Admin } from "./types";

const TOKEN_EXPIRY = "24h";

const DEV_JWT_FALLBACK = "cricket-auction-secret-key-change-in-production";

let jwtSecretWarningShown = false;

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    // Fail-safe: on misconfigured deployments (e.g. missing JWT_SECRET),
    // never hard-crash the whole app. We log once and use a deterministic fallback.
    // You should still set JWT_SECRET in Vercel for security.
    if (!s || s.length < 32) {
      if (!jwtSecretWarningShown) {
        jwtSecretWarningShown = true;
        console.error(
          "[auth] JWT_SECRET missing/too short in production; using fallback secret. Set JWT_SECRET in Vercel env for security."
        );
      }
      return s || DEV_JWT_FALLBACK;
    }
    return s;
  }
  return s || DEV_JWT_FALLBACK;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(adminId: string): string {
  return jwt.sign({ adminId }, getJwtSecret(), { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): { adminId: string } | null {
  try {
    return jwt.verify(token, getJwtSecret()) as { adminId: string };
  } catch {
    return null;
  }
}

export async function getAdminFromToken(): Promise<Admin | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) return null;

  const payload = verifyToken(token);
  if (!payload?.adminId || !ObjectId.isValid(payload.adminId)) return null;

  try {
    const db = await getDb();
    const admin = await db.collection<Admin>("admins").findOne({
      _id: new ObjectId(payload.adminId),
    });
    return admin;
  } catch {
    return null;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const admin = await getAdminFromToken();
  return admin !== null;
}

// Initialize default admin if none exists
export async function initializeDefaultAdmin(): Promise<void> {
  const db = await getDb();
  const adminCount = await db.collection("admins").countDocuments();

  if (adminCount === 0) {
    const passwordHash = await hashPassword("admin123");
    await db.collection<Admin>("admins").insertOne({
      username: "admin",
      passwordHash,
      createdAt: new Date(),
    });
  }
}

/** Shared by POST /api/auth/login and the login server action. */
export async function attemptAdminLogin(
  username: string,
  password: string
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const u = username?.trim() ?? "";
  if (!u || !password) {
    return { ok: false, error: "Username and password are required" };
  }

  await initializeDefaultAdmin();

  const db = await getDb();
  const admin = await db.collection<Admin>("admins").findOne({ username: u });

  if (!admin) {
    return { ok: false, error: "Invalid credentials" };
  }

  const hash = admin.passwordHash;
  if (typeof hash !== "string" || !hash) {
    return { ok: false, error: "Invalid credentials" };
  }

  const isValid = await verifyPassword(password, hash);
  if (!isValid) {
    return { ok: false, error: "Invalid credentials" };
  }

  const id = admin._id?.toString();
  if (!id) {
    return { ok: false, error: "Invalid credentials" };
  }

  return { ok: true, token: generateToken(id) };
}
