// Cloud Run 用の DATABASE_URL 組み立て (純粋関数 / ユニットテスト対象)。
// ローカル/テストは DATABASE_URL をそのまま使い、Cloud Run では
// SQL_CONN + SQL_DB + SQL_USER + DB_PASSWORD (Secret) から UNIX ソケット経路
// (?host=/cloudsql/<conn>) の URL を組み立てる。
export function buildDatabaseUrl(env: {
  DATABASE_URL?: string;
  SQL_CONN?: string;
  SQL_DB?: string;
  SQL_USER?: string;
  DB_PASSWORD?: string;
}): string | null {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  const { SQL_CONN, SQL_DB, SQL_USER, DB_PASSWORD } = env;
  if (!SQL_CONN || !SQL_DB || !SQL_USER || !DB_PASSWORD) return null;
  const user = encodeURIComponent(SQL_USER);
  const pass = encodeURIComponent(DB_PASSWORD);
  return `postgresql://${user}:${pass}@localhost/${SQL_DB}?host=/cloudsql/${SQL_CONN}`;
}
