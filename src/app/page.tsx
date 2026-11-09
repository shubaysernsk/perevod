"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTheme } from "next-themes"
import {
  Captions,
  Languages,
  Loader2,
  Moon,
  Sun,
  Volume2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useDubbing } from "@/hooks/use-dubbing"
import { formatTime } from "@/lib/subtitles"
import type {
  PrepareResponse,
  PrepareNeedsManualResponse,
  SegmentDTO,
  TranslateBatchResponse,
  VideoDTO,
  HistoryItem,
} from "@/lib/api-types"

import {
  SourceForm,
  ManualPasteCard,
  type PrepareRequest,
} from "@/components/app/source-form"
import {
  VideoStage,
  findSegmentIndex,
  type PlayerHandle,
} from "@/components/app/video-stage"
import { TranscriptPanel } from "@/components/app/transcript-panel"
import { HistorySheet } from "@/components/app/history-sheet"
import { InstallHint } from "@/components/app/install-hint"

type Phase = "input" | "preparing" | "manual" | "watch"

const SOURCE_LABEL: Record<string, string> = {
  youtube: "YouTube",
  direct: "Прямая ссылка",
  subtitles: "Файл субтитров",
}

export default function Home() {
  const { toast } = useToast()
  const dub = useDubbing()

  const [phase, setPhase] = useState<Phase>("input")
  const [video, setVideo] = useState<VideoDTO | null>(null)
  const [segments, setSegments] = useState<SegmentDTO[]>([])
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [duration, setDuration] = useState(0)
  const [translating, setTranslating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [manualInfo, setManualInfo] = useState<PrepareNeedsManualResponse | null>(null)
  const [manualUrl, setManualUrl] = useState("")

  // элементы управления
  const [subtitlesOn, setSubtitlesOn] = useState(true)
  const [subtitleSize, setSubtitleSize] = useState<"sm" | "md" | "lg">("md")
  const [showOriginal, setShowOriginal] = useState(false)
  const [follow, setFollow] = useState(true)
  const [dubbingOn, setDubbingOn] = useState(false)

  // история
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const playerRef = useRef<PlayerHandle>(null)
  const segmentsRef = useRef<SegmentDTO[]>([])
  segmentsRef.current = segments
  const currentIdxRef = useRef(-1)
  const dubbingRef = useRef(false)
  dubbingRef.current = dubbingOn
  const dubState = useRef({ lastIdx: -1, prevT: 0, prevPlaying: false })
  const translatingRef = useRef(false)

  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  /* ---------- тик плеера: текущая реплика + озвучка ---------- */

  const handleTime = useCallback(
    (t: number, playing: boolean) => {
      const segs = segmentsRef.current
      const idx = findSegmentIndex(segs, t)
      if (idx !== currentIdxRef.current) {
        currentIdxRef.current = idx
        setCurrentIdx(idx)
      }

      // озвучка (Web Speech API)
      const st = dubState.current
      if (dubbingRef.current && playing && idx >= 0 && idx !== st.lastIdx) {
        st.lastIdx = idx
        const seg = segs[idx]
        const jumped = Math.abs(t - st.prevT) > 1.5
        if (!jumped && seg?.translated) {
          dub.speak(seg.translated, seg.endSec - seg.startSec)
        }
      }
      if (st.prevPlaying && !playing) {
        dub.cancel()
        st.lastIdx = -1
      }
      st.prevT = t
      st.prevPlaying = playing
    },
    [dub]
  )

  /* ---------- приглушение при озвучке ---------- */

  const dubCancelRef = useRef(dub.cancel)
  dubCancelRef.current = dub.cancel

  useEffect(() => {
    if (!video) return
    playerRef.current?.setVolume(dubbingOn ? 0.12 : 1)
    if (!dubbingOn) dubCancelRef.current()
  }, [dubbingOn, video])

  /* ---------- перевод пакетами ---------- */

  const runTranslation = useCallback(
    async (videoId: string, from: number, total: number) => {
      if (translatingRef.current) return
      translatingRef.current = true
      setTranslating(true)
      setProgress({ done: from, total })
      let cursor = from
      try {
        for (let guard = 0; guard < 400; guard++) {
          const res = await fetch("/api/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId, from: cursor }),
          })
          const data = (await res.json()) as TranslateBatchResponse & {
            error?: string
          }
          if (!res.ok) throw new Error(data.error ?? "Ошибка перевода")

          setSegments((prev) =>
            prev.map((s) => {
              const found = data.segments.find((x) => x.idx === s.idx)
              return found ? { ...s, translated: found.translated } : s
            })
          )
          if (data.language) {
            setVideo((v) => (v ? { ...v, language: data.language } : v))
          }
          setProgress({ done: data.translatedCount, total: data.segmentCount })
          cursor += data.segments.length
          if (data.done || data.segments.length === 0) break
        }
        toast({
          title: "Перевод готов",
          description: "Субтитры синхронизированы с видео",
        })
      } catch (e) {
        toast({
          title: "Не удалось завершить перевод",
          description: e instanceof Error ? e.message : "Повторите попытку",
          variant: "destructive",
        })
      } finally {
        translatingRef.current = false
        setTranslating(false)
      }
    },
    [toast]
  )

  /* ---------- подготовка видео ---------- */

  const doPrepare = useCallback(
    async (req: PrepareRequest) => {
      setPhase("preparing")
      try {
        const res = await fetch("/api/prepare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        })
        const data = (await res.json()) as
          | PrepareResponse
          | PrepareNeedsManualResponse
          | { error: string }

        if ("error" in data) {
          throw new Error(data.error)
        }

        if ("needsManual" in data) {
          setManualInfo(data)
          setManualUrl(req.url ?? "")
          setPhase("manual")
          return
        }

        // сброс состояния воспроизведения
        currentIdxRef.current = -1
        dubState.current = { lastIdx: -1, prevT: 0, prevPlaying: false }
        setCurrentIdx(-1)
        setDuration(data.video.durationSec)
        setVideo(data.video)
        setSegments(data.segments)
        setPhase("watch")
        setProgress({ done: 0, total: data.video.segmentCount })
        void runTranslation(data.video.id, 0, data.video.segmentCount)
      } catch (e) {
        toast({
          title: "Не удалось начать перевод",
          description: e instanceof Error ? e.message : "Проверьте данные",
          variant: "destructive",
        })
        setPhase("input")
      }
    },
    [runTranslation, toast]
  )

  const handleDemo = useCallback(async () => {
    try {
      const res = await fetch("/demo/demo.srt")
      const content = await res.text()
      await doPrepare({
        mode: "subtitles",
        url: "/demo/demo.mp4",
        subtitleContent: content,
        subtitleFormat: "srt",
        title: "Демо: как работает перевод видео",
      })
    } catch {
      toast({
        title: "Демо недоступно",
        description: "Не удалось загрузить демо-файл",
        variant: "destructive",
      })
    }
  }, [doPrepare, toast])

  const handleManualSubmit = useCallback(
    async (pasted: string) => {
      await doPrepare({
        mode: "youtube",
        url: manualUrl,
        pastedTranscript: pasted,
      })
    },
    [doPrepare, manualUrl]
  )

  /* ---------- история ---------- */

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await fetch("/api/videos")
      const data = (await res.json()) as { items: HistoryItem[] }
      setHistoryItems(data.items ?? [])
    } catch {
      /* тихо — история не критична */
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const openHistoryVideo = useCallback(
    async (id: string) => {
      setHistoryOpen(false)
      setPhase("preparing")
      try {
        const res = await fetch(`/api/videos/${id}`)
        const data = (await res.json()) as PrepareResponse & { error?: string }
        if (!res.ok) throw new Error(data.error ?? "Не найдено")
        currentIdxRef.current = -1
        dubState.current = { lastIdx: -1, prevT: 0, prevPlaying: false }
        setCurrentIdx(-1)
        setDuration(data.video.durationSec)
        setVideo(data.video)
        setSegments(data.segments)
        setPhase("watch")
        setProgress({
          done: data.video.translatedCount,
          total: data.video.segmentCount,
        })
        if (data.video.translatedCount < data.video.segmentCount) {
          void runTranslation(
            data.video.id,
            data.video.translatedCount,
            data.video.segmentCount
          )
        }
      } catch (e) {
        toast({
          title: "Не удалось открыть видео",
          description: e instanceof Error ? e.message : "Попробуйте позже",
          variant: "destructive",
        })
        setPhase("input")
      }
    },
    [runTranslation, toast]
  )

  const deleteHistoryVideo = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/videos/${id}`, { method: "DELETE" })
        setHistoryItems((prev) => prev.filter((v) => v.id !== id))
      } catch {
        toast({
          title: "Не удалось удалить",
          variant: "destructive",
        })
      }
    },
    [toast]
  )

  /* ---------- вспомогательные ---------- */

  const seekTo = useCallback((t: number) => {
    playerRef.current?.seek(t)
    // после перехода озвучка начнётся со следующей реплики
    dubState.current.lastIdx = -1
    dub.cancel()
  }, [dub])

  const resetToInput = useCallback(() => {
    dub.cancel()
    setPhase("input")
    setVideo(null)
    setSegments([])
    setDubbingOn(false)
  }, [dub])

  const busy = phase === "preparing"

  const translatedDone =
    video !== null && progress.done >= progress.total && progress.total > 0

  /* ---------- рендер ---------- */

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur pt-safe pl-safe pr-safe">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4">
          <button
            className="flex items-center gap-2.5"
            onClick={resetToInput}
            aria-label="На главную"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Languages className="h-4.5 w-4.5" />
            </span>
            <span className="text-base font-bold tracking-tight">
              ВидеоПеревод
            </span>
            <Badge variant="outline" className="hidden font-normal sm:inline-flex">
              бета
            </Badge>
          </button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Переключить тему"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {mounted && theme === "dark" ? (
                <Sun className="h-4.5 w-4.5" />
              ) : (
                <Moon className="h-4.5 w-4.5" />
              )}
            </Button>
            <HistorySheet
              open={historyOpen}
              onOpenChange={(o) => {
                setHistoryOpen(o)
                if (o) void loadHistory()
              }}
              items={historyItems}
              loading={historyLoading}
              activeId={video?.id ?? null}
              onOpenVideo={(id) => void openHistoryVideo(id)}
              onDeleteVideo={(id) => void deleteHistoryVideo(id)}
              trigger={
                <Button variant="outline" size="sm" className="gap-2">
                  <Languages className="hidden h-4 w-4 sm:inline" />
                  История
                  {historyItems.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-0.5 h-5 px-1.5 text-[11px]"
                    >
                      {historyItems.length}
                    </Badge>
                  )}
                </Button>
              }
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">
        {phase === "input" && (
          <SourceForm
            busy={false}
            onPrepare={(req) => void doPrepare(req)}
            onDemo={() => void handleDemo()}
          />
        )}

        {phase === "input" && (
          <div className="mt-6">
            <InstallHint />
          </div>
        )}

        {phase === "preparing" && (
          <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
            <p className="text-sm">Готовим видео и субтитры…</p>
          </div>
        )}

        {phase === "manual" && manualInfo && (
          <ManualPasteCard
            info={manualInfo}
            url={manualUrl}
            busy={false}
            onSubmit={(pasted) => void handleManualSubmit(pasted)}
            onCancel={() => setPhase("input")}
          />
        )}

        {phase === "watch" && video && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
            {/* левая колонка */}
            <div className="min-w-0 space-y-4">
              {translating && progress.total > 0 && (
                <Card>
                  <CardContent className="flex items-center gap-4 p-4">
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-emerald-500" />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <p className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">Перевод реплик…</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {progress.done} / {progress.total}
                        </span>
                      </p>
                      <Progress
                        value={(progress.done / progress.total) * 100}
                        className="h-1.5"
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card className="overflow-hidden p-0">
                <VideoStage
                  ref={playerRef}
                  video={video}
                  segments={segments}
                  subtitlesOn={subtitlesOn}
                  subtitleSize={subtitleSize}
                  showOriginal={showOriginal}
                  translating={translating}
                  onTime={handleTime}
                  onDuration={(d) => setDuration(d)}
                />
              </Card>

              <Card>
                <CardContent className="space-y-4 p-4 sm:p-5">
                  {/* метаданные */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h1 className="truncate text-base font-semibold sm:text-lg">
                        {video.title}
                      </h1>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {video.author ?? SOURCE_LABEL[video.sourceType]}
                        {duration > 0 && ` · ${formatTime(duration)}`}
                        {` · ${video.segmentCount} реплик`}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="font-normal">
                        {SOURCE_LABEL[video.sourceType]}
                      </Badge>
                      {video.language && (
                        <Badge variant="secondary" className="font-normal">
                          {video.language}
                        </Badge>
                      )}
                      {translatedDone && !translating && (
                        <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
                          переведено
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* управление */}
                  <div className="grid gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-2">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label
                          htmlFor="subs-switch"
                          className="flex items-center gap-2 text-sm"
                        >
                          <Captions className="h-4 w-4 text-emerald-500" />
                          Субтитры
                        </Label>
                        <Switch
                          id="subs-switch"
                          checked={subtitlesOn}
                          onCheckedChange={setSubtitlesOn}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <Label
                          htmlFor="orig-switch"
                          className="flex items-center gap-2 text-sm"
                        >
                          <Languages className="h-4 w-4 text-muted-foreground" />
                          Оригинал под переводом
                        </Label>
                        <Switch
                          id="orig-switch"
                          checked={showOriginal}
                          onCheckedChange={setShowOriginal}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm text-muted-foreground">
                          Размер текста
                        </span>
                        <div className="flex overflow-hidden rounded-md border">
                          {(
                            [
                              ["sm", "A−", "Мелкий"],
                              ["md", "A", "Средний"],
                              ["lg", "A+", "Крупный"],
                            ] as const
                          ).map(([sz, label, title]) => (
                            <button
                              key={sz}
                              title={title}
                              onClick={() => setSubtitleSize(sz)}
                              className={`h-8 w-10 text-sm font-medium transition-colors ${
                                subtitleSize === sz
                                  ? "bg-primary text-primary-foreground"
                                  : "text-muted-foreground hover:bg-accent"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <Label
                          htmlFor="dub-switch"
                          className="flex items-center gap-2 text-sm"
                        >
                          <Volume2 className="h-4 w-4 text-emerald-500" />
                          Озвучка
                          <Badge
                            variant="outline"
                            className="h-4 px-1 text-[10px] font-normal"
                          >
                            бета
                          </Badge>
                        </Label>
                        <Switch
                          id="dub-switch"
                          checked={dubbingOn}
                          disabled={!dub.supported}
                          onCheckedChange={setDubbingOn}
                        />
                      </div>
                      {dub.supported ? (
                        <div className="space-y-1.5">
                          <span className="text-sm text-muted-foreground">
                            Голос
                          </span>
                          <Select
                            value={dub.voiceURI ?? undefined}
                            onValueChange={dub.setVoiceURI}
                          >
                            <SelectTrigger className="h-8 w-full">
                              <SelectValue placeholder="Голос браузера" />
                            </SelectTrigger>
                            <SelectContent>
                              {dub.voices.map((v) => (
                                <SelectItem key={v.voiceURI} value={v.voiceURI}>
                                  {v.name} ({v.lang})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            Оригинальная дорожка приглушается, перевод читается
                            голосом браузера.
                            {!dub.russianAvailable &&
                              " Русский голос в системе не найден — качество не гарантировано."}
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Браузер не поддерживает синтез речи.
                        </p>
                      )}
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={resetToInput}
                        >
                          Новое видео
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* правая колонка: транскрипт */}
            <Card className="overflow-hidden p-0">
              <div className="h-[60dvh] lg:h-[calc(100dvh-9.5rem)]">
                <TranscriptPanel
                  segments={segments}
                  currentIdx={currentIdx}
                  showOriginal={showOriginal}
                  follow={follow}
                  onFollowChange={setFollow}
                  onSeek={seekTo}
                />
              </div>
            </Card>
          </div>
        )}
      </main>

      <footer className="mt-auto border-t pb-safe">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-1 px-4 py-4 text-xs text-muted-foreground sm:flex-row">
          <p>Перевод — языковая модель GLM · Озвучка — голоса браузера</p>
          <p>Субтитры обрабатываются на сервере приложения</p>
        </div>
      </footer>
    </div>
  )
}
