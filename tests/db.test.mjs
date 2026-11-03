// Database tests: constraints, triggers, functions, the view, transactions, concurrency, the 7 reports,
// MongoDB validation and aggregation, and the three insight queries. Run: npm run test:db
// It reloads schema.sql into the test database, so it starts from empty tables every time.
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';

// These tests write, change and delete data. They refuse to run unless the database names contain "test".
const DB_URL = process.env.DATABASE_URL;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGO_DB = process.env.MONGODB_DB;
if (!DB_URL || !/test/i.test(new URL(DB_URL).pathname) || !MONGO_DB || !/test/i.test(MONGO_DB)) {
  console.error('Set DATABASE_URL and MONGODB_DB to TEST databases (their names must contain "test"). See README, Testing.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: DB_URL, max: 25 });

const results = [];
const rec = (id, name, ok, detail = '') => { results.push({ id, name, ok, detail }); console.log(ok ? 'PASS' : 'FAIL', id, name, detail); };
const rejects = async (id, name, sql, params, re) => {
  try { await pool.query(sql, params); rec(id, name, false, 'no error raised'); }
  catch (e) { rec(id, name, re.test(e.message), e.message); }
};

try {
  const ver = (await pool.query('select version()')).rows[0].version;
  console.log(ver);
  await pool.query(readFileSync('schema.sql', 'utf8'));
  rec('S1', 'Schema, triggers, functions and view load', true);

  await pool.query(`
    INSERT INTO users (full_name,email,password_hash,role) VALUES
      ('Admin','admin@test.com','x','admin'),('Ins A','ia@test.com','x','instructor'),('Ins B','ib@test.com','x','instructor'),
      ('S1','s1@test.com','x','student'),('S2','s2@test.com','x','student'),('S3','s3@test.com','x','student'),('S4','s4@test.com','x','student');
    INSERT INTO categories (name) VALUES ('Databases'),('Web');
    INSERT INTO courses (title,description,instructor_id,category_id,price,level) VALUES
      ('PostgreSQL Basics','Learn relational database design and SQL queries',2,1,0,'beginner'),
      ('Next.js Projects','Build full stack web apps',3,2,499,'intermediate');
    INSERT INTO modules (course_id,title,position) VALUES (1,'M1',1),(1,'M2',2),(2,'M1',1);
    INSERT INTO lessons (module_id,title,duration_minutes,position) VALUES
      (1,'L1',10,1),(1,'L2',10,2),(2,'L3',10,1),(2,'L4',10,2),(3,'L5',10,1),(3,'L6',10,2);
  `);

  // Constraints
  await rejects('C1', 'Bad email rejected', `INSERT INTO users (full_name,email,password_hash) VALUES ('x','not-an-email','x')`, [], /users_email_format/);
  await rejects('C2', 'Duplicate email rejected', `INSERT INTO users (full_name,email,password_hash) VALUES ('x','s1@test.com','x')`, [], /unique/i);
  await rejects('C3', 'Invalid role rejected', `INSERT INTO users (full_name,email,password_hash,role) VALUES ('x','z@test.com','x','root')`, [], /check/i);
  await rejects('C4', 'Negative price rejected', `UPDATE courses SET price=-1 WHERE course_id=1`, [], /check/i);
  await rejects('C5', 'Duplicate lesson position rejected', `INSERT INTO lessons (module_id,title,duration_minutes,position) VALUES (1,'x',5,1)`, [], /unique/i);
  await rejects('C6', 'Category with courses cannot be deleted',`DELETE FROM categories WHERE category_id=1`, [], /foreign key/i);

  // Triggers
  await rejects('T1', 'Student cannot own a course', `INSERT INTO courses (title,instructor_id,category_id) VALUES ('Bad',4,1)`, [], /instructor role/);
  await rejects('T2', 'Non-enrolled student cannot complete a lesson', `INSERT INTO lesson_progress (user_id,lesson_id) VALUES (4,1)`, [], /not enrolled/);
  await rejects('F1', 'Instructor cannot enrol', `SELECT enroll_student(2,1)`, [], /Only students/);

  // 20 parallel enrolments, separate pooled connections
  const ids = await Promise.all(Array.from({ length: 20 }, () => pool.query('SELECT enroll_student(4,1) AS id')));
  const cnt = (await pool.query('SELECT COUNT(*)::int c FROM enrollments WHERE user_id=4 AND course_id=1')).rows[0].c;
  rec('M1', '20 parallel enrolments create one row', cnt === 1 && new Set(ids.map(r => r.rows[0].id)).size === 1, `${cnt} row`);

  // Function and view
  await pool.query('INSERT INTO lesson_progress (user_id,lesson_id) VALUES (4,1)');
  const p = (await pool.query('SELECT course_completion_pct(4,1) p')).rows[0].p;
  rec('F2', 'Completion % is 25 after 1 of 4 lessons', Number(p) === 25, p);
  await rejects('T4', 'Review below 50% rejected', `INSERT INTO reviews (user_id,course_id,rating) VALUES (4,1,5)`, [], /50%/);
  await pool.query('INSERT INTO lesson_progress (user_id,lesson_id) VALUES (4,2)');
  await pool.query(`INSERT INTO reviews (user_id,course_id,rating,comment) VALUES (4,1,5,'Good')`);
  rec('T5', 'Review at 50% accepted', true);
  await rejects('C7', 'Rating 6 rejected (CHECK)', `UPDATE reviews SET rating=6 WHERE user_id=4`, [], /check/i);
  await rejects('C8', 'Second review by same student rejected', `INSERT INTO reviews (user_id,course_id,rating) VALUES (4,1,4)`, [], /unique/i);
  await rejects('C9', 'Repeat completion of a lesson rejected', `INSERT INTO lesson_progress (user_id,lesson_id) VALUES (4,1)`, [], /unique/i);

  // Concurrent last-two-lessons: the FOR UPDATE case
  const a = await pool.connect(), b = await pool.connect();
  await a.query('BEGIN'); await b.query('BEGIN');
  await a.query('INSERT INTO lesson_progress (user_id,lesson_id) VALUES (4,3)');
  const bDone = b.query('INSERT INTO lesson_progress (user_id,lesson_id) VALUES (4,4)');
  await new Promise(r => setTimeout(r, 400));
  await a.query('COMMIT');
  await bDone; await b.query('COMMIT'); a.release(); b.release();
  const st = (await pool.query('SELECT status FROM enrollments WHERE user_id=4 AND course_id=1')).rows[0].status;
  const v = (await pool.query('SELECT completion_pct FROM v_student_progress WHERE user_id=4 AND course_id=1')).rows[0].completion_pct;
  rec('T3', 'Two simultaneous last lessons give status completed at 100%', st === 'completed' && Number(v) === 100, `${st}, ${v}%`);

  // Transaction rollback: course + modules + lessons
  const c = await pool.connect();
  let rolled = false;
  try {
    await c.query('BEGIN');
    const nc = await c.query(`INSERT INTO courses (title,instructor_id,category_id) VALUES ('Txn Course',2,1) RETURNING course_id`);
    const nm = await c.query(`INSERT INTO modules (course_id,title,position) VALUES ($1,'M',1) RETURNING module_id`, [nc.rows[0].course_id]);
    await c.query(`INSERT INTO lessons (module_id,title,duration_minutes,position) VALUES ($1,'bad',0,1)`, [nm.rows[0].module_id]);
    await c.query('COMMIT');
  } catch { await c.query('ROLLBACK'); rolled = true; } finally { c.release(); }
  const left = (await pool.query(`SELECT COUNT(*)::int c FROM courses WHERE title='Txn Course'`)).rows[0].c;
  rec('X1', 'Failed course publish rolls back fully', rolled && left === 0, `${left} courses left`);

  // Seed reports
  await pool.query(`
    SELECT enroll_student(5,1); SELECT enroll_student(6,1); SELECT enroll_student(7,1); SELECT enroll_student(5,2);
    INSERT INTO lesson_progress (user_id,lesson_id) VALUES (5,1),(5,2),(5,3),(6,1),(5,5);
    INSERT INTO reviews (user_id,course_id,rating) VALUES (5,1,4),(5,2,5);
  `);
  const reports = {
    R1: `SELECT title, ROUND(AVG(completion_pct),2) AS avg_completion FROM v_student_progress GROUP BY title ORDER BY avg_completion DESC`,
    R2: `SELECT c.title, DATE_TRUNC('month', e.enrolled_at) AS month, COUNT(*) AS enrolments FROM enrollments e JOIN courses c ON c.course_id=e.course_id GROUP BY c.title, month ORDER BY month, enrolments DESC`,
    R3: `SELECT u.full_name, COUNT(DISTINCT e.user_id) AS students FROM users u JOIN courses c ON c.instructor_id=u.user_id JOIN enrollments e ON e.course_id=c.course_id GROUP BY u.user_id, u.full_name ORDER BY students DESC LIMIT 5`,
    R4: `SELECT c.title, l.title AS lesson, COUNT(lp.progress_id) AS completions FROM lessons l JOIN modules m ON m.module_id=l.module_id JOIN courses c ON c.course_id=m.course_id LEFT JOIN lesson_progress lp ON lp.lesson_id=l.lesson_id GROUP BY c.title, l.lesson_id, l.title ORDER BY completions ASC LIMIT 5`,
    R5: `SELECT cat.name, ROUND(AVG(r.rating),2) AS avg_rating, COUNT(*) AS reviews FROM categories cat JOIN courses c ON c.category_id=cat.category_id JOIN reviews r ON r.course_id=c.course_id GROUP BY cat.name HAVING COUNT(*) >= 2 ORDER BY avg_rating DESC`,
    R6: `SELECT full_name, title, completion_pct FROM v_student_progress WHERE completion_pct > (SELECT AVG(completion_pct) FROM v_student_progress) ORDER BY completion_pct DESC`,
    R7: `SELECT title, ts_rank(to_tsvector('english', title || ' ' || COALESCE(description,'')), q) AS rank FROM courses, plainto_tsquery('english', $1) AS q WHERE to_tsvector('english', title || ' ' || COALESCE(description,'')) @@ q ORDER BY rank DESC`,
  };
  for (const [k, sql] of Object.entries(reports)) {
    const r = await pool.query(sql, k === 'R7' ? ['relational databases'] : []);
    rec(k, 'Report runs and returns rows', r.rows.length > 0, `${r.rows.length} rows: ${JSON.stringify(r.rows[0])}`);
  }
  await pool.query('SET enable_seqscan = off');
  const plan = (await pool.query(`EXPLAIN SELECT title FROM courses WHERE to_tsvector('english', title || ' ' || COALESCE(description,'')) @@ plainto_tsquery('english','sql')`)).rows.map(r => r['QUERY PLAN']).join(' ');
  rec('I1', 'Full-text search can use the GIN index', /idx_courses_fts/.test(plan));
  await pool.query('SET enable_seqscan = on');

  // MongoDB
  const m = new MongoClient(MONGO_URI);
  await m.connect();
  const mdb = m.db(MONGO_DB);
  await mdb.dropDatabase();
  await mdb.createCollection('course_previews', { validator: { $jsonSchema: {
    bsonType: 'object', required: ['course_id', 'video_url'],
    properties: { course_id: { bsonType: 'int' }, video_url: { bsonType: 'string', pattern: '^https://' }, duration_seconds: { bsonType: 'int', minimum: 1 }, tags: { bsonType: 'array' }, what_you_will_learn: { bsonType: 'array' } } } } });
  const prev = mdb.collection('course_previews'), ev = mdb.collection('activity_events');
  await prev.createIndex({ course_id: 1 }, { unique: true });
  await prev.createIndex({ tags: 1 });
  await ev.createIndex({ course_id: 1, ts: -1 });
  await ev.createIndex({ user_id: 1, ts: -1 });
  await ev.createIndex({ event_type: 1, course_id: 1 });
  await prev.insertOne({ course_id: 1, video_url: 'https://www.youtube.com/watch?v=abc', thumbnail: 'https://x/y.jpg', duration_seconds: 90, tags: ['sql'], what_you_will_learn: ['Joins'] });
  try { await prev.insertOne({ course_id: 2, video_url: 'ftp://bad' }); rec('N0', 'Mongo validator rejects bad URL', false); } catch (e) { rec('N0', 'Mongo validator rejects bad URL', e.code === 121, `code ${e.code}`); }
  try { await prev.insertOne({ course_id: 1, video_url: 'https://dup' }); rec('N1', 'One preview per course', false); } catch (e) { rec('N1', 'One preview per course', e.code === 11000, `code ${e.code}`); }

  const old = new Date(Date.now() - 20 * 864e5), now = new Date();
  await ev.insertMany([
    { user_id: 4, course_id: 1, lesson_id: 1, event_type: 'pause', watch_seconds: 300, ts: now },
    { user_id: 5, course_id: 1, lesson_id: 1, event_type: 'ended', watch_seconds: 600, ts: now },
    { user_id: 5, course_id: 2, lesson_id: 5, event_type: 'pause', watch_seconds: 120, ts: now },
    { user_id: 6, course_id: 1, lesson_id: 3, event_type: 'lesson_open', ts: old },
    { user_id: 7, course_id: 1, lesson_id: 3, event_type: 'lesson_open', ts: now },
    { user_id: 5, course_id: 1, lesson_id: 3, event_type: 'lesson_open', ts: now },
    { user_id: 5, course_id: 1, event_type: 'preview_play', session_id: 'a', ts: now },
    { user_id: 6, course_id: 1, event_type: 'preview_play', session_id: 'b', ts: now },
    { user_id: null, course_id: 1, event_type: 'preview_play', session_id: 'c', ts: now },
    { user_id: null, course_id: 2, event_type: 'preview_play', session_id: 'd', ts: now },
  ]);
  const watch = await ev.aggregate([
    { $match: { event_type: { $in: ['pause', 'ended'] } } },
    { $group: { _id: '$course_id', total_seconds: { $sum: '$watch_seconds' }, viewers: { $addToSet: '$user_id' } } },
    { $project: { _id: 0, course_id: '$_id', watch_hours: { $round: [{ $divide: ['$total_seconds', 3600] }, 2] }, unique_viewers: { $size: '$viewers' } } },
    { $sort: { watch_hours: -1 } },
  ]).toArray();
  rec('N2', 'Watch-time aggregation', watch[0].course_id === 1 && watch[0].watch_hours === 0.25 && watch[0].unique_viewers === 2, JSON.stringify(watch));

  // Novelty 1: stall detector
  const opens = await ev.aggregate([
    { $match: { event_type: 'lesson_open' } },
    { $group: { _id: '$lesson_id', openers: { $addToSet: '$user_id' } } },
    { $project: { _id: 0, lesson_id: '$_id', opened_by: { $size: '$openers' } } },
  ]).toArray();
  const done = await pool.query(`SELECT l.lesson_id, l.title, COUNT(lp.progress_id)::int AS completed_by FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id = l.lesson_id WHERE l.lesson_id = ANY($1) GROUP BY l.lesson_id, l.title`, [opens.map(o => o.lesson_id)]);
  const stall = done.rows.map(d => ({ ...d, opened_by: opens.find(o => o.lesson_id === d.lesson_id).opened_by }));
  rec('N3', 'Stall detector merges Mongo opens with SQL completions', stall[0].lesson_id === 3 && stall[0].opened_by === 3, JSON.stringify(stall));

  // Novelty 2: preview conversion
  const viewers = await ev.aggregate([
    { $match: { event_type: 'preview_play' } },
    { $group: { _id: '$course_id', sessions: { $addToSet: '$session_id' }, users: { $addToSet: '$user_id' } } },
    { $project: { _id: 0, course_id: '$_id', viewers: { $size: '$sessions' }, known_users: { $filter: { input: '$users', cond: { $ne: ['$$this', null] } } } } },
  ]).toArray();
  const v1 = viewers.find(x => x.course_id === 1);
  const conv = (await pool.query('SELECT COUNT(*)::int c FROM enrollments WHERE course_id = $1 AND user_id = ANY($2)', [1, v1.known_users])).rows[0].c;
  rec('N4', 'Preview-to-enrolment conversion', v1.viewers === 3 && conv === 2, `${conv} of ${v1.viewers} sessions`);

  // Novelty 3: at-risk learners
  const last = await ev.aggregate([{ $match: { user_id: { $ne: null }, event_type: { $ne: 'preview_play' } } }, { $group: { _id: { u: '$user_id', c: '$course_id' }, last_ts: { $max: '$ts' } } }]).toArray();
  const lp = await pool.query(`SELECT user_id, course_id, full_name, completion_pct FROM v_student_progress WHERE status='active' AND completion_pct < 100`);
  const cutoff = Date.now() - 14 * 864e5;
  const risk = lp.rows.filter(r => { const l = last.find(x => x._id.u === r.user_id && x._id.c === r.course_id); return !l || l.last_ts.getTime() < cutoff; });
  rec('N5', 'At-risk learners found', risk.some(r => r.user_id === 6) && !risk.some(r => r.user_id === 7), JSON.stringify(risk.map(r => r.user_id)));

  await mdb.dropDatabase();
  await m.close();

  // Control: same race with the FOR UPDATE removed from trigger 3
  const fn = readFileSync('schema.sql', 'utf8').match(/CREATE FUNCTION update_enrollment_status[\s\S]*?LANGUAGE plpgsql VOLATILE;/)[0]
    .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
    .replace(/PERFORM 1 FROM enrollments[\s\S]*?FOR UPDATE;/, '');
  await pool.query(fn);
  await pool.query('SELECT enroll_student(7,2)');
  const a2 = await pool.connect(), b2 = await pool.connect();
  await a2.query('BEGIN'); await b2.query('BEGIN');
  await a2.query('INSERT INTO lesson_progress (user_id,lesson_id) VALUES (7,5)');
  await b2.query('INSERT INTO lesson_progress (user_id,lesson_id) VALUES (7,6)');
  await a2.query('COMMIT'); await b2.query('COMMIT'); a2.release(); b2.release();
  const ctl = (await pool.query('SELECT status, completion_pct FROM v_student_progress WHERE user_id=7 AND course_id=2')).rows[0];
  rec('T3c', 'Control: without FOR UPDATE, status stays active at 100%', ctl.status === 'active' && Number(ctl.completion_pct) === 100, `${ctl.status}, ${ctl.completion_pct}%`);

} finally {
  await pool.end().catch(() => {});
}
const f = results.filter(r => !r.ok);
console.log(`${results.length - f.length}/${results.length} passed`);
process.exitCode = f.length ? 1 : 0;
