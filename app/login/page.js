"use client";

import { useState } from "react";

export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ full_name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const input = { display: "block", width: "100%", padding: 8, marginBottom: 12, boxSizing: "border-box" };

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 360, margin: "48px auto", padding: "0 16px" }}>
      <h1>{mode === "login" ? "Log in" : "Register"}</h1>
      <form onSubmit={submit}>
        {mode === "register" && (
          <input style={input} placeholder="Full name" value={form.full_name} onChange={set("full_name")} required />
        )}
        <input style={input} type="email" placeholder="Email" value={form.email} onChange={set("email")} required />
        <input
          style={input}
          type="password"
          placeholder="Password (min 8 characters)"
          value={form.password}
          onChange={set("password")}
          required
        />
        {error && <p style={{ color: "crimson" }}>{error}</p>}
        <button type="submit" disabled={busy} style={{ padding: "8px 16px" }}>
          {mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        {mode === "login" ? "No account? " : "Already registered? "}
        <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === "login" ? "register" : "login"); setError(""); }}>
          {mode === "login" ? "Register" : "Log in"}
        </a>
      </p>
      <p style={{ fontSize: 13, color: "#666" }}>
        Demo accounts: student1@miniudemy.test, asha@miniudemy.test (instructor), admin@miniudemy.test. Password: Password123!
      </p>
    </main>
  );
}
