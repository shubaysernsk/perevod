"use client"

import { useRef, useState } from "react"
import {
  ArrowRight,
  Captions,
  FileText,
  Film,
  Link2,
  Loader2,
  PlayCircle,
  Sparkles,
  Volume2,
  Youtube,
} from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { PrepareNeedsManualResponse } from "@/lib/api-types"

export interface PrepareRequest {
  mode: "youtube" | "direct" | "subtitles"
  url?: string
  subtitleContent?: string
  subtitleFormat?: "srt" | "vtt"
  pastedTranscript?: string
  title?: string
}

interface SourceFormProps {
  busy: boolean
  onPrepare: (req: PrepareRequest) => void
  onDemo: () => void
}

/* ---------- чтение файла субтитров ---------- */

async function readSubtitleFile(
  file: File
): Promise<{ content: string; format: "srt" | "vtt" } | null> {
  if (file.size > 5 * 1024 * 1024) return null
  const content = await file.text()
  const format = file.name.toLowerCase().endsWith(".vtt")
    ? "vtt"
    : file.name.toLowerCase().endsWith(".srt")
      ? "srt"
      : content.trimStart().startsWith("WEBVTT")
        ? "vtt"
        : "srt"
  return { content, format }
}

/* ---------- зона выбора файла ---------- */

function FileZone({
  label,
  file,
  onFile,
  optional,
}: {
  label: string
  file: File | null
  onFile: (f: File | null) => void
  optional?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {label}
        {optional && <span className="ml-1 opacity-70">(необязательно)</span>}
      </Label>
      <div
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files?.[0]
          if (f) onFile(f)
        }}
        className={`flex min-h-[64px] cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-3 text-sm transition-colors ${
          drag
            ? "border-emerald-500 bg-emerald-500/10"
            : file
              ? "border-emerald-600/50 bg-emerald-500/5 text-foreground"
              : "text-muted-foreground hover:border-foreground/30 hover:bg-accent/40"
        }`}
      >
        <FileText className="h-4 w-4 shrink-0" />
        {file ? (
          <span className="truncate">
            {file.name} · {(file.size / 1024).toFixed(0)} КБ
          </span>
        ) : (
          <span className="text-center">
            Перетащите файл .srt / .vtt или нажмите для выбора
          </span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".srt,.vtt,text/vtt,application/x-subrip"
          className="hidden"
          onChange={(e) => {
            onFile(e.target.files?.[0] ?? null)
            e.target.value = ""
          }}
        />
      </div>
    </div>
  )
}

/* ---------- главная форма ---------- */

export function SourceForm({ busy, onPrepare, onDemo }: SourceFormProps) {
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const [youtubeFile, setYoutubeFile] = useState<File | null>(null)

  const [directUrl, setDirectUrl] = useState("")
  const [directFile, setDirectFile] = useState<File | null>(null)
  const [directPasteOpen, setDirectPasteOpen] = useState(false)
  const [directPaste, setDirectPaste] = useState("")

  const [subFile, setSubFile] = useState<File | null>(null)
  const [subUrl, setSubUrl] = useState("")

  const submit = async (mode: PrepareRequest["mode"]) => {
    if (busy) return
    if (mode === "youtube") {
      const req: PrepareRequest = { mode, url: youtubeUrl }
      if (youtubeFile) {
        const parsed = await readSubtitleFile(youtubeFile)
        if (parsed) {
          req.subtitleContent = parsed.content
          req.subtitleFormat = parsed.format
        }
      }
      onPrepare(req)
    } else if (mode === "direct") {
      const req: PrepareRequest = { mode, url: directUrl }
      if (directFile) {
        const parsed = await readSubtitleFile(directFile)
        if (parsed) {
          req.subtitleContent = parsed.content
          req.subtitleFormat = parsed.format
        }
      } else if (directPaste.trim()) {
        req.pastedTranscript = directPaste
      }
      onPrepare(req)
    } else {
      const req: PrepareRequest = { mode: "subtitles", url: subUrl }
      if (subFile) {
        const parsed = await readSubtitleFile(subFile)
        if (parsed) {
          req.subtitleContent = parsed.content
          req.subtitleFormat = parsed.format
        }
      }
      onPrepare(req)
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <div className="space-y-3 text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Перевод видео на русский{" "}
          <span className="text-emerald-500">за один клик</span>
        </h1>
        <p className="mx-auto max-w-xl text-muted-foreground">
          Вставьте ссылку — вся дорожка субтитров переводится целиком и
          появляется в видео синхронно с речью. Смотрите с субтитрами и
          озвучкой.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-emerald-500" />
            Мгновенный перевод всей дорожки
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <Captions className="h-3.5 w-3.5 text-emerald-500" />
            Синхронные субтитры + транскрипт
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <Volume2 className="h-3.5 w-3.5 text-emerald-500" />
            Озвучка перевода (бета)
          </span>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <Tabs defaultValue="youtube">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="youtube" className="gap-1.5">
                <Youtube className="h-4 w-4" />
                <span className="hidden sm:inline">YouTube</span>
              </TabsTrigger>
              <TabsTrigger value="direct" className="gap-1.5">
                <Link2 className="h-4 w-4" />
                <span className="hidden sm:inline">Прямая ссылка</span>
              </TabsTrigger>
              <TabsTrigger value="subtitles" className="gap-1.5">
                <FileText className="h-4 w-4" />
                <span className="hidden sm:inline">Файл субтитров</span>
              </TabsTrigger>
            </TabsList>

            {/* YouTube */}
            <TabsContent value="youtube" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="yt-url" className="text-xs text-muted-foreground">
                  Ссылка на видео YouTube
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="yt-url"
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit("youtube")}
                    inputMode="url"
                  />
                  <Button
                    onClick={() => submit("youtube")}
                    disabled={busy || !youtubeUrl.trim()}
                    className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Перевести
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Субтитры видео подтягиваются автоматически. Если YouTube
                ограничит доступ — приложение попросит вставить расшифровку
                вручную (займёт полминуты).
              </p>
              <Collapsible>
                <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                  Приложить свой файл субтитров к этому видео
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <FileZone
                    label="Файл субтитров для YouTube-видео"
                    file={youtubeFile}
                    onFile={setYoutubeFile}
                    optional
                  />
                </CollapsibleContent>
              </Collapsible>
            </TabsContent>

            {/* Прямая ссылка */}
            <TabsContent value="direct" className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="direct-url" className="text-xs text-muted-foreground">
                  Прямая ссылка на видеофайл
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="direct-url"
                    placeholder="https://example.com/video.mp4 или …/stream.m3u8"
                    value={directUrl}
                    onChange={(e) => setDirectUrl(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && submit("direct")}
                    inputMode="url"
                  />
                  <Button
                    onClick={() => submit("direct")}
                    disabled={busy || !directUrl.trim()}
                    className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Перевести
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <FileZone
                label="Субтитры (SRT/VTT) для этого видео"
                file={directFile}
                onFile={setDirectFile}
              />
              {!directFile && (
                <Collapsible open={directPasteOpen} onOpenChange={setDirectPasteOpen}>
                  <CollapsibleTrigger className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                    …или вставить транскрипт текстом
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <Textarea
                      placeholder={"0:01\nПервая реплика\n0:05\nВторая реплика"}
                      value={directPaste}
                      onChange={(e) => setDirectPaste(e.target.value)}
                      className="min-h-32 font-mono text-xs"
                    />
                  </CollapsibleContent>
                </Collapsible>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                Поддерживаются MP4, WebM и HLS-потоки (m3u8). Для перевода
                нужна дорожка субтитров — файл или вставленный текст.
              </p>
            </TabsContent>

            {/* Файл субтитров */}
            <TabsContent value="subtitles" className="mt-4 space-y-3">
              <FileZone
                label="Файл субтитров (SRT/VTT)"
                file={subFile}
                onFile={setSubFile}
              />
              <div className="space-y-1.5">
                <Label htmlFor="sub-url" className="text-xs text-muted-foreground">
                  Ссылка на видео для синхронного показа
                  <span className="ml-1 opacity-70">(необязательно)</span>
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="sub-url"
                    placeholder="https://…/video.mp4 или ссылка YouTube"
                    value={subUrl}
                    onChange={(e) => setSubUrl(e.target.value)}
                    inputMode="url"
                  />
                  <Button
                    onClick={() => submit("subtitles")}
                    disabled={busy || !subFile}
                    className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-500"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        Перевести
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Можно перевести субтитры и без видео — текст будет доступен в
                панели транскрипта.
              </p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="flex flex-col items-center gap-2">
        <p className="text-xs text-muted-foreground">Или посмотрите на примере:</p>
        <Button variant="outline" onClick={onDemo} disabled={busy} className="gap-2">
          <PlayCircle className="h-4 w-4 text-emerald-500" />
          Попробовать на демо-видео
        </Button>
      </div>
    </section>
  )
}

/* ---------- карточка ручной вставки транскрипта ---------- */

interface ManualPasteCardProps {
  info: PrepareNeedsManualResponse
  url: string
  busy: boolean
  onSubmit: (pasted: string) => void
  onCancel: () => void
}

export function ManualPasteCard({
  info,
  url,
  busy,
  onSubmit,
  onCancel,
}: ManualPasteCardProps) {
  const [text, setText] = useState("")
  return (
    <section className="mx-auto w-full max-w-3xl space-y-4">
      <Card className="border-amber-500/40">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex gap-4">
            {info.meta.thumbnailUrl && (
              <img
                src={info.meta.thumbnailUrl}
                alt=""
                className="hidden h-[76px] w-[135px] shrink-0 rounded-md object-cover sm:block"
              />
            )}
            <div className="min-w-0 space-y-1">
              <h2 className="truncate text-base font-semibold">
                {info.meta.title}
              </h2>
              {info.meta.author && (
                <p className="text-sm text-muted-foreground">{info.meta.author}</p>
              )}
              <p className="pt-1 text-sm text-amber-600 dark:text-amber-400">
                {info.message}
              </p>
            </div>
          </div>

          <ol className="space-y-1.5 rounded-lg border bg-accent/40 p-4 text-sm text-muted-foreground">
            <li>
              1. Откройте{" "}
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-foreground underline underline-offset-4"
              >
                это видео на YouTube
              </a>{" "}
              в новой вкладке
            </li>
            <li>
              2. Под описанием нажмите «...ещё» → «Показать расшифровку видео»
            </li>
            <li>3. Выделите весь текст панели и скопируйте его (Ctrl+C)</li>
            <li>4. Вставьте в поле ниже (Ctrl+V) — таймкоды сохранятся</li>
          </ol>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"0:00\nпривет всем, сегодня мы поговорим о…\n0:07\nи начнём с самого главного"}
            className="min-h-40 font-mono text-xs"
            aria-label="Вставьте расшифровку видео"
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Отмена
            </Button>
            <Button
              onClick={() => onSubmit(text)}
              disabled={busy || !text.trim()}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Film className="h-4 w-4" />
              )}
              Перевести расшифровку
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
