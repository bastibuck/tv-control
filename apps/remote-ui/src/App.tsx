import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  serverToClientMessageSchema,
  type PlaybackState,
  type ServerToClientMessage
} from "@tv-control/protocol";

type ConnectionState = "connecting" | "connected" | "disconnected";

function formatRuntime(seconds?: number): string {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return "Runtime unknown";
  }

  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

function formatProgressTime(seconds?: number): string {
  if (seconds === undefined || Number.isNaN(seconds)) {
    return "--";
  }

  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  return `${hours} hr ${minutes} min`;
}

function playbackLabel(playback: PlaybackState | null): string {
  if (!playback) {
    return "Stand by";
  }

  if (!playback.controllable) {
    return "Not controllable yet";
  }

  switch (playback.status) {
    case "idle":
      return "Ready";
    case "loading":
      return "Loading";
    case "playing":
      return "Playing";
    case "paused":
      return "Paused";
  }
}

function currentAction(playback: PlaybackState | null): "play" | "pause" {
  return playback?.status === "playing" || playback?.status === "loading" ? "pause" : "play";
}

function playbackActionLabel(playback: PlaybackState | null): string {
  return currentAction(playback) === "pause" ? "Pause" : "Play";
}

function primaryHeading(playback: PlaybackState | null): string {
  if (playback?.status === "playing" || playback?.status === "paused" || playback?.status === "loading") {
    return playback.title ?? "Netflix is ready";
  }

  return "Pick tonight's stream";
}

function statusCopy(playback: PlaybackState | null, extensionConnected: boolean): string {
  if (!extensionConnected) {
    return "Connect Chrome with the extension to open or control Netflix.";
  }

  if (!playback) {
    return "Paste a Netflix link to open something on your TV browser.";
  }

  if (!playback.controllable) {
    return "Netflix is open, but the player is not ready for play or pause yet.";
  }

  if (playback.status === "playing") {
    return "Your movie is live. Pause it here whenever you want.";
  }

  if (playback.status === "paused") {
    return "Playback is paused. Resume it from your phone.";
  }

  return "Netflix is loading. Controls will wake up as soon as the player is ready.";
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
      setStatusMessage("Connected to your local control server.");
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
          if (parsedMessage.extensionConnected && parsedMessage.playback?.controllable) {
            setStatusMessage("Player connected and ready.");
          } else if (parsedMessage.extensionConnected) {
            setStatusMessage("Chrome extension connected.");
          }
          break;
        case "error":
          setStatusMessage(parsedMessage.message);
          break;
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

  const progress = useMemo(() => {
    if (playback?.duration === undefined || playback.currentTime === undefined || playback.duration <= 0) {
      return 0;
    }

    return Math.min(100, (playback.currentTime / playback.duration) * 100);
  }, [playback]);

  const action = currentAction(playback);
  const actionDisabled =
    socketState !== "connected" ||
    !extensionConnected ||
    !playback?.controllable ||
    (action === "play" && playback.status !== "paused") ||
    (action === "pause" && playback.status !== "playing" && playback.status !== "loading");
  const showPlaybackMode = playback !== null && (playback.status === "playing" || playback.status === "paused" || playback.status === "loading");

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

  function sendPlaybackCommand(command: "play" | "pause"): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setStatusMessage("Server is not connected yet.");
      return;
    }

    if (!extensionConnected) {
      setStatusMessage("Chrome extension is not connected.");
      return;
    }

    if (!playback?.controllable) {
      setStatusMessage("Netflix is not controllable yet.");
      return;
    }

    socket.send(JSON.stringify({ type: "playback_command", command }));
    setStatusMessage(command === "play" ? "Sending play command..." : "Sending pause command...");
  }

  return (
    <main className={`app-shell ${showPlaybackMode ? "app-shell--playback" : "app-shell--launch"}`}>
      <section className="hero-card">
        <div className="status-strip" aria-label="Connections">
          <span className="status-chip" title={`Server: ${socketState}`}>
            <span className={`status-dot status-dot--${socketState}`} />
            <span className="status-symbol">S</span>
          </span>
          <span className="status-chip" title={`Chrome extension: ${extensionConnected ? "connected" : "disconnected"}`}>
            <span className={`status-dot status-dot--${extensionConnected ? "connected" : "disconnected"}`} />
            <span className="status-symbol">N</span>
          </span>
          <button className="reload-button" type="button" onClick={handleReconnect} aria-label="Reconnect websocket">
            ↻
          </button>
        </div>

        <p className="eyebrow">TV control</p>
        <h1>{primaryHeading(playback)}</h1>
        <p className="hero-copy">{statusCopy(playback, extensionConnected)}</p>
      </section>

      {!showPlaybackMode ? (
        <section className="panel-card panel-card--feature">
          <form className="launch-form" onSubmit={handleSubmit}>
            <label htmlFor="netflix-url">Netflix link</label>
            <input
              id="netflix-url"
              type="url"
              inputMode="url"
              placeholder="Paste a watch or share link"
              value={netflixUrl}
              onChange={(event) => setNetflixUrl(event.target.value)}
            />
            <button type="submit" disabled={socketState !== "connected"}>
              Start in Chrome
            </button>
          </form>
          <p className="status-message">{statusMessage}</p>
        </section>
      ) : (
        <section className="panel-card panel-card--feature playback-card">
          <div className="playback-topline">
            <span className="playback-badge">{playbackLabel(playback)}</span>
          </div>

          <button
            className="transport-button"
            type="button"
            onClick={() => sendPlaybackCommand(action)}
            disabled={actionDisabled}
          >
            {playbackActionLabel(playback)}
          </button>

          {!playback?.controllable ? <p className="control-note">The player is not ready yet, so controls will wake up shortly.</p> : null}

          <div className="timeline-track" aria-hidden="true">
            <div className="timeline-progress" style={{ width: `${progress}%` }} />
          </div>

          <div className="timeline-meta">
            <span>{formatProgressTime(playback?.currentTime)}</span>
            <span>{formatRuntime(playback?.duration)}</span>
          </div>

          <div className="playback-footer">
            <div>
              <p className="footer-label">Now playing</p>
              <h2>{playback?.title ?? "Netflix is open"}</h2>
            </div>
            <p className="playback-url">{playback?.url ?? "Waiting for Netflix page data..."}</p>
          </div>
        </section>
      )}
    </main>
  );
}
