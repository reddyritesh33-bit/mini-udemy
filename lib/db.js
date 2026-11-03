import { Pool } from "pg";

// Reuse one pool across hot reloads in dev so connections are shared, not leaked.
const globalForPg = globalThis;

export const pool =
  globalForPg.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10, // connection pool: many requests share 10 connections
  });

if (process.env.NODE_ENV !== "production") globalForPg.__pgPool = pool;
