/**
 * Пакетный перевод субтитров на русский через z-ai-web-dev-sdk (GLM).
 * JSON-протокол: массив реплик на входе → массив переводов на выходе.
 */

import ZAI from "z-ai-web-dev-sdk"

export interface TranslateItem {
  idx: number
  text: string
}

export interface TranslateResult {
  translations: Map<number, string>
  sourceLanguage?: string
}

const SYSTEM_PROMPT = `Ты — профессиональный переводчик субтитров видео. Тебе передают JSON с репликами видео.

Задача: перевести каждую реплику на русский язык.

Правила:
1. Стиль — естественный, живой русский язык; точная передача смысла.
2. Если реплика уже на русском языке — верни её без изменений.
3. Имена собственные транслитерируй общепринятым образом (Tim Urban → Тим Урбан).
4. Сохраняй числа, технические термины и названия брендов.
5. Перевод должен быть лаконичным: это субтитры, длина примерно как у оригинала или короче.
6. Не добавляй комментарии, пояснения и служебный текст.

Ответ строго в формате JSON без markdown-обёрток:
{"sourceLanguage":"<язык оригинала одним словом, например English>","segments":[{"i":<индекс как в запросе>,"r":"<перевод>"}]}`

let zaiPromise: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null = null

async function getZai() {
  if (!zaiPromise) {
    zaiPromise = ZAI.create()
  }
  return zaiPromise
}

function stripFences(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
  return s.trim()
}

function extractJson(raw: string): {
  sourceLanguage?: string
  segments: Array<{ i: number; r: string }>
} | null {
  const s = stripFences(raw)
  // ищем первый объект
  const start = s.indexOf("{")
  const end = s.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) return null
  const candidate = s.slice(start, end + 1)
  try {
    const parsed = JSON.parse(candidate) as {
      sourceLanguage?: string
      segments?: Array<{ i?: number; idx?: number; r?: string; text?: string }>
    }
    const segments = (parsed.segments ?? [])
      .filter((x) => typeof x.i === "number" || typeof x.idx === "number")
      .map((x) => ({
        i: (x.i ?? x.idx) as number,
        r: String(x.r ?? x.text ?? ""),
      }))
    if (segments.length === 0) return null
    return {
      sourceLanguage: parsed.sourceLanguage,
      segments,
    }
  } catch {
    return null
  }
}

/**
 * Переводит пачку реплик (рекомендуется не более 30 за раз).
 * Отсутствующие в ответе индексы заполняются оригиналом —
 * воспроизведение никогда не должно ломаться.
 */
export async function translateSegments(
  items: TranslateItem[]
): Promise<TranslateResult> {
  if (items.length === 0) return { translations: new Map() }

  const zai = await getZai()
  const payload = {
    segments: items.map((it) => ({ i: it.idx, t: it.text })),
  }

  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const completion = await zai.chat.completions.create({
        // модель можно переопределить переменной окружения LLM_MODEL
        model: process.env.LLM_MODEL || "glm-4-plus",
        messages: [
          { role: "assistant", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
        thinking: { type: "disabled" },
      })
      const raw = completion.choices?.[0]?.message?.content ?? ""
      const parsed = extractJson(raw)
      if (!parsed) throw new Error("Не удалось разобрать JSON ответа модели")

      const translations = new Map<number, string>()
      for (const seg of parsed.segments) {
        const original = items.find((it) => it.idx === seg.i)
        // Пустой или пропавший перевод → оригинал
        translations.set(seg.i, seg.r.trim() || (original?.text ?? ""))
      }
      for (const it of items) {
        if (!translations.has(it.idx)) translations.set(it.idx, it.text)
      }
      return {
        translations,
        sourceLanguage: parsed.sourceLanguage,
      }
    } catch (e) {
      lastError = e
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
    }
  }

  console.error("[translate] все попытки не удались:", lastError)
  // полный фолбэк: возвращаем оригиналы, чтобы видео не ломалось
  const translations = new Map<number, string>()
  for (const it of items) translations.set(it.idx, it.text)
  return { translations }
}
