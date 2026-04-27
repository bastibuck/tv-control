import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  serverToClientMessageSchema,
  type PlaybackState,
  type ServerToClientMessage,
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

function statusLine(
  playback: PlaybackState | null,
  extensionConnected: boolean,
): string {
  if (!extensionConnected) {
    return "Open Netflix to launch Chrome. Controls come online as soon as the bridge connects.";
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
  return playback?.status === "playing" || playback?.status === "loading"
    ? "pause"
    : "play";
}

function transportLabel(playback: PlaybackState | null): string {
  return transportMode(playback) === "pause" ? "Pause" : "Play";
}

function seekLabel(time: number): string {
  return `${time > 0 ? "+" : ""}${time}s`;
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
  const [displayCurrentTime, setDisplayCurrentTime] = useState<
    number | undefined
  >(undefined);
  const [netflixUrl, setNetflixUrl] = useState("");
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [reconnectVersion, setReconnectVersion] = useState(0);
  const [dragTime, setDragTime] = useState<number | null>(null);
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
      nextSocket.send(
        JSON.stringify({
          type: "hello",
          role: "remote-ui",
          name: "phone-remote",
        }),
      );
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
      const cappedTime =
        playback.duration === undefined
          ? nextTime
          : Math.min(nextTime, playback.duration);
      setDisplayCurrentTime(cappedTime);
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [playback]);

  const sliderTime = dragTime ?? displayCurrentTime;
  const progress = useMemo(() => {
    if (
      playback?.duration === undefined ||
      sliderTime === undefined ||
      playback.duration <= 0
    ) {
      return 0;
    }

    return Math.min(100, (sliderTime / playback.duration) * 100);
  }, [sliderTime, playback]);

  const mode = transportMode(playback);
  const transportDisabled =
    socketState !== "connected" ||
    !extensionConnected ||
    !playback?.controllable ||
    (mode === "play" && playback.status !== "paused") ||
    (mode === "pause" &&
      playback.status !== "playing" &&
      playback.status !== "loading");
  const playbackActive =
    playback !== null &&
    (playback.status === "playing" ||
      playback.status === "paused" ||
      playback.status === "loading");
  const launchDisabled = socketState !== "connected";
  const reloadDisabled = socketState !== "connected" || !extensionConnected;
  const sliderDisabled =
    transportDisabled ||
    playback?.duration === undefined ||
    playback.duration <= 0;

  function canSendSocketMessage(): boolean {
    return socket !== null && socket.readyState === WebSocket.OPEN;
  }

  function canControlPlayback(): boolean {
    return (
      canSendSocketMessage() && extensionConnected && !!playback?.controllable
    );
  }

  function sendSocketMessage(message: object): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }

  function sendPlaybackCommand(
    command: "play" | "pause" | "reload" | "seek",
    options?: { kind: "relative" | "absolute"; time: number },
  ): void {
    if (command === "reload") {
      if (!canSendSocketMessage() || !extensionConnected) {
        return;
      }
    } else if (!canControlPlayback()) {
      return;
    }

    if (command === "seek" && !options) {
      return;
    }

    sendSocketMessage(
      command === "seek"
        ? {
            type: "playback_command",
            command,
            options,
          }
        : {
            type: "playback_command",
            command,
          },
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    sendSocketMessage({
      type: "open_netflix_url",
      url: netflixUrl.trim(),
    });
  }

  function handleReconnect(): void {
    setSocket(null);
    setExtensionConnected(false);
    setSocketState("connecting");
    setReconnectVersion((value) => value + 1);
  }

  function handleTransport(): void {
    sendPlaybackCommand(mode);
  }

  function handleSeek(time: number): void {
    sendPlaybackCommand("seek", {
      kind: "relative",
      time,
    });
  }

  function handleSliderChange(event: ChangeEvent<HTMLInputElement>): void {
    setDragTime(Number(event.target.value));
  }

  function handleSliderCommit(): void {
    if (dragTime === null) {
      return;
    }

    if (!canControlPlayback()) {
      setDragTime(null);
      return;
    }

    sendPlaybackCommand("seek", {
      kind: "absolute",
      time: dragTime,
    });
    setDisplayCurrentTime(dragTime);
    setDragTime(null);
  }

  function handleReload(): void {
    sendPlaybackCommand("reload");
  }

  function handleOpenNetflix(): void {
    sendSocketMessage({ type: "open_netflix" });
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
          <span
            className="status-pill"
            title={`Netflix bridge: ${extensionConnected ? "connected" : "disconnected"}`}
          >
            <span
              className={`status-light status-light--${extensionConnected ? "connected" : "disconnected"}`}
            />
            <span className="status-glyph">N</span>
          </span>
          <button
            className="refresh-button"
            type="button"
            onClick={handleReconnect}
            aria-label="Reconnect websocket"
          >
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

      <section
        className={`panel-card playback-card ${playbackActive ? "playback-card--active" : "playback-card--idle"}`}
      >
        <div className="title-block">
          <p className="section-label">Now showing</p>
          <h2>{playback?.title ?? "Nothing has started yet"}</h2>
          <p className="section-copy">{playbackLabel(playback)}</p>
        </div>

        <div className="transport-row">
          <button
            className="seek-button"
            type="button"
            onClick={() => handleSeek(-10)}
            disabled={transportDisabled}
          >
            <span>{seekLabel(-10)}</span>
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
            onClick={() => handleSeek(10)}
            disabled={transportDisabled}
          >
            <span>{seekLabel(10)}</span>
          </button>
        </div>

        <div className="progress-shell">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
          <input
            type="range"
            min={0}
            max={playback?.duration ?? 0}
            step={1}
            value={sliderTime ?? 0}
            onChange={handleSliderChange}
            onMouseUp={handleSliderCommit}
            onTouchEnd={handleSliderCommit}
            disabled={sliderDisabled}
            aria-label="Seek playback position"
          />
        </div>

        <div className="time-row">
          <span>{formatClock(sliderTime)}</span>
          <span>{formatClock(playback?.duration)}</span>
        </div>

        {!playback?.controllable && playback !== null ? (
          <p className="hint-copy">
            The Netflix player is visible, but not ready for commands yet.
          </p>
        ) : null}

        <div className="action-row">
          <button
            className="reload-button"
            type="button"
            onClick={handleOpenNetflix}
            disabled={launchDisabled}
          >
            Open Netflix
          </button>
          <button
            className="reload-button"
            type="button"
            onClick={handleReload}
            disabled={reloadDisabled}
          >
            Reload Netflix Tab
          </button>
        </div>
      </section>
    </main>
  );
}
