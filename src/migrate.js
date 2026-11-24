import { poolFor, migrate } from "./db.js";
const pool = poolFor(process.env.DATABASE_URL);
try {
  await migrate(pool);
} finally {
  await pool.end();
}
