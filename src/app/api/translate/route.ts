import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { translateSegments } from "@/lib/translate"
import type { TranslateBatchResponse } from "@/lib/api-types"

export const runtime = "nodejs"
export const maxDuration = 120

const BATCH_SIZE = 25

interface TranslateBody {
  videoId?: string
  from?: number // индекс, с которого продолжить
}

export async function POST(req: NextRequest) {
  let body: TranslateBody
  try {
    body = (await req.json()) as TranslateBody
  } catch {
    return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 })
  }

  const videoId = body.videoId
  if (!videoId) {
    return NextResponse.json({ error: "Не указан videoId" }, { status: 400 })
  }

  const video = await db.video.findUnique({ where: { id: videoId } })
  if (!video) {
    return NextResponse.json({ error: "Видео не найдено" }, { status: 404 })
  }

  const from = Math.max(0, body.from ?? 0)
  const segments = await db.segment.findMany({
    where: { videoId },
    orderBy: { idx: "asc" },
    skip: from,
    take: BATCH_SIZE,
  })

  if (segments.length === 0) {
    return NextResponse.json({
      segments: [],
      language: video.language,
      translatedCount: video.translatedCount,
      segmentCount: video.segmentCount,
      done: true,
    } satisfies TranslateBatchResponse)
  }

  const result = await translateSegments(
    segments.map((s) => ({ idx: s.idx, text: s.text }))
  )

  // сохраняем переводы
  await Promise.all(
    Array.from(result.translations.entries()).map(([idx, translated]) =>
      db.segment.updateMany({
        where: { videoId, idx },
        data: { translated },
      })
    )
  )

  const translatedCount = await db.segment.count({
    where: { videoId, translated: { not: null } },
  })

  await db.video.update({
    where: { id: videoId },
    data: {
      translatedCount,
      language: video.language ?? result.sourceLanguage ?? null,
    },
  })

  return NextResponse.json({
    segments: segments.map((s) => ({
      idx: s.idx,
      translated: result.translations.get(s.idx) ?? s.text,
    })),
    language: video.language ?? result.sourceLanguage ?? null,
    translatedCount,
    segmentCount: video.segmentCount,
    done: from + segments.length >= video.segmentCount,
  } satisfies TranslateBatchResponse)
}
