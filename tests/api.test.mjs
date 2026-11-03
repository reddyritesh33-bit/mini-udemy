// API tests against the running app: every route, wrong-role access, reviews, publish transaction,
// course delete across both databases, insights, reports and user management. Run: npm run test:api
// The app must be running against the SAME test databases, freshly loaded with schema.sql and seeded.
import pg from 'pg';
import { MongoClient } from 'mongodb';

// These tests write, change and delete data. They refuse to run unless the database names contain "test".
const DB_URL = process.env.DATABASE_URL;
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
const MONGO_DB = process.env.MONGODB_DB;
if (!DB_URL || !/test/i.test(new URL(DB_URL).pathname) || !MONGO_DB || !/test/i.test(MONGO_DB)) {
  console.error('Set DATABASE_URL and MONGODB_DB to TEST databases (their names must contain "test"). See README, Testing.');
  process.exit(1);
}
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const pool = new pg.Pool({ connectionString: DB_URL });
const mc = new MongoClient(MONGO_URI);
await mc.connect();
const mdb = mc.db(MONGO_DB);
const PW = 'Password123!';
const results = [];
const rec = (ok, name, detail = '') => { results.push({ ok, name, detail }); console.log(ok ? 'PASS' : 'FAIL', name, detail ? `-> ${detail}` : ''); };
const info = (name, detail) => console.log('INFO', name, '->', detail);

async function call(path, { method = 'GET', body, cookie } = {}) {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data, setCookie: r.headers.get('set-cookie') };
}
async function login(email, password = PW) {
  const r = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  return r.setCookie?.split(';')[0];
}

// Catalogue
let r = await call('/api/courses');
rec(r.status === 200 && r.data.courses.length === 10, 'Catalogue lists 10 seeded courses', `${r.data?.courses?.length}`);
r = await call('/api/courses?q=database');
info('Search "database" returns', r.data.courses.map(c => c.title).join(' | '));
rec(r.data.courses.length >= 1, 'Full-text search finds database courses');
r = await call('/api/courses?level=advanced');
rec(r.data.courses.every(c => c.level === 'advanced') && r.data.courses.length > 0, 'Level filter');
r = await call(`/api/courses?category=${(await call('/api/courses')).data.categories[0].category_id}`);
rec(r.status === 200 && r.data.courses.length > 0, 'Category filter');
r = await call("/api/courses?q=' OR 1=1 --");
rec(r.status === 200 && r.data.courses.length === 0, 'SQL injection text in search is harmless', `${r.data?.courses?.length} rows`);

// Auth
const stamp = Date.now();
r = await call('/api/auth/register', { method: 'POST', body: { full_name: 'New', email: `new${stamp}@x.test`, password: 'longenough1', role: 'admin' } });
rec(r.status === 201 && r.data.user.role === 'student', 'Register ignores role=admin in the request', r.data?.user?.role);
r = await call('/api/auth/register', { method: 'POST', body: { full_name: 'Dup', email: `new${stamp}@x.test`, password: 'longenough1' } });
rec(r.status === 409, 'Duplicate email rejected', `${r.status}`);
r = await call('/api/auth/register', { method: 'POST', body: { full_name: 'Bad', email: 'not-an-email', password: 'longenough1' } });
rec(r.status === 400, 'Bad email rejected by database CHECK', `${r.status}`);
r = await call('/api/auth/register', { method: 'POST', body: { full_name: 'Short', email: `s${stamp}@x.test`, password: 'short' } });
rec(r.status === 400, 'Short password rejected', `${r.status}`);
r = await call('/api/auth/login', { method: 'POST', body: { email: 'student1@miniudemy.test', password: 'wrong' } });
rec(r.status === 401, 'Wrong password rejected', `${r.status}`);
rec(/httponly/i.test((await call('/api/auth/login', { method: 'POST', body: { email: 'student1@miniudemy.test', password: PW } })).setCookie || ''), 'Login cookie is httpOnly');
const hash = (await pool.query(`SELECT password_hash FROM users WHERE email='student1@miniudemy.test'`)).rows[0].password_hash;
rec(hash.startsWith('$2'), 'Password stored as bcrypt hash');

const s1 = await login('student1@miniudemy.test'), s2 = await login('student2@miniudemy.test'), s3 = await login('student3@miniudemy.test');
const asha = await login('asha@miniudemy.test'), vikram = await login('vikram@miniudemy.test'), admin = await login('admin@miniudemy.test');
r = await call('/api/auth/me', { cookie: s1 });
rec(r.status === 200 && r.data.user.role === 'student' && !!r.data.user.name, 'me returns the fields Nav needs', JSON.stringify(r.data?.user));
r = await call('/api/auth/me', { cookie: 'token=forged.jwt.value' });
rec(r.status === 401 || !r.data?.user, 'Forged token treated as logged out', `${r.status}`);

// Course detail and preview
r = await call('/api/courses/1');
rec(r.status === 200 && r.data.modules.length === 2 && r.data.modules[0].lessons.length === 3, 'Course detail for a guest');
rec((await call('/api/courses/9999')).status === 404, 'Missing course gives 404');
rec((await call('/api/courses/abc')).status === 400, 'Bad course id gives 400');
r = await call('/api/courses/1/preview');
rec(r.status === 200 && !!r.data.preview.video_url, 'Preview readable by a guest', r.data?.preview?.video_url);

// Preview writes: course 1 belongs to asha
const good = { video_url: 'https://www.youtube.com/watch?v=abc', duration_seconds: 60, tags: ['sql'] };
rec((await call('/api/courses/1/preview', { method: 'PUT', body: good })).status === 401, 'Preview edit: guest 401');
rec((await call('/api/courses/1/preview', { method: 'PUT', body: good, cookie: s1 })).status === 403, 'Preview edit: student 403');
rec((await call('/api/courses/1/preview', { method: 'PUT', body: good, cookie: vikram })).status === 403, 'Preview edit: other instructor 403');
rec((await call('/api/courses/1/preview', { method: 'PUT', body: { video_url: 'http://bad' }, cookie: asha })).status === 400, 'Preview edit: non-https 400');
rec((await call('/api/courses/1/preview', { method: 'PUT', body: good, cookie: asha })).status === 200, 'Preview edit: owner 200');
rec((await call('/api/courses/1/preview', { method: 'PUT', body: good, cookie: admin })).status === 200, 'Preview edit: admin 200');
rec(await mdb.collection('course_previews').countDocuments({ course_id: 1 }) === 1, 'Still one preview document for the course');

// Enrolment roles
rec((await call('/api/courses/1/enroll', { method: 'POST' })).status === 401, 'Enrol: guest 401');
r = await call('/api/courses/1/enroll', { method: 'POST', cookie: asha });
rec(r.status === 403, 'Enrol: instructor 403', r.data?.error);
rec((await call('/api/courses/9999/enroll', { method: 'POST', cookie: s1 })).status === 404, 'Enrol: missing course 404');

// Lesson progress
const lessons = (await pool.query(`SELECT l.lesson_id FROM lessons l JOIN modules m ON m.module_id=l.module_id WHERE m.course_id=1 ORDER BY m.position,l.position`)).rows.map(x => x.lesson_id);
rec((await call(`/api/lessons/${lessons[0]}/complete`, { method: 'POST' })).status === 401, 'Complete lesson: guest 401');
r = await call(`/api/lessons/${lessons[0]}/complete`, { method: 'POST', cookie: s1 });
rec(r.status === 403, 'Complete lesson: not enrolled 403 (trigger)', r.data?.error);
info('Missing lesson status', (await call('/api/lessons/99999/complete', { method: 'POST', cookie: s1 })).status);
rec((await call(`/api/lessons/${lessons[0]}/complete`, { method: 'POST', cookie: asha })).status === 403, 'Complete lesson: instructor 403');
r = await call('/api/courses/1/enroll', { method: 'POST', cookie: s1 });
rec(r.status === 200, 'Enrol: student 200');
const seen = [];
for (const l of lessons) { r = await call(`/api/lessons/${l}/complete`, { method: 'POST', cookie: s1 }); seen.push(r.data.progress_pct); }
info('Progress values returned', seen.join(', '));
rec(seen.at(-1) === 100 && r.data.status === 'completed', 'Status becomes completed at 100% through the API', r.data.status);
r = await call(`/api/lessons/${lessons[0]}/complete`, { method: 'POST', cookie: s1 });
rec(r.status === 200 && r.data.already_completed, 'Double click on Mark complete is harmless');
r = await call('/api/me/learning', { cookie: s1 });
rec(r.status === 200 && r.data.courses[0].status === 'completed', 'My Learning shows completed', JSON.stringify(r.data.courses));
rec((await call('/api/me/learning')).status === 401, 'My Learning: guest 401');
rec((await call('/api/me/learning', { cookie: asha })).status === 403, 'My Learning: instructor 403');

// Simultaneous last lessons through the HTTP layer
await call('/api/courses/2/enroll', { method: 'POST', cookie: s2 });
const l2 = (await pool.query(`SELECT l.lesson_id FROM lessons l JOIN modules m ON m.module_id=l.module_id WHERE m.course_id=2`)).rows.map(x => x.lesson_id);
await Promise.all(l2.map(l => call(`/api/lessons/${l}/complete`, { method: 'POST', cookie: s2 })));
const st = (await pool.query(`SELECT status, completion_pct FROM v_student_progress WHERE course_id=2 AND full_name='Student 2'`)).rows[0];
rec(st.status === 'completed' && Number(st.completion_pct) === 100, 'All 6 lessons completed at the same moment still gives completed', `${st.status} ${st.completion_pct}`);

// Reviews through the API
await call('/api/courses/3/enroll', { method: 'POST', cookie: s3 });
r = await call('/api/courses/3/reviews', { method: 'POST', cookie: s3, body: { rating: 5, comment: 'Great' } });
rec(r.status === 403 && /50%/.test(r.data?.error), 'Review at 0% rejected by the trigger, through the API', r.data?.error);
const l3 = (await pool.query(`SELECT l.lesson_id FROM lessons l JOIN modules m ON m.module_id=l.module_id WHERE m.course_id=3 ORDER BY m.position,l.position`)).rows.map(x => x.lesson_id);
for (const l of l3.slice(0, 2)) await call(`/api/lessons/${l}/complete`, { method: 'POST', cookie: s3 });
r = await call('/api/courses/3/reviews', { method: 'POST', cookie: s3, body: { rating: 5, comment: 'Great' } });
rec(r.status === 403, 'Review at 33% still rejected', `${r.status}`);
await call(`/api/lessons/${l3[2]}/complete`, { method: 'POST', cookie: s3 });
r = await call('/api/courses/3/reviews', { method: 'POST', cookie: s3, body: { rating: 5, comment: 'Great' } });
rec(r.status === 201, 'Review at 50% accepted', `${r.status}`);
rec((await call('/api/courses/3/reviews', { method: 'POST', cookie: s3, body: { rating: 4 } })).status === 409, 'Second review by the same student 409');
rec((await call('/api/courses/3/reviews', { method: 'PUT', cookie: s3, body: { rating: 9 } })).status === 400, 'Rating outside 1 to 5 rejected');
r = await call('/api/courses/3/reviews', { method: 'PUT', cookie: s3, body: { rating: 4, comment: 'Edited' } });
rec(r.status === 200 && r.data.review.rating === 4, 'Student edits own review');
r = await call('/api/courses/3/reviews', { cookie: s3 });
rec(r.status === 200 && r.data.reviews.filter(x => x.mine).length === 1 && r.data.average !== null, 'Review list marks the caller\'s own review', `avg ${r.data?.average} from ${r.data?.count}`);
rec((await call('/api/courses/3/reviews')).data.reviews.every(x => !x.mine), 'Guest sees no review as theirs');
rec((await call('/api/courses/3/reviews', { method: 'POST', body: { rating: 5 } })).status === 401, 'Review: guest 401');
rec((await call('/api/courses/3/reviews', { method: 'POST', cookie: asha, body: { rating: 5 } })).status === 403, 'Review: instructor 403');
rec((await call('/api/courses/3/reviews', { method: 'DELETE', cookie: s3 })).status === 200, 'Student deletes own review');
rec((await call('/api/courses/3/reviews', { method: 'DELETE', cookie: s3 })).status === 404, 'Deleting again gives 404');
const anyReview = (await pool.query('SELECT review_id, course_id FROM reviews LIMIT 1')).rows[0];
rec((await call(`/api/courses/${anyReview.course_id}/reviews?review_id=${anyReview.review_id}`, { method: 'DELETE', cookie: admin })).status === 200, 'Admin removes a review');

// Events
const count = () => mdb.collection('activity_events').countDocuments();
const before = await count();
r = await call('/api/events', { method: 'POST', body: { event_type: 'preview_play', course_id: 1, session_id: 'g1' } });
rec(r.status === 201, 'Guest preview_play recorded');
r = await call('/api/events', { method: 'POST', cookie: s1, body: { event_type: 'lesson_open', course_id: 1, lesson_id: lessons[0], user_id: 999, session_id: 's1' } });
const last = await mdb.collection('activity_events').find().sort({ _id: -1 }).limit(1).next();
const s1id = (await pool.query(`SELECT user_id FROM users WHERE email='student1@miniudemy.test'`)).rows[0].user_id;
rec(last.user_id === s1id, 'user_id in event comes from the cookie, not the body', `${last.user_id}`);
rec((await call('/api/events', { method: 'POST', body: { event_type: 'hack', course_id: 1 } })).status === 400, 'Unknown event type 400');
rec((await call('/api/events', { method: 'POST', cookie: s1, body: { event_type: 'pause', course_id: 1, lesson_id: 1 } })).status === 400, 'pause without watch_seconds 400');
// Event validation (these were open findings before)
rec((await call('/api/events', { method: 'POST', body: { event_type: 'lesson_open', course_id: 1, lesson_id: lessons[0] } })).status === 401, 'Guest lesson event rejected (401)');
rec((await call('/api/events', { method: 'POST', body: { event_type: 'preview_play', course_id: 987654 } })).status === 404, 'Event for a missing course rejected (404)');
rec((await call('/api/events', { method: 'POST', cookie: s1, body: { event_type: 'lesson_open', course_id: 5, lesson_id: lessons[0] } })).status === 404, 'Lesson from a different course rejected (404)');
rec((await call('/api/events', { method: 'POST', cookie: s3, body: { event_type: 'pause', course_id: 3, lesson_id: l3[0], watch_seconds: 999999999 } })).status === 400, 'Huge watch_seconds rejected (400)');
rec((await call('/api/events', { method: 'POST', cookie: s3, body: { event_type: 'pause', course_id: 3, lesson_id: l3[0], watch_seconds: 120 } })).status === 201, 'Valid pause event accepted');
rec(await mdb.collection('activity_events').countDocuments({ watch_seconds: 999999999 }) === 0, 'No oversized event stored');

// Lesson videos (MongoDB), access decided by PostgreSQL
const totalLessons = (await pool.query('SELECT COUNT(*)::int n FROM lessons')).rows[0].n;
rec(await mdb.collection('lesson_videos').countDocuments() === totalLessons, 'Every seeded lesson has a video', `${totalLessons} lessons`);
rec((await call(`/api/lessons/${lessons[0]}/video`)).status === 401, 'Lesson video: guest 401');
r = await call(`/api/lessons/${lessons[0]}/video`, { cookie: s2 });
rec(r.status === 403, 'Lesson video: student not enrolled 403', r.data?.error);
r = await call(`/api/lessons/${lessons[0]}/video`, { cookie: s1 });
const v0 = r.data?.video;
const v1 = (await call(`/api/lessons/${lessons[1]}/video`, { cookie: s1 })).data?.video;
rec(r.status === 200 && /^https:\/\//.test(v0.video_url) && v0.start_seconds === 0, 'Lesson video: enrolled student gets the first lesson from the start', JSON.stringify(v0));
rec(v1 && v1.video_url === v0.video_url && v1.start_seconds > 0, 'Next lesson starts later in the same course video', `${v1?.start_seconds}s`);
rec((await call(`/api/lessons/${lessons[0]}/video`, { cookie: asha })).status === 200, 'Lesson video: owning instructor 200');
rec((await call(`/api/lessons/${lessons[0]}/video`, { cookie: vikram })).status === 403, 'Lesson video: other instructor 403');
rec((await call(`/api/lessons/${lessons[0]}/video`, { cookie: admin })).status === 200, 'Lesson video: admin 200');
rec((await call('/api/lessons/999999/video', { cookie: admin })).status === 404, 'Lesson video: missing lesson 404');
try { await mdb.collection('lesson_videos').insertOne({ lesson_id: 999998, course_id: 1, video_url: 'http://bad', start_seconds: 0 }); rec(false, 'lesson_videos validator rejects a non-https link'); }
catch (e) { rec(e.code === 121, 'lesson_videos validator rejects a non-https link', `code ${e.code}`); }

// Reports
rec((await call('/api/admin/reports/watch-time', { cookie: s1 })).status === 403, 'Watch-time: student 403');
rec((await call('/api/admin/reports/watch-time')).status === 401, 'Watch-time: guest 401');
r = await call('/api/admin/reports/watch-time', { cookie: admin });
rec(r.status === 200, 'Watch-time: admin 200');
rec(r.data.rows.length === 10, 'Watch-time report has data for all 10 courses', `${r.data.rows.length} courses`);
info('Event types recorded by normal use', JSON.stringify(await mdb.collection('activity_events').aggregate([{ $group: { _id: '$event_type', n: { $sum: 1 } } }]).toArray()));

// Admin user management and immediate role changes
const s4 = await login('student4@miniudemy.test');
const s4id = (await pool.query(`SELECT user_id FROM users WHERE email='student4@miniudemy.test'`)).rows[0].user_id;
const ashaId = (await pool.query(`SELECT user_id FROM users WHERE email='asha@miniudemy.test'`)).rows[0].user_id;
const adminId = (await pool.query(`SELECT user_id FROM users WHERE email='admin@miniudemy.test'`)).rows[0].user_id;
r = await call('/api/admin/users', { cookie: admin });
rec(r.status === 200 && r.data.users.length >= 23, 'Admin lists users', `${r.data?.users?.length}`);
r = await call('/api/admin/users?q=asha', { cookie: admin });
rec(r.data.users.length === 1 && r.data.users[0].teaches === 5, 'User search shows courses taught', JSON.stringify(r.data.users[0]));
rec((await call('/api/admin/users', { cookie: s1 })).status === 403, 'User list: student 403');
rec((await call(`/api/admin/users/${s4id}`, { method: 'PATCH', cookie: asha, body: { role: 'admin' } })).status === 403, 'Role change: instructor 403');
rec((await call(`/api/admin/users/${s4id}`, { method: 'PATCH', cookie: admin, body: { role: 'superuser' } })).status === 400, 'Role change: unknown role 400');
rec((await call(`/api/admin/users/${adminId}`, { method: 'PATCH', cookie: admin, body: { role: 'student' } })).status === 400, 'Admin cannot demote themself');
r = await call(`/api/admin/users/${ashaId}`, { method: 'PATCH', cookie: admin, body: { role: 'student' } });
rec(r.status === 409, 'Instructor who owns courses cannot be demoted', r.data?.error);
rec((await call(`/api/admin/users/${s4id}`, { method: 'PATCH', cookie: admin, body: { role: 'instructor' } })).status === 200, 'Admin promotes a student to instructor');
r = await call('/api/auth/me', { cookie: s4 });
rec(r.data.user.role === 'instructor', 'New role applies at once, without logging in again', r.data.user.role);
rec((await call('/api/instructor/courses', { cookie: s4 })).status === 200, 'Promoted user reaches the instructor API with the old cookie');
await call(`/api/admin/users/${s4id}`, { method: 'PATCH', cookie: admin, body: { role: 'student' } });
rec((await call('/api/me/learning', { cookie: s4 })).status === 200, 'Demoted back to student, same cookie works as student');

// Odd input (these returned 500 before)
rec((await call('/api/auth/login', { method: 'POST', body: { email: 5, password: 'x' } })).status === 400, 'Login with non-text email gives 400');
rec((await call('/api/auth/register', { method: 'POST', body: { full_name: 'x'.repeat(500), email: `l${stamp}@x.test`, password: 'longenough1' } })).status === 400, 'Register with 500-character name gives 400');
rec((await call('/api/auth/register', { method: 'POST', body: { full_name: 'N', email: 7, password: 'longenough1' } })).status === 400, 'Register with non-text email gives 400');

// Instructor dashboard and the publish transaction
r = await call('/api/instructor/courses', { cookie: asha });
rec(r.status === 200 && r.data.courses.length === 5 && r.data.courses.every(c => c.instructor === 'Asha Rao'), 'Instructor sees only their own 5 courses');
rec((await call('/api/instructor/courses', { cookie: admin })).data.courses.length === 10, 'Admin sees all 10 courses');
rec((await call('/api/instructor/courses', { cookie: s1 })).status === 403, 'Instructor courses: student 403');
const cat = (await pool.query('SELECT category_id FROM categories LIMIT 1')).rows[0].category_id;
const newCourse = { title: `Indexing Deep Dive ${stamp}`, description: 'B-trees and GIN.', category_id: cat, level: 'advanced', price: 799,
  modules: [{ title: 'Basics', lessons: [{ title: 'What an index is', duration_minutes: 12 }, { title: 'B-trees', duration_minutes: 15 }] },
            { title: 'Practice', lessons: [{ title: 'EXPLAIN', duration_minutes: 20 }] }] };
rec((await call('/api/instructor/courses', { method: 'POST', cookie: s1, body: newCourse })).status === 403, 'Publish: student 403');
rec((await call('/api/instructor/courses', { method: 'POST', cookie: asha, body: { ...newCourse, modules: [] } })).status === 400, 'Publish: no modules 400');
rec((await call('/api/instructor/courses', { method: 'POST', cookie: asha, body: { ...newCourse, level: 'expert' } })).status === 400, 'Publish: bad level 400');
const counts = async () => (await pool.query('SELECT (SELECT COUNT(*) FROM courses)::int c, (SELECT COUNT(*) FROM modules)::int m, (SELECT COUNT(*) FROM lessons)::int l')).rows[0];
const c0 = await counts();
r = await call('/api/instructor/courses', { method: 'POST', cookie: asha, body: newCourse });
const newId = r.data?.course_id;
const c1 = await counts();
rec(r.status === 201 && c1.c === c0.c + 1 && c1.m === c0.m + 2 && c1.l === c0.l + 3, 'Publish creates course, 2 modules and 3 lessons together', JSON.stringify(c1));
r = await call(`/api/courses/${newId}`);
rec(r.status === 200 && r.data.modules[1].lessons[0].title === 'EXPLAIN' && r.data.course.instructor === 'Asha Rao', 'Published course readable with its structure');
// Duplicate title fails on the first insert; the transaction must leave nothing behind.
r = await call('/api/instructor/courses', { method: 'POST', cookie: vikram, body: { ...newCourse, modules: [{ title: 'X', lessons: [{ title: 'Y', duration_minutes: 5 }] }] } });
rec(r.status === 409 && JSON.stringify(await counts()) === JSON.stringify(c1), 'Duplicate title rolls back completely', r.data?.error);
// Make PostgreSQL fail on the LAST insert (a lesson) and check nothing from the earlier inserts survives.
await pool.query(`ALTER TABLE lessons ADD CONSTRAINT e2e_no_fail_lesson CHECK (title <> 'FAIL HERE')`);
r = await call('/api/instructor/courses', { method: 'POST', cookie: asha, body: { ...newCourse, title: `Rollback ${stamp}`, modules: [...newCourse.modules, { title: 'Last', lessons: [{ title: 'FAIL HERE', duration_minutes: 5 }] }] } });
const c2 = await counts();
await pool.query('ALTER TABLE lessons DROP CONSTRAINT e2e_no_fail_lesson');
rec(r.status === 400 && JSON.stringify(c2) === JSON.stringify(c1) && (await pool.query(`SELECT 1 FROM courses WHERE title=$1`, [`Rollback ${stamp}`])).rowCount === 0, 'Failure on the last lesson rolls back course and modules too', `${r.status} ${JSON.stringify(c2)}`);

// Deleting a course across both databases
await call(`/api/courses/${newId}/preview`, { method: 'PUT', cookie: asha, body: { video_url: 'https://www.youtube.com/watch?v=x' } });
await call('/api/events', { method: 'POST', body: { event_type: 'preview_play', course_id: newId, session_id: 'del' } });
await mdb.collection('lesson_videos').insertOne({ lesson_id: 999997, course_id: newId, video_url: 'https://www.youtube.com/watch?v=x', start_seconds: 0 });
rec((await call(`/api/courses/${newId}`, { method: 'DELETE', cookie: vikram })).status === 403, 'Delete: other instructor 403');
rec((await call(`/api/courses/${newId}`, { method: 'DELETE', cookie: s1 })).status === 403, 'Delete: student 403');
r = await call('/api/courses/1', { method: 'DELETE', cookie: asha });
rec(r.status === 409 && (await pool.query('SELECT 1 FROM courses WHERE course_id=1')).rowCount === 1, 'Course with enrolled students cannot be deleted (RESTRICT)', r.data?.error);
r = await call(`/api/courses/${newId}`, { method: 'DELETE', cookie: asha });
const left = await pool.query('SELECT (SELECT COUNT(*) FROM modules WHERE course_id=$1)::int m', [newId]);
const mongoLeft = await mdb.collection('course_previews').countDocuments({ course_id: newId }) + await mdb.collection('activity_events').countDocuments({ course_id: newId })
  + await mdb.collection('lesson_videos').countDocuments({ course_id: newId });
rec(r.status === 200 && r.data.mongo_cleaned && left.rows[0].m === 0 && mongoLeft === 0, 'Delete removes PostgreSQL rows and MongoDB documents', `modules ${left.rows[0].m}, mongo ${mongoLeft}`);
rec((await call(`/api/courses/${newId}`)).status === 404, 'Deleted course gives 404');

// Insights
rec((await call('/api/insights')).status === 401, 'Insights: guest 401');
rec((await call('/api/insights', { cookie: s1 })).status === 403, 'Insights: student 403');
r = await call('/api/insights', { cookie: admin });
rec(r.status === 200 && r.data.stalled.length > 0 && r.data.stalled.every(s => s.opened_by >= s.completed_by), 'Stall detector returns lessons opened more than completed', JSON.stringify(r.data.stalled[0]));
rec(r.data.conversion.length === 10 && r.data.conversion.every(c => c.enrolled_viewers <= c.preview_sessions), 'Conversion for all 10 courses, never above 100%', JSON.stringify(r.data.conversion[0]));
rec(r.data.at_risk.length > 0 && r.data.at_risk.every(a => a.days_quiet === null || a.days_quiet >= 14) && r.data.at_risk.every(a => a.completion_pct < 100), 'At-risk list: unfinished and quiet 14+ days', `${r.data.at_risk.length} learners`);
const ashaTitles = (await pool.query(`SELECT title FROM courses c JOIN users u ON u.user_id=c.instructor_id WHERE u.email='asha@miniudemy.test'`)).rows.map(x => x.title);
r = await call('/api/insights', { cookie: asha });
rec(r.status === 200 && [...r.data.stalled, ...r.data.conversion, ...r.data.at_risk].every(x => ashaTitles.includes(x.course)), 'Instructor insights only cover their own courses');
info('Top stalled lesson', JSON.stringify(r.data.stalled[0]));

// Admin SQL reports
rec((await call('/api/admin/reports', { cookie: s1 })).status === 403, 'SQL reports: student 403');
rec((await call('/api/admin/reports', { cookie: asha })).status === 403, 'SQL reports: instructor 403');
r = await call('/api/admin/reports?q=database', { cookie: admin });
rec(r.status === 200 && r.data.reports.length === 7 && r.data.reports.every(x => x.rows.length > 0), 'All 7 SQL reports return rows', r.data?.reports?.map(x => `${x.id}:${x.rows.length}`).join(' '));
r = await call(`/api/admin/reports?q=${encodeURIComponent("' OR 1=1 --")}`, { cookie: admin });
rec(r.status === 200 && r.data.reports.find(x => x.id === 'R7').rows.length === 0, 'R7 search text is a parameter, not SQL');

const f = results.filter(x => !x.ok).length;
console.log(`\n${results.length - f}/${results.length} passed`);
await pool.end(); await mc.close();
process.exitCode = f ? 1 : 0;
