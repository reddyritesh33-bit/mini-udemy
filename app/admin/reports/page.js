"use client";

import { useEffect, useState } from "react";
import Bars from "../../Bars";
import Table from "../../Table";

// One plain-language line per report, and which column (if any) to draw as bars.
const ABOUT = {
  R1: { text: "How far students have got in each course, on average.", chart: ["title", "avg_completion", "%"] },
  R2: { text: "How many students enrolled in each course, month by month." },
  R3: { text: "Which instructors teach the most students.", chart: ["full_name", "students", ""] },
  R4: { text: "The five lessons completed least often." },
  R5: { text: "Average rating for each subject that has at least 2 reviews.", chart: ["name", "avg_rating", " / 5"] },
  R6: { text: "Students whose progress in a course is above the average." },
  R7: { text: "Search course titles and descriptions by keyword, best match first." },
  W: { text: "Hours of lesson time per course, added up from activity events in MongoDB. Lessons stay open while a student watches, so this is time a lesson was open.", chart: ["course", "watch_hours", " h"] },
};

export default function Reports() {
  const [data, setData] = useState(null);
  const [watch, setWatch] = useState(null);
  const [titles, setTitles] = useState({});
  const [selected, setSelected] = useState("R1");
  const [q, setQ] = useState("database");
  const [showSql, setShowSql] = useState(false);
  const [error, setError] = useState("");

  function load(term) {
    fetch(`/api/admin/reports?q=${encodeURIComponent(term)}`)
      .then(async (r) => {
        if (r.status === 401) return (window.location.href = "/login");
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load reports");
        setData(d);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load(q);
    fetch("/api/admin/reports/watch-time")
      .then(async (r) => setWatch(r.ok ? (await r.json()).rows : { error: (await r.json()).error }))
      .catch(() => setWatch({ error: "Report unavailable" }));
    fetch("/api/courses")
      .then((r) => r.json())
      .then((d) => setTitles(Object.fromEntries((d.courses ?? []).map((c) => [c.course_id, c.title]))))
      .catch(() => {});
  }, []);

  const options = [
    ...(data?.reports ?? []).map((r) => ({ id: r.id, label: `${r.id}. ${r.title}` })),
    { id: "W", label: "Watch time per course (MongoDB)" },
  ];
  const report = data?.reports.find((r) => r.id === selected);
  const watchRows = Array.isArray(watch)
    ? watch.map((w) => ({ course: titles[w.course_id] ?? `Course ${w.course_id}`, watch_hours: w.watch_hours, unique_viewers: w.unique_viewers }))
    : [];
  const rows = selected === "W" ? watchRows : report?.rows ?? [];
  const about = ABOUT[selected];

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 800, margin: "24px auto", padding: "0 16px" }}>
      <h1>Admin Reports</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!data && !error && <p>Loading...</p>}
      {data && (
        <>
          <label>
            Report{" "}
            <select value={selected} onChange={(e) => { setSelected(e.target.value); setShowSql(false); }} style={{ padding: 6 }}>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>

          <p style={{ background: "#f6f8fa", padding: 12, borderRadius: 8, marginTop: 16 }}>
            {about.text}
            {report && <span style={{ color: "#666" }}> Shows: {report.shows}.</span>}
          </p>

          {selected === "R7" && (
            <form onSubmit={(e) => { e.preventDefault(); load(q); }} style={{ marginBottom: 12 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: 6 }} /> <button type="submit">Search</button>
            </form>
          )}

          {selected === "W" && watch?.error ? (
            <p style={{ color: "crimson" }}>{watch.error}</p>
          ) : (
            <>
              {about.chart && rows.length > 0 && <Bars rows={rows} label={about.chart[0]} value={about.chart[1]} suffix={about.chart[2]} />}
              <Table rows={rows} />
            </>
          )}

          {report && (
            <p style={{ fontSize: 13 }}>
              <a href="#" onClick={(e) => { e.preventDefault(); setShowSql(!showSql); }}>{showSql ? "Hide the SQL" : "Show the SQL"}</a>
            </p>
          )}
          {report && showSql && <pre style={{ background: "#f6f8fa", padding: 8, fontSize: 12, overflowX: "auto" }}>{report.sql}</pre>}
        </>
      )}
    </main>
  );
}
