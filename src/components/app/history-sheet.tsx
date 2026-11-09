"use client"

import { History, Loader2, Trash2, Youtube, Link2, FileText } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatTime } from "@/lib/subtitles"
import type { HistoryItem } from "@/lib/api-types"

interface HistorySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: HistoryItem[]
  loading: boolean
  activeId: string | null
  onOpenVideo: (id: string) => void
  onDeleteVideo: (id: string) => void
  trigger: React.ReactNode
}

const SOURCE_ICON: Record<string, React.ReactNode> = {
  youtube: <Youtube className="h-3.5 w-3.5" />,
  direct: <Link2 className="h-3.5 w-3.5" />,
  subtitles: <FileText className="h-3.5 w-3.5" />,
}

const SOURCE_LABEL: Record<string, string> = {
  youtube: "YouTube",
  direct: "Ссылка",
  subtitles: "Субтитры",
}

export function HistorySheet({
  open,
  onOpenChange,
  items,
  loading,
  activeId,
  onOpenVideo,
  onDeleteVideo,
  trigger,
}: HistorySheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-emerald-500" />
            История переводов
          </SheetTitle>
          <SheetDescription className="text-xs">
            Переводы сохраняются — повторное открытие мгновенное
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-2">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка…
              </div>
            )}
            {!loading && items.length === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Здесь пока пусто. Переведите первое видео!
              </p>
            )}
            {!loading &&
              items.map((v) => (
                <div
                  key={v.id}
                  className={`group flex items-center gap-3 rounded-lg p-2 transition-colors ${
                    v.id === activeId ? "bg-accent" : "hover:bg-accent/60"
                  }`}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => onOpenVideo(v.id)}
                  >
                    {v.thumbnailUrl ? (
                      <img
                        src={v.thumbnailUrl}
                        alt=""
                        className="h-[45px] w-[80px] shrink-0 rounded object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-[45px] w-[80px] shrink-0 items-center justify-center rounded bg-muted">
                        {SOURCE_ICON[v.sourceType] ?? <FileText className="h-4 w-4" />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{v.title}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          {SOURCE_ICON[v.sourceType]}
                          {SOURCE_LABEL[v.sourceType] ?? v.sourceType}
                        </span>
                        {v.language && <span>· {v.language}</span>}
                        {v.durationSec > 0 && (
                          <span>· {formatTime(v.durationSec)}</span>
                        )}
                        <span>
                          ·{" "}
                          {new Date(v.createdAt).toLocaleDateString("ru-RU", {
                            day: "numeric",
                            month: "short",
                          })}
                        </span>
                      </p>
                      {v.translatedCount < v.segmentCount && (
                        <Badge variant="outline" className="mt-1 h-4 px-1.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                          переведено {v.translatedCount} из {v.segmentCount}
                        </Badge>
                      )}
                    </div>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteVideo(v.id)
                    }}
                    aria-label={`Удалить «${v.title}»`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
