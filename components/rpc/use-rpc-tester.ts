"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { testRpcEndpoint } from "@/lib/api";
import type { RpcTestResult } from "@/lib/types";
import { nameOf, type TestTarget } from "@/components/rpc/parts";

/**
 * Runs endpoint tests from the UI: one at a time (testOne) or a list two at a time (testMany), so a long
 * list finishes quickly without hammering providers - each test already makes up to 5 spaced-out requests on its own.
 * Every test is recorded server-side: a pass un-blacklists, a fail adds a strike (3 in a row blacklists).
 */
export function useRpcTester(kind: "ws" | "http", refresh: (options?: { silent?: boolean }) => Promise<void>) {
  const [testingIds, setTestingIds] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const cancelRef = useRef(false);

  const setTesting = (id: string, on: boolean) =>
    setTestingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const testOne = useCallback(
    async (target: TestTarget, options: { enableOnSuccess?: boolean } = {}) => {
      setTesting(target._id, true);
      try {
        const result = await testRpcEndpoint(kind, target._id, options);
        if (result.ok) toast.success(`${nameOf(target)}: ${result.message}`);
        else toast.error(`${nameOf(target)}: ${result.message}`);
        await refresh({ silent: true });
        return result as RpcTestResult;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Test failed");
        return null;
      } finally {
        setTesting(target._id, false);
      }
    },
    [kind, refresh]
  );

  const testMany = useCallback(
    async (targets: TestTarget[], options: { enableOnSuccess?: boolean } = {}) => {
      if (targets.length === 0 || progress) return;
      cancelRef.current = false;
      const tally = { done: 0, healthy: 0, limited: 0, failed: 0 };
      setProgress({ done: 0, total: targets.length });

      const queue = [...targets];
      async function worker() {
        while (queue.length > 0 && !cancelRef.current) {
          const target = queue.shift()!;
          setTesting(target._id, true);
          const result = await testRpcEndpoint(kind, target._id, options).catch(() => null);
          setTesting(target._id, false);
          tally.done += 1;
          if (result?.ok) tally.healthy += 1;
          else if (result?.verdict === "rate_limited") tally.limited += 1;
          else tally.failed += 1;
          setProgress({ done: tally.done, total: targets.length });
        }
      }
      await Promise.all(Array.from({ length: Math.min(2, targets.length) }, worker));

      setProgress(null);
      await refresh({ silent: true });
      const parts = [`${tally.healthy} healthy`];
      if (tally.limited > 0) parts.push(`${tally.limited} rate limited (probably need upgrading)`);
      if (tally.failed > 0) parts.push(`${tally.failed} failed`);
      const message = `Tested ${tally.done} endpoint${tally.done === 1 ? "" : "s"}${cancelRef.current ? " (stopped early)" : ""}: ${parts.join(", ")}`;
      if (tally.limited + tally.failed > 0) toast.error(message);
      else toast.success(message);
    },
    [kind, refresh, progress]
  );

  const stop = useCallback(() => {
    cancelRef.current = true;
  }, []);

  return { testingIds, progress, testOne, testMany, stop };
}

export type RpcTester = ReturnType<typeof useRpcTester>;
