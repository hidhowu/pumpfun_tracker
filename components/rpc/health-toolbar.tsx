"use client";

import { useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, Square, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { isBlacklisted, type HealthTarget } from "@/components/rpc/parts";
import type { RpcTester } from "@/components/rpc/use-rpc-tester";

/** The red confirm used for deleting one endpoint (the consequence stays visible in the description). */
export function ConfirmDelete({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Delete",
  onConfirm,
}: {
  /** The button that opens it; leave out and pass `open` / `onOpenChange` to open it from elsewhere (a menu item). */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-neg-soft text-negative">
            <Trash2 />
          </AlertDialogMedia>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-negative font-semibold text-negative-foreground hover:bg-negative/90" onClick={() => void onConfirm()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Test all / re-test and delete the blacklisted ones - shared by the WebSocket and HTTP sections. */
export function HealthToolbar({
  endpoints,
  tester,
  onDeleteMany,
}: {
  endpoints: HealthTarget[];
  tester: RpcTester;
  onDeleteMany: (ids: string[]) => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const blacklisted = endpoints.filter(isBlacklisted);
  const busy = tester.progress !== null;

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDeleteMany(blacklisted.map((e) => e._id));
    } finally {
      setDeleting(false);
    }
  }

  if (endpoints.length === 0) return null;
  // Phone buttons are 44px tall and share the row; from md up they are the compact toolbar buttons.
  const phone = "max-md:h-11 max-md:flex-1 max-md:text-[13px]";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {busy ? (
        <>
          <span className="inline-flex items-center gap-1.5 text-sm text-text-2 tabular-nums">
            <Loader2 className="size-3.5 animate-spin" />
            Testing {tester.progress!.done}/{tester.progress!.total}…
          </span>
          <Button variant="outline" size="sm" className={`gap-1.5 ${phone}`} onClick={tester.stop}>
            <Square className="size-3.5" />
            Stop
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className={`gap-1.5 ${phone}`}
          onClick={() => tester.testMany(endpoints)}
          title="Tests every endpoint by fetching a known transaction (up to 5 tries, 1.5s apart; one success passes). A pass un-blacklists; a fail counts toward blacklisting."
        >
          <CheckCircle2 className="size-3.5" />
          Test all ({endpoints.length})
        </Button>
      )}
      {blacklisted.length > 0 && !busy && (
        <>
          <Button
            variant="outline"
            size="sm"
            className={`gap-1.5 ${phone}`}
            onClick={() => tester.testMany(blacklisted, { enableOnSuccess: true })}
            title="Tests every blacklisted endpoint and brings back the ones that now work"
          >
            <RefreshCw className="size-3.5" />
            Re-test blacklisted ({blacklisted.length})
          </Button>
          <ConfirmDelete
            trigger={
              <Button variant="outline" size="sm" className={`gap-1.5 text-negative hover:text-negative ${phone}`} disabled={deleting}>
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                Delete blacklisted ({blacklisted.length})
              </Button>
            }
            title={`Delete ${blacklisted.length} blacklisted endpoint${blacklisted.length === 1 ? "" : "s"}?`}
            description="Only blacklisted endpoints are deleted - the rest are not touched. This can't be undone."
            confirmLabel={`Delete ${blacklisted.length}`}
            onConfirm={handleDelete}
          />
        </>
      )}
    </div>
  );
}
