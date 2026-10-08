import { createApp } from './app.js';
import {
  loadLocalEnvironment,
  parseEnvironment,
} from './config/environment.js';
import { createDatabase } from '@screenstash/db';
import { createObjectStore } from './storage/r2.js';

loadLocalEnvironment();
const environment = parseEnvironment(process.env);
const database = environment.DATABASE_URL
  ? createDatabase(environment.DATABASE_URL)
  : undefined;
const store = createObjectStore(environment);
const app = createApp(environment, {
  ...(store ? { store } : {}),
  ...(database ? { database: database.db } : {}),
  ...(database
    ? {
        ready: async () => {
          await database.pool.query('SELECT 1');
          return true;
        },
      }
    : {}),
});
export default app;
