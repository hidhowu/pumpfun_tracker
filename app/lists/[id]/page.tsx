"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, LineChart, ListChecks, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ListPerformanceTab } from "@/components/lists/list-performance-tab";
import { WalletTradersDailyTable } from "@/components/wallets/wallet-traders-daily-table";
import { getListTradersDaily, listTraderLists } from "@/lib/api";
import { useProfile } from "@/lib/profile-context";

/** One list's combined performance on the currently selected profile - chart + per-trader breakdown. */
export default function ListDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { currentProfileId, currentProfile } = useProfile();
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    listTraderLists()
      .then(({ lists }) => setName(lists.find((l) => l._id === id)?.name ?? ""))
      .catch(() => setName(""));
  }, [id]);

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" asChild className="w-fit -ml-2 text-muted-foreground">
        <Link href="/lists">
          <ArrowLeft className="size-4" /> Back to lists
        </Link>
      </Button>

      <div className="flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <ListChecks className="size-4.5" />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-lg font-semibold tracking-tight">{name === null ? "…" : name || "List not found"}</span>
          {currentProfile && <span className="text-xs text-muted-foreground">Performance on profile &quot;{currentProfile.name}&quot;</span>}
        </div>
      </div>

      {currentProfileId && name !== "" ? (
        <Tabs defaultValue="performance" className="flex flex-col gap-4">
          <TabsList>
            <TabsTrigger value="performance" className="gap-1.5">
              <LineChart className="size-3.5" /> Performance
            </TabsTrigger>
            <TabsTrigger value="traders" className="gap-1.5">
              <Users className="size-3.5" /> Traders Performance
            </TabsTrigger>
          </TabsList>

          <TabsContent value="performance">
            <ListPerformanceTab key={currentProfileId} listId={id} profileId={currentProfileId} />
          </TabsContent>

          <TabsContent value="traders">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base">Traders in this list</CardTitle>
                <CardDescription>
                  Realized P&amp;L per day for the last 7 days, plus each trader&apos;s overall total on this profile.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WalletTradersDailyTable
                  key={currentProfileId}
                  load={() => getListTradersDaily(id, currentProfileId)}
                  emptyMessage="No traders in this list yet - tag some with the list button on the Traders page."
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
