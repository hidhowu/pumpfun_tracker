import * as React from "react"
import { cn } from "cn"

/**
 * A small "?" that opens a one-line explanation on click. Replaces paragraph descriptions: the page stays clean and the
 * explanation is one tap away. Uses <details> so it needs no client JS and works on touch.
 */
function HelpTip({
  children,
  className,
  label = "What is this?",
  tabIndex,
}: {
  children: React.ReactNode
  className?: string
  label?: string
  tabIndex?: number
}) {
  return (
    <details
      data-slot="help-tip"
      className={cn(
        "group/help relative ml-1.5 inline-block align-middle leading-none font-normal tracking-normal normal-case",
        className
      )}
    >
      <summary
        aria-label={label}
        tabIndex={tabIndex}
        className="relative size-4 cursor-pointer list-none rounded-full border border-line-3 text-center text-[10px] leading-[14px] font-semibold text-text-3 select-none after:absolute after:-inset-3.5 after:content-[''] hover:border-text-3 hover:text-foreground group-open/help:border-primary group-open/help:bg-primary group-open/help:text-primary-foreground [&::-webkit-details-marker]:hidden"
      >
        ?
      </summary>
      <span
        role="note"
        className="absolute top-[23px] left-[-10px] z-40 box-border w-max max-w-[250px] rounded-lg bg-[#e9f1ea] px-2.5 py-[7px] text-left text-xs leading-4 font-medium whitespace-normal text-[#0a120c] shadow-[0_12px_32px_rgba(0,0,0,0.5)]"
      >
        {children}
      </span>
    </details>
  )
}

export { HelpTip }
