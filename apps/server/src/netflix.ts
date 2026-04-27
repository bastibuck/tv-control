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
const NETFLIX_EPISODE_STRING_PATTERN = String.raw`((?:\\.|[^\"])*)`;

type NetflixReference = {
  id: string;
  watchUrl: string;
  titleUrl: string;
};

type NetflixMetadata = {
  title?: string;
  episodeNumber?: number | null;
  episodeTitle?: string | null;
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

function decodeNetflixScriptString(value: string): string {
  const normalized = value.replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1");

  try {
    return JSON.parse(`"${normalized}"`) as string;
  } catch {
    return value;
  }
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

function preferredAcceptLanguageHeader(): string {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  const normalized = /^[a-z]{2}(?:-[A-Z]{2})?$/.test(locale)
    ? locale
    : "en-US";
  const language = normalized.split("-")[0] ?? "en";

  if (normalized === language) {
    return `${language},en;q=0.8`;
  }

  return `${normalized},${language};q=0.9,en-US;q=0.8,en;q=0.7`;
}

function extractEpisodeMetadataFromHtml(
  html: string,
  reference: NetflixReference,
): NetflixMetadata | undefined {
  const episodePattern = new RegExp(
    String.raw`Episode:\{\\"videoId\\":${reference.id}\}":\{"__typename":"Episode","videoId":${reference.id},"title":"${NETFLIX_EPISODE_STRING_PATTERN}"[\s\S]*?"number":(\d+)`,
  );
  const episodeMatch = episodePattern.exec(html);
  const seriesTitle = extractTitleFromHtml(html);
  const episodeTitle = episodeMatch?.[1]
    ? cleanNetflixTitle(decodeNetflixScriptString(episodeMatch[1]))
    : undefined;
  const episodeNumber = episodeMatch?.[2];

  if (!seriesTitle || !episodeTitle || !episodeNumber) {
    return undefined;
  }

  return {
    title: seriesTitle,
    episodeNumber: Number(episodeNumber),
    episodeTitle,
  };
}

async function fetchNetflixHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "accept-language": preferredAcceptLanguageHeader(),
        "user-agent": "tv-control/1.0",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
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
  const watchHtml = await fetchNetflixHtml(reference.watchUrl);
  if (watchHtml) {
    const episodeMetadata = extractEpisodeMetadataFromHtml(watchHtml, reference);

    return {
      ...episodeMetadata,
      title: episodeMetadata?.title ?? extractTitleFromHtml(watchHtml),
    };
  }

  const titleHtml = await fetchNetflixHtml(reference.titleUrl);
  return {
    title: titleHtml ? extractTitleFromHtml(titleHtml) : undefined,
    episodeNumber: null,
    episodeTitle: null,
  };
}
