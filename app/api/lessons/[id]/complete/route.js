import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";

// POST /api/lessons/:id/complete
// The database does the real checking: trigger 2 rejects students who are not enrolled,
// trigger 3 marks the enrolment completed at 100% (with a row lock for simultaneous requests),
// and UNIQUE (user_id, lesson_id) stops a lesson being completed twice.
export async function POST(_request, { params }) {
  const { session, error } = await requireRole(["student"]);
  if (error) return error;

  const lessonId = Number((await params).id);
  if (!Number.isInteger(lessonId) || lessonId <= 0) {
    return NextResponse.json({ error: "Invalid lesson id" }, { status: 400 });
  }

  try {
    await pool.query("INSERT INTO lesson_progress (user_id, lesson_id) VALUES ($1, $2)", [
      session.userId,
      lessonId,
    ]);
  } catch (err) {
    if (err.code === "23503") {
      return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    }
    if (err.code === "23505") {
      // Already completed: treat as success so a double click is harmless.
      return NextResponse.json({ already_completed: true });
    }
    if (err.code === "P0001") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(err);
    return NextResponse.json({ error: "Could not save progress" }, { status: 500 });
  }

  // Read the result back after the insert (and its triggers) have committed.
  const { rows } = await pool.query(
    `SELECT m.course_id,
            course_completion_pct($1, m.course_id) AS progress_pct,
            e.status
     FROM lessons l
     JOIN modules m ON m.module_id = l.module_id
     JOIN enrollments e ON e.course_id = m.course_id AND e.user_id = $1
     WHERE l.lesson_id = $2`,
    [session.userId, lessonId]
  );
  return NextResponse.json({
    course_id: rows[0].course_id,
    progress_pct: Number(rows[0].progress_pct),
    status: rows[0].status,
  });
}
