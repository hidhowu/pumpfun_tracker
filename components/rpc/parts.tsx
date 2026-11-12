"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, Wifi, WifiOff, XCircle } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { formatAddress, formatRelativeTime } from "@/lib/format";
import type { RpcEndpointAddress, RpcEndpointHealth, RpcEndpointView } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Rate-limit failures in a row before an endpoint is blacklisted - mirrors RPC_FAILURE_THRESHOLD in db/rpcHealth.js. */
export const FAILURE_THRESHOLD = 3;

export type TestTarget = { _id: string; label: string; url: string };
export type HealthTarget = TestTarget & RpcEndpointHealth & { enabled: boolean };

export const isBlacklisted = (e: RpcEndpointHealth) => e.health === "blacklisted";
export const nameOf = (e: TestTarget) => e.label || formatAddress(e.url, 12);

const PILL_TONES = {
  pos: "border-positive/30 bg-pos-soft text-positive",
  neg: "border-destructive/30 bg-neg-soft text-destructive",
  warn: "border-warn/30 bg-warn-soft text-warn",
  neutral: "border-line-2 bg-surface-3 text-text-2",
} as const;

/** A small rounded status label ("Connected", "Blacklisted", "2/3 strikes") - the design's "bd". */
export function StatusPill({ tone = "neutral", title, className, children }: { tone?: keyof typeof PILL_TONES; title?: string; className?: string; children: React.ReactNode }) {
  return (
    <span title={title} className={cn("inline-flex h-[22px] w-fit shrink-0 items-center gap-1 rounded-full border px-2 text-[11.5px] font-medium whitespace-nowrap [&>svg]:size-3", PILL_TONES[tone], className)}>
      {children}
    </span>
  );
}

export function ConnectionBadge({ status }: { status: RpcEndpointView["status"] }) {
  if (status === "connected") {
    return (
      <StatusPill tone="pos">
        <Wifi /> Connected
      </StatusPill>
    );
  }
  if (status === "connecting") {
    return (
      <StatusPill>
        <Loader2 className="animate-spin" /> Connecting
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="neg">
      <WifiOff /> Disconnected
    </StatusPill>
  );
}

export function BlacklistBadge({ endpoint }: { endpoint: RpcEndpointHealth }) {
  if (isBlacklisted(endpoint)) {
    return (
      <StatusPill tone="neg" title={`Rate limited ${FAILURE_THRESHOLD} times in a row - skipped everywhere until it passes a test`}>
        <ShieldAlert /> Blacklisted
      </StatusPill>
    );
  }
  const strikes = endpoint.consecutiveFailures ?? 0;
  if (strikes > 0) {
    return (
      <StatusPill tone="warn" title="Failures in a row - blacklisted at 3">
        <AlertTriangle /> {strikes}/{FAILURE_THRESHOLD} strikes
      </StatusPill>
    );
  }
  return null;
}

const VERDICT_LABEL: Record<NonNullable<RpcEndpointHealth["lastTest"]>["verdict"], string> = {
  ok: "Healthy",
  slow: "Slow",
  rate_limited: "Rate limited",
  auth_failed: "Key rejected",
  unreachable: "Unreachable",
  error: "Error",
  no_signature: "Not tested",
};

export function TestResultLine({ test, className }: { test: RpcEndpointHealth["lastTest"]; className?: string }) {
  if (!test) return null;
  const tone = test.verdict === "ok" ? "text-positive" : test.verdict === "slow" ? "text-warn" : "text-destructive";
  const Icon = test.verdict === "ok" ? CheckCircle2 : test.verdict === "slow" ? AlertTriangle : XCircle;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs leading-[18px]", tone, className)}>
      <Icon className="mt-[3px] size-3 shrink-0" />
      <span className="min-w-0">
        <b className="font-semibold">{VERDICT_LABEL[test.verdict]}</b>
        {test.message ? ` · ${test.message}` : ""} <span className="text-text-3">(tested {formatRelativeTime(test.at)})</span>
      </span>
    </p>
  );
}

export function SubStatusDot({ status }: { status: RpcEndpointAddress["subscriptionStatus"] }) {
  const color = status === "subscribed" ? "bg-positive" : status === "failed" ? "bg-destructive" : "bg-warn";
  return <span aria-label={status} title={status} className={cn("inline-block size-2 shrink-0 rounded-full", color)} />;
}

/** One tracked address under an endpoint (or in the "not currently tracked" list, where `endpoint` names where it is meant to be). */
export function AddressRow({ address, endpoint }: { address: RpcEndpointAddress; endpoint?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <SubStatusDot status={address.subscriptionStatus} />
      <span className="inline-flex shrink-0 items-center gap-1">
        <span className="font-mono text-text-2">{formatAddress(address.address, 5)}</span>
        <CopyButton value={address.address} />
      </span>
      {address.label ? <span className="min-w-0 truncate text-text-3">({address.label})</span> : null}
      {endpoint ? <span className="ml-auto max-w-[45%] shrink-0 truncate pl-2 text-[11px] text-text-3">{endpoint}</span> : null}
    </div>
  );
}

/** The dashed box shown when a list has nothing in it. */
export function EmptyBox({ icon, title, children, className }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-[20px] border border-dashed border-line-3 bg-card/50 px-6 py-8 text-center", className)}>
      {icon ? <span className="flex size-[52px] items-center justify-center rounded-2xl bg-surface-3 text-primary">{icon}</span> : null}
      <b className="text-sm font-semibold text-text-2">{title}</b>
      {children}
    </div>
  );
}
