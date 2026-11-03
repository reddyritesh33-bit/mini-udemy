import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";

// GET /api/admin/users?q=name-or-email: every user with how many courses they teach and take.
export async function GET(request) {
  const { error } = await requireRole(["admin"]);
  if (error) return error;
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || null;

  const { rows } = await pool.query(
    `SELECT u.user_id, u.full_name, u.email, u.role, TO_CHAR(u.created_at, 'YYYY-MM-DD') AS joined,
            (SELECT COUNT(*) FROM courses c WHERE c.instructor_id = u.user_id)::int AS teaches,
            (SELECT COUNT(*) FROM enrollments e WHERE e.user_id = u.user_id)::int AS enrolled_in
     FROM users u
     WHERE $1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%'
     ORDER BY u.role, u.full_name`,
    [q]
  );
  return NextResponse.json({ users: rows });
}
