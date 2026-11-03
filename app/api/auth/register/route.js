import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { createSession } from "@/lib/auth";
import { cleanText } from "@/lib/validate";

export async function POST(request) {
  const body = await request.json().catch(() => null);
  const fullName = cleanText(body?.full_name, 100);
  const email = cleanText(body?.email, 255)?.toLowerCase();
  const password = body?.password;

  if (!fullName || !email || typeof password !== "string" || password.length < 8 || password.length > 72) {
    return NextResponse.json(
      { error: "Name (up to 100 characters), email and a password of 8 to 72 characters are required" },
      { status: 400 }
    );
  }

  const hash = await bcrypt.hash(password, 10);

  try {
    // Role is NOT taken from the request: everyone registers as a student.
    // Admins promote users to instructor/admin from the admin page.
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, $2, $3, 'student')
       RETURNING user_id, full_name, role`,
      [fullName, email, hash]
    );
    await createSession(rows[0]);
    return NextResponse.json({ user: rows[0] }, { status: 201 });
  } catch (err) {
    if (err.code === "23505") {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
    if (err.code === "23514") {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }
    console.error(err);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
