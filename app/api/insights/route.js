import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getMongoDb } from "@/lib/mongo";
import { requireRole } from "@/lib/auth";
import { parseId } from "@/lib/validate";

const AT_RISK_DAYS = 14; // no learning activity for this long counts as "gone quiet"
const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/insights?course_id=3: the three cross-database insights for ONE course.
// An instructor can choose among their own courses; an admin among all. PostgreSQL decides which courses
// are in scope (it is the source of truth), MongoDB supplies behaviour, and this handler merges the two.
export async function GET(request) {
  const { session, error } = await requireRole(["instructor", "admin"]);
  if (error) return error;

  const { rows: courses } = await pool.query(
    "SELECT course_id, title FROM courses WHERE ($1::int IS NULL OR instructor_id = $1) ORDER BY title",
    [session.role === "instructor" ? session.userId : null]
  );
  if (courses.length === 0) return NextResponse.json({ courses: [], course: null });

  const asked = new URL(request.url).searchParams.get("course_id");
  const courseId = asked === null ? courses[0].course_id : parseId(asked);
  const course = courses.find((c) => c.course_id === courseId);
  if (!course) return NextResponse.json({ error: "Choose one of your own courses" }, { status: 403 });

  let events;
  try {
    events = (await getMongoDb()).collection("activity_events");
    await events.estimatedDocumentCount();
  } catch (err) {
    console.error("insights: mongo unavailable:", err.message);
    return NextResponse.json({ error: "Insights need MongoDB, which is unavailable" }, { status: 503 });
  }

  // 1. Lessons: how many students opened each lesson (MongoDB) and how many completed it (PostgreSQL).
  const opens = await events
    .aggregate([
      { $match: { event_type: "lesson_open", course_id: courseId, user_id: { $ne: null } } },
      { $group: { _id: "$lesson_id", openers: { $addToSet: "$user_id" } } },
    ])
    .toArray();
  const openedBy = Object.fromEntries(opens.map((o) => [o._id, o.openers.length]));
  const { rows: lessonRows } = await pool.query(
    `SELECT l.lesson_id, l.title AS lesson, COUNT(lp.progress_id)::int AS completed_by
     FROM lessons l
     JOIN modules m ON m.module_id = l.module_id
     LEFT JOIN lesson_progress lp ON lp.lesson_id = l.lesson_id
     WHERE m.course_id = $1
     GROUP BY l.lesson_id, l.title, m.position, l.position
     ORDER BY m.position, l.position`,
    [courseId]
  );
  const lessons = lessonRows.map((r) => {
    const opened = openedBy[r.lesson_id] ?? 0;
    return { lesson: r.lesson, opened_by: opened, completed_by: r.completed_by, stalled: opened > r.completed_by };
  });

  // 2. Preview conversion: preview sessions (MongoDB) and how many of the known viewers enrolled (PostgreSQL).
  const [preview] = await events
    .aggregate([
      { $match: { event_type: "preview_play", course_id: courseId } },
      { $group: { _id: null, sessions: { $addToSet: "$session_id" }, users: { $addToSet: "$user_id" } } },
    ])
    .toArray();
  const sessions = preview?.sessions.length ?? 0;
  const known = (preview?.users ?? []).filter((u) => u !== null);
  const { rows: conv } = await pool.query(
    "SELECT COUNT(*)::int AS n FROM enrollments WHERE course_id = $1 AND user_id = ANY($2)",
    [courseId, known]
  );
  const conversion = {
    preview_sessions: sessions,
    enrolled_viewers: conv[0].n,
    conversion_pct: sessions ? Math.round((1000 * conv[0].n) / sessions) / 10 : 0,
  };

  // 3. Students: progress from the view (PostgreSQL) and last learning activity (MongoDB).
  const { rows: students } = await pool.query(
    `SELECT user_id, full_name, status, completion_pct FROM v_student_progress
     WHERE course_id = $1 ORDER BY full_name`,
    [courseId]
  );
  const last = await events
    .aggregate([
      { $match: { course_id: courseId, user_id: { $ne: null }, event_type: { $ne: "preview_play" } } },
      { $group: { _id: "$user_id", last_ts: { $max: "$ts" } } },
    ])
    .toArray();
  const lastSeen = Object.fromEntries(last.map((l) => [l._id, l.last_ts]));
  const now = Date.now();
  const studentRows = students.map((s) => {
    const ts = lastSeen[s.user_id];
    const daysQuiet = ts ? Math.floor((now - new Date(ts).getTime()) / DAY_MS) : null;
    const pct = Number(s.completion_pct);
    return {
      student: s.full_name,
      progress_pct: pct,
      status: s.status,
      days_since_activity: daysQuiet,
      at_risk: s.status === "active" && pct < 100 && (daysQuiet === null || daysQuiet >= AT_RISK_DAYS),
    };
  });

  return NextResponse.json({
    courses,
    course,
    at_risk_days: AT_RISK_DAYS,
    lessons,
    conversion,
    students: studentRows,
  });
}
