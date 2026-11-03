"use client";

import { useEffect, useState } from "react";
import Bars from "../../Bars";
import Table from "../../Table";

// Which column to draw as a bar chart for each report (others are tables only).
const CHART = {
  R1: ["title", "avg_completion", "%"],
  R3: ["full_name", "students", ""],
  R5: ["name", "avg_rating", ""],
};

export default function Reports() {
  const [data, setData] = useState(null);
  const [watch, setWatch] = useState(null);
  const [titles, setTitles] = useState({});
  const [q, setQ] = useState("database");
  const [error, setError] = useState("");
  const [showSql, setShowSql] = useState({});

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

  const watchRows = Array.isArray(watch)
    ? watch.map((w) => ({ course: titles[w.course_id] ?? `Course ${w.course_id}`, watch_hours: w.watch_hours, unique_viewers: w.unique_viewers }))
    : [];

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 1000, margin: "24px auto", padding: "0 16px" }}>
      <h1>Admin Reports</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!data && !error && <p>Loading...</p>}
      {data?.reports.map((r) => (
        <section key={r.id} style={{ marginBottom: 28 }}>
          <h2 style={{ marginBottom: 2 }}>{r.id}. {r.title}</h2>
          <p style={{ margin: "0 0 8px", color: "#666", fontSize: 13 }}>
            PostgreSQL · {r.shows} ·{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); setShowSql({ ...showSql, [r.id]: !showSql[r.id] }); }}>
              {showSql[r.id] ? "hide SQL" : "show SQL"}
            </a>
          </p>
          {r.id === "R7" && (
            <form onSubmit={(e) => { e.preventDefault(); load(q); }} style={{ marginBottom: 8 }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: 6 }} /> <button type="submit">Search</button>
            </form>
          )}
          {showSql[r.id] && <pre style={{ background: "#f6f8fa", padding: 8, fontSize: 12, overflowX: "auto" }}>{r.sql}</pre>}
          {CHART[r.id] && r.rows.length > 0 && <Bars rows={r.rows} label={CHART[r.id][0]} value={CHART[r.id][1]} suffix={CHART[r.id][2]} />}
          <Table rows={r.rows} />
        </section>
      ))}

      <section>
        <h2 style={{ marginBottom: 2 }}>Watch time per course</h2>
        <p style={{ margin: "0 0 8px", color: "#666", fontSize: 13 }}>
          MongoDB aggregation pipeline over activity events. Lessons have no video yet, so this is time a lesson stayed open.
        </p>
        {watch?.error ? (
          <p style={{ color: "crimson" }}>{watch.error}</p>
        ) : (
          <>
            <Bars rows={watchRows} label="course" value="watch_hours" suffix=" h" />
            <Table rows={watchRows} />
          </>
        )}
      </section>
    </main>
  );
}
