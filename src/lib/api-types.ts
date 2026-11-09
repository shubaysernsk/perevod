/** Общие типы API (сервер и клиент) */

export type SourceType = "youtube" | "direct" | "subtitles"

export interface SegmentDTO {
  idx: number
  startSec: number
  endSec: number
  text: string
  translated: string | null
}

export interface VideoDTO {
  id: string
  sourceType: SourceType
  sourceUrl: string | null
  youtubeId: string | null
  title: string
  author: string | null
  thumbnailUrl: string | null
  durationSec: number
  language: string | null
  segmentCount: number
  translatedCount: number
  createdAt: string
}

export interface PrepareResponse {
  video: VideoDTO
  segments: SegmentDTO[]
}

export interface PrepareNeedsManualResponse {
  needsManual: true
  reason: "BLOCKED" | "NO_CAPTIONS"
  message: string
  hint: string
  youtubeId: string
  meta: {
    title?: string
    author?: string
    thumbnailUrl?: string
  }
}

export interface TranslateBatchResponse {
  segments: Array<{ idx: number; translated: string }>
  language: string | null
  translatedCount: number
  segmentCount: number
  done: boolean
}

export type HistoryItem = VideoDTO
