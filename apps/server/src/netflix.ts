const SUPPORTED_HOSTS = new Set(["netflix.com", "www.netflix.com"]);
const NETFLIX_LOCALE_PATTERN = "(?:[a-z]{2}(?:-[A-Z]{2})?/)?";
const NETFLIX_ID_PATTERN = new RegExp(
  `^/${NETFLIX_LOCALE_PATTERN}(?:watch|title)/(\\d+)`,
);
const NETFLIX_META_TITLE_PATTERNS = [
  /<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:title["'][^>]*>/i,
];
const NETFLIX_OG_TITLE_PATTERNS = [
  /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
  /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["'][^>]*>/i,
];
const NETFLIX_TITLE_TAG_PATTERN = /<title[^>]*>([^<]+)<\/title>/i;

type NetflixReference = {
  id: string;
  watchUrl: string;
  titleUrl: string;
};

type NetflixMetadata = {
  title?: string;
};

function extractIdFromPath(pathname: string): string | null {
  const match = pathname.match(NETFLIX_ID_PATTERN);
  return match?.[1] ?? null;
}

function extractIdFromQuery(parsed: URL): string | null {
  const unifiedEntityId = parsed.searchParams.get("unifiedEntityIdEncoded");
  const match = unifiedEntityId?.match(/(?:Video|Title):(\d+)/i);
  return match?.[1] ?? null;
}

function buildReference(id: string): NetflixReference {
  return {
    id,
    watchUrl: `https://www.netflix.com/watch/${id}`,
    titleUrl: `https://www.netflix.com/title/${id}`,
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function cleanNetflixTitle(rawTitle: string): string | undefined {
  const normalized = decodeHtmlEntities(rawTitle)
    .replace(/\s*-\s*Netflix\s*$/i, "")
    .replace(/\s*[|\-–]\s*Netflix.*$/i, "")
    .replace(/^Watch\s+/i, "")
    .replace(/^Details about\s+/i, "")
    .replace(/^„(.+)“\s+ansehen$/i, "$1")
    .replace(/^"(.+)"\s+ansehen$/i, "$1")
    .replace(/^(.+)\s+ansehen$/i, "$1")
    .replace(/^„|“$/g, "")
    .replace(/^"|"$/g, "")
    .trim();

  return normalized || undefined;
}

function extractTitleFromHtml(html: string): string | undefined {
  for (const pattern of NETFLIX_OG_TITLE_PATTERNS) {
    const match = pattern.exec(html)?.[1];
    if (match) {
      return cleanNetflixTitle(match);
    }
  }

  for (const pattern of NETFLIX_META_TITLE_PATTERNS) {
    const match = pattern.exec(html)?.[1];
    if (match) {
      return cleanNetflixTitle(match);
    }
  }

  const documentTitle = NETFLIX_TITLE_TAG_PATTERN.exec(html)?.[1];
  if (documentTitle) {
    return cleanNetflixTitle(documentTitle);
  }

  return undefined;
}

export function parseNetflixReference(rawUrl: string): NetflixReference | null {
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

  return buildReference(id);
}

export async function fetchNetflixMetadata(
  reference: NetflixReference,
): Promise<NetflixMetadata> {
  try {
    const response = await fetch(reference.titleUrl, {
      headers: {
        "user-agent": "tv-control/1.0",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return {};
    }

    const html = await response.text();
    return {
      title: extractTitleFromHtml(html),
    };
  } catch {
    return {};
  }
}
