import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isServerlessRuntime, neonPoolConfig } from "./pg-pool.ts";

const URL = "postgres://db.example/mail";

describe("neon pool", () => {
  it("keeps the default pool off serverless", () => {
    assert.equal(isServerlessRuntime({}), false);
    assert.equal(isServerlessRuntime({ VERCEL: "0" }), false);
    assert.deepEqual(neonPoolConfig(URL, {}), { connectionString: URL });
  });

  it("uses one connection and a short idle timeout on Vercel", () => {
    assert.equal(isServerlessRuntime({ VERCEL: "1" }), true);
    assert.deepEqual(neonPoolConfig(URL, { VERCEL: "1" }), {
      connectionString: URL,
      max: 1,
      idleTimeoutMillis: 5000,
    });
  });
});
