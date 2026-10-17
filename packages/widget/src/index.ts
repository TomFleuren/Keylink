import { normalizeBackup, onlyDigits } from "./code.js";

export type KeylinkSuccess = {
  purpose: "enroll" | "verify";
  sessionId: string;
  factor: string;
};

export type KeylinkErrorDetail = {
  code: string;
  message: string;
  remainingAttempts?: number;
};

export type KeylinkWidgetOptions = {
  baseUrl: string;
  sessionToken: string;
  onSuccess?: (result: KeylinkSuccess) => void;
  onError?: (error: KeylinkErrorDetail) => void;
};

type SessionPayload = {
  sessionId: string;
  purpose: "enroll" | "verify";
  status: string;
  appName: string;
  issuer?: string;
  account: string;
  expiresAt: number;
  totp?: {
    secret: string;
    secretGrouped: string;
    otpauthUrl: string;
    qrSvg: string;
    digits: number;
    period: number;
  };
};

const CSS = `
:host {
  --kl-bg: var(--keylink-bg, #fbf9f4);
  --kl-fg: var(--keylink-fg, #1c1915);
  --kl-muted: var(--keylink-muted, #5e574c);
  --kl-border: var(--keylink-border, #1c1915);
  --kl-line: var(--keylink-line, #d4cdc0);
  --kl-accent: var(--keylink-accent, #9a3412);
  --kl-accent-fg: var(--keylink-accent-fg, #fff7f3);
  --kl-danger: var(--keylink-danger, #8e1b3a);
  --kl-font: var(--keylink-font, "Public Sans", "Avenir Next", "Segoe UI", sans-serif);
  --kl-mono: var(--keylink-mono, "IBM Plex Mono", ui-monospace, monospace);
  --kl-radius: var(--keylink-radius, 0px);
  display: block;
  box-sizing: border-box;
  max-width: 380px;
  background: var(--kl-bg);
  color: var(--kl-fg);
  font-family: var(--kl-font);
  font-size: 14px;
  line-height: 1.45;
  border: 1px solid var(--kl-border);
  border-radius: var(--kl-radius);
  padding: 16px 16px 14px;
}
*, *::before, *::after { box-sizing: border-box; }
:host { color-scheme: inherit; }
.kicker { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--kl-accent); font-weight: 600; }
h2 { margin: 0; font-size: 22px; line-height: 1.15; font-weight: 500; letter-spacing: -0.02em; }
.lede { margin: 8px 0 0; color: var(--kl-muted); }
.qr { margin-top: 14px; display: inline-block; background: #fff; border: 1px solid var(--kl-line); padding: 8px; }
.qr svg { display: block; width: 168px; height: 168px; }
details { margin-top: 12px; }
summary { cursor: pointer; font-size: 13px; }
.secret { display: block; margin-top: 8px; padding: 8px; border: 1px solid var(--kl-line); font-family: var(--kl-mono); letter-spacing: 0.04em; word-break: break-all; }
form { margin-top: 14px; }
label, legend { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
fieldset { border: 0; margin: 0; padding: 0; }
.digits { display: flex; gap: 6px; margin-top: 8px; }
.digits input, .backup input {
  width: 100%;
  background: transparent;
  color: inherit;
  border: 1px solid var(--kl-line);
  border-radius: var(--kl-radius);
  text-align: center;
  font-family: var(--kl-mono);
  font-size: 18px;
  padding: 8px 0;
}
.backup input { text-align: left; padding: 8px 10px; letter-spacing: 0.04em; margin-top: 8px; }
.digits input:focus, .backup input:focus, button:focus-visible, summary:focus-visible {
  outline: 2px solid var(--kl-accent);
  outline-offset: 1px;
}
.actions { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-top: 12px; }
button {
  appearance: none;
  background: var(--kl-accent);
  color: var(--kl-accent-fg);
  border: 1px solid var(--kl-accent);
  border-radius: var(--kl-radius);
  font: 600 13px/1 var(--kl-font);
  padding: 10px 12px;
  cursor: pointer;
}
button.link {
  background: transparent;
  color: inherit;
  border-color: transparent;
  padding: 8px 0;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.error { min-height: 1.2em; margin: 8px 0 0; color: var(--kl-danger); }
.codes { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 12px 0; }
.codes span { border: 1px solid var(--kl-line); padding: 6px 8px; font-family: var(--kl-mono); font-size: 13px; }
.foot { margin: 14px 0 0; color: var(--kl-muted); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
`;

type View =
  | { name: "loading" }
  | { name: "form"; session: SessionPayload; useBackup: boolean; error: string }
  | { name: "codes"; session: SessionPayload; codes: string[] }
  | { name: "done"; session: SessionPayload; message: string }
  | { name: "fatal"; message: string };

export function mount(target: Element | string, options: KeylinkWidgetOptions): { destroy: () => void } {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) throw new Error("Keylink mount target was not found.");
  const root = el.shadowRoot ?? el.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const wrap = document.createElement("div");
  root.replaceChildren(style, wrap);

  let view: View = { name: "loading" };
  let destroyed = false;
  const base = options.baseUrl.replace(/\/$/, "");

  const paint = () => {
    if (destroyed) return;
    wrap.innerHTML = render(view);
    bind(wrap, view);
  };

  const fail = (error: KeylinkErrorDetail, soft: boolean) => {
    options.onError?.(error);
    if (!soft || view.name !== "form") {
      view = { name: "fatal", message: error.message };
    } else {
      view = { ...view, error: error.message };
    }
    paint();
  };

  const load = async () => {
    try {
      const session = (await request(base, options.sessionToken, "/v1/widget/session")) as SessionPayload;
      if (session.status === "succeeded") {
        view = { name: "done", session, message: session.purpose === "enroll" ? "Authenticator already enabled." : "Code already accepted." };
      } else {
        view = { name: "form", session, useBackup: false, error: "" };
      }
      paint();
    } catch (error) {
      fail(asError(error), false);
    }
  };

  const bind = (scope: HTMLElement, current: View) => {
    const form = scope.querySelector("form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (current.name !== "form") return;
      const code = current.useBackup
        ? normalizeBackup((scope.querySelector("input[name=backup]") as HTMLInputElement | null)?.value ?? "")
        : readDigits(scope);
      void submit(current, code);
    });
    const toggle = scope.querySelector("[data-toggle]");
    toggle?.addEventListener("click", () => {
      if (current.name !== "form") return;
      view = { ...current, useBackup: !current.useBackup, error: "" };
      paint();
    });
    const digits = [...scope.querySelectorAll<HTMLInputElement>(".digits input")];
    wireDigits(digits);
    const ack = scope.querySelector("[data-ack]");
    ack?.addEventListener("click", () => {
      if (current.name !== "codes") return;
      const result: KeylinkSuccess = { purpose: "enroll", sessionId: current.session.sessionId, factor: "totp" };
      view = { name: "done", session: current.session, message: "Authenticator enabled." };
      paint();
      options.onSuccess?.(result);
    });
    const copy = scope.querySelector("[data-copy-codes]");
    copy?.addEventListener("click", () => {
      if (current.name !== "codes") return;
      void navigator.clipboard?.writeText(current.codes.join("\n"));
    });
    if (current.name === "form" && !current.useBackup) digits[0]?.focus();
    if (current.name === "form" && current.useBackup) scope.querySelector<HTMLInputElement>("input[name=backup]")?.focus();
  };

  const submit = async (current: Extract<View, { name: "form" }>, code: string) => {
    if (!code) {
      view = { ...current, error: current.useBackup ? "Enter a backup code." : "Enter the code from your app." };
      paint();
      return;
    }
    try {
      const result = (await request(base, options.sessionToken, "/v1/widget/confirm", { code })) as {
        purpose: "enroll" | "verify";
        sessionId: string;
        factor: string;
        backupCodes?: string[];
      };
      if (result.backupCodes?.length) {
        view = { name: "codes", session: current.session, codes: result.backupCodes };
        paint();
        return;
      }
      view = {
        name: "done",
        session: current.session,
        message: result.purpose === "enroll" ? "Authenticator enabled." : "Code accepted.",
      };
      paint();
      options.onSuccess?.({ purpose: result.purpose, sessionId: result.sessionId, factor: result.factor });
    } catch (error) {
      const detail = asError(error);
      const soft = detail.code === "invalid_code" || detail.code === "locked" || detail.code === "rate_limited";
      fail(detail, soft);
    }
  };

  void load();
  return {
    destroy() {
      destroyed = true;
      root.replaceChildren();
    },
  };
}

function render(view: View): string {
  if (view.name === "loading") {
    return `<p class="kicker">Keylink</p><h2>Contacting the server</h2><p class="lede">One moment.</p>`;
  }
  if (view.name === "fatal") {
    return `<p class="kicker">Keylink</p><h2>Unable to continue</h2><p class="error" role="alert">${escapeHtml(view.message)}</p>`;
  }
  if (view.name === "done") {
    return `<p class="kicker">${escapeHtml(view.session.appName)}</p><h2>${escapeHtml(view.message)}</h2><p class="foot">Keylink</p>`;
  }
  if (view.name === "codes") {
    const cells = view.codes.map((code) => `<span>${escapeHtml(code)}</span>`).join("");
    return `<p class="kicker">${escapeHtml(view.session.appName)}</p>
      <h2>Save your backup codes</h2>
      <p class="lede">Each code works once, if you lose the authenticator. Store them somewhere other than this browser. They will not be shown again.</p>
      <div class="codes">${cells}</div>
      <div class="actions">
        <button type="button" class="link" data-copy-codes>Copy codes</button>
        <button type="button" data-ack>I have saved these codes</button>
      </div>
      <p class="foot">Keylink</p>`;
  }
  const session = view.session;
  const enroll = session.purpose === "enroll";
  const digits = session.totp?.digits ?? 6;
  const boxes = view.useBackup
    ? ""
    : `<fieldset><legend>${enroll ? "Code from the app" : "Authentication code"}</legend><div class="digits">${Array.from({ length: digits }, (_, i) => `<input inputmode="numeric" autocomplete="${i === 0 ? "one-time-code" : "off"}" maxlength="1" aria-label="Digit ${i + 1} of ${digits}">`).join("")}</div></fieldset>`;
  const backup = view.useBackup
    ? `<div class="backup"><label for="kl-backup">Backup code</label><input id="kl-backup" name="backup" autocomplete="off" spellcheck="false"></div>`
    : "";
  const qr =
    enroll && session.totp && !view.useBackup
      ? `<div class="qr" role="img" aria-label="QR code for ${escapeHtml(session.issuer || session.appName)}">${session.totp.qrSvg}</div>
         <details><summary>Enter the secret manually</summary><code class="secret">${escapeHtml(session.totp.secretGrouped)}</code></details>`
      : "";
  return `<p class="kicker">${escapeHtml(session.appName)}</p>
    <h2>${enroll ? "Set up an authenticator" : "Two-factor check"}</h2>
    <p class="lede">${enroll ? `Scan with an authenticator app, then enter the ${digits}-digit code for ${escapeHtml(session.account)}.` : `Enter the code from the authenticator registered to ${escapeHtml(session.account)}.`}</p>
    ${qr}
    <form>
      ${boxes}
      ${backup}
      <p class="error" role="alert">${escapeHtml(view.error)}</p>
      <div class="actions">
        ${enroll ? "" : `<button type="button" class="link" data-toggle>${view.useBackup ? "Use authenticator code" : "Use a backup code"}</button>`}
        <button type="submit">${enroll ? "Confirm and enable" : "Verify"}</button>
      </div>
    </form>
    <p class="foot">Keylink</p>`;
}

function wireDigits(inputs: HTMLInputElement[]): void {
  inputs.forEach((input, index) => {
    input.addEventListener("input", () => {
      const digits = onlyDigits(input.value);
      if (digits.length > 1) {
        fillDigits(inputs, digits, index);
        return;
      }
      input.value = digits;
      if (digits && inputs[index + 1]) inputs[index + 1]!.focus();
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !input.value && inputs[index - 1]) {
        inputs[index - 1]!.focus();
      }
      if (event.key === "ArrowLeft" && inputs[index - 1]) inputs[index - 1]!.focus();
      if (event.key === "ArrowRight" && inputs[index + 1]) inputs[index + 1]!.focus();
    });
    input.addEventListener("paste", (event) => {
      const text = event.clipboardData?.getData("text") ?? "";
      const digits = onlyDigits(text);
      if (!digits) return;
      event.preventDefault();
      fillDigits(inputs, digits, index);
    });
  });
}

function fillDigits(inputs: HTMLInputElement[], digits: string, start: number): void {
  for (let i = 0; i < inputs.length - start; i += 1) {
    inputs[start + i]!.value = digits[i] ?? "";
  }
  const next = Math.min(start + digits.length, inputs.length - 1);
  inputs[next]?.focus();
}

function readDigits(scope: ParentNode): string {
  return [...scope.querySelectorAll<HTMLInputElement>(".digits input")].map((input) => input.value).join("");
}

async function request(base: string, token: string, path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    credentials: "omit",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: KeylinkErrorDetail };
  if (!response.ok) {
    throw payload.error ?? { code: "request_failed", message: "The Keylink server rejected the request." };
  }
  return payload;
}

function asError(error: unknown): KeylinkErrorDetail {
  if (error && typeof error === "object" && "message" in error && typeof (error as KeylinkErrorDetail).message === "string") {
    return error as KeylinkErrorDetail;
  }
  return { code: "network", message: "Could not reach the Keylink server." };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

class KeylinkElement extends HTMLElement {
  private handle: { destroy: () => void } | null = null;
  connectedCallback(): void {
    const baseUrl = this.getAttribute("base-url");
    const sessionToken = this.getAttribute("session-token");
    if (!baseUrl || !sessionToken || this.handle) return;
    this.handle = mount(this, {
      baseUrl,
      sessionToken,
      onSuccess: (result) => this.dispatchEvent(new CustomEvent("keylink-success", { detail: result, bubbles: true })),
      onError: (error) => this.dispatchEvent(new CustomEvent("keylink-error", { detail: error, bubbles: true })),
    });
  }
  disconnectedCallback(): void {
    this.handle?.destroy();
    this.handle = null;
  }
}

function autoMount(): void {
  document.querySelectorAll<HTMLElement>("[data-keylink]").forEach((el) => {
    if (el.dataset.keylinkReady === "1") return;
    const baseUrl = el.dataset.baseUrl;
    const sessionToken = el.dataset.sessionToken;
    if (!baseUrl || !sessionToken) return;
    el.dataset.keylinkReady = "1";
    const successName = el.dataset.success;
    mount(el, {
      baseUrl,
      sessionToken,
      onSuccess(result) {
        el.dispatchEvent(new CustomEvent("keylink-success", { detail: result, bubbles: true }));
        const host = window as unknown as Record<string, unknown>;
        const fn = successName ? host[successName] : undefined;
        if (typeof fn === "function") (fn as (result: KeylinkSuccess) => void)(result);
      },
      onError(error) {
        el.dispatchEvent(new CustomEvent("keylink-error", { detail: error, bubbles: true }));
      },
    });
  });
}

if (typeof window !== "undefined" && typeof customElements !== "undefined" && !customElements.get("keylink-widget")) {
  customElements.define("keylink-widget", KeylinkElement);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount);
  else autoMount();
}

declare global {
  interface Window {
    Keylink?: { mount: typeof mount };
  }
}

if (typeof window !== "undefined") {
  window.Keylink = { mount };
}
