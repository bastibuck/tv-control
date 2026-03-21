const SUPPORTED_HOSTS = new Set(["netflix.com", "www.netflix.com"]);

function extractTitleOrWatchId(pathname: string): string | null {
  const match = pathname.match(/^\/(watch|title)\/(\d+)/);
  return match?.[2] ?? null;
}

export function normalizeNetflixUrl(rawUrl: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!SUPPORTED_HOSTS.has(hostname)) {
    return null;
  }

  const id = extractTitleOrWatchId(parsed.pathname);
  if (!id) {
    return null;
  }

  return `https://www.netflix.com/watch/${id}`;
}
