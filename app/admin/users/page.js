"use client";

import { useEffect, useState } from "react";

const th = { textAlign: "left", borderBottom: "2px solid #ddd", padding: 6 };
const td = { borderBottom: "1px solid #eee", padding: 6 };

export default function Users() {
  const [users, setUsers] = useState(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function load(term = q) {
    fetch(`/api/admin/users${term ? `?q=${encodeURIComponent(term)}` : ""}`)
      .then(async (r) => {
        if (r.status === 401) return (window.location.href = "/login");
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not load users");
        setUsers(d.users);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => { load(""); }, []);

  async function changeRole(u, role) {
    setMsg("");
    const res = await fetch(`/api/admin/users/${u.user_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const d = await res.json();
    setMsg(res.ok ? `${u.full_name} is now ${role}.` : d.error || "Could not change role");
    load();
  }

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 1000, margin: "24px auto", padding: "0 16px" }}>
      <h1>Users</h1>
      <form onSubmit={(e) => { e.preventDefault(); load(); }} style={{ marginBottom: 12 }}>
        <input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: 6, width: 260 }} />{" "}
        <button type="submit">Search</button>
      </form>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {msg && <p>{msg}</p>}
      {users && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr><th style={th}>Name</th><th style={th}>Email</th><th style={th}>Joined</th><th style={th}>Teaches</th><th style={th}>Enrolled in</th><th style={th}>Role</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id}>
                <td style={td}>{u.full_name}</td>
                <td style={td}>{u.email}</td>
                <td style={td}>{u.joined}</td>
                <td style={td}>{u.teaches}</td>
                <td style={td}>{u.enrolled_in}</td>
                <td style={td}>
                  <select value={u.role} onChange={(e) => changeRole(u, e.target.value)} aria-label={`Role for ${u.email}`}>
                    <option value="student">student</option>
                    <option value="instructor">instructor</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
