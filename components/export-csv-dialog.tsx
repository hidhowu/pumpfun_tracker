"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Granularity = "hour" | "day" | "trade";
type Layout = "sections" | "flat";
type RangeMode = "all" | "custom";
type Tz = "local" | "utc";

/** The viewer's own UTC offset, e.g. "UTC+01:00". */
function localTzLabel() {
  const offset = -new Date().getTimezoneOffset();
  if (offset === 0) return "UTC";
  const abs = Math.abs(offset);
  return `UTC${offset > 0 ? "+" : "-"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Downloads a per-trader performance CSV for one wallet or one profile - see
 * db/exportService.js for exactly what's in it. `endpoint` is the export
 * route, e.g. /api/wallets/<id>/export.
 */
export function ExportCsvDialog({ endpoint, title, description }: { endpoint: string; title: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [layout, setLayout] = useState<Layout>("sections");
  const [rangeMode, setRangeMode] = useState<RangeMode>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tz, setTz] = useState<Tz>("local");
  const [includeEmpty, setIncludeEmpty] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    if (rangeMode === "custom" && (!from || !to)) {
      toast.error("Pick both a start and an end date");
      return;
    }
    if (rangeMode === "custom" && from > to) {
      toast.error("The start date must be on or before the end date");
      return;
    }
    const qs = new URLSearchParams({
      granularity,
      layout,
      tz: String(tz === "local" ? -new Date().getTimezoneOffset() : 0),
    });
    if (rangeMode === "custom") {
      qs.set("from", from);
      qs.set("to", to);
    }
    if (includeEmpty) qs.set("includeEmpty", "1");

    setDownloading(true);
    try {
      const res = await fetch(`${endpoint}?${qs.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "")?.[1] || "export.csv";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filename}`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Download className="size-4" /> Export CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Breakdown</Label>
            <Select value={granularity} onValueChange={(v) => setGranularity(v as Granularity)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hour">Hourly - P&amp;L, trades, win rate per hour</SelectItem>
                <SelectItem value="day">Daily - P&amp;L, trades, win rate per day</SelectItem>
                <SelectItem value="trade">Individual trades - one row per trade</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Date range</Label>
            <Select value={rangeMode} onValueChange={(v) => setRangeMode(v as RangeMode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Entire period (since each trader was added)</SelectItem>
                <SelectItem value="custom">Custom - from one day to another</SelectItem>
              </SelectContent>
            </Select>
            {rangeMode === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">From</span>
                  <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">To (inclusive)</span>
                  <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Timezone</Label>
              <Select value={tz} onValueChange={(v) => setTz(v as Tz)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">My time ({localTzLabel()})</SelectItem>
                  <SelectItem value="utc">UTC (matches app charts)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Layout</Label>
              <Select value={layout} onValueChange={(v) => setLayout(v as Layout)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sections">Summary + section per trader</SelectItem>
                  <SelectItem value="flat">One flat table (for pivots)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {granularity !== "trade" && (
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <span className="flex flex-col">
                <span className="text-sm font-medium">Include periods with no trades</span>
                <span className="text-xs text-muted-foreground">Adds a zero row for every {granularity === "hour" ? "hour" : "day"} in the range.</span>
              </span>
              <Switch checked={includeEmpty} onCheckedChange={setIncludeEmpty} />
            </label>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={handleDownload} disabled={downloading} className="gap-1.5">
            {downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Download CSV
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
