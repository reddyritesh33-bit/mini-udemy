import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getMongoDb } from "@/lib/mongo";
import { requireRole } from "@/lib/auth";

function parseCourseId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const isHttps = (v) => typeof v === "string" && /^https:\/\//.test(v);
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");

// GET: public. Anyone (even a guest) can see the short "what is this course about" video.
export async function GET(_request, { params }) {
  const courseId = parseCourseId((await params).id);
  if (!courseId) return NextResponse.json({ error: "Invalid course id" }, { status: 400 });

  try {
    const db = await getMongoDb();
    const preview = await db
      .collection("course_previews")
      .findOne({ course_id: courseId }, { projection: { _id: 0 } });
    if (!preview) return NextResponse.json({ error: "No preview for this course" }, { status: 404 });
    return NextResponse.json({ preview });
  } catch (err) {
    // Mongo down: the course page must still load, just without the video.
    console.error("preview read failed:", err.message);
    return NextResponse.json({ preview: null, degraded: true });
  }
}

// PUT: add or edit the preview. Instructor who owns the course, or an admin.
export async function PUT(request, { params }) {
  const { session, error } = await requireRole(["instructor", "admin"]);
  if (error) return error;

  const courseId = parseCourseId((await params).id);
  if (!courseId) return NextResponse.json({ error: "Invalid course id" }, { status: 400 });

  // PostgreSQL is the source of truth for ownership.
  const { rows } = await pool.query("SELECT instructor_id FROM courses WHERE course_id = $1", [
    courseId,
  ]);
  if (!rows[0]) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  if (session.role === "instructor" && rows[0].instructor_id !== session.userId) {
    return NextResponse.json({ error: "You do not own this course" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !isHttps(body.video_url)) {
    return NextResponse.json({ error: "video_url must be an https URL" }, { status: 400 });
  }
  if (body.thumbnail !== undefined && !isHttps(body.thumbnail)) {
    return NextResponse.json({ error: "thumbnail must be an https URL" }, { status: 400 });
  }
  if (
    body.duration_seconds !== undefined &&
    !(Number.isInteger(body.duration_seconds) && body.duration_seconds > 0)
  ) {
    return NextResponse.json({ error: "duration_seconds must be a positive integer" }, { status: 400 });
  }
  if (body.tags !== undefined && !isStringArray(body.tags)) {
    return NextResponse.json({ error: "tags must be an array of strings" }, { status: 400 });
  }
  if (body.what_you_will_learn !== undefined && !isStringArray(body.what_you_will_learn)) {
    return NextResponse.json({ error: "what_you_will_learn must be an array of strings" }, { status: 400 });
  }

  const doc = { course_id: courseId, video_url: body.video_url };
  for (const key of ["thumbnail", "duration_seconds", "tags", "what_you_will_learn"]) {
    if (body[key] !== undefined) doc[key] = body[key];
  }

  try {
    const db = await getMongoDb();
    // replaceOne + upsert: one preview document per course (unique index backs this up).
    await db.collection("course_previews").replaceOne({ course_id: courseId }, doc, { upsert: true });
    return NextResponse.json({ preview: doc });
  } catch (err) {
    if (err.code === 121) {
      return NextResponse.json({ error: "Preview rejected by database validator" }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Could not save preview" }, { status: 500 });
  }
}
