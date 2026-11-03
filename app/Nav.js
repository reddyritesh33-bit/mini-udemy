"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Nav() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUser(d?.user ?? null))
      .catch(() => setUser(null));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  return (
    <nav
      style={{
        display: "flex",
        gap: 16,
        alignItems: "center",
        padding: "12px 24px",
        borderBottom: "1px solid #ddd",
        fontFamily: "sans-serif",
      }}
    >
      <Link href="/" style={{ fontWeight: 700, textDecoration: "none", color: "#111" }}>
        Mini-Udemy
      </Link>
      {user?.role === "student" && <Link href="/my-learning">My Learning</Link>}
      {user?.role === "instructor" && <Link href="/instructor">Dashboard</Link>}
      {(user?.role === "instructor" || user?.role === "admin") && <Link href="/insights">Insights</Link>}
      {user?.role === "admin" && <Link href="/admin/reports">Reports</Link>}
      {user?.role === "admin" && <Link href="/admin/users">Users</Link>}
      {user?.role === "admin" && <Link href="/instructor">All courses</Link>}
      <span style={{ flex: 1 }} />
      {user ? (
        <>
          <span style={{ fontSize: 14 }}>
            {user.name} ({user.role})
          </span>
          <button onClick={logout}>Log out</button>
        </>
      ) : (
        <Link href="/login">Log in / Register</Link>
      )}
    </nav>
  );
}
