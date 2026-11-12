"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Keyboard } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { DialogHead } from "@/components/ui/dialog-parts";
import { ALL_PAGES } from "@/components/shell/nav";

/** The little keycap used for shortcuts. */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line-2 bg-surface-2 px-1.5 font-mono text-[11px] font-medium text-text-2">{children}</kbd>;
}

const CHORD_WINDOW_MS = 1200;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Keyboard shortcuts for the whole app: Cmd/Ctrl+K opens the jump menu, "?" lists the shortcuts, and "G" then a letter goes to a page
 * (G then B = Backtest). Nothing fires while you type in a field or while a dialog is open.
 */
export function ShortcutListener({ onJump, onHelp }: { onJump: () => void; onHelp: () => void }) {
  const router = useRouter();
  const chordAt = useRef(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onJump();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      if (e.key === "?") {
        e.preventDefault();
        onHelp();
        return;
      }
      const key = e.key.toUpperCase();
      if (key === "G" && !e.shiftKey) {
        chordAt.current = Date.now();
        return;
      }
      if (chordAt.current && Date.now() - chordAt.current < CHORD_WINDOW_MS) {
        chordAt.current = 0;
        const page = ALL_PAGES.find((p) => p.key === key);
        if (page) {
          e.preventDefault();
          router.push(page.href);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, onJump, onHelp]);

  return null;
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHead icon={<Keyboard className="size-5" />} title="Keyboard shortcuts" help="Shortcuts do nothing while you are typing in a field." />
        <div className="flex flex-col gap-1">
          <div className="flex min-h-9 items-center justify-between gap-3 text-[13px]">
            <span>Jump to a page, trader or wallet</span>
            <span className="flex gap-1">
              <Kbd>⌘ / Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </div>
          <div className="flex min-h-9 items-center justify-between gap-3 text-[13px]">
            <span>Show these shortcuts</span>
            <Kbd>?</Kbd>
          </div>
          <b className="mt-3 text-xs font-semibold tracking-wide text-text-3 uppercase">Go to</b>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {ALL_PAGES.map((p) => (
              <div key={p.href} className="flex min-h-9 items-center justify-between gap-3 text-[13px]">
                <span className="truncate">{p.label}</span>
                <span className="flex shrink-0 gap-1">
                  <Kbd>G</Kbd>
                  <Kbd>{p.key}</Kbd>
                </span>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
