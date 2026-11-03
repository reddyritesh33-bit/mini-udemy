import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createSession } from "@/lib/auth";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : null;
  const password = body?.password;

  if (!email || typeof password !== "string") {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const { rows } = await pool.query(
    "SELECT user_id, full_name, role, password_hash FROM users WHERE email = $1",
    [email]
  );
  const user = rows[0];
  // Same message for unknown email and wrong password.
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  await createSession(user);
  return NextResponse.json({
    user: { user_id: user.user_id, full_name: user.full_name, role: user.role },
  });
}
