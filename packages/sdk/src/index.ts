export class KeylinkError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "KeylinkError";
    this.status = status;
    this.code = code;
  }
}

export type FactorState = {
  type: string;
  status: string;
  confirmedAt: number | null;
};

export type UserRecord = {
  id: string;
  externalId: string;
  displayName: string | null;
  enrolled: boolean;
  lockedUntil: number | null;
  failedAttempts: number;
  factors: FactorState[];
  backupCodesRemaining: number;
};

export type EnrollSession = {
  sessionId: string;
  clientToken: string;
  expiresAt: number;
  purpose: "enroll";
  totp: {
    secret: string;
    secretGrouped: string;
    otpauthUrl: string;
    qrSvg: string;
    digits: number;
    period: number;
    algorithm: string;
  };
};

export type VerifySession = {
  sessionId: string;
  clientToken: string;
  expiresAt: number;
  purpose: "verify";
};

export type SessionRecord = {
  sessionId: string;
  purpose: "enroll" | "verify";
  status: string;
  externalId: string;
  expiresAt: number;
  consumedAt: number | null;
};

export type KeylinkOptions = {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
};

export class Keylink {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: KeylinkOptions) {
    if (!options.baseUrl) throw new Error("baseUrl is required");
    if (!options.apiKey) throw new Error("apiKey is required");
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
  }

  upsertUser(externalId: string, input: { displayName?: string } = {}): Promise<UserRecord> {
    return this.request("PUT", `/v1/users/${encodeURIComponent(externalId)}`, input);
  }

  getUser(externalId: string): Promise<UserRecord> {
    return this.request("GET", `/v1/users/${encodeURIComponent(externalId)}`);
  }

  createSession(externalId: string, input: { purpose: "enroll"; displayName?: string }): Promise<EnrollSession>;
  createSession(externalId: string, input: { purpose: "verify"; displayName?: string }): Promise<VerifySession>;
  createSession(externalId: string, input: { purpose: "enroll" | "verify"; displayName?: string }): Promise<EnrollSession | VerifySession> {
    return this.request("POST", `/v1/users/${encodeURIComponent(externalId)}/sessions`, input);
  }

  getSession(sessionId: string): Promise<SessionRecord> {
    return this.request("GET", `/v1/sessions/${encodeURIComponent(sessionId)}`);
  }

  /** Mark a successful widget session as used. Call this from your backend, not the browser. */
  consumeSession(sessionId: string): Promise<SessionRecord> {
    return this.request("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/consume`);
  }

  verifyCode(externalId: string, code: string): Promise<{ ok: true; factor: "totp" | "backup_code"; user: UserRecord }> {
    return this.request("POST", `/v1/users/${encodeURIComponent(externalId)}/verify`, { code });
  }

  regenerateBackupCodes(externalId: string): Promise<{ codes: string[] }> {
    return this.request("POST", `/v1/users/${encodeURIComponent(externalId)}/backup-codes`);
  }

  disableTotp(externalId: string): Promise<{ ok: true; user: UserRecord }> {
    return this.request("DELETE", `/v1/users/${encodeURIComponent(externalId)}/totp`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      throw new KeylinkError(
        response.status,
        payload.error?.code ?? "request_failed",
        payload.error?.message ?? `Keylink request failed (${response.status})`,
      );
    }
    return payload as T;
  }
}
