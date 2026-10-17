import { csrfField, esc, formatTime, layout } from "../http/html.js";
import { parseStoredOrigins } from "../services/origins.js";
import type { AppRow, ApiKeyRow } from "../services/apps.js";
import type { UserRow } from "../services/users.js";

function page(options: { title: string; theme: string | null; active: "apps" | "audit"; next: string; body: string; csrf: string }): string {
  return layout(options);
}

export function appsPage(options: {
  theme: string | null;
  csrf: string;
  apps: { app: AppRow; users: number; keys: number }[];
  error?: string;
}): string {
  const rows = options.apps
    .map((entry, index) => {
      const origins = parseStoredOrigins(entry.app.allowed_origins);
      return `<tr>
        <td class="num">${String(index + 1).padStart(2, "0")}</td>
        <td><a href="/admin/apps/${esc(entry.app.id)}">${esc(entry.app.name)}</a><div class="meta">${esc(entry.app.slug)}</div></td>
        <td>${origins.length ? origins.map((origin) => `<div class="mono">${esc(origin)}</div>`).join("") : '<span class="meta">None</span>'}</td>
        <td class="num">${entry.users}</td>
        <td class="num">${entry.keys}</td>
        <td class="num">${esc(formatTime(entry.app.created_at))}</td>
      </tr>`;
    })
    .join("");
  const table = options.apps.length
    ? `<div class="table-wrap"><table>
        <thead><tr><th></th><th>Application</th><th>Origins</th><th>Users</th><th>Keys</th><th>Created</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`
    : `<p class="empty">No applications yet. Create one to issue an API key.</p>`;
  return page({
    title: "Applications",
    theme: options.theme,
    active: "apps",
    next: "/admin",
    csrf: options.csrf,
    body: `
      <div class="page-head">
        <div>
          <p class="kicker">Registry</p>
          <h1>Applications</h1>
          <p class="lede">Each application is a site or product that delegates its second factor to this Keylink server.</p>
        </div>
      </div>
      ${options.error ? `<p class="alert" role="alert">${esc(options.error)}</p>` : ""}
      <section class="panel">
        <h2>New application</h2>
        <form method="post" action="/admin/apps">
          ${csrfField(options.csrf)}
          <div class="grid-2">
            <div>
              <label for="name">Name</label>
              <input id="name" name="name" type="text" required maxlength="80" placeholder="Fieldnote" autocomplete="off">
            </div>
            <div>
              <label for="issuer">Issuer shown in authenticator apps</label>
              <input id="issuer" name="issuer" type="text" maxlength="80" placeholder="Defaults to the name">
            </div>
          </div>
          <label for="origins">Allowed browser origins</label>
          <textarea id="origins" name="origins" placeholder="https://example.com&#10;http://localhost:4781"></textarea>
          <p class="fine">One origin per line. The embeddable widget can only call Keylink from these origins. Server-side API calls are not limited by this list.</p>
          <p><button class="primary" type="submit">Create application</button></p>
        </form>
      </section>
      ${table}
    `,
  });
}

export function appDetailPage(options: {
  theme: string | null;
  csrf: string;
  app: AppRow;
  keys: ApiKeyRow[];
  users: { user: UserRow; factor: string; backup: number }[];
  issuedKey?: string;
  error?: string;
  notice?: string;
}): string {
  const origins = parseStoredOrigins(options.app.allowed_origins).join("\n");
  const keyRows = options.keys
    .map((key) => {
      const state = key.revoked_at ? `<span class="pill off">Revoked</span>` : `<span class="pill ok">Active</span>`;
      const revoke = key.revoked_at
        ? ""
        : `<form method="post" action="/admin/apps/${esc(options.app.id)}/keys/${esc(key.id)}/revoke">
            ${csrfField(options.csrf)}
            <button type="submit">Revoke</button>
           </form>`;
      return `<tr>
        <td>${esc(key.name)}<div class="meta mono">${esc(key.prefix)}…</div></td>
        <td>${state}</td>
        <td class="num">${esc(formatTime(key.created_at))}</td>
        <td class="num">${esc(formatTime(key.last_used_at))}</td>
        <td>${revoke}</td>
      </tr>`;
    })
    .join("");
  const userRows = options.users
    .map((entry) => {
      const locked = entry.user.locked_until && entry.user.locked_until > Date.now();
      return `<tr>
        <td class="mono">${esc(entry.user.external_id)}<div class="meta">${esc(entry.user.display_name ?? "")}</div></td>
        <td>${entry.factor === "active" ? '<span class="pill ok">TOTP</span>' : entry.factor === "pending" ? '<span class="pill warn">Pending</span>' : '<span class="pill off">None</span>'}</td>
        <td class="num">${entry.backup}</td>
        <td>${locked ? `<span class="pill warn">Locked</span>` : `<span class="meta">Open</span>`}</td>
        <td class="row-actions">
          ${locked ? `<form method="post" action="/admin/users/${esc(entry.user.id)}/unlock">${csrfField(options.csrf)}<button type="submit">Unlock</button></form>` : ""}
          <form method="post" action="/admin/users/${esc(entry.user.id)}/delete">
            ${csrfField(options.csrf)}
            <button class="danger" type="submit">Remove</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");
  const banner = options.issuedKey
    ? `<div class="banner" role="status">
        <strong>Copy this API key now. It will not be shown again.</strong>
        <div class="keybox">
          <code id="issued-key">${esc(options.issuedKey)}</code>
          <button type="button" data-copy="#issued-key">Copy</button>
        </div>
        <p class="fine">Send it as <span class="mono">Authorization: Bearer …</span> from your backend. Do not put it in the browser.</p>
      </div>`
    : "";
  return page({
    title: options.app.name,
    theme: options.theme,
    active: "apps",
    next: `/admin/apps/${options.app.id}`,
    csrf: options.csrf,
    body: `
      <div class="page-head">
        <div>
          <p class="kicker"><a href="/admin">Applications</a> / ${esc(options.app.slug)}</p>
          <h1>${esc(options.app.name)}</h1>
          <p class="lede">Issuer in authenticator apps: <strong>${esc(options.app.issuer)}</strong>. Created ${esc(formatTime(options.app.created_at))}.</p>
        </div>
      </div>
      ${options.error ? `<p class="alert" role="alert">${esc(options.error)}</p>` : ""}
      ${options.notice ? `<p class="banner" role="status">${esc(options.notice)}</p>` : ""}
      ${banner}
      <div class="grid-2">
        <section class="panel">
          <h2>Settings</h2>
          <form method="post" action="/admin/apps/${esc(options.app.id)}">
            ${csrfField(options.csrf)}
            <label for="name">Name</label>
            <input id="name" name="name" type="text" required maxlength="80" value="${esc(options.app.name)}">
            <label for="issuer">Issuer</label>
            <input id="issuer" name="issuer" type="text" required maxlength="80" value="${esc(options.app.issuer)}">
            <label for="origins">Allowed browser origins</label>
            <textarea id="origins" name="origins">${esc(origins)}</textarea>
            <p><button class="primary" type="submit">Save settings</button></p>
          </form>
        </section>
        <section class="panel">
          <h2>API keys</h2>
          <p class="fine">Keys are stored as a SHA-256 hash. Revoking a key takes effect immediately.</p>
          <form class="form-inline" method="post" action="/admin/apps/${esc(options.app.id)}/keys">
            ${csrfField(options.csrf)}
            <div>
              <label for="keyName">Key name</label>
              <input id="keyName" name="name" type="text" maxlength="80" placeholder="Production">
            </div>
            <button class="primary" type="submit">Issue key</button>
          </form>
          ${
            options.keys.length
              ? `<div class="table-wrap" style="margin-top:14px"><table>
                  <thead><tr><th>Key</th><th>State</th><th>Created</th><th>Last used</th><th></th></tr></thead>
                  <tbody>${keyRows}</tbody>
                </table></div>`
              : `<p class="empty" style="margin-top:14px">No keys yet.</p>`
          }
        </section>
      </div>
      <section>
        <h2>Users</h2>
        <p class="lede">Users are created by your backend the first time it enrolls or checks them. Keylink does not store their password.</p>
        ${
          options.users.length
            ? `<div class="table-wrap"><table>
                <thead><tr><th>External id</th><th>Factor</th><th>Backup codes</th><th>Lock</th><th></th></tr></thead>
                <tbody>${userRows}</tbody>
              </table></div>`
            : `<p class="empty">No users for this application yet.</p>`
        }
      </section>
      <section class="panel" style="margin-top:24px">
        <h2>Delete application</h2>
        <p class="fine">Removes API keys, users, authenticators, and backup codes for this application.</p>
        <form method="post" action="/admin/apps/${esc(options.app.id)}/delete">
          ${csrfField(options.csrf)}
          <label class="check"><input type="checkbox" name="confirm" value="yes" required> I understand this cannot be undone.</label>
          <button class="danger" type="submit">Delete application</button>
        </form>
      </section>
    `,
  });
}

export function auditPage(options: {
  theme: string | null;
  csrf: string;
  events: { created_at: number; action: string; app_name: string | null; detail: string | null; ip: string | null }[];
}): string {
  const rows = options.events
    .map(
      (event) => `<tr>
        <td class="num">${esc(formatTime(event.created_at))}</td>
        <td class="mono">${esc(event.action)}</td>
        <td>${esc(event.app_name ?? "—")}</td>
        <td>${esc(event.detail ?? "")}</td>
        <td class="mono">${esc(event.ip ?? "")}</td>
      </tr>`,
    )
    .join("");
  return page({
    title: "Audit",
    theme: options.theme,
    active: "audit",
    next: "/admin/audit",
    csrf: options.csrf,
    body: `
      <div class="page-head">
        <div>
          <p class="kicker">Registry</p>
          <h1>Audit</h1>
          <p class="lede">Enrollments, verifications, lockouts, and key changes. Codes and secrets are never written here.</p>
        </div>
      </div>
      ${
        options.events.length
          ? `<div class="table-wrap"><table>
              <thead><tr><th>When</th><th>Action</th><th>Application</th><th>Detail</th><th>IP</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
          : `<p class="empty">No events yet.</p>`
      }
    `,
  });
}

export function placard(version: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Keylink</title>
  <link rel="stylesheet" href="/fonts.css">
  <link rel="stylesheet" href="/admin/assets/admin.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
  <header class="mast">
    <a class="brand" href="/admin">
      <span class="stamp">KL</span>
      <span><span class="brand-name">Keylink</span><span class="brand-sub">Service</span></span>
    </a>
  </header>
  <main>
    <p class="kicker">Running</p>
    <h1>Keylink ${esc(version)}</h1>
    <p class="lede">This process verifies authenticator codes for the applications you register. Operators use the console. Your servers use the API. Browsers load the widget.</p>
    <div class="table-wrap" style="max-width: 640px">
      <table>
        <tbody>
          <tr><th>Console</th><td><a href="/admin">/admin</a></td></tr>
          <tr><th>Health</th><td><a href="/health">/health</a></td></tr>
          <tr><th>Widget</th><td class="mono">/widget.js</td></tr>
          <tr><th>API</th><td class="mono">/v1</td></tr>
        </tbody>
      </table>
    </div>
  </main>
</body>
</html>`;
}
