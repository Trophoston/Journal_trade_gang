import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/tradegang";

const g = globalThis as unknown as { __tgMongo?: Promise<MongoClient> };

/** One client per process, reused across hot reloads. */
export function mongo(): Promise<MongoClient> {
  if (!g.__tgMongo) {
    g.__tgMongo = new MongoClient(uri, { maxPoolSize: 20, serverSelectionTimeoutMS: 4000 }).connect().catch((err) => {
      g.__tgMongo = undefined;
      throw err;
    });
  }
  return g.__tgMongo;
}

export async function db(): Promise<Db> {
  return (await mongo()).db();
}
