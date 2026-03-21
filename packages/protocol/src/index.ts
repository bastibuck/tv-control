import { z } from "zod";

export const clientRoleSchema = z.enum(["remote-ui", "extension"]);
export type ClientRole = z.infer<typeof clientRoleSchema>;

export const playbackStatusSchema = z.enum(["idle", "loading", "playing", "paused"]);
export type PlaybackStatus = z.infer<typeof playbackStatusSchema>;

export const playbackStateSchema = z.object({
  status: playbackStatusSchema,
  controllable: z.boolean(),
  title: z.string().min(1).optional(),
  currentTime: z.number().nonnegative().optional(),
  duration: z.number().nonnegative().optional(),
  url: z.string().url().optional(),
  updatedAt: z.number().int().nonnegative()
});
export type PlaybackState = z.infer<typeof playbackStateSchema>;

export const helloMessageSchema = z.object({
  type: z.literal("hello"),
  role: clientRoleSchema,
  name: z.string().min(1).max(100).optional()
});

export const openNetflixUrlMessageSchema = z.object({
  type: z.literal("open_netflix_url"),
  url: z.string().url()
});

export const requestStateMessageSchema = z.object({
  type: z.literal("request_state")
});

export const playbackCommandMessageSchema = z.object({
  type: z.literal("playback_command"),
  command: z.enum(["play", "pause"])
});

export const playbackStateMessageSchema = z.object({
  type: z.literal("playback_state"),
  playback: playbackStateSchema
});

export const clientToServerMessageSchema = z.discriminatedUnion("type", [
  helloMessageSchema,
  openNetflixUrlMessageSchema,
  requestStateMessageSchema,
  playbackCommandMessageSchema,
  playbackStateMessageSchema
]);
export type ClientToServerMessage = z.infer<typeof clientToServerMessageSchema>;

export const helloAckMessageSchema = z.object({
  type: z.literal("hello_ack"),
  role: clientRoleSchema
});

export const openUrlMessageSchema = z.object({
  type: z.literal("open_url"),
  url: z.string().url()
});

export const executePlaybackCommandMessageSchema = z.object({
  type: z.literal("execute_playback_command"),
  command: z.enum(["play", "pause"])
});

export const stateSnapshotMessageSchema = z.object({
  type: z.literal("state_snapshot"),
  extensionConnected: z.boolean(),
  playback: playbackStateSchema.nullable()
});

export const errorMessageSchema = z.object({
  type: z.literal("error"),
  message: z.string().min(1)
});

export const serverToClientMessageSchema = z.discriminatedUnion("type", [
  helloAckMessageSchema,
  openUrlMessageSchema,
  executePlaybackCommandMessageSchema,
  stateSnapshotMessageSchema,
  errorMessageSchema
]);
export type ServerToClientMessage = z.infer<typeof serverToClientMessageSchema>;
