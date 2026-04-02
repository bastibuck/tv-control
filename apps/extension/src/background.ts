import {
  clientToServerMessageSchema,
  serverToClientMessageSchema,
  type PlaybackCommand,
  type PlaybackState
} from "@tv-control/protocol";
import { NETFLIX_URL_PATTERN, RECONNECT_DELAY_MS, SERVER_WS_URL } from "./config";

type ContentMessage = {
  type: "content_playback_state";
  playback: PlaybackState;
};

type BackgroundToContentMessage = {
  type: "playback_command";
  command: PlaybackCommand;
};

const HEARTBEAT_INTERVAL_MS = 20000;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let latestPlayback: PlaybackState | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function sendToServer(message: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

async function findNetflixTab(): Promise<chrome.tabs.Tab | undefined> {
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => typeof tab.url === "string" && NETFLIX_URL_PATTERN.test(tab.url));
}

async function openOrReuseNetflixTab(url: string): Promise<void> {
  const existingTab = await findNetflixTab();

  if (existingTab?.id !== undefined) {
    await chrome.tabs.update(existingTab.id, { active: true, url });

    if (existingTab.windowId !== undefined) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }

    return;
  }

  await chrome.tabs.create({ url, active: true });
}

async function dispatchPlaybackCommand(command: PlaybackCommand): Promise<void> {
  const netflixTab = await findNetflixTab();
  if (netflixTab?.id === undefined) {
    return;
  }

  if (command === "reload") {
    await chrome.tabs.reload(netflixTab.id);
    return;
  }

  if (command === "seek_back_10" || command === "seek_forward_10") {
    const deltaSeconds = command === "seek_back_10" ? -10 : 10;
    await chrome.scripting.executeScript({
      target: { tabId: netflixTab.id },
      world: "MAIN",
      args: [deltaSeconds],
      func: (seconds: number) => {
        const globalObject = window as typeof window & {
          netflix?: {
            appContext?: {
              state?: {
                playerApp?: {
                  getAPI?: () => {
                    videoPlayer?: {
                      getAllPlayerSessionIds?: () => string[];
                      getVideoPlayerBySessionId?: (sessionId: string) => {
                        seek?: (timeMs: number) => void;
                        getCurrentTime?: () => number;
                      };
                    };
                  };
                };
              };
            };
          };
        };

        try {
          const videoApi = globalObject.netflix?.appContext?.state?.playerApp?.getAPI?.().videoPlayer;
          const sessionId = videoApi?.getAllPlayerSessionIds?.()[0];
          const player = sessionId ? videoApi?.getVideoPlayerBySessionId?.(sessionId) : undefined;
          const currentTimeMs = player?.getCurrentTime?.();
          if (player?.seek && typeof currentTimeMs === "number") {
            player.seek(Math.max(0, currentTimeMs + seconds * 1000));
            return;
          }
        } catch {
          // Fall back to the content script path below.
        }

        const video = document.querySelector("video");
        if (video instanceof HTMLVideoElement) {
          const duration = Number.isFinite(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER;
          video.currentTime = Math.max(0, Math.min(duration, video.currentTime + seconds));
        }
      }
    });
    return;
  }

  await chrome.tabs.sendMessage(netflixTab.id, {
    type: "playback_command",
    command
  } satisfies BackgroundToContentMessage);
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) {
    return;
  }

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(): void {
  stopHeartbeat();

  heartbeatTimer = setInterval(() => {
    sendToServer({ type: "heartbeat" });
  }, HEARTBEAT_INTERVAL_MS);
}

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(SERVER_WS_URL);

  socket.addEventListener("open", () => {
    sendToServer({ type: "hello", role: "extension", name: "chrome-netflix-bridge" });
    startHeartbeat();

    if (latestPlayback) {
      sendToServer({ type: "playback_state", playback: latestPlayback });
    }
  });

  socket.addEventListener("message", async (event) => {
    let payload: unknown;

    try {
      payload = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }

    const parsed = serverToClientMessageSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }

    const message = parsed.data;
    if (message.type === "open_url") {
      await openOrReuseNetflixTab(message.url);
    }

    if (message.type === "execute_playback_command") {
      await dispatchPlaybackCommand(message.command);
    }
  });

  socket.addEventListener("close", () => {
    stopHeartbeat();
    socket = null;
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    stopHeartbeat();
    socket?.close();
  });
}

chrome.runtime.onMessage.addListener((message: ContentMessage) => {
  if (message.type !== "content_playback_state") {
    return;
  }

  const parsed = clientToServerMessageSchema.safeParse({ type: "playback_state", playback: message.playback });
  if (!parsed.success) {
    return;
  }

  latestPlayback = message.playback;
  sendToServer(parsed.data);
});

chrome.runtime.onStartup.addListener(() => {
  connect();
});

chrome.runtime.onInstalled.addListener(() => {
  connect();
});

connect();
