import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Keylink, KeylinkError } from "@keylink/sdk";

const DEMO_USER = {
  email: "ada@fieldnote.test",
  password: "notebook",
  name: "Ada Lovelace",
};

const NOTES = [
  { date: "1843-08-12", title: "On the measurement of the tide at Margate", body: "The evening reading disagreed with the table by four minutes. I kept both." },
  { date: "1843-10-02", title: "Ciphers I do not trust", body: "Anything that can be guessed from a birthday, a street, or a favourite poet." },
  { date: "1851-01-19", title: "Spare key", body: "The spare key is not a password. Write down the recovery codes, not the secret." },
];

type Pending = { sessionId: string; token: string; purpose: "enroll" | "verify" };
type DemoSession = { externalId: string; name: string; stage: "mfa" | "in"; pending?: Pending };

export type DemoOptions = {
  keylinkUrl: string;
  publicKeylinkUrl: string;
  apiKey: string;
  logLevel?: string;
};

const here = path.dirname(fileURLToPath(import.meta.url));
const cssFile = path.resolve(here, "../public/fieldnote.css");

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function samePassword(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export async function buildDemo(options: DemoOptions): Promise<FastifyInstance> {
  const sessions = new Map<string, DemoSession>();
  const keylink = new Keylink({ baseUrl: options.keylinkUrl, apiKey: options.apiKey || "missing" });
  const app = Fastify({ logger: options.logLevel === "silent" ? false : { level: options.logLevel ?? "info" } });
  await app.register(formbody);

  const theme = (request: FastifyRequest) => {
    const value = parseCookies(request.headers.cookie).fn_theme;
    return value === "light" || value === "dark" ? value : null;
  };
  const current = (request: FastifyRequest) => {
    const id = parseCookies(request.headers.cookie).fn_session;
    if (!id) return null;
    return sessions.get(id) ?? null;
  };
  const body = (request: FastifyRequest) => (request.body ?? {}) as Record<string, string>;

  const page = (request: FastifyRequest, title: string, inner: string) => {
    const mode = theme(request);
    const attr = mode ? ` data-theme="${mode}"` : "";
    const publicBase = options.publicKeylinkUrl.replace(/\/$/, "");
    return `<!DOCTYPE html>
<html lang="en"${attr}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Fieldnote</title>
  <link rel="stylesheet" href="${esc(publicBase)}/fonts.css">
  <link rel="stylesheet" href="/fieldnote.css">
</head>
<body>
  <header class="top">
    <a class="mark" href="/">Fieldnote</a>
    <p class="deck">A private notebook.</p>
    <nav>
      <form method="post" action="/theme">
        <input type="hidden" name="next" value="${esc(request.url.split("?")[0] || "/")}">
        <button name="theme" value="light" type="submit">Light</button>
        <button name="theme" value="dark" type="submit">Dark</button>
      </form>
      ${current(request)?.stage === "in" ? `<a href="/security">Security</a><form method="post" action="/logout"><button type="submit">Sign out</button></form>` : ""}
    </nav>
  </header>
  <div class="wrap">${inner}</div>
  <script src="${esc(publicBase)}/widget.js" defer></script>
</body>
</html>`;
  };

  const send = (reply: FastifyReply, html: string) => reply.type("text/html; charset=utf-8").send(html);

  app.get("/fieldnote.css", async (_request, reply) => {
    return reply.type("text/css; charset=utf-8").send(createReadStream(cssFile));
  });

  app.post("/theme", async (request, reply) => {
    const value = body(request).theme === "dark" ? "dark" : "light";
    const next = body(request).next;
    const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    reply.header("set-cookie", `fn_theme=${value}; Path=/; Max-Age=31536000; SameSite=Lax`);
    return reply.redirect(dest);
  });

  app.get("/", async (request, reply) => {
    const session = current(request);
    if (!session || session.stage !== "in") {
      return send(
        reply,
        page(
          request,
          "Sign in",
          `<section>
            <h1>Open the book.</h1>
            <p class="fine">Fieldnote keeps the password. Keylink, running beside it, keeps the second factor.</p>
            <p class="fine">Try the desk copy: <strong>${esc(DEMO_USER.email)}</strong> / <strong>${esc(DEMO_USER.password)}</strong></p>
          </section>
          <section class="panel">
            <h2>Sign in</h2>
            <form method="post" action="/login">
              <label for="email">Email</label>
              <input id="email" name="email" type="email" autocomplete="username" required value="${esc(DEMO_USER.email)}">
              <label for="password">Password</label>
              <input id="password" name="password" type="password" autocomplete="current-password" required>
              <p><button class="solid" type="submit">Continue</button></p>
            </form>
          </section>`,
        ),
      );
    }
    const items = NOTES.map(
      (note) => `<li><time datetime="${esc(note.date)}">${esc(note.date)}</time><strong>${esc(note.title)}</strong><div>${esc(note.body)}</div></li>`,
    ).join("");
    return send(
      reply,
      page(
        request,
        "Notebook",
        `<section>
          <h1>Good afternoon, ${esc(session.name.split(" ")[0] ?? session.name)}.</h1>
          <p class="fine">Three notes from the bound volume. Nothing here is stored in Keylink.</p>
          <ul class="note-list">${items}</ul>
        </section>
        <section class="panel">
          <h2>Second factor</h2>
          <p class="fine">Enrollment and verification go through the Keylink widget. Your API key stays on this server.</p>
          <p><a href="/security">Authenticator settings</a></p>
        </section>`,
      ),
    );
  });

  app.post("/login", async (request, reply) => {
    const input = body(request);
    if (input.email !== DEMO_USER.email || !samePassword(input.password ?? "", DEMO_USER.password)) {
      return send(
        reply.code(401),
        page(request, "Sign in", `<section><h1>That did not match.</h1><p><a href="/">Try again</a></p></section><section></section>`),
      );
    }
    let record;
    try {
      record = await keylink.upsertUser(DEMO_USER.email, { displayName: DEMO_USER.name });
    } catch (error) {
      const message = error instanceof KeylinkError ? error.message : "Keylink is not reachable.";
      return send(reply.code(502), page(request, "Keylink", `<section><h1>Keylink is unavailable.</h1><p class="alert">${esc(message)}</p></section><section></section>`));
    }
    const id = randomBytes(18).toString("base64url");
    if (record.enrolled) {
      const pending = await keylink.createSession(DEMO_USER.email, { purpose: "verify" });
      sessions.set(id, { externalId: DEMO_USER.email, name: DEMO_USER.name, stage: "mfa", pending: { sessionId: pending.sessionId, token: pending.clientToken, purpose: "verify" } });
      reply.header("set-cookie", `fn_session=${id}; Path=/; HttpOnly; SameSite=Lax`);
      return reply.redirect("/challenge");
    }
    sessions.set(id, { externalId: DEMO_USER.email, name: DEMO_USER.name, stage: "in" });
    reply.header("set-cookie", `fn_session=${id}; Path=/; HttpOnly; SameSite=Lax`);
    return reply.redirect("/");
  });

  app.get("/challenge", async (request, reply) => {
    const session = current(request);
    if (!session?.pending || session.pending.purpose !== "verify") return reply.redirect("/");
    return send(
      reply,
      page(
        request,
        "Check",
        `<section>
          <h1>One more step.</h1>
          <p class="fine">The password was accepted. Fieldnote will not open the notebook until Keylink accepts a code and this server consumes the session.</p>
        </section>
        <section>
          <div id="keylink"></div>
          <form id="done" method="post" action="/challenge/complete" hidden></form>
          <script>
            document.addEventListener("DOMContentLoaded", function () {
              Keylink.mount("#keylink", {
                baseUrl: ${JSON.stringify(options.publicKeylinkUrl)},
                sessionToken: ${JSON.stringify(session.pending.token)},
                onSuccess: function () { document.getElementById("done").submit(); }
              });
            });
          </script>
        </section>`,
      ),
    );
  });

  app.post("/challenge/complete", async (request, reply) => {
    const id = parseCookies(request.headers.cookie).fn_session;
    const session = id ? sessions.get(id) : undefined;
    if (!session?.pending) return reply.redirect("/");
    try {
      const consumed = await keylink.consumeSession(session.pending.sessionId);
      if (consumed.status !== "succeeded" || consumed.purpose !== "verify") throw new KeylinkError(409, "not_verified", "Not verified.");
    } catch {
      return send(reply.code(400), page(request, "Check", `<section><h1>That check did not stick.</h1><p><a href="/">Start again</a></p></section><section></section>`));
    }
    session.stage = "in";
    delete session.pending;
    return reply.redirect("/");
  });

  app.get("/security", async (request, reply) => {
    const session = current(request);
    if (!session || session.stage !== "in") return reply.redirect("/");
    const record = await keylink.getUser(session.externalId);
    if (record.enrolled) {
      return send(
        reply,
        page(
          request,
          "Security",
          `<section><h1>Authenticator is on.</h1><p class="fine">The next sign-in will ask for a code. Sign out to try the check.</p></section>
           <section class="panel"><form method="post" action="/logout"><button class="solid" type="submit">Sign out and try the check</button></form></section>`,
        ),
      );
    }
    const pending = await keylink.createSession(session.externalId, { purpose: "enroll", displayName: session.name });
    session.pending = { sessionId: pending.sessionId, token: pending.clientToken, purpose: "enroll" };
    return send(
      reply,
      page(
        request,
        "Security",
        `<section>
          <h1>Add an authenticator.</h1>
          <p class="fine">This is the same widget a host site embeds. Fieldnote only receives a session id, then asks Keylink whether it succeeded.</p>
        </section>
        <section>
          <div id="keylink"></div>
          <form id="done" method="post" action="/security/complete" hidden></form>
          <script>
            document.addEventListener("DOMContentLoaded", function () {
              Keylink.mount("#keylink", {
                baseUrl: ${JSON.stringify(options.publicKeylinkUrl)},
                sessionToken: ${JSON.stringify(pending.clientToken)},
                onSuccess: function () { document.getElementById("done").submit(); }
              });
            });
          </script>
        </section>`,
      ),
    );
  });

  app.post("/security/complete", async (request, reply) => {
    const session = current(request);
    if (!session?.pending || session.pending.purpose !== "enroll") return reply.redirect("/security");
    try {
      await keylink.consumeSession(session.pending.sessionId);
    } catch {
      return reply.redirect("/security");
    }
    delete session.pending;
    return reply.redirect("/security");
  });

  app.post("/logout", async (request, reply) => {
    const id = parseCookies(request.headers.cookie).fn_session;
    if (id) sessions.delete(id);
    reply.header("set-cookie", "fn_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
    return reply.redirect("/");
  });

  return app;
}

export function loadDemoConfig(env: NodeJS.ProcessEnv = process.env): DemoOptions & { port: number; host: string } {
  return {
    port: Number(env.DEMO_PORT ?? 4781),
    host: env.DEMO_HOST ?? "0.0.0.0",
    keylinkUrl: env.KEYLINK_URL ?? "http://127.0.0.1:4780",
    publicKeylinkUrl: env.KEYLINK_PUBLIC_URL ?? env.KEYLINK_URL ?? "http://127.0.0.1:4780",
    apiKey: env.KEYLINK_API_KEY ?? "",
    logLevel: env.KEYLINK_LOG_LEVEL ?? "info",
  };
}

export const DEMO_CREDENTIALS = DEMO_USER;
