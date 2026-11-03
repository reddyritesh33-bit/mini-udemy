import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";

// GET /api/me/learning: the logged-in student's courses with progress,
// read from the v_student_progress view (one definition of progress everywhere).
export async function GET() {
  const { session, error } = await requireRole(["student"]);
  if (error) return error;

  try {
    const { rows } = await pool.query(
      `SELECT course_id, title, status, completion_pct
       FROM v_student_progress
       WHERE user_id = $1
       ORDER BY title`,
      [session.userId]
    );
    return NextResponse.json({
      courses: rows.map((r) => ({ ...r, completion_pct: Number(r.completion_pct) })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not load your courses" }, { status: 500 });
  }
}
