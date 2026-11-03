import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireRole } from "@/lib/auth";

// The seven SQL reports from the Project Report. Each shows a different query feature.
const REPORTS = [
  {
    id: "R1",
    title: "Average completion per course",
    shows: "View, aggregate, GROUP BY",
    sql: `SELECT title, ROUND(AVG(completion_pct), 2) AS avg_completion
          FROM v_student_progress
          GROUP BY title
          ORDER BY avg_completion DESC`,
  },
  {
    id: "R2",
    title: "Enrolments per course per month",
    shows: "JOIN, GROUP BY",
    sql: `SELECT c.title, TO_CHAR(DATE_TRUNC('month', e.enrolled_at), 'YYYY-MM') AS month, COUNT(*)::int AS enrolments
          FROM enrollments e
          JOIN courses c ON c.course_id = e.course_id
          GROUP BY c.title, DATE_TRUNC('month', e.enrolled_at)
          ORDER BY month, enrolments DESC`,
  },
  {
    id: "R3",
    title: "Top instructors by number of students",
    shows: "Multi-table JOIN, COUNT DISTINCT",
    sql: `SELECT u.full_name, COUNT(DISTINCT e.user_id)::int AS students
          FROM users u
          JOIN courses c ON c.instructor_id = u.user_id
          JOIN enrollments e ON e.course_id = c.course_id
          GROUP BY u.user_id, u.full_name
          ORDER BY students DESC
          LIMIT 5`,
  },
  {
    id: "R4",
    title: "Lessons with the fewest completions",
    shows: "LEFT JOIN",
    sql: `SELECT c.title, l.title AS lesson, COUNT(lp.progress_id)::int AS completions
          FROM lessons l
          JOIN modules m ON m.module_id = l.module_id
          JOIN courses c ON c.course_id = m.course_id
          LEFT JOIN lesson_progress lp ON lp.lesson_id = l.lesson_id
          GROUP BY c.title, l.lesson_id, l.title
          ORDER BY completions ASC
          LIMIT 5`,
  },
  {
    id: "R5",
    title: "Average rating per category, with at least 2 reviews",
    shows: "HAVING",
    sql: `SELECT cat.name, ROUND(AVG(r.rating), 2) AS avg_rating, COUNT(*)::int AS reviews
          FROM categories cat
          JOIN courses c ON c.category_id = cat.category_id
          JOIN reviews r ON r.course_id = c.course_id
          GROUP BY cat.name
          HAVING COUNT(*) >= 2
          ORDER BY avg_rating DESC`,
  },
  {
    id: "R6",
    title: "Students above average progress",
    shows: "Subquery",
    sql: `SELECT full_name, title, completion_pct
          FROM v_student_progress
          WHERE completion_pct > (SELECT AVG(completion_pct) FROM v_student_progress)
          ORDER BY completion_pct DESC
          LIMIT 20`,
  },
  {
    id: "R7",
    title: "Full-text course search, ranked",
    shows: "GIN index, ts_rank",
    sql: `SELECT title, ROUND(ts_rank(to_tsvector('english', title || ' ' || COALESCE(description, '')), q)::numeric, 4) AS rank
          FROM courses, plainto_tsquery('english', $1) AS q
          WHERE to_tsvector('english', title || ' ' || COALESCE(description, '')) @@ q
          ORDER BY rank DESC`,
    param: true,
  },
];

// GET /api/admin/reports?q=database  (q is the search term for R7)
export async function GET(request) {
  const { error } = await requireRole(["admin"]);
  if (error) return error;
  const q = new URL(request.url).searchParams.get("q")?.trim().slice(0, 100) || "database";

  try {
    const out = [];
    for (const r of REPORTS) {
      const { rows } = await pool.query(r.sql, r.param ? [q] : []);
      out.push({ id: r.id, title: r.title, shows: r.shows, sql: r.sql.replace(/\n {10}/g, "\n"), rows });
    }
    return NextResponse.json({ reports: out, q });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Could not run reports" }, { status: 500 });
  }
}
