import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import type { VideoDTO } from "@/lib/api-types"

export const runtime = "nodejs"

export async function GET() {
  const videos = await db.video.findMany({
    orderBy: { createdAt: "desc" },
    take: 60,
    include: { _count: { select: { segments: true } } },
  })

  const items: VideoDTO[] = videos.map((v) => ({
    id: v.id,
    sourceType: v.sourceType as VideoDTO["sourceType"],
    sourceUrl: v.sourceUrl,
    youtubeId: v.youtubeId,
    title: v.title,
    author: v.author,
    thumbnailUrl: v.thumbnailUrl,
    durationSec: v.durationSec,
    language: v.language,
    segmentCount: v.segmentCount,
    translatedCount: v.translatedCount,
    createdAt: v.createdAt.toISOString(),
  }))

  return NextResponse.json({ items })
}
