import { PGlite } from '@electric-sql/pglite';
import { constraintSuite } from '../helpers/constraints.js';

constraintSuite('PostgreSQL schema (PGlite engine)', async () => {
  const database = new PGlite();
  return {
    sql: {
      exec: (text) => database.exec(text),
      query: (text, values) =>
        database.query<Record<string, unknown>>(text, values),
    },
    close: () => database.close(),
  };
});
