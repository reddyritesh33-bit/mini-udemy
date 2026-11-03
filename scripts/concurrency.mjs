// Fires 20 parallel enrolment requests as one student and checks the database
// holds exactly one enrolment row. Needs the app running (npm run dev) and seeded data.
// Uses student 9, who is reserved for this test: it deletes and recreates their enrolment,
// so running it never disturbs an account used in the live demo.
import pg from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const EMAIL = "student9@miniudemy.test";
const PASSWORD = "Password123!";
const COURSE_ID = Number(process.argv[2] || 1);
const PARALLEL = 20;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) {
  console.error("Login failed:", login.status, await login.text());
  process.exit(1);
}
const cookie = login.headers.get("set-cookie").split(";")[0];

const { rows: me } = await pool.query("SELECT user_id FROM users WHERE email = $1", [EMAIL]);
const userId = me[0].user_id;
await pool.query("DELETE FROM enrollments WHERE user_id = $1 AND course_id = $2", [userId, COURSE_ID]);

const results = await Promise.all(
  Array.from({ length: PARALLEL }, () =>
    fetch(`${BASE}/api/courses/${COURSE_ID}/enroll`, { method: "POST", headers: { cookie } }).then(
      (r) => r.status
    )
  )
);

const { rows } = await pool.query(
  "SELECT COUNT(*)::int AS n FROM enrollments WHERE user_id = $1 AND course_id = $2",
  [userId, COURSE_ID]
);

console.log(`HTTP statuses: ${[...new Set(results)].join(", ")} (${PARALLEL} requests)`);
console.log(`Enrolment rows for student 9 in course ${COURSE_ID}: ${rows[0].n}`);
console.log(rows[0].n === 1 ? "PASS: no duplicates" : "FAIL: duplicates found");
await pool.end();
process.exit(rows[0].n === 1 ? 0 : 1);
