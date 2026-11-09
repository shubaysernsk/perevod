"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { AlertCircle, Loader2, Maximize, Minimize } from "lucide-react"
import type { SegmentDTO, VideoDTO } from "@/lib/api-types"

export interface PlayerHandle {
  seek: (t: number) => void
  setVolume: (v01: number) => void
}

interface VideoStageProps {
  video: VideoDTO
  segments: SegmentDTO[]
  subtitlesOn: boolean
  subtitleSize: "sm" | "md" | "lg"
  showOriginal: boolean
  translating: boolean
  onTime: (t: number, playing: boolean) => void
  onDuration: (d: number) => void
}

/* ---------- YouTube IFrame API ---------- */

declare global {
  interface Window {
    YT?: {
      Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number }
    }
    onYouTubeIframeAPIReady?: () => void
  }
}

interface YTPlayer {
  getCurrentTime: () => number
  getDuration: () => number
  getPlayerState: () => number
  seekTo: (seconds: number, allowSeekAhead: boolean) => void
  setVolume: (volume: number) => void
  destroy: () => void
}

let ytApiPromise: Promise<NonNullable<Window["YT"]>> | null = null

function loadYouTubeApi(): Promise<NonNullable<Window["YT"]>> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"))
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (ytApiPromise) return ytApiPromise
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      prev?.()
      if (window.YT) resolve(window.YT)
    }
    const script = document.createElement("script")
    script.src = "https://www.youtube.com/iframe_api"
    script.async = true
    document.head.appendChild(script)
  })
  return ytApiPromise
}

/* ---------- полноэкранный режим (контейнер + субтитры) ---------- */

interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void
}
interface FsElement extends HTMLDivElement {
  webkitRequestFullscreen?: () => Promise<void> | void
}
interface LegacyVideoElement extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void
}

/* ---------- определение текущей реплики ---------- */

export function findSegmentIndex(
  segments: SegmentDTO[],
  t: number
): number {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    if (t >= s.startSec && t < s.endSec) return i
    if (s.startSec > t) break
  }
  return -1
}

const SIZE_CLASS: Record<"sm" | "md" | "lg", string> = {
  sm: "text-sm sm:text-base",
  md: "text-lg sm:text-xl",
  lg: "text-2xl sm:text-3xl",
}

export const VideoStage = forwardRef<PlayerHandle, VideoStageProps>(
  function VideoStage(
    {
      video,
      segments,
      subtitlesOn,
      subtitleSize,
      showOriginal,
      translating,
      onTime,
      onDuration,
    },
    ref
  ) {
    const isYouTube = video.sourceType === "youtube" && Boolean(video.youtubeId)
    const src = video.sourceUrl ?? ""
    const isHls = /\.m3u8(\?|$)/i.test(src)

    const containerRef = useRef<HTMLDivElement>(null)
    const stageRef = useRef<HTMLDivElement>(null)
    const ytPlayerRef = useRef<YTPlayer | null>(null)
    const videoElRef = useRef<HTMLVideoElement>(null)
    const hlsRef = useRef<{ destroy: () => void } | null>(null)

    const [time, setTime] = useState(0)
    const [ready, setReady] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [fullscreen, setFullscreen] = useState(false)

    const onTimeRef = useRef(onTime)
    onTimeRef.current = onTime

    /* --- полноэкранный режим контейнера (субтитры остаются поверх) --- */
    useEffect(() => {
      const doc = document as FsDocument
      const onChange = () =>
        setFullscreen(
          Boolean(document.fullscreenElement ?? doc.webkitFullscreenElement)
        )
      document.addEventListener("fullscreenchange", onChange)
      document.addEventListener("webkitfullscreenchange", onChange)
      return () => {
        document.removeEventListener("fullscreenchange", onChange)
        document.removeEventListener("webkitfullscreenchange", onChange)
      }
    }, [])

    const toggleFullscreen = () => {
      const stage = stageRef.current
      if (!stage) return
      const doc = document as FsDocument
      if (document.fullscreenElement || doc.webkitFullscreenElement) {
        if (document.exitFullscreen) void document.exitFullscreen()
        else doc.webkitExitFullscreen?.()
        return
      }
      const el = stage as FsElement
      const request =
        el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el)
      if (request) {
        Promise.resolve(request()).catch(() => {
          // старые iPhone: полноэкранный режим поддерживает только <video>
          const v = videoElRef.current as LegacyVideoElement | null
          v?.webkitEnterFullscreen?.()
        })
      } else {
        const v = videoElRef.current as LegacyVideoElement | null
        v?.webkitEnterFullscreen?.()
      }
    }

    useImperativeHandle(
      ref,
      () => ({
        seek: (t: number) => {
          if (ytPlayerRef.current) {
            ytPlayerRef.current.seekTo(t, true)
          } else if (videoElRef.current) {
            videoElRef.current.currentTime = t
          }
        },
        setVolume: (v01: number) => {
          if (ytPlayerRef.current) {
            ytPlayerRef.current.setVolume(Math.round(v01 * 100))
          } else if (videoElRef.current) {
            videoElRef.current.volume = Math.min(1, Math.max(0, v01))
          }
        },
      }),
      []
    )

    /* --- создание YouTube-плеера --- */
    useEffect(() => {
      if (!isYouTube) return
      let cancelled = false
      let poll: ReturnType<typeof setInterval> | null = null

      loadYouTubeApi()
        .then((YT) => {
          if (cancelled || !containerRef.current) return
          const player = new YT.Player(containerRef.current, {
            videoId: video.youtubeId as string,
            playerVars: {
              rel: 0,
              modestbranding: 1,
              cc_load_policy: 0, // свои субтитры поверх — родные отключаем
              hl: "ru",
            },
            events: {
              onReady: () => {
                if (cancelled) return
                ytPlayerRef.current = player
                setReady(true)
                try {
                  onDuration(player.getDuration())
                } catch {
                  /* длительность появится позже */
                }
                poll = setInterval(() => {
                  try {
                    const t = player.getCurrentTime()
                    const state = player.getPlayerState()
                    setTime(t)
                    onTimeRef.current(t, state === 1)
                    const d = player.getDuration()
                    if (d > 0) onDuration(d)
                  } catch {
                    /* плеер ещё не готов */
                  }
                }, 100)
              },
              onError: () => {
                setError("embed")
              },
            },
          })
        })
        .catch(() => setError("Не удалось загрузить YouTube-плеер."))

      return () => {
        cancelled = true
        if (poll) clearInterval(poll)
        try {
          ytPlayerRef.current?.destroy()
        } catch {
          /* noop */
        }
        ytPlayerRef.current = null
      }
    }, [isYouTube, video.youtubeId])

    /* --- нативное видео (+ HLS) --- */
    useEffect(() => {
      if (isYouTube || !src) return
      const el = videoElRef.current
      if (!el) return

      let hls: { destroy: () => void } | null = null
      setError(null)
      setReady(true)

      if (isHls && !el.canPlayType("application/vnd.apple.mpegurl")) {
        import("hls.js")
          .then(({ default: Hls }) => {
            if (Hls.isSupported()) {
              const instance = new Hls({ enableWorker: true })
              instance.loadSource(src)
              instance.attachMedia(el)
              instance.on(Hls.Events.ERROR, (_e, data) => {
                if (data.fatal) {
                  setError("Не удалось загрузить HLS-поток. Проверьте ссылку.")
                }
              })
              hls = instance
              hlsRef.current = instance
            } else {
              setError("Браузер не поддерживает HLS-воспроизведение.")
            }
          })
          .catch(() => setError("Не удалось загрузить HLS-модуль."))
      }

      return () => {
        if (hls) hls.destroy()
        hlsRef.current = null
      }
    }, [isYouTube, src, isHls])

    /* --- опрос времени нативного видео --- */
    useEffect(() => {
      if (isYouTube) return
      const el = videoElRef.current
      if (!el) return
      const poll = setInterval(() => {
        const playing = !el.paused && !el.ended
        setTime(el.currentTime)
        onTimeRef.current(el.currentTime, playing)
      }, 100)
      return () => clearInterval(poll)
    }, [isYouTube, ready])

    const currentIdx = findSegmentIndex(segments, time)
    const current = currentIdx >= 0 ? segments[currentIdx] : null
    const hasVideo = isYouTube || Boolean(src)

    return (
      <div
        ref={stageRef}
        className="video-stage relative aspect-video w-full bg-black"
      >
        {isYouTube ? (
          <div className="absolute inset-0">
            <div ref={containerRef} className="h-full w-full" />
          </div>
        ) : src ? (
          <video
            ref={videoElRef}
            src={src}
            controls
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full bg-black"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration
              if (Number.isFinite(d)) onDuration(d)
            }}
            onError={() =>
              setError(
                "Видео по ссылке не загрузилось. Убедитесь, что это прямой файл (mp4/webm/m3u8), доступный для воспроизведения."
              )
            }
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
            <AlertCircle className="h-10 w-10 opacity-40" />
            <p className="text-sm">
              Видео не прикреплено — доступен перевод и просмотр текста
            </p>
          </div>
        )}

        {/* своя кнопка полноэкранного режима: контейнер целиком,
            поэтому субтитры остаются поверх видео */}
        {hasVideo && !error && (
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={
              fullscreen
                ? "Выйти из полноэкранного режима"
                : "Полноэкранный режим с субтитрами"
            }
            title="Полноэкранный режим с субтитрами"
            className="absolute right-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-lg bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
          >
            {fullscreen ? (
              <Minimize className="h-4.5 w-4.5" />
            ) : (
              <Maximize className="h-4.5 w-4.5" />
            )}
          </button>
        )}

        {/* Оверлей субтитров */}
        {subtitlesOn && current && (
          <div className="pointer-events-none absolute inset-x-0 bottom-10 z-10 flex justify-center px-4 sm:bottom-14">
            <div className="max-w-[92%] rounded-lg bg-black/70 px-4 py-2 shadow-lg backdrop-blur-[2px]">
              {current.translated ? (
                <p
                  className={`text-center font-semibold leading-snug text-white subtitle-glow ${SIZE_CLASS[subtitleSize]}`}
                >
                  {current.translated}
                </p>
              ) : (
                <p
                  className={`text-center font-medium leading-snug text-white/75 subtitle-glow ${SIZE_CLASS[subtitleSize]}`}
                >
                  {current.text}
                </p>
              )}
              {showOriginal && current.translated && (
                <p className="mt-1 text-center text-xs text-white/55 sm:text-sm">
                  {current.text}
                </p>
              )}
              {translating && !current.translated && (
                <p className="mt-1 text-center text-[10px] uppercase tracking-wider text-emerald-400/90">
                  переводится…
                </p>
              )}
            </div>
          </div>
        )}

        {/* состояния */}
        {!ready && !error && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
            <Loader2 className="h-8 w-8 animate-spin text-white/80" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/80 p-6 text-center">
            <AlertCircle className="h-8 w-8 text-amber-400" />
            {error === "embed" ? (
              <>
                <p className="max-w-sm text-sm text-white/85">
                  YouTube не запускает это видео во встроенном плеере
                  (ограничение владельца или проверка роботов). Перевод,
                  субтитры и транскрипт продолжают работать — смотрите видео
                  в отдельной вкладке.
                </p>
                <a
                  href={`https://www.youtube.com/watch?v=${video.youtubeId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  Открыть на YouTube ↗
                </a>
              </>
            ) : (
              <p className="max-w-sm text-sm text-white/85">{error}</p>
            )}
          </div>
        )}
      </div>
    )
  }
)
