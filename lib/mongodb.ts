import { MongoClient, Db } from "mongodb";

const rawMongoUri = process.env.MONGODB_URI?.trim();
if (!rawMongoUri) {
  throw new Error("Please define the MONGODB_URI environment variable in Settings > Vars");
}

const MONGODB_URI = rawMongoUri;

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;
let indexesReady = false;
let connectPromise: Promise<{ client: MongoClient; db: Db }> | null = null;

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

  if (!connectPromise) {
    connectPromise = (async () => {
      if (process.env.NODE_ENV === "development") {
        console.log("[v0] Connecting to MongoDB...");
      }

      const client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 15_000,
        // Raise pool ceiling so 50-500 concurrent requests don't queue behind
        // the default limit of 5. minPoolSize keeps warm connections ready.
        maxPoolSize: 50,
        minPoolSize: 5,
        // Reclaim idle connections after 2 min to avoid holding Atlas slots
        // during quiet periods between auction rounds.
        maxIdleTimeMS: 120_000,
        // How long a request waits for a free pool slot before failing.
        waitQueueTimeoutMS: 10_000,
      });
      await client.connect();

      const dbName =
        new URL(MONGODB_URI.replace("mongodb+srv://", "https://")).pathname.slice(1) || "cricket_auction";
      const db = client.db(dbName || "cricket_auction");

      if (process.env.NODE_ENV === "development") {
        console.log("[v0] Connected to database:", dbName || "cricket_auction");
      }

      await ensureIndexes(db);

      cachedClient = client;
      cachedDb = db;

      return { client, db };
    })().finally(() => {
      connectPromise = null;
    });
  }

  return connectPromise;
}

export async function getDb(): Promise<Db> {
  const { db } = await connectToDatabase();
  return db;
}
