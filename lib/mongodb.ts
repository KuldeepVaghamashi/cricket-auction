import { MongoClient, Db } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable in Settings > Vars");
}

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  console.log("[v0] Connecting to MongoDB...");
  
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  
  // Extract database name from URI or use default
  const dbName = new URL(MONGODB_URI.replace("mongodb+srv://", "https://")).pathname.slice(1) || "cricket_auction";
  const db = client.db(dbName || "cricket_auction");
  
  console.log("[v0] Connected to database:", dbName || "cricket_auction");

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

export async function getDb(): Promise<Db> {
  const { db } = await connectToDatabase();
  return db;
}
