"use client";

import { useParams } from "next/navigation";
import { RunDashboard } from "@/components/backtest/run-dashboard";

/** One backtest's live dashboard - see components/backtest/run-dashboard.tsx. */
export default function BacktestRunPage() {
  const { id } = useParams<{ id: string }>();
  return <RunDashboard runId={id} />;
}
