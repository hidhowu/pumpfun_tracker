"use client";

import { useParams } from "next/navigation";
import { AddressDashboard } from "@/components/backtest/address-dashboard";

/** One address of a backtest - see components/backtest/address-dashboard.tsx. */
export default function BacktestAddressPage() {
  const { id, address } = useParams<{ id: string; address: string }>();
  return <AddressDashboard runId={id} address={address} />;
}
