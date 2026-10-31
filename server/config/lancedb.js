import "dotenv/config";
import * as lancedb from "@lancedb/lancedb";
import path from "node:path";
import fs from "node:fs/promises";

const dbPath = path.resolve(process.cwd(), process.env.LANCEDB_PATH || "./data/lancedb");
let dbPromise;
export async function getLanceDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      await fs.mkdir(dbPath, { recursive: true });
      return lancedb.connect(dbPath);
    })();
  }
  return dbPromise;
}
export async function getLanceTable(name) {
  const db = await getLanceDB();
  const names = await db.tableNames();
  return names.includes(name) ? db.openTable(name) : null;
}
