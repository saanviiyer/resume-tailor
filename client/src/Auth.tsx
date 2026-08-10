import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Signed-in header chip + sign-out button.
export function AuthHeader({ user }: { user: User }) {
  async function signOut() {
    await supabase?.auth.signOut();
  }
  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-slate-600 sm:inline">
        {user.email}
      </span>
      <button
        type="button"
        onClick={signOut}
        className="rounded-md border border-slate-300 px-3 py-1 text-sm font-medium hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  );
}

// Email magic-link (OTP) sign-in card, shown when Supabase is configured and
// the visitor is not signed in.
export function SignIn() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [message, setMessage] = useState<string | null>(null);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !email.trim()) return;
    setStatus("sending");
    setMessage(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
      setMessage(
        "Check your email for a magic sign-in link, then return to this tab."
      );
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-bold">Sign in to continue</h2>
      <p className="mt-1 text-sm text-slate-500">
        Enter your email and we'll send you a one-time magic link. Your saved
        resumes and history stay tied to your account.
      </p>
      <form onSubmit={sendLink} className="mt-4 space-y-3">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="w-full rounded-lg border border-slate-300 p-2.5 text-sm focus:border-slate-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded-lg bg-slate-900 px-5 py-2.5 font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {status === "sending" ? "Sending…" : "Send magic link"}
        </button>
      </form>
      {message && (
        <p
          className={`mt-3 text-sm ${
            status === "error" ? "text-rose-600" : "text-green-700"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
