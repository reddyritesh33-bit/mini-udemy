import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

const COOKIE_NAME = "token";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function secretKey() {
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

// Stateless session: any number of users can be logged in at once.
export async function createSession(user) {
  const token = await new SignJWT({ role: user.role, name: user.full_name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.user_id))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());

  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

// Returns { userId, role, name } or null. Never throws for a bad/missing token.
// The token proves who the user is; the role is read fresh from PostgreSQL on every request,
// so a role change by an admin applies at once and a deleted user is logged out.
export async function getSession() {
  let userId;
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, secretKey());
    userId = Number(payload.sub);
  } catch {
    return null;
  }
  const { rows } = await pool.query("SELECT full_name, role FROM users WHERE user_id = $1", [userId]);
  if (!rows[0]) return null;
  return { userId, role: rows[0].role, name: rows[0].full_name };
}

// Usage in a Route Handler:
//   const { session, error } = await requireRole(["student"]);
//   if (error) return error;
export async function requireRole(roles) {
  const session = await getSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Not logged in" }, { status: 401 }) };
  }
  if (!roles.includes(session.role)) {
    return { error: NextResponse.json({ error: "Forbidden for your role" }, { status: 403 }) };
  }
  return { session };
}
