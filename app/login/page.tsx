"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError } from "@/lib/api";
import {
  checkInvite,
  checkResetToken,
  resetPassword,
  signIn,
  signUp,
  MIN_PASSWORD_LENGTH,
} from "@/lib/account";
import { useAuth } from "@/lib/auth-context";
import { validateUsername, MAX_USERNAME_LENGTH } from "@/lib/settings";
import { useSite } from "@/components/SiteProvider";

// "forgot" explains how to get a reset link; "reset" is where that link lands.
type Mode = "login" | "register" | "forgot" | "reset";

function friendlyError(err: unknown) {
  if (err instanceof ApiError) {
    if (err.code === "network" || err.status === 0) return "Couldn't reach the server.";
    return err.message || "Something went wrong.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

const label = "mb-1.5 block text-[10px] font-bold uppercase tracking-[1.5px] text-mut";
const field =
  "w-full rounded-lg border-[0.5px] border-edge bg-card px-3.5 py-3 text-[16px] outline-none transition-colors placeholder:text-[#2e2e2e] focus:border-mut";
const errorBox =
  "mb-4 rounded-lg border-[0.5px] border-[#5c1a1a] bg-[#1a0a0a] px-3.5 py-3 text-[13px] leading-snug text-[#e74c3c]";
const submit =
  "mt-2.5 w-full rounded-lg bg-white p-3.5 text-sm font-extrabold tracking-[0.3px] text-black transition-opacity hover:opacity-90 active:opacity-75 disabled:cursor-not-allowed disabled:opacity-30";

export default function LoginPage() {
  const router = useRouter();
  const site = useSite();
  const { user, loading, adopt } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [invite, setInvite] = useState("");
  // Invite codes that arrive in the link are filled in for the visitor.
  const [inviteFromLink, setInviteFromLink] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set once the password is accepted but an authenticator code is still owed.
  const [needsCode, setNeedsCode] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  // Invite and reset links both land here: /login?invite=… and /login?reset=…
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("invite");
    const token = params.get("reset");
    /* eslint-disable react-hooks/set-state-in-effect -- one-time read of the link on mount */
    if (token) {
      setResetToken(token);
      setMode("reset");
      checkResetToken(token)
        .then((valid) => {
          if (!valid) setError("That reset link has expired — ask for a new one.");
        })
        .catch(() => {});
    } else if (code) {
      setInvite(code);
      setInviteFromLink(true);
      setMode("register");
      checkInvite(code)
        .then((valid) => {
          if (!valid) setError("That invite link is not valid any more — ask for a new one.");
        })
        .catch(() => {});
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Already signed in: there is nothing to do here.
  useEffect(() => {
    if (!loading && user && mode !== "reset") router.replace("/");
  }, [loading, user, mode, router]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setInfo(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "login") {
        adopt(await signIn(email, password));
        router.replace("/");
      } else if (mode === "register") {
        const invalid = validateUsername(username);
        if (invalid) {
          setError(invalid);
          return;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
          setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
          return;
        }
        adopt(await signUp({ email, password, username: username.trim(), invite: invite.trim() }));
        router.replace("/");
      } else if (mode === "reset") {
        if (password.length < MIN_PASSWORD_LENGTH) {
          setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
          return;
        }
        await resetPassword(resetToken, password);
        setPassword("");
        window.history.replaceState(null, "", "/login");
        setMode("login");
        setInfo("Password changed — log in with the new one.");
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "mfa-required") setNeedsCode(true);
      else setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      adopt(await signIn(email, password, totpCode.trim()));
      router.replace("/");
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const heading = (subtitle: string) => (
    <div className="mb-10 text-center">
      <h1 className="text-[32px] font-black leading-none tracking-[-1px]">{site.siteName}</h1>
      <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[2.5px] text-dim">
        {subtitle}
      </p>
    </div>
  );

  if (needsCode) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-4 py-6">
        <form onSubmit={handleTotp} className="w-full max-w-[380px]">
          {heading("Two-factor authentication")}
          <p className="mb-6 text-center text-[13px] leading-relaxed text-mut">
            Enter the 6-digit code from your authenticator app.
          </p>
          {error && <p className={errorBox}>{error}</p>}
          <input
            autoFocus
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className={`${field} text-center text-xl tracking-[8px]`}
          />
          <button type="submit" disabled={busy || totpCode.length !== 6} className={submit}>
            Verify
          </button>
          <button
            type="button"
            onClick={() => {
              setNeedsCode(false);
              setTotpCode("");
              setError(null);
            }}
            className="mt-4 w-full text-center text-xs text-dim transition-colors hover:text-white"
          >
            Back to log in
          </button>
        </form>
      </main>
    );
  }

  const signupClosed = site.signup === "closed";

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-6">
      <div className="w-full max-w-[380px]">
        {heading(site.tagline)}

        {(mode === "login" || mode === "register") && !signupClosed && (
          <div className="mb-8 flex border-b-[0.5px] border-line">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={`flex-1 border-b-2 pb-2.5 pt-2.5 text-[11px] font-bold uppercase tracking-[1.5px] transition-colors ${
                  mode === m ? "border-white text-white" : "border-transparent text-dim"
                }`}
              >
                {m === "login" ? "Log In" : "Sign Up"}
              </button>
            ))}
          </div>
        )}

        {mode === "forgot" && (
          <p className="mb-8 text-center text-[13px] leading-relaxed text-mut">
            This site doesn&apos;t send email. Ask whoever runs it for a password reset
            link — they can make one for you in a few seconds.
          </p>
        )}

        {mode === "reset" && (
          <p className="mb-8 text-center text-[13px] leading-relaxed text-mut">
            Choose a new password for your account.
          </p>
        )}

        {error && <p className={errorBox}>{error}</p>}
        {info && (
          <p className="mb-4 rounded-lg border-[0.5px] border-[#1a5c2e] bg-[#0a1a0f] px-3.5 py-3 text-[13px] leading-snug text-[#2ecc71]">
            {info}
          </p>
        )}

        {mode !== "forgot" && (
          <form onSubmit={handleSubmit}>
            {mode !== "reset" && (
              <div className="mb-4">
                <label className={label} htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={field}
                />
              </div>
            )}

            <div className="mb-4">
              <label className={label} htmlFor="password">
                {mode === "reset" ? "New password" : "Password"}
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={mode === "login" ? undefined : MIN_PASSWORD_LENGTH}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
            </div>

            {mode === "register" && (
              <div className="mb-4">
                <label className={label} htmlFor="username">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  required
                  maxLength={MAX_USERNAME_LENGTH}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={field}
                />
              </div>
            )}

            {mode === "register" && site.signup === "invite" && !inviteFromLink && (
              <div className="mb-4">
                <label className={label} htmlFor="invite">
                  Invite code
                </label>
                <input
                  id="invite"
                  type="text"
                  required
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  className={field}
                />
              </div>
            )}

            <button type="submit" disabled={busy} className={submit}>
              {mode === "login" ? "Log In" : mode === "register" ? "Create Account" : "Set Password"}
            </button>

            {mode === "register" && (
              <p className="mt-4 text-center text-[11px] leading-relaxed text-dim">
                By creating an account you agree to the{" "}
                <Link href="/terms" className="underline hover:text-white">
                  terms
                </Link>{" "}
                and{" "}
                <Link href="/privacy" className="underline hover:text-white">
                  privacy notice
                </Link>
                .
              </p>
            )}
          </form>
        )}

        <div className="mt-5 text-center text-xs leading-relaxed text-dim">
          {mode === "login" ? (
            <button onClick={() => switchMode("forgot")} className="transition-colors hover:text-white">
              Forgot password?
            </button>
          ) : mode === "forgot" || mode === "reset" ? (
            <button onClick={() => switchMode("login")} className="transition-colors hover:text-white">
              Back to log in
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
