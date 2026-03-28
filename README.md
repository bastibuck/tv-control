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

## Run As A systemd Service

If you want the server to keep running after you disconnect from SSH, install it as a `systemd` service.

This repo includes an example unit file at `deploy/tv-control.service`.

- `WorkingDirectory=/home/bastibuck/dev/tv-control` points `systemd` at the checked-out repo
- `User=bastibuck` runs the service as your normal server user
- `ExecStart=/usr/bin/env pnpm start` runs the root `start` script from the workspace
- Use the full absolute path for `WorkingDirectory` in a system service so startup is explicit and easier to debug

### Install The Service

1. Copy the repo to your server at `~/dev/tv-control`.
2. Install dependencies:

   ```bash
   cd ~/dev/tv-control
   pnpm install
   ```

3. Build the app:

   ```bash
   pnpm build
   ```

4. Copy the service file into `systemd`:

   ```bash
   sudo cp deploy/tv-control.service /etc/systemd/system/tv-control.service
   ```

5. Reload `systemd`:

   ```bash
   sudo systemctl daemon-reload
   ```

6. Enable the service so it starts on boot:

   ```bash
   sudo systemctl enable tv-control
   ```

### Start The Service

```bash
sudo systemctl start tv-control
```

### Check If It Is Running

Show current status:

```bash
sudo systemctl status tv-control
```

Follow the live logs:

```bash
journalctl -u tv-control -f
```

### Restart After Code Changes

Rebuild the app:

```bash
cd ~/dev/tv-control
pnpm build
```

Restart the service:

```bash
sudo systemctl restart tv-control
```

### Stop The Service

```bash
sudo systemctl stop tv-control
```

### Remove The Service Again

Stop it and disable it:

```bash
sudo systemctl stop tv-control
sudo systemctl disable tv-control
```

Delete the unit file and reload `systemd`:

```bash
sudo rm /etc/systemd/system/tv-control.service
sudo systemctl daemon-reload
```

Reset any failed-state metadata if needed:

```bash
sudo systemctl reset-failed tv-control
```
