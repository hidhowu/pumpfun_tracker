import * as React from "react"
import { cn } from "cn"
import { HelpTip } from "@/components/ui/help-tip"

/** The "settings list": a rounded box of rows, label on the left and a compact control on the right. */
function SettingsList({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="settings-list"
      className={cn(
        "flex flex-col rounded-xl border border-line bg-card px-3.5 [&>*+*]:border-t [&>*+*]:border-line",
        className
      )}
      {...props}
    />
  )
}

function SettingsRow({
  label,
  help,
  htmlFor,
  children,
  className,
}: {
  label: React.ReactNode
  /** One line, shown behind a "?" next to the label. */
  help?: React.ReactNode
  htmlFor?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "flex min-h-11 items-center justify-between gap-4 py-[7px] [&_input]:h-9",
        className
      )}
    >
      <label
        htmlFor={htmlFor}
        className="min-w-0 flex-1 text-[13px] leading-[18px] text-foreground"
      >
        {label}
        {help ? <HelpTip>{help}</HelpTip> : null}
      </label>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export { SettingsList, SettingsRow }
