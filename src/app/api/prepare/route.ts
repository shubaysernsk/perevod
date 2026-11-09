import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import {
  parseSubtitleContent,
  parsePastedTranscript,
  type SubSegment,
} from "@/lib/subtitles"
import {
  extractYoutubeId,
  getYoutubeMeta,
  getYoutubeTranscript,
} from "@/lib/youtube"
import type { PrepareResponse, PrepareNeedsManualResponse } from "@/lib/api-types"

export const runtime = "nodejs"
export const maxDuration = 60

interface PrepareBody {
  mode: "youtube" | "direct" | "subtitles"
  url?: string
  subtitleContent?: string
  subtitleFormat?: "srt" | "vtt" | "auto"
  pastedTranscript?: string
  title?: string
}

function titleFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const name = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "")
    return name || u.hostname
  } catch {
    return "Видео"
  }
}

async function createVideo(
  data: {
    sourceType: "youtube" | "direct" | "subtitles"
    sourceUrl: string | null
    youtubeId: string | null
    title: string
    author: string | null
    thumbnailUrl: string | null
  },
  segments: SubSegment[]
): Promise<PrepareResponse> {
  const durationSec = segments.length
    ? Math.max(...segments.map((s) => s.end))
    : 0

  const video = await db.video.create({
    data: {
      ...data,
      durationSec,
      segmentCount: segments.length,
      translatedCount: 0,
    },
  })

  if (segments.length > 0) {
    await db.segment.createMany({
      data: segments.map((s, i) => ({
        videoId: video.id,
        idx: i,
        startSec: s.start,
        endSec: s.end,
        text: s.text,
      })),
    })
  }

  return {
    video: {
      id: video.id,
      sourceType: video.sourceType as "youtube" | "direct" | "subtitles",
      sourceUrl: video.sourceUrl,
      youtubeId: video.youtubeId,
      title: video.title,
      author: video.author,
      thumbnailUrl: video.thumbnailUrl,
      durationSec: video.durationSec,
      language: null,
      segmentCount: video.segmentCount,
      translatedCount: 0,
      createdAt: video.createdAt.toISOString(),
    },
    segments: segments.map((s, i) => ({
      idx: i,
      startSec: s.start,
      endSec: s.end,
      text: s.text,
      translated: null,
    })),
  }
}

export async function POST(req: NextRequest) {
  let body: PrepareBody
  try {
    body = (await req.json()) as PrepareBody
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }

  const mode = body.mode
  const url = (body.url ?? "").trim()

  // ---------- Режим: файл субтитров (SRT/VTT) ----------
  if (mode === "subtitles") {
    const content = (body.subtitleContent ?? "").trim()
    if (!content) {
      return NextResponse.json(
        { error: "Загрузите файл субтитров (SRT или VTT) или вставьте их содержимое" },
        { status: 400 }
      )
    }
    const segments = parseSubtitleContent(content, body.subtitleFormat ?? "auto")
    if (segments.length === 0) {
      return NextResponse.json(
        { error: "Не удалось распознать субтитры. Проверьте формат файла (SRT/VTT)" },
        { status: 400 }
      )
    }
    return NextResponse.json(
      await createVideo(
        {
          sourceType: "subtitles",
          sourceUrl: url || null,
          youtubeId: extractYoutubeId(url) ?? null,
          title: body.title?.trim() || (url ? titleFromUrl(url) : "Субтитры"),
          author: null,
          thumbnailUrl: null,
        },
        segments
      )
    )
  }

  // ---------- Режим: прямая ссылка на видео ----------
  if (mode === "direct") {
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { error: "Укажите прямую ссылку на видео (http/https), например https://site.com/video.mp4" },
        { status: 400 }
      )
    }
    const hasSubs = Boolean(
      (body.subtitleContent ?? "").trim() || (body.pastedTranscript ?? "").trim()
    )
    if (!hasSubs) {
      return NextResponse.json(
        {
          error:
            "Для прямой ссылки нужны субтитры: загрузите файл SRT/VTT или вставьте транскрипт — иначе перевести нечего",
        },
        { status: 400 }
      )
    }
    let segments: SubSegment[] = []
    if ((body.subtitleContent ?? "").trim()) {
      segments = parseSubtitleContent(body.subtitleContent!, body.subtitleFormat ?? "auto")
    } else {
      segments = parsePastedTranscript(body.pastedTranscript!).segments
    }
    if (segments.length === 0) {
      return NextResponse.json(
        { error: "Не удалось распознать субтитры/транскрипт" },
        { status: 400 }
      )
    }
    return NextResponse.json(
      await createVideo(
        {
          sourceType: "direct",
          sourceUrl: url,
          youtubeId: null,
          title: body.title?.trim() || titleFromUrl(url),
          author: null,
          thumbnailUrl: null,
        },
        segments
      )
    )
  }

  // ---------- Режим: YouTube ----------
  if (mode === "youtube") {
    const videoId = extractYoutubeId(url)
    if (!videoId) {
      return NextResponse.json(
        { error: "Не похоже на ссылку YouTube. Пример: https://www.youtube.com/watch?v=XXXXXXXXXXX" },
        { status: 400 }
      )
    }

    // 1) вставленный транскрипт (ручной фолбэк) — приоритет, если передан
    const pasted = (body.pastedTranscript ?? "").trim()
    if (pasted) {
      const { segments } = parsePastedTranscript(pasted)
      if (segments.length === 0) {
        return NextResponse.json(
          { error: "Не удалось распознать вставленный транскрипт" },
          { status: 400 }
        )
      }
      const meta = await getYoutubeMeta(videoId)
      return NextResponse.json(
        await createVideo(
          {
            sourceType: "youtube",
            sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
            youtubeId: videoId,
            title: body.title?.trim() || meta?.title || `YouTube видео ${videoId}`,
            author: meta?.author ?? null,
            thumbnailUrl: meta?.thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          },
          segments
        )
      )
    }

    // 2) файл субтитров, приложенный к YouTube-ссылке
    if ((body.subtitleContent ?? "").trim()) {
      const segments = parseSubtitleContent(
        body.subtitleContent!,
        body.subtitleFormat ?? "auto"
      )
      if (segments.length === 0) {
        return NextResponse.json(
          { error: "Не удалось распознать файл субтитров" },
          { status: 400 }
        )
      }
      const meta = await getYoutubeMeta(videoId)
      return NextResponse.json(
        await createVideo(
          {
            sourceType: "youtube",
            sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
            youtubeId: videoId,
            title: body.title?.trim() || meta?.title || `YouTube видео ${videoId}`,
            author: meta?.author ?? null,
            thumbnailUrl: meta?.thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          },
          segments
        )
      )
    }

    // 3) автоматическое получение субтитров с сервера
    const result = await getYoutubeTranscript(videoId)
    if (result.ok && result.segments.length > 0) {
      const meta = await getYoutubeMeta(videoId)
      return NextResponse.json(
        await createVideo(
          {
            sourceType: "youtube",
            sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
            youtubeId: videoId,
            title: body.title?.trim() || meta?.title || `YouTube видео ${videoId}`,
            author: meta?.author ?? null,
            thumbnailUrl: meta?.thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          },
          result.segments
        )
      )
    }

    // 4) не вышло — просим расшифровку вручную
    const meta = await getYoutubeMeta(videoId)
    const needsManual: PrepareNeedsManualResponse = {
      needsManual: true,
      reason: result.error === "NO_CAPTIONS" ? "NO_CAPTIONS" : "BLOCKED",
      message:
        result.error === "NO_CAPTIONS"
          ? "У видео нет дорожки субтитров на YouTube."
          : "YouTube сейчас блокирует автоматический доступ к субтитрам с этого сервера (бот-защита).",
      hint: "Скопируйте расшифровку на YouTube: описание видео → «...ещё» → «Показать расшифровку видео» → выделите текст в панели → вставьте сюда. Таймкоды сохранять не обязательно, но с ними точнее.",
      youtubeId: videoId,
      meta: {
        title: meta?.title ?? `YouTube видео ${videoId}`,
        author: meta?.author,
        thumbnailUrl: meta?.thumbnailUrl ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      },
    }
    return NextResponse.json(needsManual)
  }

  return NextResponse.json({ error: "Неизвестный режим" }, { status: 400 })
}
