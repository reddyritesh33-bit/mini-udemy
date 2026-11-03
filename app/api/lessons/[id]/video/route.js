import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getMongoDb } from "@/lib/mongo";
import { requireRole } from "@/lib/auth";
import { parseId } from "@/lib/validate";

// GET /api/lessons/:id/video: the video for a lesson, from MongoDB.
// PostgreSQL decides who may watch: an enrolled student (not dropped), the course's instructor, or an admin.
export async function GET(_request, { params }) {
  const { session, error } = await requireRole(["student", "instructor", "admin"]);
  if (error) return error;
  const lessonId = parseId((await params).id);
  if (!lessonId) return NextResponse.json({ error: "Invalid lesson id" }, { status: 400 });

  const { rows } = await pool.query(
    `SELECT c.course_id, c.instructor_id,
            EXISTS (SELECT 1 FROM enrollments e
                    WHERE e.course_id = c.course_id AND e.user_id = $2 AND e.status <> 'dropped') AS enrolled
     FROM lessons l
     JOIN modules m ON m.module_id = l.module_id
     JOIN courses c ON c.course_id = m.course_id
     WHERE l.lesson_id = $1`,
    [lessonId, session.userId]
  );
  if (!rows[0]) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  const allowed =
    session.role === "admin" ||
    (session.role === "instructor" && rows[0].instructor_id === session.userId) ||
    (session.role === "student" && rows[0].enrolled);
  if (!allowed) return NextResponse.json({ error: "Enrol in this course to watch its lessons" }, { status: 403 });

  try {
    const db = await getMongoDb();
    const video = await db
      .collection("lesson_videos")
      .findOne({ lesson_id: lessonId }, { projection: { _id: 0, video_url: 1, start_seconds: 1 } });
    if (!video) return NextResponse.json({ error: "No video for this lesson yet" }, { status: 404 });
    return NextResponse.json({ video });
  } catch (err) {
    // MongoDB down: the lesson can still be completed, just without the video.
    console.error("lesson video read failed:", err.message);
    return NextResponse.json({ video: null, degraded: true });
  }
}
