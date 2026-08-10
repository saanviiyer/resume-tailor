import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseEnabled } from "./supabase";

export interface AuthState {
  enabled: boolean;
  loading: boolean;
  user: User | null;
  session: Session | null;
}

// Tracks Supabase auth state. In anonymous mode (no Supabase env) this reports
// enabled:false and never blocks the UI.
export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(supabaseEnabled);

  useEffect(() => {
    if (!supabaseEnabled || !supabase) {
      setLoading(false);
      return;
    }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    enabled: supabaseEnabled,
    loading,
    user: session?.user ?? null,
    session,
  };
}

// Return the current access token (JWT) to send to the server, or null.
export async function getAccessToken(): Promise<string | null> {
  if (!supabaseEnabled || !supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
