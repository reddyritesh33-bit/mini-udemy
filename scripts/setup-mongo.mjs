// Creates course_previews, lesson_videos and activity_events with their validators and indexes.
// Safe to run more than once.
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

// One document per lesson: which video plays when the lesson is opened, and from which second.
const lessonValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["lesson_id", "course_id", "video_url", "start_seconds"],
    properties: {
      lesson_id: { bsonType: "int" },
      course_id: { bsonType: "int" },
      video_url: { bsonType: "string", pattern: "^https://" },
      start_seconds: { bsonType: "int", minimum: 0 },
    },
  },
};
if (existing.includes("lesson_videos")) {
  await db.command({ collMod: "lesson_videos", validator: lessonValidator });
} else {
  await db.createCollection("lesson_videos", { validator: lessonValidator });
}
await db.collection("lesson_videos").createIndex({ lesson_id: 1 }, { unique: true });
await db.collection("lesson_videos").createIndex({ course_id: 1 });

await db.collection("course_previews").createIndex({ course_id: 1 }, { unique: true });
await db.collection("course_previews").createIndex({ tags: 1 });
await db.collection("activity_events").createIndex({ course_id: 1, ts: -1 });
await db.collection("activity_events").createIndex({ user_id: 1, ts: -1 });
await db.collection("activity_events").createIndex({ event_type: 1, course_id: 1 });

console.log("MongoDB collections, validator and indexes are ready.");
await client.close();
