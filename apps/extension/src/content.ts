import type { PlaybackState, PlaybackStatus } from "@tv-control/protocol";

type PlaybackDetails = Pick<PlaybackState, "title" | "currentTime" | "duration" | "url">;
type IncomingCommandMessage = {
  type: "playback_command";
  command: "play" | "pause";
};

const WATCH_PATH_PATTERN = /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?watch\//;

let attachedVideo: HTMLVideoElement | null = null;
let lastHref = location.href;
let lastSentAt = 0;

function isWatchPage(): boolean {
  return WATCH_PATH_PATTERN.test(location.pathname);
}

function computePlaybackStatus(video: HTMLVideoElement | null): PlaybackStatus {
  if (!isWatchPage()) {
    return "idle";
  }

  if (!video) {
    return document.readyState === "complete" ? "idle" : "loading";
  }

  if (video.readyState < 2) {
    return "loading";
  }

  return video.paused ? "paused" : "playing";
}

function playbackDetails(video: HTMLVideoElement | null): PlaybackDetails {
  if (!isWatchPage()) {
    return {
      title: undefined,
      currentTime: undefined,
      duration: undefined,
      url: undefined
    };
  }

  return {
    title: undefined,
    currentTime: video?.currentTime,
    duration: Number.isFinite(video?.duration) ? video?.duration : undefined,
    url: location.href
  };
}

function sendPlayback(force = false): void {
  const now = Date.now();
  if (!force && now - lastSentAt < 1200) {
    return;
  }

  const playback: PlaybackState = {
    status: computePlaybackStatus(attachedVideo),
    controllable: isWatchPage() && attachedVideo !== null,
    ...playbackDetails(attachedVideo),
    updatedAt: now
  };

  chrome.runtime.sendMessage({ type: "content_playback_state", playback });
  lastSentAt = now;
}

function attachVideo(video: HTMLVideoElement): void {
  if (attachedVideo === video) {
    return;
  }

  attachedVideo = video;

  for (const eventName of ["play", "pause", "playing", "waiting", "loadedmetadata", "timeupdate", "seeking"]) {
    video.addEventListener(eventName, () => sendPlayback(eventName !== "timeupdate"));
  }

  sendPlayback(true);
}

async function applyPlaybackCommand(command: "play" | "pause"): Promise<void> {
  if (!attachedVideo) {
    locateVideo();
  }

  if (!attachedVideo) {
    return;
  }

  if (command === "play") {
    await attachedVideo.play().catch(() => undefined);
  } else {
    attachedVideo.pause();
  }

  sendPlayback(true);
}

function locateVideo(): void {
  if (!isWatchPage()) {
    attachedVideo = null;
    sendPlayback(true);
    return;
  }

  const video = document.querySelector("video");
  if (video instanceof HTMLVideoElement) {
    attachVideo(video);
    return;
  }

  attachedVideo = null;
  sendPlayback(true);
}

const observer = new MutationObserver(() => {
  locateVideo();
});

observer.observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener("load", () => {
  locateVideo();
  sendPlayback(true);
});

window.setInterval(() => {
  if (location.href !== lastHref) {
    lastHref = location.href;
    locateVideo();
    sendPlayback(true);
    return;
  }

  if (!attachedVideo) {
    locateVideo();
  }
}, 1000);

chrome.runtime.onMessage.addListener((message: IncomingCommandMessage) => {
  if (message.type !== "playback_command") {
    return;
  }

  void applyPlaybackCommand(message.command);
});

sendPlayback(true);
