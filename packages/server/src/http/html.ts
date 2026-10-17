export function esc(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function csrfField(csrf: string): string {
  return `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
}

export function layout(options: {
  title: string;
  theme: string | null;
  active: "apps" | "audit";
  body: string;
  next: string;
  csrf: string;
}): string {
  const themeAttr = options.theme === "light" || options.theme === "dark" ? ` data-theme="${options.theme}"` : "";
  return `<!DOCTYPE html>
<html lang="en"${themeAttr}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(options.title)} · Keylink</title>
  <link rel="stylesheet" href="/fonts.css">
  <link rel="stylesheet" href="/admin/assets/admin.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body>
  <a class="skip" href="#content">Skip to content</a>
  <header class="mast">
    <a class="brand" href="/admin">
      <span class="stamp" aria-hidden="true">KL</span>
      <span>
        <span class="brand-name">Keylink</span>
        <span class="brand-sub">Console</span>
      </span>
    </a>
    <p class="mast-note">Self-hosted second factor</p>
    <form class="theme" method="post" action="/admin/theme">
      <input type="hidden" name="next" value="${esc(options.next)}">
      <button type="submit" name="theme" value="light" aria-pressed="${options.theme === "light" ? "true" : "false"}">Light</button>
      <button type="submit" name="theme" value="dark" aria-pressed="${options.theme === "dark" ? "true" : "false"}">Dark</button>
    </form>
    <form method="post" action="/admin/logout">
      ${csrfField(options.csrf)}
      <button type="submit">Sign out</button>
    </form>
  </header>
  <div class="shell">
    <nav class="side" aria-label="Console">
      <p class="side-label">Registry</p>
      <a class="${options.active === "apps" ? "is-active" : ""}" href="/admin" ${options.active === "apps" ? 'aria-current="page"' : ""}>Applications</a>
      <a class="${options.active === "audit" ? "is-active" : ""}" href="/admin/audit" ${options.active === "audit" ? 'aria-current="page"' : ""}>Audit</a>
    </nav>
    <main id="content">${options.body}</main>
  </div>
  <script src="/admin/assets/admin.js" defer></script>
</body>
</html>`;
}

export function loginPage(options: { theme: string | null; error?: string }): string {
  const themeAttr = options.theme === "light" || options.theme === "dark" ? ` data-theme="${options.theme}"` : "";
  return `<!DOCTYPE html>
<html lang="en"${themeAttr}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Sign in · Keylink</title>
  <link rel="stylesheet" href="/fonts.css">
  <link rel="stylesheet" href="/admin/assets/admin.css">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
</head>
<body class="login-body">
  <header class="mast">
    <a class="brand" href="/admin/login">
      <span class="stamp" aria-hidden="true">KL</span>
      <span>
        <span class="brand-name">Keylink</span>
        <span class="brand-sub">Console</span>
      </span>
    </a>
    <p class="mast-note">Self-hosted second factor</p>
    <form class="theme" method="post" action="/admin/theme">
      <input type="hidden" name="next" value="/admin/login">
      <button type="submit" name="theme" value="light" aria-pressed="${options.theme === "light" ? "true" : "false"}">Light</button>
      <button type="submit" name="theme" value="dark" aria-pressed="${options.theme === "dark" ? "true" : "false"}">Dark</button>
    </form>
  </header>
  <main class="login">
    <section class="login-copy">
      <p class="kicker">Operator access</p>
      <h1>Sign in to the console.</h1>
      <p>Applications, API keys, and user factors live here. The passwords for your product stay in your product — Keylink only keeps the second factor.</p>
      <ol class="steps">
        <li><span>01</span> Create an application and an allowed origin.</li>
        <li><span>02</span> Issue an API key and store it on your server.</li>
        <li><span>03</span> Enroll users from your backend, then verify codes.</li>
      </ol>
    </section>
    <section class="login-panel">
      <h2>Console password</h2>
      ${options.error ? `<p class="alert" role="alert">${esc(options.error)}</p>` : ""}
      <form method="post" action="/admin/login">
        <label for="password">Password</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
        <button class="primary" type="submit">Enter console</button>
      </form>
      <p class="fine">Set with <code>KEYLINK_ADMIN_PASSWORD</code>. This screen is for operators, not end users.</p>
    </section>
  </main>
</body>
</html>`;
}
