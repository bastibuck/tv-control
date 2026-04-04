import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  serverToClientMessageSchema,
  type PlaybackCommand,
  type PlaybackState,
  type ServerToClientMessage
} from "@tv-control/protocol";

type ConnectionState = "connecting" | "connected" | "disconnected";

function formatClock(seconds?: number): string {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return "--:--";
  }

  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function playbackLabel(playback: PlaybackState | null): string {
  if (!playback) {
    return "Waiting for a title";
  }

  if (!playback.controllable) {
    return "Player waking up";
  }

  switch (playback.status) {
    case "idle":
      return "Ready to start";
    case "loading":
      return "Loading on screen";
    case "playing":
      return "Playing now";
    case "paused":
      return "Paused on screen";
  }
}

function statusLine(playback: PlaybackState | null, extensionConnected: boolean): string {
  if (!extensionConnected) {
    return "Open Chrome with the Netflix bridge and this remote comes online.";
  }

  if (!playback) {
    return "Paste a Netflix link and send it to the big screen.";
  }

  if (!playback.controllable) {
    return "Netflix is open. Controls appear as soon as the player is ready.";
  }

  if (playback.status === "idle") {
    return "Netflix is open, but nothing is playing right now.";
  }

  return "Netflix is open and ready on the big screen.";
}

function transportMode(playback: PlaybackState | null): "play" | "pause" {
  return playback?.status === "playing" || playback?.status === "loading" ? "pause" : "play";
}

function transportLabel(playback: PlaybackState | null): string {
  return transportMode(playback) === "pause" ? "Pause" : "Play";
}

function seekLabel(command: PlaybackCommand): string {
  return command === "seek_back_10" ? "-10s" : "+10s";
}

function TransportIcon({ mode }: { mode: "play" | "pause" }): ReactElement {
  if (mode === "pause") {
    return (
      <span className="transport-icon" aria-hidden="true">
        <span />
        <span />
      </span>
    );
  }

  return <span className="transport-play" aria-hidden="true" />;
}

export function App(): ReactElement {
  const [socketState, setSocketState] = useState<ConnectionState>("connecting");
  const [extensionConnected, setExtensionConnected] = useState(false);
  const [playback, setPlayback] = useState<PlaybackState | null>(null);
  const [displayCurrentTime, setDisplayCurrentTime] = useState<number | undefined>(undefined);
  const [netflixUrl, setNetflixUrl] = useState("");
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
      scheduleReconnect();
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
          break;
        case "open_netflix_url_accepted":
          setNetflixUrl("");
          break;
        case "open_netflix_accepted":
          // No state update needed; the button is a fire-and-forget action.
          break;
        case "error":
        case "open_url":
        case "execute_playback_command":
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

  useEffect(() => {
    if (!playback) {
      setDisplayCurrentTime(undefined);
      return;
    }

    setDisplayCurrentTime(playback.currentTime);

    if (playback.status !== "playing" || playback.currentTime === undefined) {
      return;
    }

    const startedAt = window.performance.now();
    const baseTime = playback.currentTime;
    const timer = window.setInterval(() => {
      const elapsedSeconds = (window.performance.now() - startedAt) / 1000;
      const nextTime = baseTime + elapsedSeconds;
      const cappedTime = playback.duration === undefined ? nextTime : Math.min(nextTime, playback.duration);
      setDisplayCurrentTime(cappedTime);
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [playback]);

  const progress = useMemo(() => {
    if (playback?.duration === undefined || displayCurrentTime === undefined || playback.duration <= 0) {
      return 0;
    }

    return Math.min(100, (displayCurrentTime / playback.duration) * 100);
  }, [displayCurrentTime, playback]);

  const mode = transportMode(playback);
  const transportDisabled =
    socketState !== "connected" ||
    !extensionConnected ||
    !playback?.controllable ||
    (mode === "play" && playback.status !== "paused") ||
    (mode === "pause" && playback.status !== "playing" && playback.status !== "loading");
  const playbackActive = playback !== null && (playback.status === "playing" || playback.status === "paused" || playback.status === "loading");
  const reloadDisabled = socketState !== "connected" || !extensionConnected;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type: "open_netflix_url", url: netflixUrl.trim() }));
  }

  function handleReconnect(): void {
    setSocket(null);
    setExtensionConnected(false);
    setSocketState("connecting");
    setReconnectVersion((value) => value + 1);
  }

  function handleTransport(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!extensionConnected || !playback?.controllable) {
      return;
    }

    socket.send(JSON.stringify({ type: "playback_command", command: mode }));
  }

  function handleSeek(command: PlaybackCommand): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!extensionConnected || !playback?.controllable) {
      return;
    }

    socket.send(JSON.stringify({ type: "playback_command", command }));
  }

  function handleReload(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN || !extensionConnected) {
      return;
    }

    socket.send(JSON.stringify({ type: "playback_command", command: "reload" }));
  }

  function handleOpenNetflix(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN || !extensionConnected) {
      return;
    }

    socket.send(JSON.stringify({ type: "open_netflix" }));
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="hero-noise" aria-hidden="true" />
        <div className="status-row" aria-label="Connections">
          <span className="status-pill" title={`Server: ${socketState}`}>
            <span className={`status-light status-light--${socketState}`} />
            <span className="status-glyph">R</span>
          </span>
          <span className="status-pill" title={`Netflix bridge: ${extensionConnected ? "connected" : "disconnected"}`}>
            <span className={`status-light status-light--${extensionConnected ? "connected" : "disconnected"}`} />
            <span className="status-glyph">N</span>
          </span>
          <button className="refresh-button" type="button" onClick={handleReconnect} aria-label="Reconnect websocket">
            <span className="refresh-ring" />
          </button>
        </div>

        <p className="hero-kicker">Netflix remote</p>
        <p className="hero-copy">{statusLine(playback, extensionConnected)}</p>

        <form className="launch-form" onSubmit={handleSubmit}>
          <div className="launch-bar">
            <input
              id="netflix-url"
              type="url"
              inputMode="url"
              placeholder="Paste watch or share link"
              value={netflixUrl}
              onChange={(event) => setNetflixUrl(event.target.value)}
            />
            <button type="submit" disabled={socketState !== "connected"}>
              Send
            </button>
          </div>
        </form>
      </section>

      <section className={`panel-card playback-card ${playbackActive ? "playback-card--active" : "playback-card--idle"}`}>
        <div className="title-block">
          <p className="section-label">Now showing</p>
          <h2>{playback?.title ?? "Nothing has started yet"}</h2>
          <p className="section-copy">{playbackLabel(playback)}</p>
        </div>

        <div className="transport-row">
          <button
            className="seek-button"
            type="button"
            onClick={() => handleSeek("seek_back_10")}
            disabled={transportDisabled}
          >
            <span>{seekLabel("seek_back_10")}</span>
          </button>

          <button
            className="transport-button"
            type="button"
            onClick={handleTransport}
            disabled={transportDisabled}
            aria-label={transportLabel(playback)}
          >
            <TransportIcon mode={mode} />
          </button>

          <button
            className="seek-button"
            type="button"
            onClick={() => handleSeek("seek_forward_10")}
            disabled={transportDisabled}
          >
            <span>{seekLabel("seek_forward_10")}</span>
          </button>
        </div>

        <div className="progress-shell" aria-hidden="true">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>

        <div className="time-row">
          <span>{formatClock(displayCurrentTime)}</span>
          <span>{formatClock(playback?.duration)}</span>
        </div>

        {!playback?.controllable && playback !== null ? (
          <p className="hint-copy">The Netflix player is visible, but not ready for commands yet.</p>
        ) : null}

        <div className="action-row">
          <button className="reload-button" type="button" onClick={handleOpenNetflix} disabled={reloadDisabled}>
            Open Netflix
          </button>
          <button className="reload-button" type="button" onClick={handleReload} disabled={reloadDisabled}>
            Reload Netflix Tab
          </button>
        </div>
      </section>
    </main>
  );
}
