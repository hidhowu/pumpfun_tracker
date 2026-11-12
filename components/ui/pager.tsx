import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** The page numbers to show: always the first and last, the current page and its neighbours, with "…" for the gaps. */
function pageList(page: number, pages: number): (number | "gap")[] {
  const wanted = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages))
  const sorted = [...wanted].sort((a, b) => a - b)
  const out: (number | "gap")[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("gap")
    out.push(p)
  })
  return out
}

/** "Showing 1–25 of 61 traders" with previous / numbered / next page buttons. Renders nothing when everything fits on one page. */
function Pager({
  page,
  pageSize,
  total,
  noun = "traders",
  onPage,
  className,
}: {
  page: number
  pageSize: number
  total: number
  noun?: string
  onPage: (page: number) => void
  className?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-[13px] text-text-2", className)}>
      <span>
        Showing {from}–{to} of {total} {noun}
      </span>
      <nav aria-label="Pagination" className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft />
        </Button>
        {pageList(page, pages).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-text-3">
              …
            </span>
          ) : (
            <Button key={p} variant={p === page ? "secondary" : "ghost"} size="sm" aria-label={`Page ${p}`} aria-current={p === page ? "page" : undefined} onClick={() => onPage(p)} className="min-w-[30px] px-2">
              {p}
            </Button>
          )
        )}
        <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          <ChevronRight />
        </Button>
      </nav>
    </div>
  )
}

export { Pager }
