import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDemo } from "./app.js";

test("demo sign-in page does not embed an API key", async () => {
  const app = await buildDemo({
    keylinkUrl: "http://127.0.0.1:9",
    publicKeylinkUrl: "http://127.0.0.1:9",
    apiKey: "kl_live_should_not_leak",
    logLevel: "silent",
  });
  const response = await app.inject({ method: "GET", url: "/" });
  assert.equal(response.statusCode, 200);
  assert.match(response.body, /Fieldnote/);
  assert.match(response.body, /ada@fieldnote.test/);
  assert.equal(response.body.includes("kl_live_should_not_leak"), false);
  await app.close();
});
