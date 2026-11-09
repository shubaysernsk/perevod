import { PrismaClient } from "@prisma/client"
import fs from "node:fs"
import path from "node:path"

/**
 * Клиент базы данных с самозапуском.
 *
 * Особенность serverless-платформ (Vercel и т.п.): корень проекта доступен
 * только для чтения. Поэтому клиент сам:
 *  1) подбирает записываемый путь к SQLite (env -> db/ в проекте -> /tmp);
 *  2) при первом обращении создаёт таблицы через CREATE TABLE IF NOT EXISTS.
 */

const DDL = [
  `CREATE TABLE IF NOT EXISTS "Video" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "youtubeId" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "thumbnailUrl" TEXT,
    "durationSec" REAL NOT NULL DEFAULT 0,
    "language" TEXT,
    "segmentCount" INTEGER NOT NULL DEFAULT 0,
    "translatedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS "Video_createdAt_idx" ON "Video"("createdAt")`,
  `CREATE TABLE IF NOT EXISTS "Segment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "videoId" TEXT NOT NULL REFERENCES "Video"("id") ON DELETE CASCADE,
    "idx" INTEGER NOT NULL,
    "startSec" REAL NOT NULL,
    "endSec" REAL NOT NULL,
    "text" TEXT NOT NULL,
    "translated" TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS "Segment_videoId_idx_idx" ON "Segment"("videoId", "idx")`,
]

function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL
  const candidates: string[] = []

  if (raw) {
    const p = raw.replace(/^file:/, "")
    candidates.push(path.isAbsolute(p) ? p : path.join(process.cwd(), p))
  }
  candidates.push(path.join(process.cwd(), "db", "custom.db"))
  candidates.push("/tmp/videoperevod.db")

  for (const abs of candidates) {
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.accessSync(path.dirname(abs), fs.constants.W_OK)
      return `file:${abs}`
    } catch {
      /* каталог недоступен для записи — пробуем следующий */
    }
  }
  return "file:/tmp/videoperevod.db"
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  schemaReady: Promise<void> | undefined
}

const base =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["query"],
    datasourceUrl: resolveDatabaseUrl(),
  })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = base

/** Гарантирует наличие таблиц; при сбое следующая операция повторит попытку. */
function ensureSchema(): Promise<void> {
  globalForPrisma.schemaReady ??= (async () => {
    for (const ddl of DDL) {
      await base.$executeRawUnsafe(ddl)
    }
  })()
  globalForPrisma.schemaReady.catch(() => {
    globalForPrisma.schemaReady = undefined
  })
  return globalForPrisma.schemaReady
}

/**
 * Расширенный клиент: каждый запрос к любой модели сначала дожидается
 * готовности схемы — таблицы создаются до первого чтения/записи.
 */
export const db = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ query, args }) {
        await ensureSchema()
        return query(args)
      },
    },
  },
})
