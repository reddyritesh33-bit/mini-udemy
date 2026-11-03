"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Catalogue() {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [category, setCategory] = useState("");
  const [data, setData] = useState({ courses: [], categories: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    if (level) params.set("level", level);
    if (category) params.set("category", category);
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/courses?${params}`)
        .then((r) => r.json())
        .then((d) => setData({ courses: d.courses ?? [], categories: d.categories ?? [] }))
        .catch(() => setData({ courses: [], categories: [] }))
        .finally(() => setLoading(false));
    }, 250); // small debounce while typing
    return () => clearTimeout(t);
  }, [q, level, category]);

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 900, margin: "24px auto", padding: "0 16px" }}>
      <h1>Courses</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input
          placeholder="Search courses (e.g. database)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: 8 }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: 8 }}>
          <option value="">All categories</option>
          {data.categories.map((c) => (
            <option key={c.category_id} value={c.category_id}>{c.name}</option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} style={{ padding: 8 }}>
          <option value="">All levels</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : data.courses.length === 0 ? (
        <p>No courses found.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
          {data.courses.map((c) => (
            <Link
              key={c.course_id}
              href={`/courses/${c.course_id}`}
              style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, textDecoration: "none", color: "#111" }}
            >
              <h3 style={{ margin: "0 0 8px" }}>{c.title}</h3>
              <p style={{ margin: "0 0 8px", fontSize: 14, color: "#444" }}>{c.description}</p>
              <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
                {c.category} · {c.level} · {c.instructor} · Rs. {c.price}
              </p>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
