import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import {
  clientToServerMessageSchema,
  errorMessageSchema,
  helloAckMessageSchema,
  stateSnapshotMessageSchema,
  type ClientRole,
  type PlaybackState,
  type ServerToClientMessage
} from "@tv-control/protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { normalizeNetflixUrl } from "./netflix.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 8787);
const remoteUiDistPath = fileURLToPath(new URL("../../remote-ui/dist", import.meta.url));

type RegisteredSocket = WebSocket & {
  isAlive?: boolean;
  role?: ClientRole;
  name?: string;
};

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

let extensionClient: RegisteredSocket | null = null;
const remoteClients = new Set<RegisteredSocket>();
let latestPlayback: PlaybackState | null = null;

function sendMessage(socket: WebSocket, message: ServerToClientMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function currentSnapshot(): ServerToClientMessage {
  return stateSnapshotMessageSchema.parse({
    type: "state_snapshot",
    extensionConnected: extensionClient?.readyState === WebSocket.OPEN,
    playback: latestPlayback
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

async function serveRemoteUi(pathname: string, response: ServerResponse): Promise<void> {
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

  response.writeHead(200, {
    "content-type": mimeTypes[extname(target)] ?? "application/octet-stream",
    "cache-control": target.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable"
  });

  createReadStream(target).pipe(response);
}

const httpServer = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400).end();
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);

  try {
    await serveRemoteUi(url.pathname, response);
  } catch (error) {
    console.error("Failed to serve remote UI", error);
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  }
});

const webSocketServer = new WebSocketServer({ server: httpServer, path: "/ws" });

webSocketServer.on("connection", (socket: RegisteredSocket) => {
  socket.isAlive = true;

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", (rawData: RawData) => {
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

        sendMessage(socket, helloAckMessageSchema.parse({ type: "hello_ack", role: message.role }));
        sendMessage(socket, currentSnapshot());
        broadcastSnapshot();
        break;
      }

      case "open_netflix_url": {
        if (socket.role !== "remote-ui") {
          sendError(socket, "Only remote UI clients can open Netflix URLs.");
          return;
        }

        if (!extensionClient || extensionClient.readyState !== WebSocket.OPEN) {
          sendError(socket, "No extension client is currently connected.");
          return;
        }

        const normalizedUrl = normalizeNetflixUrl(message.url);
        if (!normalizedUrl) {
          sendError(socket, "Only direct Netflix watch/title URLs are supported right now.");
          return;
        }

        sendMessage(
          extensionClient,
          {
            type: "open_url",
            url: normalizedUrl
          }
        );
        break;
      }

      case "request_state": {
        sendMessage(socket, currentSnapshot());
        break;
      }

      case "playback_state": {
        if (socket.role !== "extension") {
          sendError(socket, "Only extension clients can report playback state.");
          return;
        }

        latestPlayback = message.playback;
        broadcastSnapshot();
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
