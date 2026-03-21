const SUPPORTED_HOSTS = new Set(["netflix.com", "www.netflix.com"]);

function extractIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?(?:watch|title)\/(\d+)/);
  return match?.[1] ?? null;
}

function extractIdFromQuery(parsed: URL): string | null {
  const unifiedEntityId = parsed.searchParams.get("unifiedEntityIdEncoded");
  const match = unifiedEntityId?.match(/(?:Video|Title):(\d+)/i);
  return match?.[1] ?? null;
}

export function normalizeNetflixUrl(rawUrl: string): string | null {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!SUPPORTED_HOSTS.has(hostname)) {
    return null;
  }

  const id = extractIdFromPath(parsed.pathname) ?? extractIdFromQuery(parsed);
  if (!id) {
    return null;
  }

  return `https://www.netflix.com/watch/${id}`;
}
