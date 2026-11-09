/**
 * Серверные хелперы YouTube: извлечение ID, метаданные через oEmbed
 * и попытка получить субтитры напрямую (watch-страница / innertube API).
 *
 * ВАЖНО: YouTube блокирует запросы с IP датацентров бот-защитой
 * («Sign in to confirm you're not a bot»). Поэтому получение субтитров
 * здесь — «лучшее усилие»: при чистом IP сервера работает полностью,
 * при блокировке клиент предложит вставить расшифровку вручную.
 */

import { parseJson3, type SubSegment } from "./subtitles"

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

export interface YoutubeMeta {
  title?: string
  author?: string
  thumbnailUrl?: string
}

export interface YoutubeTranscriptResult {
  ok: boolean
  segments: SubSegment[]
  language?: string
  error?:
    | "BLOCKED" // бот-защита YouTube для серверного IP
    | "NO_CAPTIONS" // у видео нет дорожки субтитров
    | "UNAVAILABLE" // видео недоступно/не существует
    | "NETWORK"
  message?: string
}

export function extractYoutubeId(input: string): string | null {
  const s = input.trim()
  if (!s) return null
  // «голый» ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`)
    const host = u.hostname.replace(/^www\./, "")
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0]
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = u.searchParams.get("v")
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v
      const m = u.pathname.match(
        /^\/(embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/
      )
      if (m) return m[2]
    }
  } catch {
    return null
  }
  return null
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept-Language": "en-US,en;q=0.9",
        ...(init.headers ?? {}),
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Метаданные видео через oEmbed (не закрывается бот-защитой) */
export async function getYoutubeMeta(
  videoId: string
): Promise<YoutubeMeta | null> {
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`
      )}&format=json`,
      {},
      8000
    )
    if (!res.ok) return null
    const data = (await res.json()) as {
      title?: string
      author_name?: string
      thumbnail_url?: string
    }
    return {
      title: data.title,
      author: data.author_name,
      thumbnailUrl: data.thumbnail_url,
    }
  } catch {
    return null
  }
}

interface CaptionTrack {
  baseUrl: string
  languageCode?: string
  kind?: string // 'asr' = автогенерация
  name?: { simpleText?: string; runs?: Array<{ text?: string }> }
  vssId?: string
}

function extractCaptionTracks(playerResponse: unknown): CaptionTrack[] {
  const pr = playerResponse as {
    captions?: {
      playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] }
    }
    playabilityStatus?: { status?: string; reason?: string }
  }
  return (
    pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  )
}

function trackDisplayName(t: CaptionTrack): string {
  return (
    t.name?.simpleText ??
    (t.name?.runs ?? []).map((r) => r.text ?? "").join("") ??
    t.languageCode ??
    "?"
  )
}

/** Загружаем содержимое дорожки (json3) */
async function fetchTrack(
  track: CaptionTrack
): Promise<{ segments: SubSegment[]; language: string }> {
  const url = `${track.baseUrl}${track.baseUrl.includes("?") ? "&" : "?"}fmt=json3`
  const res = await fetchWithTimeout(url)
  if (!res.ok) throw new Error(`timedtext ${res.status}`)
  const body = await res.text()
  if (!body.trim()) throw new Error("timedtext empty (нужна подпись URL)")
  const segments = parseJson3(body)
  if (segments.length === 0) throw new Error("timedtext без сегментов")
  return { segments, language: track.languageCode ?? "" }
}

/** Выбираем дорожку: ручные приоритетнее авто; «переведённые» пропускаем */
function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null
  // vssId вида «.en» означает авто-перевод — стараемся не брать
  const original = tracks.filter((t) => !(t.vssId ?? "").startsWith("."))
  const pool = original.length > 0 ? original : tracks
  const manual = pool.find((t) => t.kind !== "asr")
  return manual ?? pool[0]
}

/** Попытка 1: innertube player API (WEB-клиент) */
async function tryInnertube(videoId: string): Promise<CaptionTrack[] | null> {
  try {
    const res = await fetchWithTimeout(
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "MWEB",
              clientVersion: "2.20240304.00.00",
              hl: "en",
            },
          },
          videoId,
        }),
      },
      10000
    )
    if (!res.ok) return null
    const pr = await res.json()
    const status = (pr as { playabilityStatus?: { status?: string } })
      ?.playabilityStatus?.status
    const tracks = extractCaptionTracks(pr)
    if (status === "LOGIN_REQUIRED") return null // бот-блокировка
    if (tracks.length > 0) return tracks
    return status === "OK" ? [] : null // OK без дорожек = NO_CAPTIONS
  } catch {
    return null
  }
}

/** Попытка 2: скрейп watch-страницы */
async function tryWatchPage(videoId: string): Promise<CaptionTrack[] | null> {
  try {
    const res = await fetchWithTimeout(
      `https://www.youtube.com/watch?v=${videoId}&hl=en&bpctr=9999999999&has_verified=1`,
      { redirect: "manual" },
      12000
    )
    // редирект на google.com/sorry = бот-блокировка
    const loc = res.headers.get("location") ?? ""
    if (res.status === 429 || loc.includes("/sorry/")) return null
    if (!res.ok) return null
    const html = await res.text()
    const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s)
    if (!m) return null
    const pr = JSON.parse(m[1])
    const status = (pr as { playabilityStatus?: { status?: string } })
      ?.playabilityStatus?.status
    const tracks = extractCaptionTracks(pr)
    if (status === "LOGIN_REQUIRED") return null
    if (tracks.length > 0) return tracks
    return status === "OK" ? [] : null
  } catch {
    return null
  }
}

/**
 * Получить транскрипт YouTube «лучшим усилием».
 * Порядок: watch-страница → innertube. Оба закрыты → BLOCKED.
 */
export async function getYoutubeTranscript(
  videoId: string
): Promise<YoutubeTranscriptResult> {
  const attempts: Array<() => Promise<CaptionTrack[] | null>> = [
    () => tryWatchPage(videoId),
    () => tryInnertube(videoId),
  ]

  let sawOkNoCaptions = false
  for (const attempt of attempts) {
    const tracks = await attempt()
    if (tracks === null) continue // метод недоступен — следующий
    if (tracks.length === 0) {
      sawOkNoCaptions = true
      continue
    }
    const track = pickTrack(tracks)
    if (!track) continue
    try {
      const { segments, language } = await fetchTrack(track)
      return {
        ok: true,
        segments,
        language: language || trackDisplayName(track),
      }
    } catch {
      // подпись не подошла — пробуем другие дорожки
      for (const alt of tracks) {
        if (alt === track) continue
        try {
          const r = await fetchTrack(alt)
          return { ok: true, ...r }
        } catch {
          /* следующая */
        }
      }
    }
  }

  if (sawOkNoCaptions) {
    return {
      ok: false,
      segments: [],
      error: "NO_CAPTIONS",
      message:
        "У этого видео нет дорожки субтитров (ни ручной, ни автоматической).",
    }
  }
  return {
    ok: false,
    segments: [],
    error: "BLOCKED",
    message:
      "YouTube ограничивает автоматический доступ к субтитрам с этого сервера (бот-защита).",
  }
}
