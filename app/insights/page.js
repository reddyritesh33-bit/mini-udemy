"use client";

import { useEffect, useState } from "react";

const th = { textAlign: "left", borderBottom: "2px solid #ddd", padding: "6px 8px" };
const td = { borderBottom: "1px solid #eee", padding: "6px 8px" };
const flag = { color: "#b45309", fontWeight: 600 };

export default function Insights() {
  const [courseId, setCourseId] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    fetch(`/api/insights${courseId ? `?course_id=${courseId}` : ""}`)
      .then(async (r) => {
        if (r.status === 401) return (window.location.href = "/login");
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load insights");
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, [courseId]);

  const stalled = data?.lessons?.filter((l) => l.stalled) ?? [];
  const atRisk = data?.students?.filter((s) => s.at_risk) ?? [];

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 800, margin: "24px auto", padding: "0 16px" }}>
      <h1>Learner Insights</h1>
      <p style={{ color: "#666" }}>
        For one course at a time: what students completed (PostgreSQL) combined with what they did (MongoDB).
      </p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {data?.courses?.length === 0 && <p>You have no courses yet.</p>}
      {data?.course && (
        <>
          <label>
            Course{" "}
            <select value={data.course.course_id} onChange={(e) => setCourseId(e.target.value)} style={{ padding: 6 }}>
              {data.courses.map((c) => (
                <option key={c.course_id} value={c.course_id}>{c.title}</option>
              ))}
            </select>
          </label>

          <p style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, marginTop: 16 }}>
            <strong>{data.students.length}</strong> students enrolled ·{" "}
            <strong>{stalled.length}</strong> stalled {stalled.length === 1 ? "lesson" : "lessons"} ·{" "}
            <strong>{data.conversion.conversion_pct}%</strong> preview conversion ·{" "}
            <strong>{atRisk.length}</strong> at-risk {atRisk.length === 1 ? "student" : "students"}
          </p>

          <h2>1. Lessons</h2>
          <p style={{ fontSize: 14 }}>A lesson is <span style={flag}>stalled</span> when students opened it but did not finish it.</p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr><th style={th}>Lesson</th><th style={th}>Opened by</th><th style={th}>Completed by</th><th style={th}></th></tr></thead>
            <tbody>
              {data.lessons.map((l) => (
                <tr key={l.lesson}>
                  <td style={td}>{l.lesson}</td><td style={td}>{l.opened_by}</td><td style={td}>{l.completed_by}</td>
                  <td style={td}>{l.stalled && <span style={flag}>stalled</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>2. Preview conversion</h2>
          <p style={{ fontSize: 14 }}>
            The preview was watched in <strong>{data.conversion.preview_sessions}</strong> sessions, and{" "}
            <strong>{data.conversion.enrolled_viewers}</strong> of those viewers enrolled
            ({data.conversion.conversion_pct}%). Guests who register later are not linked, so this is a lower estimate.
          </p>

          <h2>3. Students</h2>
          <p style={{ fontSize: 14 }}>
            A student is <span style={flag}>at risk</span> when they are below 100% and have had no learning activity
            for {data.at_risk_days} days or more.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead><tr><th style={th}>Student</th><th style={th}>Progress</th><th style={th}>Last activity</th><th style={th}></th></tr></thead>
            <tbody>
              {data.students.map((s) => (
                <tr key={s.student}>
                  <td style={td}>{s.student}</td>
                  <td style={td}>{s.status === "completed" ? "Completed" : `${s.progress_pct}%`}</td>
                  <td style={td}>{s.days_since_activity === null ? "none" : s.days_since_activity === 0 ? "today" : `${s.days_since_activity} days ago`}</td>
                  <td style={td}>{s.at_risk && <span style={flag}>at risk</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {!data && !error && <p>Loading...</p>}
    </main>
  );
}
