import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { parseId } from "@/lib/validate";

const ROLES = ["student", "instructor", "admin"];

// PATCH /api/admin/users/:id  { role }: change a user's role. Takes effect on their next request,
// because the session reads the role from the database each time.
export async function PATCH(request, { params }) {
  const { session, error } = await requireRole(["admin"]);
  if (error) return error;
  const userId = parseId((await params).id);
  if (!userId) return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  const role = (await request.json().catch(() => null))?.role;
  if (!ROLES.includes(role)) return NextResponse.json({ error: `role must be one of ${ROLES.join(", ")}` }, { status: 400 });
  if (userId === session.userId) {
    return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // FOR UPDATE makes a course publish for this user wait (trigger 1 reads the row FOR SHARE),
    // so a new course cannot slip in between the check below and the role change.
    const { rows } = await client.query("SELECT role FROM users WHERE user_id = $1 FOR UPDATE", [userId]);
    if (!rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    // Trigger 1 only checks when a course is created, so keep course owners as instructors here.
    if (rows[0].role === "instructor" && role !== "instructor") {
      const owned = await client.query("SELECT COUNT(*)::int AS n FROM courses WHERE instructor_id = $1", [userId]);
      if (owned.rows[0].n > 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: `This instructor owns ${owned.rows[0].n} course(s); reassign or delete them first` }, { status: 409 });
      }
    }
    await client.query("UPDATE users SET role = $2 WHERE user_id = $1", [userId, role]);
    await client.query("COMMIT");
    return NextResponse.json({ user_id: userId, role });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return NextResponse.json({ error: "Could not change role" }, { status: 500 });
  } finally {
    client.release();
  }
}
