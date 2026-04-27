import { z } from "zod";

export const clientRoleSchema = z.enum(["remote-ui", "extension"]);
export type ClientRole = z.infer<typeof clientRoleSchema>;

export const playbackStatusSchema = z.enum([
  "idle",
  "loading",
  "playing",
  "paused",
]);
export type PlaybackStatus = z.infer<typeof playbackStatusSchema>;

export const playbackCommandSchema = z.enum([
  "play",
  "pause",
  "reload",
  "seek",
]);
export type PlaybackCommand = z.infer<typeof playbackCommandSchema>;

export const seekOptionsSchema = z.object({
  kind: z.enum(["relative", "absolute"]),
  time: z.number(),
});
export type SeekOptions = z.infer<typeof seekOptionsSchema>;

export const playbackCommandMessageSchema = z.discriminatedUnion("command", [
  z.object({
    type: z.literal("playback_command"),
    command: z.enum(["play", "pause", "reload"]),
  }),
  z.object({
    type: z.literal("playback_command"),
    command: z.literal("seek"),
    options: seekOptionsSchema,
  }),
]);

export const playbackStateSchema = z.object({
  status: playbackStatusSchema,
  controllable: z.boolean(),
  title: z.string().min(1).optional(),
  currentTime: z.number().nonnegative().optional(),
  duration: z.number().nonnegative().optional(),
  url: z.url().optional(),
  updatedAt: z.number().int().nonnegative(),
});
export type PlaybackState = z.infer<typeof playbackStateSchema>;

export const helloMessageSchema = z.object({
  type: z.literal("hello"),
  role: clientRoleSchema,
  name: z.string().min(1).max(100).optional(),
});

export const openNetflixUrlMessageSchema = z.object({
  type: z.literal("open_netflix_url"),
  url: z.url(),
});

export const openNetflixMessageSchema = z.object({
  type: z.literal("open_netflix"),
});

export const requestStateMessageSchema = z.object({
  type: z.literal("request_state"),
});

export const heartbeatMessageSchema = z.object({
  type: z.literal("heartbeat"),
});

export const playbackStateMessageSchema = z.object({
  type: z.literal("playback_state"),
  playback: playbackStateSchema,
});

export const clientToServerMessageSchema = z.discriminatedUnion("type", [
  helloMessageSchema,
  openNetflixUrlMessageSchema,
  openNetflixMessageSchema,
  requestStateMessageSchema,
  heartbeatMessageSchema,
  playbackCommandMessageSchema,
  playbackStateMessageSchema,
]);
export type ClientToServerMessage = z.infer<typeof clientToServerMessageSchema>;

export const helloAckMessageSchema = z.object({
  type: z.literal("hello_ack"),
  role: clientRoleSchema,
});

export const openUrlMessageSchema = z.object({
  type: z.literal("open_url"),
  url: z.url(),
});

export const openNetflixUrlAcceptedMessageSchema = z.object({
  type: z.literal("open_netflix_url_accepted"),
});

export const openNetflixAcceptedMessageSchema = z.object({
  type: z.literal("open_netflix_accepted"),
});

export const executePlaybackCommandMessageSchema = z.discriminatedUnion(
  "command",
  [
    z.object({
      type: z.literal("execute_playback_command"),
      command: z.enum(["play", "pause", "reload"]),
    }),
    z.object({
      type: z.literal("execute_playback_command"),
      command: z.literal("seek"),
      options: seekOptionsSchema,
    }),
  ],
);

export const stateSnapshotMessageSchema = z.object({
  type: z.literal("state_snapshot"),
  extensionConnected: z.boolean(),
  playback: playbackStateSchema.nullable(),
});

export const errorMessageSchema = z.object({
  type: z.literal("error"),
  message: z.string().min(1),
});

export const serverToClientMessageSchema = z.discriminatedUnion("type", [
  helloAckMessageSchema,
  openUrlMessageSchema,
  openNetflixUrlAcceptedMessageSchema,
  openNetflixAcceptedMessageSchema,
  executePlaybackCommandMessageSchema,
  stateSnapshotMessageSchema,
  errorMessageSchema,
]);
export type ServerToClientMessage = z.infer<typeof serverToClientMessageSchema>;
