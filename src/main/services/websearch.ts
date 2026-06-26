// Built-in, keyless web search. Runs in the main process (no CORS), querying
// DuckDuckGo's HTML endpoint and parsing the result list. Best-effort: if the
// endpoint changes shape or rate-limits, the tool returns an honest error.

export interface WebResult {
  title: string
  url: string
  snippet: string
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function safeCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n)
  } catch {
    return ''
  }
}

/** DuckDuckGo wraps real URLs in a redirect: //duckduckgo.com/l/?uddg=<enc> */
function decodeHref(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/)
  if (m) {
    try {
      return decodeURIComponent(m[1])
    } catch {
      return href
    }
  }
  return href.startsWith('//') ? 'https:' + href : href
}

export async function webSearch(
  query: string,
  limit = 8,
  signal?: AbortSignal
): Promise<WebResult[]> {
  // Bound the request: a 10s timeout, plus the run's cancel signal if present.
  const signals = [AbortSignal.timeout(10_000)]
  if (signal) signals.push(signal)
  let res: Response
  try {
    // POST to the HTML endpoint — the GET form gets soft-blocked (HTTP 202).
    res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      body: 'q=' + encodeURIComponent(query),
      signal: AbortSignal.any(signals)
    })
  } catch (err: any) {
    if (err?.name === 'TimeoutError') throw new Error('Web search timed out.')
    if (err?.name === 'AbortError') throw new Error('Web search was cancelled.')
    throw err
  }
  if (!res.ok) throw new Error(`Search request failed (HTTP ${res.status}).`)
  const html = await res.text()

  // Collect title-anchors and snippet-anchors with their positions, then pair a
  // title with the snippet that falls between it and the next title — robust to
  // results that have no snippet (ads, modules) which would shift index-paired arrays.
  const linkRe = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
  const snipRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
  const links = [...html.matchAll(linkRe)].map((m) => ({
    at: m.index ?? 0,
    href: m[1],
    title: stripTags(m[2])
  }))
  const snips = [...html.matchAll(snipRe)].map((m) => ({ at: m.index ?? 0, text: stripTags(m[1]) }))

  const results: WebResult[] = []
  for (let i = 0; i < links.length && results.length < limit; i++) {
    const l = links[i]
    if (!l.title) continue
    const nextAt = links[i + 1]?.at ?? Infinity
    const snip = snips.find((s) => s.at > l.at && s.at < nextAt)
    results.push({ title: l.title, url: decodeHref(l.href), snippet: snip?.text ?? '' })
  }

  // Distinguish a genuine 0-result query from an anti-bot challenge page.
  if (results.length === 0 && /anomaly|unusual traffic|challenge|are you a robot|rate.?limit/i.test(html)) {
    throw new Error('Web search is temporarily blocked or rate-limited — try again shortly.')
  }
  return results
}
