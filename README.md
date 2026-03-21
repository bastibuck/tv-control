# tv-control

Local-network Netflix launcher made of three parts:

- a Node WebSocket server that also serves the phone-friendly remote UI
- a React remote UI you open from your phone
- a Chrome extension that opens or reuses a Netflix tab and reports playback state back

## Workspace

- `apps/server` - Node + TypeScript HTTP/WebSocket hub
- `apps/remote-ui` - React + TypeScript remote control UI
- `apps/extension` - Chrome MV3 extension in TypeScript
- `packages/protocol` - shared WebSocket message types and schemas

## Quick Start

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Build everything:

   ```bash
   pnpm build
   ```

3. Start the server:

   ```bash
   pnpm start
   ```

   `pnpm start` runs the built server from `apps/server/dist`. It does not rebuild files and it does not hot reload.

4. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable Developer Mode
   - Click `Load unpacked`
   - Select `apps/extension/dist`

5. Open the remote UI on your phone or another device on the same network:

   ```text
   http://<server-ip>:8787
   ```

## Notes

- The extension defaults to `ws://localhost:8787/ws` in `apps/extension/src/config.ts`.
- If Chrome runs on a different machine than the server, update that value before building.
- The app supports opening Netflix watch/title/share URLs, showing live playback state, and sending play/pause controls.

## Local Network Run

Use this flow when you want to run the app on your local network in a production-style setup:

```bash
pnpm install
pnpm build
pnpm start
```

If you change code later, run `pnpm build` again and restart `pnpm start` so the server uses the latest output.
