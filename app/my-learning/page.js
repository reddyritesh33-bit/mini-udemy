"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function MyLearning() {
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/me/learning")
      .then(async (r) => {
        if (r.status === 401) {
          window.location.href = "/login";
          return;
        }
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load your courses");
        setCourses(d.courses);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 700, margin: "24px auto", padding: "0 16px" }}>
      <h1>My Learning</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!courses && !error && <p>Loading...</p>}
      {courses && courses.length === 0 && (
        <p>You have not enrolled in any course yet. <Link href="/">Browse courses</Link></p>
      )}
      {courses?.map((c) => (
        <Link
          key={c.course_id}
          href={`/courses/${c.course_id}`}
          style={{
            display: "block",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 16,
            marginBottom: 12,
            textDecoration: "none",
            color: "#111",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <strong>{c.title}</strong>
            <span style={{ fontSize: 13, color: c.status === "completed" ? "green" : "#666" }}>
              {c.status === "completed" ? "Completed" : `${c.completion_pct}%`}
            </span>
          </div>
          <div style={{ background: "#eee", borderRadius: 4, height: 10, marginTop: 10 }}>
            <div
              style={{
                width: `${c.completion_pct}%`,
                height: "100%",
                borderRadius: 4,
                background: c.status === "completed" ? "#2e9e44" : "#3b82f6",
              }}
            />
          </div>
        </Link>
      ))}
    </main>
  );
}
