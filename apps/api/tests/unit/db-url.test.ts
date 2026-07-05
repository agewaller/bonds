import { describe, it, expect } from "vitest";
import { buildDatabaseUrl } from "../../src/lib/db-url.js";

describe("buildDatabaseUrl (Cloud Run)", () => {
  it("DATABASE_URL があればそのまま", () => {
    expect(buildDatabaseUrl({ DATABASE_URL: "postgresql://x" })).toBe("postgresql://x");
  });
  it("SQL_CONN 一式から UNIX ソケット URL を組み立て、パスワードは URL エンコード", () => {
    expect(
      buildDatabaseUrl({
        SQL_CONN: "proj:asia-northeast1:bonds-db-prod",
        SQL_DB: "bonds",
        SQL_USER: "bonds",
        DB_PASSWORD: "p@ss/w:rd",
      }),
    ).toBe(
      "postgresql://bonds:p%40ss%2Fw%3Ard@localhost/bonds?host=/cloudsql/proj:asia-northeast1:bonds-db-prod",
    );
  });
  it("材料が足りなければ null (ローカルは DATABASE_URL 必須のまま)", () => {
    expect(buildDatabaseUrl({ SQL_CONN: "x", SQL_DB: "y", SQL_USER: "z" })).toBeNull();
    expect(buildDatabaseUrl({})).toBeNull();
  });
});
