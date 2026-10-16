"use client";

import { useParams } from "next/navigation";
import { ViewDashboard } from "@/components/backtest/view-dashboard";

/** One combined view of a backtest - see components/backtest/view-dashboard.tsx. */
export default function BacktestViewPage() {
  const { id, viewId } = useParams<{ id: string; viewId: string }>();
  return <ViewDashboard runId={id} viewId={viewId} />;
}
