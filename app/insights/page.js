"use client";

import { useEffect, useState } from "react";
import Bars from "../Bars";
import Table from "../Table";

export default function Insights() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/insights")
      .then(async (r) => {
        if (r.status === 401) return (window.location.href = "/login");
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load insights");
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 1000, margin: "24px auto", padding: "0 16px" }}>
      <h1>Learner Insights</h1>
      <p style={{ color: "#666" }}>
        Each insight combines PostgreSQL (what students completed) with MongoDB (what students did).
      </p>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!data && !error && <p>Loading...</p>}
      {data && (
        <>
          <h2>1. Stalled lessons</h2>
          <p style={{ fontSize: 14 }}>Lessons students opened but did not finish. A large gap points to a lesson worth reviewing.</p>
          <Bars rows={data.stalled.map((s) => ({ ...s, name: `${s.course}: ${s.lesson}` }))} label="name" value="not_finished" />
          <Table rows={data.stalled} />

          <h2>2. Preview-to-enrolment conversion</h2>
          <p style={{ fontSize: 14 }}>
            Preview sessions per course, and how many logged-in viewers enrolled. Guests who register later are not linked, so this is a lower estimate.
          </p>
          <Bars rows={data.conversion} label="course" value="conversion_pct" suffix="%" />
          <Table rows={data.conversion} />

          <h2>3. At-risk learners</h2>
          <p style={{ fontSize: 14 }}>
            Active students below 100% with no learning activity for {data.at_risk_days} days or more.
          </p>
          <Table rows={data.at_risk} />
        </>
      )}
    </main>
  );
}
