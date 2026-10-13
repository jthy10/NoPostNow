import { apiGet, apiPost } from "./api";

// Sign-in, sign-up and account changes. The server keeps the session in an
// HttpOnly cookie, so there is no token for this code to hold or leak.

export type User = {
  uid: string;
  email: string;
  isAdmin: boolean;
  // Whether an authenticator app is set up for this account.
  totpEnabled: boolean;
  createdAt: number;
};

export type SessionInfo = {
  user: User | null;
  username?: string;
  avatarPath?: string | null;
  hasApp?: boolean;
  freshAdmin?: boolean;
};

export const MIN_PASSWORD_LENGTH = 8;

// The signed-in member's uid, for code that runs outside React. Kept current
// by the auth context.
let activeUid: string | null = null;

export function setCurrentUid(uid: string | null) {
  activeUid = uid;
}

export function currentUid(): string | null {
  return activeUid;
}

export function fetchSession(): Promise<SessionInfo> {
  return apiGet<SessionInfo>("/api/auth/session");
}

// Rejects with code "mfa-required" when the account needs an authenticator
// code — call again with one.
export function signIn(email: string, password: string, code?: string): Promise<SessionInfo> {
  return apiPost<SessionInfo>("/api/auth/login", { email, password, code });
}

export function signUp(opts: {
  email: string;
  password: string;
  username: string;
  invite?: string;
}): Promise<SessionInfo> {
  return apiPost<SessionInfo>("/api/auth/signup", opts);
}

export async function signOut(): Promise<void> {
  await apiPost("/api/auth/logout");
}

export async function checkInvite(invite: string): Promise<boolean> {
  return (await apiPost<{ valid: boolean }>("/api/auth/invite-check", { invite })).valid;
}

export async function checkResetToken(token: string): Promise<boolean> {
  return (await apiPost<{ valid: boolean }>("/api/auth/reset-check", { token })).valid;
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiPost("/api/auth/reset", { token, password });
}

// Re-enter the password (and authenticator code, when enrolled). Admin actions
// are only accepted for a short while afterwards.
export async function reauthenticate(password: string, code?: string): Promise<boolean> {
  const res = await apiPost<{ freshAdmin: boolean }>("/api/auth/reauth", { password, code });
  return res.freshAdmin;
}

export async function changePassword(currentPassword: string, newPassword: string) {
  await apiPost("/api/auth/password", { password: currentPassword, newPassword });
}

export async function changeEmail(currentPassword: string, newEmail: string): Promise<string> {
  const res = await apiPost<{ email: string }>("/api/auth/email", {
    password: currentPassword,
    newEmail,
  });
  return res.email;
}

export async function deleteAccount(currentPassword: string) {
  await apiPost("/api/auth/delete-account", { password: currentPassword });
}

export function beginTotp(password?: string): Promise<{ secret: string; uri: string }> {
  return apiPost("/api/auth/totp-begin", { password });
}

export async function confirmTotp(code: string, password?: string) {
  await apiPost("/api/auth/totp-confirm", { code, password });
}

export async function disableTotp(password: string, code: string) {
  await apiPost("/api/auth/totp-disable", { password, code });
}
