// Seeds demo data: 1 admin, 2 instructors, 9 students, 10 courses (2 modules x 3 lessons each),
// one preview document per course, and demo activity so reports are not empty.
// Students 1-4 stay untouched for the live demo and tests. Students 5-8 hold the demo activity.
// Student 9 is reserved for the concurrency test.
// For local development only.
// Run after: schema.sql loaded and `npm run setup:mongo`.
import bcrypt from "bcryptjs";
import pg from "pg";
import { MongoClient } from "mongodb";

const DEMO_PASSWORD = "Password123!"; // dev-only password shared by all seeded users
const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const mdb = mongo.db(process.env.MONGODB_DB || "miniudemy");

async function addUser(name, email, role) {
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING user_id`,
    [name, email, hash, role]
  );
  return rows[0].user_id;
}

await addUser("Admin User", "admin@miniudemy.test", "admin");
const instructors = [
  await addUser("Asha Rao", "asha@miniudemy.test", "instructor"),
  await addUser("Vikram Nair", "vikram@miniudemy.test", "instructor"),
];
// Earlier versions seeded students 10-20; remove them (their enrolments, progress and reviews cascade).
await pool.query("DELETE FROM users WHERE email ~ '^student(1[0-9]|20)@miniudemy[.]test$'");
const studentIds = [];
for (let i = 1; i <= 9; i++) {
  studentIds.push(await addUser(`Student ${i}`, `student${i}@miniudemy.test`, "student"));
}

const categories = ["Databases", "Web Development", "Data Science", "Programming"];
const catIds = [];
for (const name of categories) {
  const { rows } = await pool.query(
    `INSERT INTO categories (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING category_id`,
    [name]
  );
  catIds.push(rows[0].category_id);
}

const courses = [
  ["SQL Fundamentals", "Design tables and write joins in PostgreSQL.", 0, "beginner", ["sql", "postgresql"], "HXV3zeQKqGY"],
  ["Advanced PostgreSQL", "Triggers, functions, indexing and transactions.", 0, "advanced", ["postgresql", "triggers"], "qw--VYLpxG4"],
  ["MongoDB Essentials", "Documents, indexes and aggregation pipelines.", 0, "beginner", ["mongodb", "nosql"], "-bt_y4Loofg"],
  ["Next.js in Practice", "Build full-stack apps with the App Router.", 1, "intermediate", ["nextjs", "react"], "Sklc_fQBmcs"],
  ["REST API Design", "Design secure, versioned HTTP APIs.", 1, "intermediate", ["api", "rest"], "lsMQRaeKNDk"],
  ["JavaScript from Scratch", "Core language features and async code.", 3, "beginner", ["javascript"], "W6NZfCO5SIk"],
  ["Python for Data Analysis", "Pandas, plotting and clean data workflows.", 2, "beginner", ["python", "pandas"], "vmEHCJofslg"],
  ["Machine Learning Basics", "Regression, classification and evaluation.", 2, "intermediate", ["ml", "python"], "ukzFI9rgwfU"],
  ["Database Design and Normalisation", "ER modelling through third normal form.", 0, "beginner", ["er", "normalisation"], "ztHopE5Wnpc"],
  ["Authentication and Security", "Hashing, JWT sessions and role checks.", 1, "advanced", ["jwt", "security"], "7Q17ubqLfaM"],
];

// Lesson videos: one full-length public tutorial per course (same order as `courses`), with its length
// in seconds. Each of a course's 6 lessons starts at a different point in it. Only links are stored.
const lessonVideos = [
  ["HXV3zeQKqGY", 15639], // freeCodeCamp: SQL Tutorial, Full Database Course for Beginners
  ["qw--VYLpxG4", 15574], // freeCodeCamp: Learn PostgreSQL, Full Course for Beginners
  ["c2M-rlkkT5o", 3600], // Bro Code: Learn MongoDB in 1 hour
  ["ZVnjOPwW4ZA", 3775], // Programming with Mosh: Next.js Tutorial for Beginners
  ["WXsD0ZgxjRw", 11226], // freeCodeCamp: APIs for Beginners, Full Course
  ["PkZNo7MFNFg", 12403], // freeCodeCamp: Learn JavaScript, Full Course for Beginners
  ["r-uOLxNrNk8", 15733], // freeCodeCamp: Data Analysis with Python, Full Course
  ["i_LwzRVP7bg", 14033], // freeCodeCamp: Machine Learning for Everybody, Full Course
  ["ztHopE5Wnpc", 29240], // freeCodeCamp: Database Design Course
  ["F-sFp_AvHc8", 22408], // freeCodeCamp: User Authentication in Web Apps
];

const courseIds = [];
for (const [i, [title, description, catIdx, level, tags, videoId]] of courses.entries()) {
  const instructor = instructors[i % 2];
  const { rows } = await pool.query(
    `INSERT INTO courses (title, description, instructor_id, category_id, price, level)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (title) DO UPDATE SET description = EXCLUDED.description
     RETURNING course_id`,
    [title, description, instructor, catIds[catIdx], 499 + i * 100, level]
  );
  const courseId = rows[0].course_id;
  courseIds.push(courseId);

  for (let m = 1; m <= 2; m++) {
    const mod = await pool.query(
      `INSERT INTO modules (course_id, title, position) VALUES ($1,$2,$3)
       ON CONFLICT (course_id, position) DO UPDATE SET title = EXCLUDED.title
       RETURNING module_id`,
      [courseId, `Module ${m}`, m]
    );
    for (let l = 1; l <= 3; l++) {
      await pool.query(
        `INSERT INTO lessons (module_id, title, duration_minutes, position) VALUES ($1,$2,$3,$4)
         ON CONFLICT (module_id, position) DO NOTHING`,
        [mod.rows[0].module_id, `Lesson ${m}.${l}`, 8 + l * 2, l]
      );
    }
  }

  const { rows: courseLessons } = await pool.query(
    `SELECT l.lesson_id FROM lessons l JOIN modules m ON m.module_id = l.module_id
     WHERE m.course_id = $1 ORDER BY m.position, l.position`,
    [courseId]
  );
  const [lessonVideo, seconds] = lessonVideos[i];
  for (const [k, { lesson_id }] of courseLessons.entries()) {
    await mdb.collection("lesson_videos").replaceOne(
      { lesson_id },
      {
        lesson_id,
        course_id: courseId,
        video_url: `https://www.youtube.com/watch?v=${lessonVideo}`,
        start_seconds: Math.floor((k * seconds) / courseLessons.length),
      },
      { upsert: true }
    );
  }

  await mdb.collection("course_previews").replaceOne(
    { course_id: courseId },
    {
      course_id: courseId,
      // Public tutorials used as stand-ins. Only the link is stored, never the video.
      video_url: `https://www.youtube.com/watch?v=${videoId}`,
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      tags,
      what_you_will_learn: [`Understand ${title}`, "Build a small hands-on project"],
    },
    { upsert: true }
  );
}

// Demo activity: two students per course, so every insight is short and easy to read.
// In each course one student finishes it and leaves a review; the other stops partway through
// (a stalled lesson) and has been quiet for 3 weeks (an at-risk learner). A few guests watch the
// preview without enrolling. Fixed pattern, no randomness, so the numbers are the same on every run.
// Students 5-8 hold this activity: 5 and 6 in Asha's courses, 7 and 8 in Vikram's.
// Anything seeded for them before is removed first.
const learners = studentIds.slice(4, 8);
const ago = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const events = [];
await mdb.collection("activity_events").deleteMany({ seeded: true });
await pool.query("DELETE FROM reviews WHERE user_id = ANY($1)", [learners]);
await pool.query("DELETE FROM lesson_progress WHERE user_id = ANY($1)", [learners]);
await pool.query("DELETE FROM enrollments WHERE user_id = ANY($1)", [learners]);

let enrolments = 0;
let completions = 0;
let reviews = 0;
for (const [i, courseId] of courseIds.entries()) {
  const { rows: lessons } = await pool.query(
    `SELECT l.lesson_id, l.duration_minutes
     FROM lessons l JOIN modules m ON m.module_id = l.module_id
     WHERE m.course_id = $1
     ORDER BY m.position, l.position`,
    [courseId]
  );
  const stall = 2 + (i % 3); // lessons the second student completed before stopping
  const pair = i % 2 === 0 ? [learners[0], learners[1]] : [learners[2], learners[3]]; // [finishes, gets stuck]

  for (const [j, userId] of pair.entries()) {
    const finished = j === 0;
    const enrolledAgo = 30 + i;
    const lastAgo = finished ? 2 + (i % 4) : 21;
    const done = finished ? lessons.length : stall;
    const base = { user_id: userId, session_id: `seed-${i}-${j}`, course_id: courseId, seeded: true };

    await pool.query(
      "INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES ($1, $2, $3)",
      [userId, courseId, ago(enrolledAgo)]
    );
    enrolments++;
    events.push({ ...base, event_type: "preview_play", ts: ago(enrolledAgo + 1) });

    for (let k = 0; k < done; k++) {
      const when = ago(enrolledAgo - ((enrolledAgo - lastAgo) * (k + 1)) / (done + 1));
      const lesson = lessons[k];
      await pool.query(
        "INSERT INTO lesson_progress (user_id, lesson_id, completed_at) VALUES ($1, $2, $3)",
        [userId, lesson.lesson_id, when]
      );
      completions++;
      const watch_seconds = Math.round(lesson.duration_minutes * 60 * (0.8 + ((i + k) % 5) / 10));
      events.push({ ...base, lesson_id: lesson.lesson_id, event_type: "lesson_open", ts: when });
      events.push({ ...base, lesson_id: lesson.lesson_id, event_type: "ended", watch_seconds, ts: when });
    }

    if (finished) {
      // Past 50%, so the review trigger accepts it.
      await pool.query(
        "INSERT INTO reviews (user_id, course_id, rating, comment) VALUES ($1, $2, $3, $4)",
        [userId, courseId, 4 + (i % 2), "Clear explanations and useful exercises."]
      );
      reviews++;
    } else {
      const lesson = lessons[stall];
      const watch_seconds = Math.round(lesson.duration_minutes * 60 * 0.3);
      events.push({ ...base, lesson_id: lesson.lesson_id, event_type: "lesson_open", ts: ago(lastAgo) });
      events.push({ ...base, lesson_id: lesson.lesson_id, event_type: "pause", watch_seconds, ts: ago(lastAgo) });
    }
  }

  // Guests who watched the preview and did not enrol, for the conversion insight.
  for (let g = 0; g < 2; g++) {
    events.push({
      user_id: null,
      session_id: `seed-guest-${i}-${g}`,
      course_id: courseId,
      event_type: "preview_play",
      seeded: true,
      ts: ago(3 + g * 4),
    });
  }
}
await mdb.collection("activity_events").insertMany(events);

console.log(
  `Seeded users (password for all: ${DEMO_PASSWORD}), ${courses.length} courses, previews, lesson videos, ` +
    `${enrolments} enrolments, ${completions} completed lessons, ${reviews} reviews and ${events.length} demo events.`
);
await pool.end();
await mongo.close();
