import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// GET /api/courses?q=sql&level=beginner&category=1
// Search uses the GIN full-text index; filters are optional.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || null;
  const level = searchParams.get("level") || null;
  const category = Number(searchParams.get("category")) || null;

  try {
    const courses = await pool.query(
      `SELECT c.course_id, c.title, c.description, c.price, c.level,
              cat.name AS category, u.full_name AS instructor
       FROM courses c
       JOIN categories cat ON cat.category_id = c.category_id
       JOIN users u ON u.user_id = c.instructor_id
       WHERE ($1::text IS NULL OR
              to_tsvector('english', c.title || ' ' || COALESCE(c.description, ''))
                @@ plainto_tsquery('english', $1))
         AND ($2::text IS NULL OR c.level = $2)
         AND ($3::int IS NULL OR c.category_id = $3)
       ORDER BY c.title`,
      [q, level, category]
    );
    const categories = await pool.query("SELECT category_id, name FROM categories ORDER BY name");
    return NextResponse.json({ courses: courses.rows, categories: categories.rows });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not load courses" }, { status: 500 });
  }
}
