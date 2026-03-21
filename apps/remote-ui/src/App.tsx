import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  serverToClientMessageSchema,
  type PlaybackState,
  type ServerToClientMessage
} from "@tv-control/protocol";

type ConnectionState = "connecting" | "connected" | "disconnected";

function formatTime(seconds?: number): string {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return "--:--";
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function playbackLabel(playback: PlaybackState | null): string {
  if (!playback) {
    return "Waiting for Netflix tab";
  }

  switch (playback.status) {
    case "idle":
      return "Idle";
    case "loading":
      return "Loading";
    case "playing":
      return "Playing";
    case "paused":
      return "Paused";
  }
}

export function App(): ReactElement {
  const [socketState, setSocketState] = useState<ConnectionState>("connecting");
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [netflixUrl, setNetflixUrl] = useState("");
  const [statusMessage, setStatusMessage] = useState("Paste a Netflix watch link to send it to Chrome.");
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [reconnectVersion, setReconnectVersion] = useState(0);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let shouldReconnect = true;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const nextSocket = new WebSocket(`${protocol}//${window.location.host}/ws`);

    setSocketState("connecting");

    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    function scheduleReconnect(): void {
      if (!shouldReconnect || reconnectTimerRef.current !== null) {
        return;
      }

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        setReconnectVersion((value) => value + 1);
      }, 2500);
    }

    nextSocket.addEventListener("open", () => {
      setSocketState("connected");
      setStatusMessage("Paste a Netflix watch link to send it to Chrome.");
      nextSocket.send(JSON.stringify({ type: "hello", role: "remote-ui", name: "phone-remote" }));
      nextSocket.send(JSON.stringify({ type: "request_state" }));
    });

    nextSocket.addEventListener("close", () => {
      if (!shouldReconnect) {
        return;
      }

      setSocketState("disconnected");
      setExtensionConnected(false);
      setSocket(null);
      setStatusMessage("Server disconnected. Reconnecting...");
      scheduleReconnect();
    });

    nextSocket.addEventListener("error", () => {
      if (!shouldReconnect) {
        return;
      }

      setStatusMessage("Lost connection to the server.");
    });

    nextSocket.addEventListener("message", (event) => {
      let parsedMessage: ServerToClientMessage | null = null;

      try {
        const payload = JSON.parse(event.data) as unknown;
        const validated = serverToClientMessageSchema.safeParse(payload);
        if (validated.success) {
          parsedMessage = validated.data;
        }
      } catch {
        parsedMessage = null;
      }

      if (!parsedMessage) {
        return;
      }

      switch (parsedMessage.type) {
        case "hello_ack":
          setSocket(nextSocket);
          break;
        case "state_snapshot":
          setExtensionConnected(parsedMessage.extensionConnected);
          setPlayback(parsedMessage.playback);
          if (parsedMessage.extensionConnected) {
            setStatusMessage("Chrome extension connected.");
          }
          break;
        case "error":
          setStatusMessage(parsedMessage.message);
          break;
        case "open_url":
          break;
      }
    });

    return () => {
      shouldReconnect = false;

      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }

      nextSocket.close();
    };
  }, [reconnectVersion]);

  const progress = useMemo(() => {
    if (!playback?.duration || !playback.currentTime) {
      return 0;
    }

    return Math.min(100, (playback.currentTime / playback.duration) * 100);
  }, [playback]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setStatusMessage("Server is not connected yet.");
      return;
    }

    socket.send(JSON.stringify({ type: "open_netflix_url", url: netflixUrl.trim() }));
    setStatusMessage("Sending link to Chrome...");
  }

  function handleReconnect(): void {
    setSocket(null);
    setExtensionConnected(false);
    setSocketState("connecting");
    setStatusMessage("Reconnecting to the server...");
    setReconnectVersion((value) => value + 1);
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">TV control</p>
        <h1>Launch Netflix from your phone.</h1>
        <p className="subtitle">
          This remote talks to your local server, which forwards the command to your Chrome extension.
        </p>
      </section>

      <section className="status-grid">
        <article className="status-card">
          <span className={`status-dot status-dot--${socketState}`} />
          <div>
            <h2>Server</h2>
            <p>{socketState}</p>
          </div>
        </article>
        <article className="status-card">
          <span className={`status-dot status-dot--${extensionConnected ? "connected" : "disconnected"}`} />
          <div>
            <h2>Chrome extension</h2>
            <p>{extensionConnected ? "connected" : "waiting"}</p>
          </div>
        </article>
      </section>

      <section className="panel-card">
        <form className="launch-form" onSubmit={handleSubmit}>
          <label htmlFor="netflix-url">Netflix link</label>
          <input
            id="netflix-url"
            type="url"
            inputMode="url"
            placeholder="https://www.netflix.com/watch/..."
            value={netflixUrl}
            onChange={(event) => setNetflixUrl(event.target.value)}
          />
          <button type="submit" disabled={socketState !== "connected"}>
            Open in Chrome
          </button>
        </form>
        <p className="status-message">{statusMessage}</p>
        <button className="secondary-button" type="button" onClick={handleReconnect}>
          Reconnect websocket
        </button>
      </section>

      <section className="panel-card playback-card">
        <div className="playback-header">
          <div>
            <p className="eyebrow">Live playback</p>
            <h2>{playback?.title ?? "No title yet"}</h2>
          </div>
          <span className="playback-badge">{playbackLabel(playback)}</span>
        </div>

        <div className="timeline-track" aria-hidden="true">
          <div className="timeline-progress" style={{ width: `${progress}%` }} />
        </div>

        <div className="timeline-meta">
          <span>{formatTime(playback?.currentTime)}</span>
          <span>{formatTime(playback?.duration)}</span>
        </div>

        <p className="playback-url">{playback?.url ?? "Waiting for Netflix page data..."}</p>
      </section>
    </main>
  );
}
