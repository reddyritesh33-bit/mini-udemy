import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getMongoDb } from "@/lib/mongo";
import { requireRole } from "@/lib/auth";

const AT_RISK_DAYS = 14; // no learning activity for this long counts as "gone quiet"
const DAY_MS = 24 * 60 * 60 * 1000;

// GET /api/insights: the three cross-database insights. An instructor sees their own courses;
// an admin sees all. PostgreSQL decides which courses are in scope (it is the source of truth),
// MongoDB supplies behaviour, and this handler merges the two because they cannot be joined.
export async function GET() {
  const { session, error } = await requireRole(["instructor", "admin"]);
  if (error) return error;

  const { rows: courses } = await pool.query(
    "SELECT course_id, title FROM courses WHERE ($1::int IS NULL OR instructor_id = $1) ORDER BY title",
    [session.role === "instructor" ? session.userId : null]
  );
  const courseIds = courses.map((c) => c.course_id);
  const titleOf = Object.fromEntries(courses.map((c) => [c.course_id, c.title]));
  if (courseIds.length === 0) return NextResponse.json({ stalled: [], conversion: [], at_risk: [], at_risk_days: AT_RISK_DAYS });

  let events;
  try {
    events = (await getMongoDb()).collection("activity_events");
    await events.estimatedDocumentCount();
  } catch (err) {
    console.error("insights: mongo unavailable:", err.message);
    return NextResponse.json({ error: "Insights need MongoDB, which is unavailable" }, { status: 503 });
  }

  // 1. Stall detector: students who opened each lesson (MongoDB) vs. students who completed it (PostgreSQL).
  const opens = await events
    .aggregate([
      { $match: { event_type: "lesson_open", course_id: { $in: courseIds }, user_id: { $ne: null } } },
      { $group: { _id: "$lesson_id", openers: { $addToSet: "$user_id" } } },
      { $project: { _id: 0, lesson_id: "$_id", opened_by: { $size: "$openers" } } },
    ])
    .toArray();
  const { rows: lessonRows } = await pool.query(
    `SELECT l.lesson_id, l.title AS lesson, m.course_id, COUNT(lp.progress_id)::int AS completed_by
     FROM lessons l
     JOIN modules m ON m.module_id = l.module_id
     LEFT JOIN lesson_progress lp ON lp.lesson_id = l.lesson_id
     WHERE l.lesson_id = ANY($1) AND m.course_id = ANY($2)
     GROUP BY l.lesson_id, l.title, m.course_id`,
    [opens.map((o) => o.lesson_id), courseIds]
  );
  const openedBy = Object.fromEntries(opens.map((o) => [o.lesson_id, o.opened_by]));
  const stalled = lessonRows
    .map((r) => {
      const opened = openedBy[r.lesson_id];
      const notFinished = Math.max(opened - r.completed_by, 0);
      return { course: titleOf[r.course_id], lesson: r.lesson, opened_by: opened, completed_by: r.completed_by, not_finished: notFinished };
    })
    .filter((r) => r.not_finished > 0)
    .sort((a, b) => b.not_finished - a.not_finished || b.opened_by - a.opened_by)
    .slice(0, 10);

  // 2. Preview-to-enrolment conversion: preview sessions per course (MongoDB) vs. enrolments by known viewers (PostgreSQL).
  const previews = await events
    .aggregate([
      { $match: { event_type: "preview_play", course_id: { $in: courseIds } } },
      { $group: { _id: "$course_id", sessions: { $addToSet: "$session_id" }, users: { $addToSet: "$user_id" } } },
    ])
    .toArray();
  const conversion = [];
  for (const p of previews) {
    const known = p.users.filter((u) => u !== null);
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM enrollments WHERE course_id = $1 AND user_id = ANY($2)",
      [p._id, known]
    );
    const sessions = p.sessions.length;
    conversion.push({
      course: titleOf[p._id],
      preview_sessions: sessions,
      enrolled_viewers: rows[0].n,
      conversion_pct: sessions ? Math.round((1000 * rows[0].n) / sessions) / 10 : 0,
    });
  }
  conversion.sort((a, b) => b.conversion_pct - a.conversion_pct);

  // 3. At-risk learners: active and unfinished (PostgreSQL view) with no learning event for 14 days (MongoDB).
  const { rows: active } = await pool.query(
    `SELECT user_id, full_name, course_id, completion_pct
     FROM v_student_progress
     WHERE status = 'active' AND completion_pct < 100 AND course_id = ANY($1)`,
    [courseIds]
  );
  const last = await events
    .aggregate([
      { $match: { course_id: { $in: courseIds }, user_id: { $ne: null }, event_type: { $ne: "preview_play" } } },
      { $group: { _id: { u: "$user_id", c: "$course_id" }, last_ts: { $max: "$ts" } } },
    ])
    .toArray();
  const lastSeen = Object.fromEntries(last.map((l) => [`${l._id.u}-${l._id.c}`, l.last_ts]));
  const now = Date.now();
  const atRisk = active
    .map((a) => {
      const ts = lastSeen[`${a.user_id}-${a.course_id}`];
      return {
        student: a.full_name,
        course: titleOf[a.course_id],
        completion_pct: Number(a.completion_pct),
        days_quiet: ts ? Math.floor((now - new Date(ts).getTime()) / DAY_MS) : null,
      };
    })
    .filter((a) => a.days_quiet === null || a.days_quiet >= AT_RISK_DAYS)
    .sort((a, b) => (b.days_quiet ?? 9999) - (a.days_quiet ?? 9999));

  return NextResponse.json({ stalled, conversion, at_risk: atRisk, at_risk_days: AT_RISK_DAYS });
}
