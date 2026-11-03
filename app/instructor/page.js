"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const box = { border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 };
const input = { padding: 6, boxSizing: "border-box" };
const th = { textAlign: "left", borderBottom: "2px solid #ddd", padding: 6 };
const td = { borderBottom: "1px solid #eee", padding: 6 };

const emptyLesson = () => ({ title: "", duration_minutes: 10 });
const emptyModule = () => ({ title: "", lessons: [emptyLesson()] });
const emptyCourse = () => ({ title: "", description: "", category_id: "", level: "beginner", price: 0, modules: [emptyModule()] });

function PreviewForm({ course, onDone }) {
  const [form, setForm] = useState({ video_url: "", tags: "", learn: "" });
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch(`/api/courses/${course.course_id}/preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const p = d?.preview;
        if (p) setForm({ video_url: p.video_url ?? "", tags: (p.tags ?? []).join(", "), learn: (p.what_you_will_learn ?? []).join("\n") });
      })
      .catch(() => {});
  }, [course.course_id]);

  async function save(e) {
    e.preventDefault();
    const split = (s, sep) => s.split(sep).map((x) => x.trim()).filter(Boolean);
    const res = await fetch(`/api/courses/${course.course_id}/preview`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_url: form.video_url.trim(), tags: split(form.tags, ","), what_you_will_learn: split(form.learn, "\n") }),
    });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error || "Could not save preview");
    onDone("Preview saved to MongoDB.");
  }

  return (
    <form onSubmit={save} style={{ ...box, background: "#fafafa" }}>
      <strong>Preview for {course.title}</strong>
      <input style={{ ...input, display: "block", width: "100%", margin: "8px 0" }} placeholder="https://www.youtube.com/watch?v=..." value={form.video_url} onChange={(e) => setForm({ ...form, video_url: e.target.value })} required />
      <input style={{ ...input, display: "block", width: "100%", marginBottom: 8 }} placeholder="Tags, separated by commas" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
      <textarea style={{ ...input, display: "block", width: "100%", minHeight: 60, marginBottom: 8 }} placeholder="What you will learn, one per line" value={form.learn} onChange={(e) => setForm({ ...form, learn: e.target.value })} />
      {msg && <p style={{ color: "crimson" }}>{msg}</p>}
      <button type="submit">Save preview</button>{" "}
      <button type="button" onClick={() => onDone("")}>Cancel</button>
    </form>
  );
}

export default function InstructorDashboard() {
  const [courses, setCourses] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(emptyCourse());
  const [previewFor, setPreviewFor] = useState(null);

  function load() {
    fetch("/api/instructor/courses")
      .then(async (r) => {
        if (r.status === 401) return (window.location.href = "/login");
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load your courses");
        setCourses(d.courses);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    fetch("/api/courses").then((r) => r.json()).then((d) => setCategories(d.categories ?? [])).catch(() => {});
  }, []);

  const setModule = (i, patch) => setDraft({ ...draft, modules: draft.modules.map((m, k) => (k === i ? { ...m, ...patch } : m)) });
  const setLesson = (i, j, patch) =>
    setModule(i, { lessons: draft.modules[i].lessons.map((l, k) => (k === j ? { ...l, ...patch } : l)) });

  async function publish(e) {
    e.preventDefault();
    setMsg("");
    const body = {
      ...draft,
      category_id: Number(draft.category_id),
      price: Number(draft.price),
      modules: draft.modules.map((m) => ({ ...m, lessons: m.lessons.map((l) => ({ ...l, duration_minutes: Number(l.duration_minutes) })) })),
    };
    const res = await fetch("/api/instructor/courses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) return setMsg(data.error || "Could not publish");
    setCreating(false);
    setDraft(emptyCourse());
    setMsg("Course published. The course, its modules and lessons were saved in one transaction.");
    load();
  }

  async function remove(c) {
    if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return;
    setMsg("");
    const res = await fetch(`/api/courses/${c.course_id}`, { method: "DELETE" });
    const data = await res.json();
    setMsg(res.ok ? `Deleted "${c.title}".` : data.error || "Could not delete");
    if (res.ok) load();
  }

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 1000, margin: "24px auto", padding: "0 16px" }}>
      <h1>Instructor Dashboard</h1>
      <p>
        <Link href="/insights">See learner insights</Link> for stalled lessons, preview conversion and at-risk learners.
      </p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {msg && <p>{msg}</p>}

      {!creating ? (
        <button onClick={() => { setCreating(true); setMsg(""); }} style={{ padding: "8px 16px", marginBottom: 16 }}>New course</button>
      ) : (
        <form onSubmit={publish} style={box}>
          <h2 style={{ marginTop: 0 }}>New course</h2>
          <input style={{ ...input, width: "100%", marginBottom: 8 }} placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
          <textarea style={{ ...input, width: "100%", minHeight: 50, marginBottom: 8 }} placeholder="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <select style={input} value={draft.category_id} onChange={(e) => setDraft({ ...draft, category_id: e.target.value })} required>
              <option value="">Category</option>
              {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
            </select>
            <select style={input} value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })}>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
            <label>Price (Rs.) <input style={{ ...input, width: 100 }} type="number" min="0" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></label>
          </div>
          {draft.modules.map((m, i) => (
            <div key={i} style={{ borderLeft: "3px solid #3b82f6", paddingLeft: 12, marginBottom: 12 }}>
              <input style={{ ...input, width: "60%" }} placeholder={`Module ${i + 1} title`} value={m.title} onChange={(e) => setModule(i, { title: e.target.value })} required />
              {draft.modules.length > 1 && (
                <button type="button" onClick={() => setDraft({ ...draft, modules: draft.modules.filter((_, k) => k !== i) })} style={{ marginLeft: 8 }}>Remove module</button>
              )}
              {m.lessons.map((l, j) => (
                <div key={j} style={{ margin: "6px 0 0 16px", display: "flex", gap: 8 }}>
                  <input style={{ ...input, flex: 1 }} placeholder={`Lesson ${i + 1}.${j + 1} title`} value={l.title} onChange={(e) => setLesson(i, j, { title: e.target.value })} required />
                  <input style={{ ...input, width: 70 }} type="number" min="1" value={l.duration_minutes} onChange={(e) => setLesson(i, j, { duration_minutes: e.target.value })} title="Minutes" />
                  <span style={{ alignSelf: "center", fontSize: 13 }}>min</span>
                  {m.lessons.length > 1 && (
                    <button type="button" onClick={() => setModule(i, { lessons: m.lessons.filter((_, k) => k !== j) })}>×</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setModule(i, { lessons: [...m.lessons, emptyLesson()] })} style={{ margin: "6px 0 0 16px" }}>Add lesson</button>
            </div>
          ))}
          <button type="button" onClick={() => setDraft({ ...draft, modules: [...draft.modules, emptyModule()] })}>Add module</button>
          <div style={{ marginTop: 12 }}>
            <button type="submit" style={{ padding: "8px 16px" }}>Publish course</button>{" "}
            <button type="button" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}

      {previewFor && <PreviewForm course={previewFor} onDone={(m) => { setPreviewFor(null); setMsg(m); }} />}

      <h2>Your courses</h2>
      {!courses && !error && <p>Loading...</p>}
      {courses && courses.length === 0 && <p>You have no courses yet.</p>}
      {courses && courses.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={th}>Course</th><th style={th}>Lessons</th><th style={th}>Enrolments</th><th style={th}>Completed</th>
              <th style={th}>Avg progress</th><th style={th}>Rating</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {courses.map((c) => (
              <tr key={c.course_id}>
                <td style={td}><Link href={`/courses/${c.course_id}`}>{c.title}</Link><div style={{ color: "#888", fontSize: 12 }}>{c.category} · {c.level}</div></td>
                <td style={td}>{c.lessons}</td>
                <td style={td}>{c.enrolments}</td>
                <td style={td}>{c.completed}</td>
                <td style={td}>{c.avg_completion === null ? "-" : `${c.avg_completion}%`}</td>
                <td style={td}>{c.avg_rating === null ? "-" : c.avg_rating}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button onClick={() => setPreviewFor(c)}>Preview</button>{" "}
                  <button onClick={() => remove(c)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
