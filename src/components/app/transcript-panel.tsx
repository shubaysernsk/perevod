"use client"

import { memo, useEffect, useRef } from "react"
import { ListVideo } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { formatTime } from "@/lib/subtitles"
import type { SegmentDTO } from "@/lib/api-types"

interface TranscriptPanelProps {
  segments: SegmentDTO[]
  currentIdx: number
  showOriginal: boolean
  follow: boolean
  onFollowChange: (v: boolean) => void
  onSeek: (t: number) => void
}

interface RowProps {
  seg: SegmentDTO
  isCurrent: boolean
  showOriginal: boolean
  onSeek: (t: number) => void
}

const TranscriptRow = memo(function TranscriptRow({
  seg,
  isCurrent,
  showOriginal,
  onSeek,
}: Omit<RowProps, "register">) {
  return (
    <button
      data-idx={seg.idx}
      onClick={() => onSeek(seg.startSec + 0.01)}
      className={`w-full rounded-md border-l-2 px-3 py-2 text-left transition-colors ${
        isCurrent
          ? "border-emerald-500 bg-emerald-500/10"
          : "border-transparent hover:bg-accent/60"
      }`}
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: "72px",
      }}
    >
      <span
        className={`font-mono text-[11px] tabular-nums ${
          isCurrent ? "text-emerald-400" : "text-muted-foreground"
        }`}
      >
        {formatTime(seg.startSec)}
      </span>
      {seg.translated ? (
        <>
          <p
            className={`mt-0.5 text-sm leading-snug ${
              isCurrent ? "font-medium text-foreground" : "text-foreground/85"
            }`}
          >
            {seg.translated}
          </p>
          {showOriginal && (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              {seg.text}
            </p>
          )}
        </>
      ) : (
        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
          {seg.text}
        </p>
      )}
    </button>
  )
})

export function TranscriptPanel({
  segments,
  currentIdx,
  showOriginal,
  follow,
  onFollowChange,
  onSeek,
}: TranscriptPanelProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!follow || currentIdx < 0) return
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-idx="${currentIdx}"]`
    )
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" })
    }
  }, [currentIdx, follow])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <ListVideo className="h-4 w-4 text-emerald-500" />
          <h2 className="text-sm font-semibold">Транскрипт</h2>
          <Badge variant="secondary" className="font-normal">
            {segments.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor="follow-switch"
            className="hidden text-xs text-muted-foreground sm:block"
          >
            Автопрокрутка
          </Label>
          <Switch
            id="follow-switch"
            checked={follow}
            onCheckedChange={onFollowChange}
            aria-label="Автопрокрутка к текущей реплике"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={listRef} className="flex flex-col gap-0.5 p-2">
          {segments.length === 0 && (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Нет реплик
            </p>
          )}
          {segments.map((s, i) => (
            <TranscriptRow
              key={s.idx}
              seg={s}
              isCurrent={i === currentIdx}
              showOriginal={showOriginal}
              onSeek={onSeek}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
