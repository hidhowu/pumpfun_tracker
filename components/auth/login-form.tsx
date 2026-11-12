"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Activity, ArrowRight, ChevronLeft, Clock, Eye, EyeOff, FlaskConical, Loader2, Lock, LockKeyhole, ShieldCheck, TrendingUp, TriangleAlert, User, XCircle, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Only same-site paths - never an absolute or protocol-relative URL (open redirect). */
/**
 * The post-login destination, accepted only if it resolves to this same origin. String prefix checks aren't
 * enough: browsers strip tabs/newlines and treat "\" like "/" while parsing, so "/%09/evil.com" or "/\evil.com"
 * can still end up on another host. Resolving the URL the way the browser will and comparing origins can't be fooled that way.
 */
function safeNextPath(raw: string | null): string {
  if (!raw || !raw.startsWith("/")) return "/";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    if (url.pathname.startsWith("/login")) return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}

const subscribeNever = () => () => {};
/** True when the page came over plain HTTP from somewhere other than this machine. */
function isInsecureOrigin() {
  const { protocol, hostname } = window.location;
  return protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

// The server gives a password-accepted login 5 minutes to supply the second factor; this only drives the countdown.
const CHALLENGE_MS = 5 * 60 * 1000;

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once the password was accepted and the account needs a second factor: a short-lived proof from the server.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [challengeEndsAt, setChallengeEndsAt] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const insecure = useSyncExternalStore(subscribeNever, isInsecureOrigin, () => false);

  useEffect(() => {
    if (!challenge) return;
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((challengeEndsAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        setChallenge(null);
        setCode("");
        setError("Your sign-in expired - start again.");
      }
    }, 1000);
    return () => clearInterval(id);
  }, [challenge, challengeEndsAt]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Sign-in failed (${res.status})`);
        setPassword("");
        return;
      }
      if (body.twoFactor && typeof body.challenge === "string") {
        setChallenge(body.challenge);
        setChallengeEndsAt(Date.now() + CHALLENGE_MS);
        setSecondsLeft(CHALLENGE_MS / 1000);
        setPassword("");
        return;
      }
      // Full navigation (not router.push) so the signed-in shell loads fresh.
      window.location.assign(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge, code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.expired) {
          // The 5-minute window ran out: back to the password step.
          setChallenge(null);
        }
        setError(body.error || `Sign-in failed (${res.status})`);
        setCode("");
        return;
      }
      window.location.assign(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function backToPassword() {
    setChallenge(null);
    setCode("");
    setError(null);
  }

  const countdown = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="flex min-h-svh bg-background">
      <StoryPanel twoFactor={!!challenge} />
      <section className="flex min-w-0 flex-1 flex-col lg:items-center lg:justify-center lg:p-12">
        <MobileHero twoFactor={!!challenge} />
        {challenge ? (
          <form onSubmit={handleCodeSubmit} className="flex w-full max-w-[400px] flex-col gap-6 p-6 lg:p-0">
            <Button type="button" variant="ghost" size="sm" className="-ml-2.5 self-start" onClick={backToPassword}>
              <ChevronLeft />
              Back to password
            </Button>
            <div className="flex flex-col gap-2">
              <h2 className="text-[28px] leading-[34px] font-semibold tracking-[-0.025em]">Enter your code</h2>
              <p className="text-sm leading-[22px] text-text-2">
                Open your authenticator app and type the 6-digit code for <b className="font-medium text-foreground">pump.fun tracker</b>, or use a recovery code.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="otp-code">Authentication code</Label>
              <Input
                id="otp-code"
                name="otp-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus
                required
                maxLength={16}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                aria-invalid={error ? true : undefined}
                className="h-[60px] rounded-xl text-center font-mono text-2xl font-semibold tracking-[0.35em] md:text-2xl"
              />
              <div className="flex items-center justify-between text-xs text-text-3">
                <span className="flex items-center gap-1.5">
                  <Clock className="size-3" />
                  Expires in <b className="font-mono text-foreground">{countdown}</b>
                </span>
                <span>6 digits, or a recovery code</span>
              </div>
            </div>
            {error && <ErrorNotice>{error}</ErrorNotice>}
            <Button type="submit" size="lg" disabled={submitting || code.trim().length < 6} className="h-[52px] w-full rounded-[14px] text-[15px] font-semibold">
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting ? "Checking…" : "Verify and sign in"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="flex w-full max-w-[400px] flex-col gap-6 p-6 lg:p-0">
            <div className="hidden flex-col gap-2 lg:flex">
              <h2 className="text-[28px] leading-[34px] font-semibold tracking-[-0.025em]">Welcome back</h2>
              <p className="text-sm leading-[22px] text-text-2">Sign in to your trading desk.</p>
            </div>
            {insecure && (
              <div className="flex items-start gap-3 rounded-[14px] border border-warn/30 bg-warn-soft p-3.5 text-[13px] leading-5 text-[#f0d9a6]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                <span>
                  <b>This connection is not encrypted (HTTP).</b> Your password can be read by anyone on the network - serve the dashboard over HTTPS.
                </span>
              </div>
            )}
            {error && <ErrorNotice>{error}</ErrorNotice>}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="username">Username</Label>
                <div className="relative">
                  <User className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-3" />
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    required
                    maxLength={64}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    className="h-12 rounded-xl pl-10 text-base"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {capsLock && (
                    <span className="flex items-center gap-1.5 text-xs text-warn">
                      <ArrowRight className="size-3 -rotate-90" />
                      Caps Lock is on
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-text-3" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyUp={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                    onKeyDown={(e) => setCapsLock(e.getModifierState("CapsLock"))}
                    onBlur={() => setCapsLock(false)}
                    aria-invalid={error ? true : undefined}
                    className="h-12 rounded-xl pr-12 pl-10 text-base"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-1 -translate-y-1/2"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? <EyeOff /> : <Eye />}
                  </Button>
                </div>
              </div>
            </div>
            <Button type="submit" size="lg" disabled={submitting} className="h-[52px] w-full rounded-[14px] text-[15px] font-semibold">
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {submitting ? "Signing in…" : "Sign in"}
              {!submitting && <ArrowRight />}
            </Button>
            <p className="flex items-center justify-center gap-2 text-center text-xs text-text-3">
              <ShieldCheck className="size-3.5 shrink-0" />
              Two-factor authentication is asked on the next step when enabled.
            </p>
          </form>
        )}
        <div className="mt-auto flex items-center gap-3 p-6 pb-8 text-xs text-text-3 lg:hidden">
          <LockKeyhole className="size-3.5 shrink-0" />
          Keys are encrypted at rest. Two-factor protects live wallets.
        </div>
      </section>
    </div>
  );
}

function ErrorNotice({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[14px] border border-destructive/30 bg-neg-soft p-3.5 text-[13px] leading-5 text-[#ffc9d0]">
      <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <span>{children}</span>
    </div>
  );
}

const DOT_GRID = "radial-gradient(circle at 1px 1px, rgba(255,255,255,.07) 1px, transparent 0) 0 0/28px 28px";

function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[13px] bg-primary text-primary-foreground" style={{ width: size, height: size }}>
      <TrendingUp className="size-5" strokeWidth={2.4} />
    </span>
  );
}

/** Phone-only header: the product line above the form (the full story panel is desktop-only). */
function MobileHero({ twoFactor }: { twoFactor: boolean }) {
  return (
    <div className="flex flex-col gap-4 px-6 pt-10 pb-2 lg:hidden" style={{ background: "radial-gradient(90% 40% at 20% 0%, rgba(182,242,79,.14), transparent 70%)" }}>
      <Logo size={44} />
      {twoFactor ? (
        <>
          <h1 className="text-[34px] leading-[38px] font-semibold tracking-[-0.035em]">A second check keeps your wallets yours.</h1>
          <p className="text-[15px] leading-[22px] text-text-2">Live wallets can move real SOL. Two-factor protects sign-in, sends and key reveals.</p>
        </>
      ) : (
        <>
          <h1 className="text-[34px] leading-[38px] font-semibold tracking-[-0.035em]">
            Follow the best traders. <span className="text-primary">Prove it</span> first.
          </h1>
          <p className="text-[15px] leading-[22px] text-text-2">Track pump.fun wallets live, copy them in simulation, then go live on your own server.</p>
        </>
      )}
    </div>
  );
}

const FEED = [
  { ini: "7X", addr: "7xKX…9fPq", side: "bought", tok: "a new token", sub: "Copied in simulation", amt: "+1.20 SOL", pos: true, shift: 0, bg: "#6cd9b0" },
  { ini: "GH", addr: "Gh3m…Rv2t", side: "sold", tok: "for a profit", sub: "Position closed", amt: "+$38.40", pos: true, shift: 32, bg: "#8fc6ff" },
  { ini: "9P", addr: "9PzA…xT1e", side: "sold", tok: "at a loss", sub: "Stop-loss hit", amt: "−$12.10", pos: false, shift: 0, bg: "#ffc98a" },
];

const POINTS = [
  { icon: Activity, t: "Real-time tracking", s: "Every buy and sell from the wallets you follow, as it lands." },
  { icon: FlaskConical, t: "Simulate & backtest", s: "Replay history with your own size, fees and exit rules." },
  { icon: Zap, t: "Go live, carefully", s: "Fast sends, per-trader lots and a dry run before real money." },
];

/** Desktop-only left panel with the product story: static copy and an example feed, no live data. */
function StoryPanel({ twoFactor }: { twoFactor: boolean }) {
  return (
    <section
      className="relative hidden min-w-0 flex-[1.15] flex-col justify-between overflow-hidden border-r border-line bg-sidebar px-16 py-12 lg:flex"
      style={{ backgroundImage: `${DOT_GRID}, radial-gradient(80% 60% at 20% 0%, rgba(182,242,79,.12), transparent 60%)` }}
    >
      <div className="flex items-center gap-2.5">
        <Logo />
        <b className="text-lg tracking-tight">pump.fun tracker</b>
      </div>

      {twoFactor ? (
        <div className="flex max-w-[520px] flex-col gap-4">
          <span className="flex size-14 items-center justify-center rounded-[18px] bg-volt-soft text-primary">
            <ShieldCheck className="size-6" />
          </span>
          <h1 className="text-[44px] leading-[48px] font-semibold tracking-[-0.035em]">A second check keeps your wallets yours.</h1>
          <p className="text-[17px] leading-7 text-text-2">Live wallets can move real SOL. Two-factor protects sign-in, new wallets, sends and private-key reveals.</p>
        </div>
      ) : (
        <div className="flex max-w-[600px] flex-col gap-8">
          <div className="flex flex-col gap-4">
            <h1 className="text-[52px] leading-14 font-semibold tracking-[-0.035em]">
              Follow the best traders.
              <br />
              <span className="text-primary">Prove it</span> before you pay for it.
            </h1>
            <p className="text-[17px] leading-7 text-text-2">
              Watch pump.fun wallets in real time, copy-trade them in simulation, backtest their history, then go live with a wallet that stays encrypted on your own server.
            </p>
          </div>
          <div className="flex flex-col gap-2" aria-label="Example of the activity feed">
            {FEED.map((f) => (
              <div key={f.addr} className="flex items-center gap-3 rounded-2xl border border-line-2 bg-card/80 px-3.5 py-3 backdrop-blur-sm" style={{ marginLeft: f.shift }}>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] font-mono text-[10px] font-semibold text-primary-foreground" style={{ background: f.bg }}>
                  {f.ini}
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-snug">
                  <span className="text-[13px]">
                    <span className="font-mono">{f.addr}</span> <b className={f.pos ? "text-positive" : "text-negative"}>{f.side}</b> <b>{f.tok}</b>
                  </span>
                  <span className="text-xs text-text-3">Example · {f.sub}</span>
                </span>
                <b className={cn("tabular-nums", f.pos ? "text-positive" : "text-negative")}>{f.amt}</b>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-5">
            {POINTS.map((p) => (
              <div key={p.t} className="flex flex-col gap-2">
                <span className="flex size-9 items-center justify-center rounded-[11px] bg-volt-soft text-primary">
                  <p.icon className="size-4" />
                </span>
                <b className="text-[13px]">{p.t}</b>
                <span className="text-xs leading-[18px] text-text-2">{p.s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-text-3">
        <LockKeyhole className="size-3.5 shrink-0" />
        {twoFactor ? "Lost your device? Use a recovery code." : "Self-hosted. Private keys are encrypted at rest and revealed only after two-factor."}
      </div>
    </section>
  );
}
