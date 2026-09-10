import { DatabaseSync } from "node:sqlite";

// D1's prepared-statement subset, backed by real SQLite for development and tests.
export class SqliteD1 {
  constructor(filename = ":memory:") {
    this.sql = new DatabaseSync(filename);
    this.sql.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  }
  prepare(sql) {
    const make = (args) => ({
      bind: (...values) => make(values),
      first: () => Promise.resolve(this.sql.prepare(sql).get(...args) ?? null),
      all: () =>
        Promise.resolve({
          results: this.sql.prepare(sql).all(...args),
          success: true,
          meta: { changes: 0 },
        }),
      run: () => Promise.resolve().then(() => this.execute(sql, args)),
      _sql: sql,
      _args: args,
    });
    return make([]);
  }
  execute(sql, args) {
    const s = this.sql.prepare(sql), result = s.run(...args);
    return { success: true, results: [], meta: { changes: Number(result.changes) } };
  }
  batch(statements) {
    // No await between BEGIN and COMMIT: another async request cannot enter the transaction.
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s) => this.execute(s._sql, s._args));
      this.sql.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.sql.exec("ROLLBACK");
      return Promise.reject(error);
    }
  }
  close() {
    this.sql.close();
  }
}
