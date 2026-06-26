import { createWriteStream } from 'node:fs'

/** Stream a URL to a file, reporting bytes received vs total (0 if unknown). */
export async function streamDownload(
  url: string,
  dest: string,
  headers: Record<string, string>,
  onBytes: (received: number, total: number) => void
): Promise<void> {
  const res = await fetch(url, { headers })
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  const total = Number(res.headers.get('content-length') ?? 0)
  const out = createWriteStream(dest)
  const reader = res.body.getReader()
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.length
      await new Promise<void>((resolve, reject) =>
        out.write(value, (err) => (err ? reject(err) : resolve()))
      )
      onBytes(received, total)
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve))
  }
}
