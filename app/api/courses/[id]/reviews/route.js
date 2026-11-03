import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession, requireRole } from "@/lib/auth";
import { parseId } from "@/lib/validate";

function readBody(body) {
  const rating = body?.rating;
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "rating must be a whole number from 1 to 5" };
  const comment = body?.comment;
  if (comment !== undefined && comment !== null && (typeof comment !== "string" || comment.length > 2000)) {
    return { error: "comment must be text of at most 2000 characters" };
  }
  return { rating, comment: comment?.trim() || null };
}

// GET: public list of reviews with the average, plus the caller's own review if any.
export async function GET(_request, { params }) {
  const courseId = parseId((await params).id);
  if (!courseId) return NextResponse.json({ error: "Invalid course id" }, { status: 400 });

  try {
    const { rows } = await pool.query(
      `SELECT r.review_id, r.user_id, u.full_name, r.rating, r.comment
       FROM reviews r JOIN users u ON u.user_id = r.user_id
       WHERE r.course_id = $1
       ORDER BY r.review_id DESC`,
      [courseId]
    );
    const session = await getSession();
    const avg = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : null;
    return NextResponse.json({
      reviews: rows.map(({ user_id, ...r }) => ({ ...r, mine: session?.userId === user_id })),
      average: avg === null ? null : Math.round(avg * 100) / 100,
      count: rows.length,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not load reviews" }, { status: 500 });
  }
}

// POST: add a review. Trigger 4 rejects it below 50% progress; UNIQUE (user_id, course_id) stops a second one.
export async function POST(request, { params }) {
  const { session, error } = await requireRole(["student"]);
  if (error) return error;
  const courseId = parseId((await params).id);
  if (!courseId) return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  const input = readBody(await request.json().catch(() => null));
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });

  try {
    const { rows } = await pool.query(
      `INSERT INTO reviews (user_id, course_id, rating, comment) VALUES ($1, $2, $3, $4)
       RETURNING review_id, rating, comment`,
      [session.userId, courseId, input.rating, input.comment]
    );
    return NextResponse.json({ review: rows[0] }, { status: 201 });
  } catch (err) {
    if (err.code === "P0001") return NextResponse.json({ error: err.message }, { status: 403 });
    if (err.code === "23505") return NextResponse.json({ error: "You have already reviewed this course" }, { status: 409 });
    if (err.code === "23503") return NextResponse.json({ error: "Course not found" }, { status: 404 });
    console.error(err);
    return NextResponse.json({ error: "Could not save review" }, { status: 500 });
  }
}

// PUT: edit your own review.
export async function PUT(request, { params }) {
  const { session, error } = await requireRole(["student"]);
  if (error) return error;
  const courseId = parseId((await params).id);
  if (!courseId) return NextResponse.json({ error: "Invalid course id" }, { status: 400 });
  const input = readBody(await request.json().catch(() => null));
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });

  const { rows } = await pool.query(
    `UPDATE reviews SET rating = $3, comment = $4
     WHERE user_id = $1 AND course_id = $2
     RETURNING review_id, rating, comment`,
    [session.userId, courseId, input.rating, input.comment]
  );
  if (!rows[0]) return NextResponse.json({ error: "You have not reviewed this course" }, { status: 404 });
  return NextResponse.json({ review: rows[0] });
}

// DELETE: a student removes their own review; an admin can remove any (?review_id=).
export async function DELETE(request, { params }) {
  const { session, error } = await requireRole(["student", "admin"]);
  if (error) return error;
  const courseId = parseId((await params).id);
  if (!courseId) return NextResponse.json({ error: "Invalid course id" }, { status: 400 });

  let result;
  if (session.role === "admin") {
    const reviewId = parseId(new URL(request.url).searchParams.get("review_id"));
    if (!reviewId) return NextResponse.json({ error: "review_id is required" }, { status: 400 });
    result = await pool.query("DELETE FROM reviews WHERE review_id = $1 AND course_id = $2", [reviewId, courseId]);
  } else {
    result = await pool.query("DELETE FROM reviews WHERE user_id = $1 AND course_id = $2", [session.userId, courseId]);
  }
  if (result.rowCount === 0) return NextResponse.json({ error: "Review not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
