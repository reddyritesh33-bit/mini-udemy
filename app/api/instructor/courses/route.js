import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { cleanText, parseId } from "@/lib/validate";

const LEVELS = ["beginner", "intermediate", "advanced"];

// GET: the instructor's own courses (an admin sees all) with enrolment and review figures.
export async function GET() {
  const { session, error } = await requireRole(["instructor", "admin"]);
  if (error) return error;

  try {
    const { rows } = await pool.query(
      `SELECT c.course_id, c.title, c.level, c.price, cat.name AS category, u.full_name AS instructor,
              (SELECT COUNT(*) FROM modules m JOIN lessons l ON l.module_id = m.module_id
                 WHERE m.course_id = c.course_id)::int AS lessons,
              COUNT(DISTINCT e.enrollment_id)::int AS enrolments,
              COUNT(DISTINCT e.enrollment_id) FILTER (WHERE e.status = 'completed')::int AS completed,
              (SELECT ROUND(AVG(completion_pct), 2) FROM v_student_progress v
                 WHERE v.course_id = c.course_id) AS avg_completion,
              (SELECT ROUND(AVG(rating), 2) FROM reviews r WHERE r.course_id = c.course_id) AS avg_rating
       FROM courses c
       JOIN categories cat ON cat.category_id = c.category_id
       JOIN users u ON u.user_id = c.instructor_id
       LEFT JOIN enrollments e ON e.course_id = c.course_id
       WHERE ($1::int IS NULL OR c.instructor_id = $1)
       GROUP BY c.course_id, cat.name, u.full_name
       ORDER BY c.title`,
      [session.role === "instructor" ? session.userId : null]
    );
    return NextResponse.json({
      courses: rows.map((r) => ({
        ...r,
        avg_completion: r.avg_completion === null ? null : Number(r.avg_completion),
        avg_rating: r.avg_rating === null ? null : Number(r.avg_rating),
      })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not load your courses" }, { status: 500 });
  }
}

function readCourse(body) {
  const title = cleanText(body?.title, 200);
  if (!title) return { error: "title is required (at most 200 characters)" };
  const description = body?.description == null ? null : cleanText(body.description, 5000);
  if (body?.description && description === null) return { error: "description must be at most 5000 characters" };
  const categoryId = parseId(body?.category_id);
  if (!categoryId) return { error: "category_id is required" };
  if (!LEVELS.includes(body?.level)) return { error: `level must be one of ${LEVELS.join(", ")}` };
  const price = Number(body?.price ?? 0);
  if (!Number.isFinite(price) || price < 0 || price > 1000000) return { error: "price must be 0 or more" };

  if (!Array.isArray(body?.modules) || body.modules.length === 0 || body.modules.length > 50) {
    return { error: "add at least one module" };
  }
  const modules = [];
  for (const [i, m] of body.modules.entries()) {
    const mTitle = cleanText(m?.title, 200);
    if (!mTitle) return { error: `module ${i + 1} needs a title` };
    if (!Array.isArray(m.lessons) || m.lessons.length === 0 || m.lessons.length > 100) {
      return { error: `module ${i + 1} needs at least one lesson` };
    }
    const lessons = [];
    for (const [j, l] of m.lessons.entries()) {
      const lTitle = cleanText(l?.title, 200);
      const minutes = Number(l?.duration_minutes);
      if (!lTitle) return { error: `lesson ${i + 1}.${j + 1} needs a title` };
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 600) {
        return { error: `lesson ${i + 1}.${j + 1} needs a duration in whole minutes` };
      }
      lessons.push({ title: lTitle, minutes });
    }
    modules.push({ title: mTitle, lessons });
  }
  return { title, description, categoryId, level: body.level, price, modules };
}

// POST: publish a course with its modules and lessons as ONE transaction.
// If any insert fails (duplicate title, bad value, trigger), everything is rolled back,
// so a half-created course can never appear in the catalogue.
export async function POST(request) {
  const { session, error } = await requireRole(["instructor"]);
  if (error) return error;
  const input = readCourse(await request.json().catch(() => null));
  if (input.error) return NextResponse.json({ error: input.error }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO courses (title, description, instructor_id, category_id, price, level)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING course_id`,
      [input.title, input.description, session.userId, input.categoryId, input.price, input.level]
    );
    const courseId = rows[0].course_id;
    for (const [i, m] of input.modules.entries()) {
      const mod = await client.query(
        "INSERT INTO modules (course_id, title, position) VALUES ($1, $2, $3) RETURNING module_id",
        [courseId, m.title, i + 1]
      );
      for (const [j, l] of m.lessons.entries()) {
        await client.query(
          "INSERT INTO lessons (module_id, title, duration_minutes, position) VALUES ($1, $2, $3, $4)",
          [mod.rows[0].module_id, l.title, l.minutes, j + 1]
        );
      }
    }
    await client.query("COMMIT");
    return NextResponse.json({ course_id: courseId }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") return NextResponse.json({ error: "A course with this title already exists" }, { status: 409 });
    if (err.code === "23503") return NextResponse.json({ error: "Category not found" }, { status: 400 });
    if (err.code === "23514") return NextResponse.json({ error: "A value is outside the allowed range" }, { status: 400 });
    if (err.code === "P0001") return NextResponse.json({ error: err.message }, { status: 403 });
    console.error(err);
    return NextResponse.json({ error: "Could not publish course" }, { status: 500 });
  } finally {
    client.release();
  }
}
