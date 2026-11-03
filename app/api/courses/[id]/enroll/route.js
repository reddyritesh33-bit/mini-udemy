import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export async function POST(_request, { params }) {
  const { session, error } = await requireRole(["student"]);
  if (error) return error;

  const { id } = await params;
  const courseId = Number(id);
  if (!Number.isInteger(courseId) || courseId <= 0) {
    return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  }

  try {
    // The database function does the rule check and the ON CONFLICT upsert,
    // so repeated or simultaneous requests can never create a duplicate row.
    const { rows } = await pool.query("SELECT enroll_student($1, $2) AS enrollment_id", [
      session.userId,
      courseId,
    ]);
    return NextResponse.json({ enrollment_id: rows[0].enrollment_id });
  } catch (err) {
    if (err.code === "23503") {
      return NextResponse.json({ error: "Course not found" }, { status: 404 });
    }
    if (err.code === "P0001") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(err);
    return NextResponse.json({ error: "Enrolment failed" }, { status: 500 });
  }
}
