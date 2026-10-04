import { useState, type FormEvent } from "react";
import { LoginBody, RegisterBody } from "@vc/shared";

type Mode = "sign-in" | "sign-up";

interface Props {
  busy: boolean;
  error: string | null;
  onSignIn: (email: string, password: string) => void;
  onSignUp: (displayName: string, email: string, password: string) => void;
}

export function AuthForm({ busy, error, onSignIn, onSignUp }: Props) {
  const [mode, setMode] = useState<Mode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const signUp = mode === "sign-up";

  function submit(e: FormEvent) {
    e.preventDefault();
    if (signUp) {
      const parsed = RegisterBody.safeParse({ displayName: name, email, password });
      if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? "Check your details");
      setFieldError(null);
      onSignUp(parsed.data.displayName, parsed.data.email, parsed.data.password);
    } else {
      const parsed = LoginBody.safeParse({ email, password });
      if (!parsed.success) return setFieldError(parsed.error.issues[0]?.message ?? "Check your details");
      setFieldError(null);
      onSignIn(parsed.data.email, parsed.data.password);
    }
  }

  const message = fieldError ?? error;

  return (
    <form className="card join" onSubmit={submit} noValidate>
      <div className="segmented" role="tablist" aria-label="Account">
        {(["sign-in", "sign-up"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setFieldError(null);
            }}
          >
            {m === "sign-in" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      {signUp && (
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" />
        </label>
      )}
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
        />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={signUp ? "new-password" : "current-password"}
        />
        {signUp && <small>At least 10 characters. A few random words works well.</small>}
      </label>

      <p className="form-error" role="alert" hidden={!message}>
        {message}
      </p>
      <button className="primary" type="submit" disabled={busy}>
        {busy ? "One moment…" : signUp ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
