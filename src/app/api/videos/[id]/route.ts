import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import type { PrepareResponse } from "@/lib/api-types"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const video = await db.video.findUnique({
    where: { id },
    include: { segments: { orderBy: { idx: "asc" } } },
  })
  if (!video) {
    return NextResponse.json({ error: "Видео не найдено" }, { status: 404 })
  }

  const response: PrepareResponse = {
    video: {
      id: video.id,
      sourceType: video.sourceType as PrepareResponse["video"]["sourceType"],
      sourceUrl: video.sourceUrl,
      youtubeId: video.youtubeId,
      title: video.title,
      author: video.author,
      thumbnailUrl: video.thumbnailUrl,
      durationSec: video.durationSec,
      language: video.language,
      segmentCount: video.segmentCount,
      translatedCount: video.translatedCount,
      createdAt: video.createdAt.toISOString(),
    },
    segments: video.segments.map((s) => ({
      idx: s.idx,
      startSec: s.startSec,
      endSec: s.endSec,
      text: s.text,
      translated: s.translated,
    })),
  }
  return NextResponse.json(response)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const exists = await db.video.findUnique({ where: { id } })
  if (!exists) {
    return NextResponse.json({ error: "Видео не найдено" }, { status: 404 })
  }
  await db.video.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
