"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Озвучка перевода средствами браузера (Web Speech API).
 * Серверный TTS не поддерживает русский, поэтому голос берётся
 * из системы/браузера пользователя (Google Russian, Microsoft и т.п.).
 */

export interface DubbingApi {
  supported: boolean
  voices: SpeechSynthesisVoice[]
  russianAvailable: boolean
  voiceURI: string | null
  setVoiceURI: (uri: string) => void
  speak: (text: string, durationSec: number) => void
  cancel: () => void
  speaking: boolean
}

export function useDubbing(): DubbingApi {
  const [supported] = useState(() =>
    typeof window !== "undefined" && "speechSynthesis" in window
  )
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      return []
    }
    const all = window.speechSynthesis.getVoices()
    const ru = all.filter((v) => v.lang.toLowerCase().startsWith("ru"))
    return ru.length > 0 ? ru : all
  })
  const [voiceURI, setVoiceURI] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)

  useEffect(() => {
    if (!supported) return
    const synth = window.speechSynthesis

    const load = () => {
      const all = synth.getVoices()
      if (all.length === 0) return
      const ru = all.filter((v) => v.lang.toLowerCase().startsWith("ru"))
      // предпочитаем русские; если нет — отдаём все (модель всё равно может осилить)
      setVoices(ru.length > 0 ? ru : all)
    }
    synth.addEventListener("voiceschanged", load)
    // повторная попытка: некоторые браузеры отдают список с задержкой
    const t = setTimeout(load, 800)
    return () => {
      synth.removeEventListener("voiceschanged", load)
      clearTimeout(t)
      synth.cancel()
    }
  }, [supported])

  useEffect(() => {
    voiceRef.current =
      voices.find((v) => v.voiceURI === voiceURI) ?? voices[0] ?? null
  }, [voiceURI, voices])

  const cancel = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return
    window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  const speak = useCallback(
    (text: string, durationSec: number) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return
      const clean = text.replace(/\s+/g, " ").trim()
      if (!clean) return
      window.speechSynthesis.cancel()

      const u = new SpeechSynthesisUtterance(clean)
      if (voiceRef.current) {
        u.voice = voiceRef.current
        u.lang = voiceRef.current.lang
      } else {
        u.lang = "ru-RU"
      }
      // подгон темпа: ~15 символов/сек при rate=1 для русского
      const estSec = clean.length / 15
      const rate = Math.min(1.9, Math.max(0.9, estSec / Math.max(1, durationSec)))
      u.rate = rate
      u.onend = () => setSpeaking(false)
      u.onerror = () => setSpeaking(false)
      setSpeaking(true)
      window.speechSynthesis.speak(u)
    },
    []
  )

  const russianAvailable = voices.some(
    (v) => v.lang.toLowerCase().startsWith("ru")
  )

  return {
    supported,
    voices,
    russianAvailable,
    voiceURI,
    setVoiceURI,
    speak,
    cancel,
    speaking,
  }
}
