import { createReadStream, existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { basename, extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import {
  clientToServerMessageSchema,
  errorMessageSchema,
  helloAckMessageSchema,
  stateSnapshotMessageSchema,
  type ClientRole,
  type PlaybackState,
  type ServerToClientMessage,
} from "@tv-control/protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { fetchNetflixMetadata, parseNetflixReference } from "./netflix.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8787);
const remoteUiDistPath = fileURLToPath(
  new URL("../../remote-ui/dist", import.meta.url),
);
const extensionDistPath = fileURLToPath(
  new URL("../../extension/dist", import.meta.url),
);
const chromeProfilePath = fileURLToPath(
  new URL("../../../.tv-control-chrome", import.meta.url),
);

type RegisteredSocket = WebSocket & {
  isAlive?: boolean;
  role?: ClientRole;
  name?: string;
};

type CachedNetflixMetadata = {
  title?: string;
  episodeNumber?: number | null;
  episodeTitle?: string | null;
};

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
};

let extensionClient: RegisteredSocket | null = null;
const remoteClients = new Set<RegisteredSocket>();
let latestPlayback: PlaybackState | null = null;
let pendingSeekTime: number | null = null;
const titleCache = new Map<string, CachedNetflixMetadata>();

function titleForPlayback(
  playback: PlaybackState | null,
): PlaybackState | null {
  if (!playback?.url) {
    return playback;
  }

  const reference = parseNetflixReference(playback.url);
  if (!reference) {
    return playback;
  }

  const cachedMetadata = titleCache.get(reference.id);
  if (!cachedMetadata) {
    return playback;
  }

  return {
    ...playback,
    title: cachedMetadata.title,
    episodeNumber: cachedMetadata.episodeNumber ?? null,
    episodeTitle: cachedMetadata.episodeTitle ?? null,
  };
}

function sendMessage(socket: WebSocket, message: ServerToClientMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function currentSnapshot(): ServerToClientMessage {
  const playback =
    latestPlayback && pendingSeekTime !== null
      ? {
          ...latestPlayback,
          currentTime: pendingSeekTime,
        }
      : latestPlayback;

  return stateSnapshotMessageSchema.parse({
    type: "state_snapshot",
    extensionConnected: extensionClient?.readyState === WebSocket.OPEN,
    playback: titleForPlayback(playback),
  });
}

function broadcastSnapshot(): void {
  const snapshot = currentSnapshot();
  for (const client of remoteClients) {
    sendMessage(client, snapshot);
  }
}

function sendError(socket: WebSocket, message: string): void {
  sendMessage(socket, errorMessageSchema.parse({ type: "error", message }));
}

async function cacheNetflixTitle(url: string): Promise<void> {
  const reference = parseNetflixReference(url);
  if (!reference || titleCache.has(reference.id)) {
    return;
  }

  const metadata = await fetchNetflixMetadata(reference);
  if (metadata.title || metadata.episodeNumber || metadata.episodeTitle) {
    titleCache.set(reference.id, metadata);
  }
}

function refreshPlaybackTitleFromUrl(playback: PlaybackState | null): void {
  if (!playback?.url) {
    return;
  }

  void cacheNetflixTitle(playback.url).then(() => {
    latestPlayback = titleForPlayback(latestPlayback);
    broadcastSnapshot();
  });
}

function chromeExecutableCandidates(): string[] {
  switch (process.platform) {
    case "darwin":
      return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
    case "linux":
      return [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
      ];
    default:
      return [];
  }
}

async function spawnDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let settled = false;
    let stderr = "";

    function cleanup(): void {
      child.removeAllListeners("error");
      child.removeAllListeners("spawn");
      child.removeAllListeners("exit");
      child.stderr?.removeAllListeners("data");
      child.stderr?.destroy();
    }

    function rejectOnce(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      reject(error);
    }

    function resolveOnce(): void {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      child.unref();
      resolve();
    }

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length >= 4000) {
        return;
      }

      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      rejectOnce(error instanceof Error ? error : new Error(String(error)));
    });

    child.once("spawn", () => {
      setTimeout(resolveOnce, 1000);
    });

    child.once("exit", (code, signal) => {
      const details = stderr.trim();
      const suffix = details ? `\n${details}` : "";
      rejectOnce(
        new Error(
          `Process exited early (code=${code ?? "null"}, signal=${signal ?? "null"})${suffix}`,
        ),
      );
    });
  });
}

async function openChromeUrl(url: string): Promise<void> {
  await mkdir(chromeProfilePath, { recursive: true });

  const args = [
    `--user-data-dir=${chromeProfilePath}`,
    "--new-window",
    "--start-fullscreen",
    "--no-first-run",
    "--no-default-browser-check",
  ];

  if (process.platform === "linux" && process.env.WAYLAND_DISPLAY) {
    args.push("--enable-features=UseOzonePlatform");
    args.push("--ozone-platform=wayland");
  }

  if (existsSync(extensionDistPath)) {
    args.push(`--load-extension=${extensionDistPath}`);
  }

  args.push(url);

  const failures: string[] = [];
  const candidates = chromeExecutableCandidates();
  for (const command of candidates) {
    try {
      await spawnDetached(command, args);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${command}: ${message}`);
    }
  }

  if (candidates.length === 0) {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }

  throw new Error(
    `Failed to launch Google Chrome. Tried: ${failures.join(" | ")}`,
  );
}

async function openNetflixInChrome(url: string): Promise<void> {
  if (extensionClient?.readyState === WebSocket.OPEN) {
    sendMessage(extensionClient, { type: "open_url", url });
    return;
  }

  await openChromeUrl(url);
}

async function serveRemoteUi(
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const normalizedPath = normalize(pathname).replace(/^\/+/, "");
  const candidate = join(remoteUiDistPath, normalizedPath || "index.html");
  const fallback = join(remoteUiDistPath, "index.html");
  const target = existsSync(candidate) ? candidate : fallback;

  if (!existsSync(target)) {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("Remote UI has not been built yet. Run 'pnpm build'.");
    return;
  }

  const fileStat = await stat(target);
  if (!fileStat.isFile()) {
    response.writeHead(404).end();
    return;
  }

  const fileName = basename(target);
  const cacheControl =
    fileName === "index.html" ||
    fileName === "manifest.json" ||
    fileName === "sw.js"
      ? "no-cache"
      : "public, max-age=31536000, immutable";

  response.writeHead(200, {
    "content-type": mimeTypes[extname(target)] ?? "application/octet-stream",
    "cache-control": cacheControl,
  });

  createReadStream(target).pipe(response);
}

const httpServer = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400).end();
    return;
  }

  const url = new URL(
    request.url,
    `http://${request.headers.host ?? "localhost"}`,
  );

  try {
    await serveRemoteUi(url.pathname, response);
  } catch (error) {
    console.error("Failed to serve remote UI", error);
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  }
});

const webSocketServer = new WebSocketServer({
  server: httpServer,
  path: "/ws",
});

webSocketServer.on("connection", (socket: RegisteredSocket) => {
  socket.isAlive = true;

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", async (rawData: RawData) => {
    let payload: unknown;

    try {
      payload = JSON.parse(rawData.toString());
    } catch {
      sendError(socket, "Invalid JSON payload.");
      return;
    }

    const parsed = clientToServerMessageSchema.safeParse(payload);
    if (!parsed.success) {
      sendError(socket, "Invalid message payload.");
      return;
    }

    const message = parsed.data;

    if (message.type !== "hello" && !socket.role) {
      sendError(socket, "Send hello before any other message.");
      return;
    }

    switch (message.type) {
      case "hello": {
        socket.role = message.role;
        socket.name = message.name;

        if (message.role === "extension") {
          extensionClient = socket;
        }

        if (message.role === "remote-ui") {
          remoteClients.add(socket);
        }

        sendMessage(
          socket,
          helloAckMessageSchema.parse({
            type: "hello_ack",
            role: message.role,
          }),
        );
        sendMessage(socket, currentSnapshot());
        broadcastSnapshot();
        break;
      }

      case "open_netflix": {
        if (socket.role !== "remote-ui") {
          sendError(socket, "Only remote UI clients can open Netflix.");
          return;
        }

        try {
          await openNetflixInChrome("https://www.netflix.com");
        } catch (error) {
          console.error("Failed to open Netflix in Chrome", error);
          sendError(socket, "Failed to open Google Chrome with Netflix.");
          return;
        }

        sendMessage(socket, { type: "open_netflix_accepted" });
        break;
      }

      case "open_netflix_url": {
        if (socket.role !== "remote-ui") {
          sendError(socket, "Only remote UI clients can open Netflix URLs.");
          return;
        }

        const reference = parseNetflixReference(message.url);
        if (!reference) {
          sendError(
            socket,
            "Only Netflix watch, title, or supported share URLs are accepted.",
          );
          return;
        }

        void cacheNetflixTitle(reference.watchUrl).then(() => {
          latestPlayback = titleForPlayback(latestPlayback);
          broadcastSnapshot();
        });

        try {
          await openNetflixInChrome(reference.watchUrl);
        } catch (error) {
          console.error("Failed to open Netflix URL in Chrome", error);
          sendError(
            socket,
            "Failed to open Google Chrome with the Netflix URL.",
          );
          return;
        }

        sendMessage(socket, {
          type: "open_netflix_url_accepted",
        });
        break;
      }

      case "request_state": {
        sendMessage(socket, currentSnapshot());
        break;
      }

      case "heartbeat": {
        break;
      }

      case "playback_command": {
        if (socket.role !== "remote-ui") {
          sendError(socket, "Only remote UI clients can control playback.");
          return;
        }

        if (!extensionClient || extensionClient.readyState !== WebSocket.OPEN) {
          sendError(socket, "No extension client is currently connected.");
          return;
        }

        if (message.command === "seek") {
          pendingSeekTime =
            message.options.kind === "absolute"
              ? message.options.time
              : latestPlayback?.currentTime !== undefined
                ? latestPlayback.currentTime + message.options.time
                : null;

          if (pendingSeekTime !== null && latestPlayback) {
            latestPlayback = {
              ...latestPlayback,
              currentTime: Math.max(0, pendingSeekTime),
            };
            broadcastSnapshot();
          }

          sendMessage(extensionClient, {
            type: "execute_playback_command",
            command: message.command,
            options: message.options,
          });
        } else {
          sendMessage(extensionClient, {
            type: "execute_playback_command",
            command: message.command,
          });
        }
        break;
      }

      case "playback_state": {
        if (socket.role !== "extension") {
          sendError(
            socket,
            "Only extension clients can report playback state.",
          );
          return;
        }

        const nextPlayback = titleForPlayback({
          ...message.playback,
          title: undefined,
          episodeNumber: null,
          episodeTitle: null,
        });

        if (
          nextPlayback &&
          pendingSeekTime !== null &&
          nextPlayback.currentTime !== undefined &&
          Math.abs(nextPlayback.currentTime - pendingSeekTime) <= 1
        ) {
          pendingSeekTime = null;
        }

        latestPlayback =
          nextPlayback && pendingSeekTime !== null
            ? {
                ...nextPlayback,
                currentTime: pendingSeekTime,
              }
            : nextPlayback;
        broadcastSnapshot();
        refreshPlaybackTitleFromUrl(latestPlayback);
        break;
      }
    }
  });

  socket.on("close", () => {
    if (socket === extensionClient) {
      extensionClient = null;
    }

    remoteClients.delete(socket);
    broadcastSnapshot();
  });
});

const heartbeatInterval = setInterval(() => {
  for (const socket of webSocketServer.clients as Set<RegisteredSocket>) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, 30000);

webSocketServer.on("close", () => {
  clearInterval(heartbeatInterval);
});

httpServer.listen(port, host, () => {
  console.log(`TV control server listening on http://${host}:${port}`);
});
