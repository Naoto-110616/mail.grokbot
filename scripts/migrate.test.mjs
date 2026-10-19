import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationDatabaseUrl } from "./migrate.mjs";

const UNPOOLED = "postgres://direct.example/mail";
const POOLED = "postgres://pooled.example/mail";

test("migrations prefer DATABASE_URL_UNPOOLED", () => {
  assert.equal(migrationDatabaseUrl({}), undefined);
  assert.equal(migrationDatabaseUrl({ DATABASE_URL: "  ", DATABASE_URL_UNPOOLED: " " }), undefined);
  assert.equal(migrationDatabaseUrl({ DATABASE_URL: POOLED }), POOLED);
  assert.equal(migrationDatabaseUrl({ DATABASE_URL_UNPOOLED: UNPOOLED }), UNPOOLED);
  assert.equal(
    migrationDatabaseUrl({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: UNPOOLED }),
    UNPOOLED,
  );
  assert.equal(
    migrationDatabaseUrl({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: "  " }),
    POOLED,
  );
});
