"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/** The 24px round icon at the start of a toast (the design's "ti"), tinted by the toast's tone. */
function ToastIcon({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`flex size-6 items-center justify-center rounded-full ${tone}`}>{children}</span>
}

// This app is always dark (no theme toggle), so the toaster is hardcoded to
// match rather than depending on next-themes (which isn't installed here).
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      className="toaster group"
      icons={{
        success: (
          <ToastIcon tone="bg-pos-soft text-positive">
            <CircleCheckIcon className="size-4" />
          </ToastIcon>
        ),
        info: (
          <ToastIcon tone="bg-info-soft text-info">
            <InfoIcon className="size-4" />
          </ToastIcon>
        ),
        warning: (
          <ToastIcon tone="bg-warn-soft text-warn">
            <TriangleAlertIcon className="size-4" />
          </ToastIcon>
        ),
        error: (
          <ToastIcon tone="bg-neg-soft text-destructive">
            <OctagonXIcon className="size-4" />
          </ToastIcon>
        ),
        loading: (
          <ToastIcon tone="bg-surface-4 text-text-2">
            <Loader2Icon className="size-4 animate-spin" />
          </ToastIcon>
        ),
      }}
      style={
        {
          "--normal-bg": "var(--surface-3)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--line-3)",
          "--border-radius": "16px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !gap-3 !px-3.5 !py-3 !text-[13px] !font-semibold !shadow-[0_12px_32px_rgba(0,0,0,0.5)]",
          description: "!font-normal !text-text-2",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
