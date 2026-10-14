"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { fetchSession, setCurrentUid, type SessionInfo, type User } from "./account";
import { SIGNED_OUT_EVENT } from "./api";
import { db, doc, serverTimestamp, updateDoc } from "./store";
import { isStandalone } from "./push";
import { invalidateAvatarMap } from "./users";
import { stopBlockListeners } from "./blocks";
import { forgetFeed } from "./feed-cache";
import { invalidateAllCommentPreviews } from "./posts";

type AuthState = {
  user: User | null;
  username: string | null;
  avatarPath: string | null;
  loading: boolean;
  setAvatarPath: (path: string) => void;
  setUsername: (name: string) => void;
  // Adopt a session the server just handed back (after sign-in or sign-up).
  adopt: (session: SessionInfo) => void;
  // Re-read the session from the server (after an email change, 2FA setup…).
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  user: null,
  username: null,
  avatarPath: null,
  loading: true,
  setAvatarPath: () => {},
  setUsername: () => {},
  adopt: () => {},
  refresh: async () => {},
});

// Remembered across launches so an installed app that opens with no network
// still shows the last known member instead of bouncing to the login page.
const CACHE_KEY = "nopostnow:session";

function readCached(): SessionInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as SessionInfo) : null;
  } catch {
    return null;
  }
}

function writeCached(session: SessionInfo | null) {
  try {
    if (session?.user) localStorage.setItem(CACHE_KEY, JSON.stringify(session));
    else localStorage.removeItem(CACHE_KEY);
  } catch {}
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const adopt = useCallback((session: SessionInfo) => {
    writeCached(session);
    setCurrentUid(session.user?.uid ?? null);
    invalidateAvatarMap();
    if (!session.user) {
      stopBlockListeners();
      forgetFeed();
      invalidateAllCommentPreviews();
    }
    setUser(session.user);
    setUsername(session.user ? session.username ?? "Anonymous" : null);
    setAvatarPath(session.user ? session.avatarPath ?? null : null);
    setLoading(false);
    // First launch from the Home Screen: note that this member has the app,
    // which is how others can tell a message will reach them.
    if (session.user && !session.hasApp && isStandalone()) {
      void updateDoc(doc(db, "users", session.user.uid), { appAt: serverTimestamp() }).catch(
        () => {}
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      adopt(await fetchSession());
    } catch {
      // Couldn't reach the server. Fall back to the last known member so the
      // app still opens offline; the next successful load corrects it.
      adopt(readCached() ?? { user: null });
    }
  }, [adopt]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial session fetch on mount
    void refresh();
    const onSignedOut = () => adopt({ user: null });
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [refresh, adopt]);

  return (
    <AuthContext.Provider
      value={{ user, username, avatarPath, loading, setAvatarPath, setUsername, adopt, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
