import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession, requireRole } from "@/lib/auth";
import { getMongoDb } from "@/lib/mongo";

// GET /api/courses/:id -> course, modules with lessons, and the caller's
// enrolment status, completed lessons and progress percentage.
export async function GET(_request, { params }) {
  const courseId = Number((await params).id);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  }

  try {
    const course = await pool.query(
      `SELECT c.course_id, c.title, c.description, c.price, c.level,
              cat.name AS category, u.full_name AS instructor
       FROM courses c
       JOIN categories cat ON cat.category_id = c.category_id
       JOIN users u ON u.user_id = c.instructor_id
       WHERE c.course_id = $1`,
      [courseId]
    );
    if (!course.rows[0]) return NextResponse.json({ error: "Course not found" }, { status: 404 });

    const lessons = await pool.query(
      `SELECT m.module_id, m.title AS module_title, m.position AS module_position,
              l.lesson_id, l.title AS lesson_title, l.duration_minutes, l.position AS lesson_position
       FROM modules m
       LEFT JOIN lessons l ON l.module_id = m.module_id
       WHERE m.course_id = $1
       ORDER BY m.position, l.position`,
      [courseId]
    );

    const modules = [];
    for (const r of lessons.rows) {
      let mod = modules.find((m) => m.module_id === r.module_id);
      if (!mod) {
        mod = { module_id: r.module_id, title: r.module_title, lessons: [] };
        modules.push(mod);
      }
      if (r.lesson_id) {
        mod.lessons.push({
          lesson_id: r.lesson_id,
          title: r.lesson_title,
          duration_minutes: r.duration_minutes,
        });
      }
    }

    let enrollment = null;
    let completed = [];
    let progressPct = 0;
    const session = await getSession();
    if (session) {
      const e = await pool.query(
        "SELECT status FROM enrollments WHERE user_id = $1 AND course_id = $2",
        [session.userId, courseId]
      );
      enrollment = e.rows[0]?.status ?? null;

      if (enrollment) {
        const done = await pool.query(
          `SELECT lp.lesson_id
           FROM lesson_progress lp
           JOIN lessons l ON l.lesson_id = lp.lesson_id
           JOIN modules m ON m.module_id = l.module_id
           WHERE lp.user_id = $1 AND m.course_id = $2`,
          [session.userId, courseId]
        );
        completed = done.rows.map((r) => r.lesson_id);
        const pct = await pool.query("SELECT course_completion_pct($1, $2) AS pct", [
          session.userId,
          courseId,
        ]);
        progressPct = Number(pct.rows[0].pct);
      }
    }

    return NextResponse.json({
      course: course.rows[0],
      modules,
      enrollment,
      completed,
      progress_pct: progressPct,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not load course" }, { status: 500 });
  }
}

// DELETE /api/courses/:id: the owning instructor or an admin.
// PostgreSQL first: modules, lessons and reviews cascade, but ON DELETE RESTRICT on enrollments
// refuses to delete a course that students are taking. Then the course's MongoDB documents are
// removed. The two databases share no transaction, so if that cleanup fails the leftover
// documents are harmless: every report starts from PostgreSQL course ids.
export async function DELETE(_request, { params }) {
  const { session, error } = await requireRole(["instructor", "admin"]);
  if (error) return error;
  const courseId = Number((await params).id);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  }

  const { rows } = await pool.query("SELECT instructor_id FROM courses WHERE course_id = $1", [courseId]);
  if (!rows[0]) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  if (session.role === "instructor" && rows[0].instructor_id !== session.userId) {
    return NextResponse.json({ error: "You do not own this course" }, { status: 403 });
  }

  try {
    await pool.query("DELETE FROM courses WHERE course_id = $1", [courseId]);
  } catch (err) {
    // 23001 = ON DELETE RESTRICT (enrollments), 23503 = any other foreign key still pointing here.
    if (err.code === "23001" || err.code === "23503") {
      return NextResponse.json({ error: "Students are enrolled in this course, so it cannot be deleted" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "Could not delete course" }, { status: 500 });
  }

  let mongoCleaned = true;
  try {
    const db = await getMongoDb();
    await db.collection("course_previews").deleteMany({ course_id: courseId });
    await db.collection("activity_events").deleteMany({ course_id: courseId });
  } catch (err) {
    console.error("mongo cleanup failed:", err.message);
    mongoCleaned = false;
  }
  return NextResponse.json({ deleted: true, mongo_cleaned: mongoCleaned });
}
