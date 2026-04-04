import { MongoClient, Db } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable in Settings > Vars");
}

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;
let indexesReady = false;

async function ensureIndexes(db: Db) {
  if (indexesReady) return;
  await Promise.all([
    db.collection("auctionStates").createIndex({ auctionId: 1 }, { unique: true }),
    db.collection("teams").createIndex({ auctionId: 1 }),
    db.collection("players").createIndex({ auctionId: 1, status: 1 }),
    db.collection("players").createIndex({ auctionId: 1, soldTo: 1 }),
    db.collection("players").createIndex(
      { auctionId: 1, phone: 1 },
      {
        unique: true,
        partialFilterExpression: { phone: { $exists: true, $type: "string" } },
      }
    ),
    db.collection("auctionLogs").createIndex({ auctionId: 1, timestamp: -1 }),
  ]);
  indexesReady = true;
}

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

  await ensureIndexes(db);

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

export async function getDb(): Promise<Db> {
  const { db } = await connectToDatabase();
  return db;
}
