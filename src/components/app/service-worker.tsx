"use client"

import { useEffect } from "react"

/**
 * Регистрация service worker'а для офлайн-оболочки.
 * SW консервативен: не кэширует HTML и API, поэтому безопасен и в dev-сборке.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          /* тихо: офлайн-режим не критичен */
        })
    }

    if (document.readyState === "complete") {
      register()
    } else {
      window.addEventListener("load", register, { once: true })
      return () => window.removeEventListener("load", register)
    }
  }, [])

  return null
}
