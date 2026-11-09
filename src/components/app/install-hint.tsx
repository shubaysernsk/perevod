"use client"

import { useEffect, useState } from "react"
import { Plus, Share, Smartphone, X } from "lucide-react"

import { Button } from "@/components/ui/button"

const DISMISS_KEY = "vp-install-hint-dismissed"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function detectIOS(): boolean {
  if (typeof window === "undefined") return false
  const ua = navigator.userAgent
  const isIPadOS = navigator.maxTouchPoints > 1 && /Macintosh/.test(ua)
  return /iPhone|iPad|iPod/.test(ua) || isIPadOS
}

/**
 * Подсказка об установке приложения:
 * - iPhone/iPad (Safari): инструкция «Поделиться → На экран “Домой”»
 * - Chrome/Edge (Android, desktop): нативная кнопка установки PWA
 * Показывается, только когда приложение ещё не установлено.
 */
export function InstallHint() {
  const [showIOS, setShowIOS] = useState(false)
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // уже установлено как отдельное приложение?
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    const dismissed = localStorage.getItem(DISMISS_KEY) === "1"

    const onPrompt = (e: Event) => {
      e.preventDefault() // гасим мини-инфобар Chrome
      setInstallEvent(e as BeforeInstallPromptEvent)
      if (!standalone && !dismissed) setVisible(true)
    }
    window.addEventListener("beforeinstallprompt", onPrompt)

    if (!standalone && !dismissed && detectIOS()) {
      const t = window.setTimeout(() => setShowIOS(true), 1200)
      return () => {
        window.clearTimeout(t)
        window.removeEventListener("beforeinstallprompt", onPrompt)
      }
    }
    return () => window.removeEventListener("beforeinstallprompt", onPrompt)
  }, [])

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1")
    setVisible(false)
    setShowIOS(false)
  }

  const install = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    if (outcome === "accepted") {
      setVisible(false)
    }
    setInstallEvent(null)
  }

  if (!visible && !showIOS) return null

  return (
    <div className="mx-auto w-full max-w-3xl">
      {showIOS ? (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-600/30 bg-emerald-500/5 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Smartphone className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-sm font-medium">
              Установить приложение на iPhone
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              В Safari нажмите{" "}
              <Share className="inline h-3.5 w-3.5 -translate-y-0.5" aria-hidden />{" "}
              «Поделиться» → «На экран “Домой”» — приложение откроется
              на весь экран, без адресной строки, с офлайн-режимом.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
                <Share className="h-3 w-3" aria-hidden /> Поделиться
              </span>
              <Plus className="h-3 w-3 text-muted-foreground" aria-hidden />
              <span className="inline-flex items-center gap-1.5 rounded-md bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
                <Plus className="h-3 w-3" aria-hidden /> На экран «Домой»
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2 h-8 w-8 shrink-0"
            aria-label="Скрыть подсказку"
            onClick={dismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        visible && (
          <div className="flex items-center gap-3 rounded-xl border p-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Smartphone className="h-4.5 w-4.5" />
            </span>
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              Можно установить приложение как обычную программу — на телефон
              или компьютер.
            </p>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                className="bg-emerald-600 text-white hover:bg-emerald-500"
                onClick={() => void install()}
              >
                Установить
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label="Скрыть подсказку"
                onClick={dismiss}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  )
}
