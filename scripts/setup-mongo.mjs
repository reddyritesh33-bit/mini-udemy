// Creates course_previews and activity_events with the validator and indexes
// from the RDBMS and NoSQL PDF. Safe to run more than once.
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "miniudemy");

const validator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["course_id", "video_url"],
    properties: {
      course_id: { bsonType: "int" },
      video_url: { bsonType: "string", pattern: "^https://" },
      duration_seconds: { bsonType: "int", minimum: 1 },
      tags: { bsonType: "array" },
      what_you_will_learn: { bsonType: "array" },
    },
  },
};

const existing = (await db.listCollections().toArray()).map((c) => c.name);

if (existing.includes("course_previews")) {
  await db.command({ collMod: "course_previews", validator });
} else {
  await db.createCollection("course_previews", { validator });
}
if (!existing.includes("activity_events")) await db.createCollection("activity_events");

await db.collection("course_previews").createIndex({ course_id: 1 }, { unique: true });
await db.collection("course_previews").createIndex({ tags: 1 });
await db.collection("activity_events").createIndex({ course_id: 1, ts: -1 });
await db.collection("activity_events").createIndex({ user_id: 1, ts: -1 });
await db.collection("activity_events").createIndex({ event_type: 1, course_id: 1 });

console.log("MongoDB collections, validator and indexes are ready.");
await client.close();
