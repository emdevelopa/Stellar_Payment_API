const TOKEN_KEY = "merchant_token";

export interface MerchantSession {
  id: string;
  email: string;
  exp: number;
}

export interface Merchant {
  id: string;
  email: string;
  business_name: string;
  notification_email: string;
  merchant_settings?: {
    send_success_emails?: boolean;
  } | null;
  api_key: string;
  webhook_secret: string;
  created_at: string;
}

/**
 * Decode the JWT payload without verifying the signature.
 * Verification happens server-side; here we only need the claims for UI state.
 */
function parseJwtPayload(token: string): MerchantSession | null {
  try {
    const [, payloadB64] = token.split(".");
    const json = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as MerchantSession;
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
}

/**
 * Returns the decoded session if a valid, non-expired token exists.
 * Clears the stored token automatically if it has expired.
 */
export function getSession(): MerchantSession | null {
  const token = getToken();
  if (!token) return null;

  const session = parseJwtPayload(token);
  if (!session) {
    clearToken();
    return null;
  }

  if (Date.now() / 1000 >= session.exp) {
    clearToken();
    return null;
  }

  return session;
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

/**
 * POST credentials to the backend, persist the returned JWT, and return
 * the decoded session. Throws with the server's error message on failure.
 */
export async function login(
  email: string,
  password: string
): Promise<MerchantSession> {
  const apiUrl =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  const res = await fetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Login failed");
  }

  const body = await res.json();
  console.log("[auth] login response body:", body);
  const token = body.token;
  if (!token) throw new Error("No token in server response");
  saveToken(token);

  // Also save merchant metadata if provided
  if (body.merchant && typeof window !== "undefined") {
    localStorage.setItem("merchant_metadata", JSON.stringify(body.merchant));
  }

  const session = getSession();
  console.log("[auth] parsed session:", session);
  if (!session) throw new Error("Invalid token received from server");
  return session;
}

export async function registerMerchant(
  email: string,
  business_name: string,
  notification_email: string,
  password: string,
): Promise<{ message: string; token?: string; merchant: Merchant }> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  const res = await fetch(`${apiUrl}/api/register-merchant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, business_name, notification_email, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Registration failed");
  }

  const body = await res.json();
  const token = body.token;
  if (!token) throw new Error("No token in server response");

  saveToken(token);

  if (body.merchant && typeof window !== "undefined") {
    localStorage.setItem("merchant_metadata", JSON.stringify(body.merchant));
    if (body.merchant.api_key) {
      localStorage.setItem("merchant_api_key", body.merchant.api_key);
    }
  }

  return body;
}

export function logout(): void {
  clearToken();
}

export async function generateFirstApiKey(): Promise<string> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const token = getToken();

  if (!token) throw new Error("No session token found");

  const res = await fetch(`${apiUrl}/api/merchants/generate-api-key`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Failed to generate API key");
  }

  const { api_key } = await res.json();
  return api_key;
}
