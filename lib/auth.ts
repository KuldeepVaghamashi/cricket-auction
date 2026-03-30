import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getDb } from "./mongodb";
import type { Admin } from "./types";

const JWT_SECRET = process.env.JWT_SECRET || "cricket-auction-secret-key-change-in-production";
const TOKEN_EXPIRY = "24h";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(adminId: string): string {
  return jwt.sign({ adminId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): { adminId: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { adminId: string };
  } catch {
    return null;
  }
}

export async function getAdminFromToken(): Promise<Admin | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  
  if (!token) return null;
  
  const payload = verifyToken(token);
  if (!payload) return null;
  
  const db = await getDb();
  const admin = await db.collection<Admin>("admins").findOne({ 
    _id: new (await import("mongodb")).ObjectId(payload.adminId) 
  });
  
  return admin;
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
