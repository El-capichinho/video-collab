import { useCallback, useEffect, useState } from "react";
import type { PublicUser } from "@vc/shared";
import { AuthApiError } from "../../core/auth/AuthClient";
import { SERVER_URL } from "../../core/config";
import { authClient } from "./authClient";

export type AuthStatus = "loading" | "signed-out" | "signed-in";

const OFFLINE = `Can't reach the server at ${SERVER_URL}. Check that it's running (npm run dev:server), then try again.`;

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = authClient.subscribe((u) => {
      setUser(u);
      setStatus(u ? "signed-in" : "signed-out");
    });
    authClient
      .restoreSession()
      .then((u) => {
        setUser(u);
        setStatus(u ? "signed-in" : "signed-out");
      })
      .catch(() => {
        setError(OFFLINE);
        setStatus("signed-out");
      });
    return off;
  }, []);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof AuthApiError ? e.message : OFFLINE);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    status,
    user,
    error,
    busy,
    signIn: (email: string, password: string) => run(() => authClient.login({ email, password })),
    signUp: (displayName: string, email: string, password: string) =>
      run(() => authClient.register({ displayName, email, password })),
    signOut: () => authClient.logout(),
  };
}
