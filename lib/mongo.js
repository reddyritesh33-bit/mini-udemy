import { MongoClient } from "mongodb";

const globalForMongo = globalThis;

function getClientPromise() {
  if (!globalForMongo.__mongoClientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 3000, // fail fast so a Mongo outage never stalls the page
    });
    globalForMongo.__mongoClientPromise = client.connect().catch((err) => {
      globalForMongo.__mongoClientPromise = null; // allow retry on next request
      throw err;
    });
  }
  return globalForMongo.__mongoClientPromise;
}

export async function getMongoDb() {
  const client = await getClientPromise();
  return client.db(process.env.MONGODB_DB || "miniudemy");
}
