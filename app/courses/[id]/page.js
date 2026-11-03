"use client";

import { useParams } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";

// Turn a YouTube watch/short link into an embeddable URL, optionally starting at a given second.
// Returns null for other hosts.
function toEmbedUrl(url, start = 0) {
  try {
    const u = new URL(url);
    let id = null;
    if (u.hostname.endsWith("youtube.com")) id = u.searchParams.get("v");
    else if (u.hostname === "youtu.be") id = u.pathname.slice(1);
    const from = start > 0 ? `&start=${Math.floor(start)}` : "";
    return id ? `https://www.youtube.com/embed/${encodeURIComponent(id)}?autoplay=1${from}` : null;
  } catch {
    return null;
  }
}

// One id per browser tab, used to group events from the same session.
function getSessionId() {
  try {
    let id = sessionStorage.getItem("mu_session");
    if (!id) {
      id = crypto.randomUUID().slice(0, 8);
      sessionStorage.setItem("mu_session", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

export default function CoursePage() {
  const { id } = useParams();
  const courseId = Number(id);

  const [detail, setDetail] = useState(null);
  const [preview, setPreview] = useState(undefined); // undefined = loading, null = none
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [msg, setMsg] = useState("");
  const [enrollment, setEnrollment] = useState(null);
  const [completed, setCompleted] = useState([]);
  const [progress, setProgress] = useState(0);
  const [opened, setOpened] = useState(null); // lesson id currently open
  const openedAt = useRef(0); // when it was opened, to measure watch time
  const [lessonVideo, setLessonVideo] = useState(null); // { lessonId, embed } or { lessonId, note }
  const [reviews, setReviews] = useState({ reviews: [], average: null, count: 0 });
  const [form, setForm] = useState({ rating: 5, comment: "" });
  const [editing, setEditing] = useState(false);
  const [reviewMsg, setReviewMsg] = useState("");

  function loadReviews() {
    fetch(`/api/courses/${courseId}/reviews`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setReviews(d))
      .catch(() => {});
  }

  useEffect(() => {
    fetch(`/api/courses/${courseId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load course");
        setDetail(d);
        setEnrollment(d.enrollment);
        setCompleted(d.completed ?? []);
        setProgress(d.progress_pct ?? 0);
      })
      .catch((e) => setError(e.message));

    fetch(`/api/courses/${courseId}/preview`)
      .then((r) => (r.ok ? r.json() : { preview: null }))
      .then((d) => setPreview(d.preview ?? null))
      .catch(() => setPreview(null));

    loadReviews();
  }, [courseId]);

  function sendEvent(body) {
    // Fire and forget: a lost event must never block the user.
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course_id: courseId, session_id: getSessionId(), ...body }),
    }).catch(() => {});
  }

  function playPreview() {
    setPlaying(true);
    sendEvent({ event_type: "preview_play" });
  }

  // Sends pause or ended with the time since Open. This is what the watch-time report adds up.
  function closeLesson(eventType) {
    sendEvent({
      event_type: eventType,
      lesson_id: opened,
      watch_seconds: Math.round((Date.now() - openedAt.current) / 1000),
    });
    setOpened(null);
    setLessonVideo(null);
  }

  function openLesson(lessonId) {
    if (opened) closeLesson("pause");
    openedAt.current = Date.now();
    setOpened(lessonId);
    setLessonVideo({ lessonId, note: "Loading video..." });
    sendEvent({ event_type: "lesson_open", lesson_id: lessonId });

    // The video link lives in MongoDB; the lesson still works if it is missing.
    fetch(`/api/lessons/${lessonId}/video`)
      .then((r) => r.json())
      .then((d) => {
        const embed = d.video ? toEmbedUrl(d.video.video_url, d.video.start_seconds) : null;
        setLessonVideo((cur) =>
          cur?.lessonId !== lessonId ? cur : embed ? { lessonId, embed } : { lessonId, note: "No video for this lesson yet." }
        );
      })
      .catch(() => setLessonVideo((cur) => (cur?.lessonId === lessonId ? { lessonId, note: "Video unavailable." } : cur)));
  }

  async function completeLesson(lessonId) {
    setMsg("");
    const res = await fetch(`/api/lessons/${lessonId}/complete`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Could not mark complete");
      return;
    }
    if (opened === lessonId) closeLesson("ended");
    setCompleted((prev) => (prev.includes(lessonId) ? prev : [...prev, lessonId]));
    if (data.progress_pct !== undefined) setProgress(data.progress_pct);
    if (data.status) setEnrollment(data.status);
    if (data.status === "completed") setMsg("Course completed. Well done!");
  }

  async function enroll() {
    setMsg("");
    const res = await fetch(`/api/courses/${courseId}/enroll`, { method: "POST" });
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Enrolment failed");
      return;
    }
    setEnrollment("active");
    setMsg("You are enrolled.");
  }

  async function saveReview(e) {
    e.preventDefault();
    setReviewMsg("");
    const res = await fetch(`/api/courses/${courseId}/reviews`, {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: Number(form.rating), comment: form.comment }),
    });
    const data = await res.json();
    if (!res.ok) {
      setReviewMsg(data.error || "Could not save review");
      return;
    }
    setEditing(false);
    setForm({ rating: 5, comment: "" });
    setReviewMsg(editing ? "Review updated." : "Thank you for your review.");
    loadReviews();
  }

  async function deleteReview() {
    if (!window.confirm("Delete your review?")) return;
    const res = await fetch(`/api/courses/${courseId}/reviews`, { method: "DELETE" });
    if (res.ok) {
      setReviewMsg("Review deleted.");
      setEditing(false);
      loadReviews();
    }
  }

  if (error) return <main style={{ fontFamily: "sans-serif", padding: 24 }}><p>{error}</p></main>;
  if (!detail) return <main style={{ fontFamily: "sans-serif", padding: 24 }}><p>Loading...</p></main>;

  const { course, modules } = detail;
  const embed = preview ? toEmbedUrl(preview.video_url) : null;
  const isEnrolled = enrollment === "active" || enrollment === "completed";
  const myReview = reviews.reviews.find((r) => r.mine);

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 800, margin: "24px auto", padding: "0 16px" }}>
      <h1 style={{ marginBottom: 4 }}>{course.title}</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        {course.category} · {course.level} · by {course.instructor} · Rs. {course.price}
      </p>
      <p>{course.description}</p>

      <section style={{ margin: "24px 0" }}>
        <h2>Course preview</h2>
        {preview === undefined ? (
          <p>Loading preview...</p>
        ) : preview === null ? (
          <p style={{ color: "#666" }}>No preview video for this course yet.</p>
        ) : playing && embed ? (
          <iframe
            width="100%"
            height="420"
            src={embed}
            title={`${course.title} preview`}
            allow="autoplay; encrypted-media"
            allowFullScreen
            style={{ border: 0, borderRadius: 8 }}
          />
        ) : playing ? (
          <p>
            <a href={preview.video_url} target="_blank" rel="noreferrer">Open preview video</a>
          </p>
        ) : (
          <button
            onClick={playPreview}
            style={{
              width: "100%",
              height: 240,
              borderRadius: 8,
              border: "1px solid #ddd",
              background: "#f4f4f4",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ▶ Watch preview{preview.duration_seconds ? ` (${preview.duration_seconds}s)` : ""}
          </button>
        )}
        {preview?.what_you_will_learn?.length > 0 && (
          <>
            <h3>What you will learn</h3>
            <ul>{preview.what_you_will_learn.map((w) => <li key={w}>{w}</li>)}</ul>
          </>
        )}
        {preview?.tags?.length > 0 && (
          <p style={{ fontSize: 13, color: "#666" }}>Tags: {preview.tags.join(", ")}</p>
        )}
      </section>

      <section style={{ margin: "24px 0" }}>
        {isEnrolled ? (
          <>
            <p>
              <strong>{enrollment === "completed" ? "Completed" : "Enrolled"}</strong> · {progress}% done
            </p>
            <div style={{ background: "#eee", borderRadius: 4, height: 10 }}>
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: enrollment === "completed" ? "#2e9e44" : "#3b82f6",
                }}
              />
            </div>
          </>
        ) : (
          <button onClick={enroll} style={{ padding: "10px 20px", fontSize: 16 }}>Enroll</button>
        )}
        {msg && <p>{msg}</p>}
      </section>

      <section>
        <h2>Curriculum</h2>
        {modules.map((m) => (
          <div key={m.module_id} style={{ marginBottom: 12 }}>
            <strong>{m.title}</strong>
            <ul style={{ marginTop: 4, listStyle: "none", paddingLeft: 0 }}>
              {m.lessons.map((l) => {
                const done = completed.includes(l.lesson_id);
                const video = opened === l.lesson_id && lessonVideo?.lessonId === l.lesson_id ? lessonVideo : null;
                return (
                  <Fragment key={l.lesson_id}>
                  <li style={{ padding: "4px 0", display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ width: 18 }}>{done ? "✓" : "○"}</span>
                    <span style={{ flex: 1 }}>
                      {l.title} <span style={{ color: "#888" }}>({l.duration_minutes} min)</span>
                    </span>
                    {isEnrolled && (
                      <>
                        <button onClick={() => openLesson(l.lesson_id)} disabled={opened === l.lesson_id}>
                          {opened === l.lesson_id ? "Opened" : "Open"}
                        </button>
                        <button
                          onClick={() => completeLesson(l.lesson_id)}
                          disabled={done || opened !== l.lesson_id}
                          title={!done && opened !== l.lesson_id ? "Open the lesson first" : undefined}
                        >
                          {done ? "Done" : "Mark complete"}
                        </button>
                      </>
                    )}
                  </li>
                  {video && (
                    <li style={{ padding: "4px 0 12px 26px" }}>
                      {video.embed ? (
                        <iframe
                          width="100%"
                          height="400"
                          src={video.embed}
                          title={`${l.title} video`}
                          allow="autoplay; encrypted-media"
                          allowFullScreen
                          style={{ border: 0, borderRadius: 8 }}
                        />
                      ) : (
                        <p style={{ color: "#666", margin: 0 }}>{video.note}</p>
                      )}
                      <button onClick={() => closeLesson("pause")} style={{ marginTop: 6 }}>Close video</button>
                    </li>
                  )}
                  </Fragment>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <section style={{ margin: "24px 0" }}>
        <h2>
          Reviews{" "}
          <span style={{ fontSize: 16, color: "#666", fontWeight: 400 }}>
            {reviews.count > 0 ? `${reviews.average} / 5 from ${reviews.count}` : "none yet"}
          </span>
        </h2>
        {isEnrolled && (!myReview || editing) && (
          <form onSubmit={saveReview} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, marginBottom: 12 }}>
            <p style={{ margin: "0 0 8px", fontSize: 13, color: "#666" }}>
              Reviews need at least 50% of the course completed. The database checks this.
            </p>
            <label>
              Rating{" "}
              <select value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
                {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <textarea
              placeholder="What did you think of this course?"
              value={form.comment}
              onChange={(e) => setForm({ ...form, comment: e.target.value })}
              maxLength={2000}
              style={{ display: "block", width: "100%", minHeight: 60, margin: "8px 0", boxSizing: "border-box" }}
            />
            <button type="submit">{editing ? "Save changes" : "Post review"}</button>
            {editing && <button type="button" onClick={() => setEditing(false)} style={{ marginLeft: 8 }}>Cancel</button>}
          </form>
        )}
        {reviewMsg && <p>{reviewMsg}</p>}
        {reviews.reviews.map((r) => (
          <div key={r.review_id} style={{ borderBottom: "1px solid #eee", padding: "8px 0" }}>
            <strong>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</strong> {r.full_name}
            {r.comment && <p style={{ margin: "4px 0" }}>{r.comment}</p>}
            {r.mine && !editing && (
              <span style={{ fontSize: 13 }}>
                <button onClick={() => { setEditing(true); setForm({ rating: r.rating, comment: r.comment ?? "" }); }}>Edit</button>{" "}
                <button onClick={deleteReview}>Delete</button>
              </span>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
