import type { Account } from "./core/accounts.ts";
import { getDoc } from "./store.ts";

// What the browser is told about the signed-in member.
export function sessionPayload(account: Account) {
  const profile = getDoc(`users/${account.uid}`)?.data ?? {};
  return {
    user: {
      uid: account.uid,
      email: account.email,
      isAdmin: account.role === "admin",
      totpEnabled: account.totpEnabled,
      createdAt: account.createdAt,
    },
    username: typeof profile.username === "string" ? profile.username : "Anonymous",
    avatarPath: typeof profile.avatarPath === "string" ? profile.avatarPath : null,
    hasApp: profile.appAt !== undefined,
  };
}
