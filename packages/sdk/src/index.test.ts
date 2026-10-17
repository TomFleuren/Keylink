import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";
import { Keylink, KeylinkError } from "./index.js";

async function listen(handler: (url: URL, body: string) => { status: number; json: unknown }): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => {
      const result = handler(new URL(req.url ?? "/", "http://127.0.0.1"), Buffer.concat(chunks).toString("utf8"));
      res.writeHead(result.status, { "content-type": "application/json" });
      res.end(JSON.stringify(result.json));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

test("sdk sends the API key and parses a user", async () => {
  let seen = "";
  const { server, url } = await listen((parsed, body) => {
    seen = parsed.pathname;
    assert.equal(body.includes("Ada"), true);
    return {
      status: 200,
      json: {
        id: "user_1",
        externalId: "ada",
        displayName: "Ada",
        enrolled: false,
        lockedUntil: null,
        failedAttempts: 0,
        factors: [],
        backupCodesRemaining: 0,
      },
    };
  });
  try {
    const client = new Keylink({ baseUrl: url + "/", apiKey: "kl_live_test" });
    const user = await client.upsertUser("ada", { displayName: "Ada" });
    assert.equal(seen, "/v1/users/ada");
    assert.equal(user.enrolled, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("sdk raises KeylinkError on a rejected code", async () => {
  const { server, url } = await listen(() => ({
    status: 401,
    json: { error: { code: "invalid_code", message: "That code was not accepted." } },
  }));
  try {
    const client = new Keylink({ baseUrl: url, apiKey: "kl_live_test" });
    await assert.rejects(() => client.verifyCode("ada", "000000"), (error: unknown) => {
      assert.ok(error instanceof KeylinkError);
      assert.equal(error.code, "invalid_code");
      assert.equal(error.status, 401);
      return true;
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
