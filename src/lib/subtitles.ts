/**
 * Парсеры субтитров: SRT, WebVTT и вставленный транскрипт YouTube
 * (панель «Показать расшифровку видео»).
 */

export interface SubSegment {
  start: number // секунды
  end: number // секунды
  text: string
}

/** "00:00:01,000" | "00:00:01.000" | "0:01" | "01:02:03.5" → секунды */
export function parseTimestamp(raw: string): number | null {
  const s = raw.trim()
  const m = s.match(
    /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/
  )
  if (!m) return null
  const h = m[1] ? parseInt(m[1], 10) : 0
  const min = parseInt(m[2], 10)
  const sec = parseInt(m[3], 10)
  const ms = m[4] ? parseFloat(`0.${m[4]}`) : 0
  return h * 3600 + min * 60 + sec + ms
}

function parseCueLine(line: string): { start: number; end: number } | null {
  // "00:00:01,000 --> 00:00:04,000" (+ возможные настройки после -->
  const m = line.match(
    /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3})/
  )
  if (!m) return null
  const start = parseTimestamp(m[1])
  const end = parseTimestamp(m[2])
  if (start == null || end == null) return null
  return { start, end }
}

/** Универсальный парсер блочных форматов (SRT и VTT) */
function parseBlockFormat(content: string): SubSegment[] {
  const normalized = content.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "")
  const lines = normalized.split("\n")
  const segments: SubSegment[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const cue = parseCueLine(line)
    if (cue) {
      // собираем текстовые строки до пустой строки или следующего cue
      const texts: string[] = []
      i++
      while (i < lines.length) {
        const l = lines[i]
        if (l.trim() === "" || parseCueLine(l)) break
        // пропускаем номер реплики SRT, если он попал в текст
        if (/^\d+$/.test(l.trim()) && texts.length === 0 && !cue) break
        texts.push(l.trim())
        i++
      }
      const text = texts.join(" ").trim()
      if (text) {
        segments.push({ start: cue.start, end: cue.end, text })
      }
      continue
    }
    // строка с номером SRT перед cue
    if (/^\d+$/.test(line.trim())) {
      const nextCue = i + 1 < lines.length ? parseCueLine(lines[i + 1]) : null
      if (nextCue) {
        i++
        continue
      }
    }
    i++
  }
  return segments
}

/**
 * Вставленный транскрипт YouTube. Форматы:
 *  1) таймкод на отдельной строке, текст на следующей:
 *     "0:12\nПривет всем" — типично для «Показать расшифровку»
 *  2) "0:12 Привет всем" — таймкод и текст в одной строке
 *  3) без таймкодов вовсе — текст подряд (синхронизация оценочная)
 */
export function parsePastedTranscript(content: string): {
  segments: SubSegment[]
  hasTimestamps: boolean
} {
  const normalized = content.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "")
  const lines = normalized
    .split("\n")
    .map((l) => l.replace(/\t/g, " ").trimEnd())
    .filter((l) => l.trim() !== "")

  const TS_RE = /^(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\s*(.*)$/

  type Entry = { time: number; text: string }
  const entries: Entry[] = []
  let tsCount = 0

  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(TS_RE)
    if (m) {
      const t = parseTimestamp(m[1])
      if (t != null) {
        tsCount++
        const inline = m[2].trim()
        if (inline) {
          entries.push({ time: t, text: inline })
        } else {
          // текст на следующей строке (если она не таймкод)
          const next = lines[i + 1]
          if (next !== undefined && !next.match(TS_RE) && next.trim() !== "") {
            entries.push({ time: t, text: next.trim() })
            i += 2
            continue
          } else {
            entries.push({ time: t, text: "" })
          }
        }
        i++
        continue
      }
    }
    // строка без таймкода
    if (entries.length > 0) {
      const last = entries[entries.length - 1]
      last.text = `${last.text} ${lines[i].trim()}`.trim()
    } else if (lines[i].trim()) {
      entries.push({ time: -1, text: lines[i].trim() })
    }
    i++
  }

  // Чистим пустые тексты
  const filled = entries.filter((e) => e.text.trim() !== "")

  if (tsCount < 2 || filled.length === 0) {
    // Нет таймкодов — оценочная раскладка по скорости чтения (~14 симв/сек)
    const segments: SubSegment[] = []
    let t = 0
    for (const e of filled) {
      const dur = Math.max(1.2, e.text.length / 14)
      segments.push({ start: t, end: t + dur, text: e.text })
      t += dur + 0.25
    }
    return { segments, hasTimestamps: false }
  }

  // С таймкодами: end = начало следующей реплики (или +4с, максимум 8с)
  const timed = filled.filter((e) => e.time >= 0)
  const segments: SubSegment[] = timed.map((e, idx) => {
    const nextTime =
      idx + 1 < timed.length ? timed[idx + 1].time : e.time + 4
    let end = Math.max(nextTime, e.time + 0.5)
    if (end - e.time > 12) end = e.time + 12
    return { start: e.time, end, text: e.text }
  })
  return { segments, hasTimestamps: true }
}

/** Автоопределение формата и парсинг содержимого субтитров */
export function parseSubtitleContent(
  content: string,
  format?: "srt" | "vtt" | "auto"
): SubSegment[] {
  const head = content.slice(0, 2000)
  const isVtt = /^\uFEFF?WEBVTT/i.test(head.trim())
  const hasCue = /-->/.test(content)
  let segments: SubSegment[] = []

  if (isVtt || (hasCue && format !== "srt")) {
    segments = parseBlockFormat(content)
  }
  if (segments.length === 0 && hasCue) {
    segments = parseBlockFormat(content)
  }
  if (segments.length === 0) {
    // возможно, это вставленный транскрипт без cue-строк
    const parsed = parsePastedTranscript(content)
    segments = parsed.segments
  }
  return normalizeSegments(segments)
}

/** Нормализация: сортировка, дедупликация, защита от мусора */
export function normalizeSegments(segments: SubSegment[]): SubSegment[] {
  const cleaned = segments
    .map((s) => ({
      start: Math.max(0, s.start),
      end: s.end,
      text: s.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((s) => s.text !== "")

  // сортируем и убираем пересечения лёгкие
  cleaned.sort((a, b) => a.start - b.start)
  const out: SubSegment[] = []
  for (const s of cleaned) {
    if (s.end <= s.start) s.end = s.start + 1
    if (s.end - s.start > 30) s.end = s.start + 30
    // дедупликация подряд идущих одинаковых (артефакты авто-субтитров)
    const prev = out[out.length - 1]
    if (prev && prev.text === s.text && s.start < prev.end) continue
    out.push(s)
  }
  return out
}

/** Парсинг json3 (формат авто-субтитров YouTube) */
export function parseJson3(json: string): SubSegment[] {
  const data = JSON.parse(json) as {
    events?: Array<{
      tStartMs?: number
      dDurationMs?: number
      segs?: Array<{ utf8?: string }>
    }>
  }
  const segments: SubSegment[] = []
  for (const ev of data.events ?? []) {
    if (ev.tStartMs == null) continue
    const text = (ev.segs ?? [])
      .map((sg) => sg.utf8 ?? "")
      .join("")
      .replace(/\s+/g, " ")
      .trim()
    if (!text) continue
    const start = ev.tStartMs / 1000
    const dur = (ev.dDurationMs ?? 2000) / 1000
    segments.push({ start, end: start + dur, text })
  }
  return normalizeSegments(segments)
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
  return `${m}:${String(r).padStart(2, "0")}`
}
