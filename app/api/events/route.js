import { NextResponse } from "next/server";
import { getMongoDb } from "@/lib/mongo";
import { pool } from "@/lib/db";
import { getSession } from "@/lib/auth";

const EVENT_TYPES = ["preview_play", "lesson_open", "play", "pause", "ended"];
const MAX_WATCH_SECONDS = 4 * 60 * 60; // one event never counts more than 4 hours
const posInt = (v) => Number.isInteger(v) && v > 0;

// POST: record one activity event. Guests may send preview_play (it can happen before login);
// lesson events need a logged-in user. PostgreSQL is checked first, so every event refers to a real
// course, and a lesson event to a lesson that belongs to that course.
export async function POST(request) {
  const body = await request.json().catch(() => null);
  if (!body || !EVENT_TYPES.includes(body.event_type) || !posInt(body.course_id)) {
    return NextResponse.json(
      { error: `event_type (${EVENT_TYPES.join("|")}) and course_id are required` },
      { status: 400 }
    );
  }

  const isPreview = body.event_type === "preview_play";
  if (!isPreview && !posInt(body.lesson_id)) {
    return NextResponse.json({ error: "lesson_id is required for lesson events" }, { status: 400 });
  }

  const needsWatch = body.event_type === "pause" || body.event_type === "ended";
  if (needsWatch && !(Number.isInteger(body.watch_seconds) && body.watch_seconds >= 0 && body.watch_seconds <= MAX_WATCH_SECONDS)) {
    return NextResponse.json({ error: `watch_seconds (0 to ${MAX_WATCH_SECONDS}) is required for pause and ended` }, { status: 400 });
  }

  // user_id always comes from the verified JWT, never from the request body.
  const session = await getSession();
  if (!isPreview && !session) {
    return NextResponse.json({ error: "Log in to record lesson activity" }, { status: 401 });
  }

  const check = isPreview
    ? await pool.query("SELECT 1 FROM courses WHERE course_id = $1", [body.course_id])
    : await pool.query(
        "SELECT 1 FROM lessons l JOIN modules m ON m.module_id = l.module_id WHERE l.lesson_id = $1 AND m.course_id = $2",
        [body.lesson_id, body.course_id]
      );
  if (check.rowCount === 0) {
    return NextResponse.json({ error: isPreview ? "Course not found" : "Lesson not found in this course" }, { status: 404 });
  }

  const doc = {
    user_id: session ? session.userId : null,
    session_id: typeof body.session_id === "string" ? body.session_id.slice(0, 64) : null,
    course_id: body.course_id,
    event_type: body.event_type,
    ts: new Date(),
  };
  if (!isPreview) doc.lesson_id = body.lesson_id;
  if (needsWatch) doc.watch_seconds = body.watch_seconds;

  try {
    const db = await getMongoDb();
    await db.collection("activity_events").insertOne(doc);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    // A lost event affects analytics only, never progress, so the user's action still succeeds.
    console.error("event insert failed:", err.message);
    return NextResponse.json({ ok: false }, { status: 202 });
  }
}
