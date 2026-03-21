import type { PlaybackState, PlaybackStatus } from "@tv-control/protocol";

type PlaybackDetails = Pick<PlaybackState, "title" | "currentTime" | "duration" | "url">;

let attachedVideo: HTMLVideoElement | null = null;
let lastHref = location.href;
let lastSentAt = 0;

function extractTitle(): string | undefined {
  const heading = document.querySelector<HTMLElement>("h4, h3, .video-title, .title-logo")?.innerText?.trim();
  if (heading) {
    return heading;
  }

  const title = document.title.replace(/\s*-\s*Netflix$/i, "").trim();
  return title || undefined;
}

function computePlaybackStatus(video: HTMLVideoElement | null): PlaybackStatus {
  if (!video) {
    return document.readyState === "complete" ? "idle" : "loading";
  }

  if (video.readyState < 2) {
    return "loading";
  }

  return video.paused ? "paused" : "playing";
}

function playbackDetails(video: HTMLVideoElement | null): PlaybackDetails {
  return {
    title: extractTitle(),
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

function locateVideo(): void {
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

sendPlayback(true);
