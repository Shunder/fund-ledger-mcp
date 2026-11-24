import { PGlite } from "@electric-sql/pglite";

// A private in-memory PostgreSQL engine for each stdio process. No sockets or credentials.
export async function demoDatabase() {
  const db = await PGlite.create({ parsers: { 1082: String, 1700: String } });
  function adapter(session) {
    return {
      async query(sql, params) {
        const result = params
          ? await session.query(sql, params)
          : (await session.exec(sql)).at(-1);
        return {
          rows: result.rows,
          rowCount: result.rows.length || result.affectedRows,
        };
      },
    };
  }
  const client = adapter(db);
  return {
    ...client,
    // refresh holds a session advisory lock outside its short write transactions.
    connect: async () => ({ ...client, release() {} }),
    transaction: (fn) => db.transaction((tx) => fn(adapter(tx))),
    end: () => db.close(),
  };
}
