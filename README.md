# tv-control

Local-network Netflix launcher made of three parts:

- a Node WebSocket server that also serves the phone-friendly remote UI
- a React remote UI you open from your phone
- a Chrome extension that opens or reuses a Netflix tab and reports playback state back

The server can also launch Chrome directly when the extension is not already connected.

## Workspace

- `apps/server` - Node + TypeScript HTTP/WebSocket hub
- `apps/remote-ui` - React + TypeScript remote control UI
- `apps/extension` - Chrome MV3 extension in TypeScript
- `packages/protocol` - shared WebSocket message types and schemas

## Quick Start

1. Install dependencies:

   ```bash
   pnpm install --frozen-lockfile
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

4. Build the extension so the server can auto-load it into the TV Control Chrome profile:

   `pnpm build` already writes the built extension to `apps/extension/dist`.

5. Open the remote UI on your phone or another device on the same network:

   ```text
   http://<server-ip>:8787
   ```

6. Press `Open Netflix` in the remote UI:
   - If the extension is already connected, it reuses that Chrome session and Netflix tab.
   - Otherwise the server launches a dedicated Chrome window for TV Control, opens only the requested Netflix page, and tries to auto-load the built extension from `apps/extension/dist`.

7. Optional: manually load the extension in Chrome if you want to use your existing Chrome session instead of the dedicated TV Control window:
   - Open `chrome://extensions`
   - Enable Developer Mode
   - Click `Load unpacked`
   - Select `apps/extension/dist`

## Notes

- The extension defaults to `ws://localhost:8787/ws` in `apps/extension/src/config.ts`.
- If Chrome runs on a different machine than the server, update that value before building.
- The app supports opening Netflix watch/title/share URLs, showing live playback state, and sending play/pause controls.
- When the server launches Chrome itself, it uses a dedicated profile at `.tv-control-chrome/` so it does not restore tabs from your normal Chrome profile.
- That dedicated profile is persistent. If you log into Netflix there once, the login should still be present on later launches.
- Server-side Chrome launching currently supports macOS and Linux by looking for standard Chrome or Chromium executables.
- Opening Netflix works without an already-connected extension, but playback controls only appear after the extension bridge connects.

## Local Network Run

Use this flow when you want to run the app on your local network in a production-style setup:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

If you change code later, run `pnpm build` again and restart `pnpm start` so the server uses the latest output.

## Run As A systemd Service

If you want the server to keep running after you disconnect from SSH, install it as a `systemd` service.

This repo includes an example unit file at `deploy/tv-control.service`.

- `WorkingDirectory=/home/bastibuck/dev/tv-control` points `systemd` at the checked-out repo
- `User=bastibuck` runs the service as your normal server user
- `ExecStart=/home/bastibuck/.volta/bin/node apps/server/dist/index.js` starts the built server with your Volta-managed Node binary
- Use the full absolute path for `WorkingDirectory` in a system service so startup is explicit and easier to debug
- The service starts the built output directly so it does not depend on `pnpm` being available in the `systemd` environment
- `systemd` does not inherit your interactive shell PATH, so tools installed through Volta, nvm, or shell init usually need absolute paths
- On Ubuntu Wayland, the service also needs your desktop session environment so Chrome can open a window. The checked-in unit file sets `XDG_RUNTIME_DIR=/run/user/1000`, `WAYLAND_DISPLAY=wayland-0`, and `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus` for user `bastibuck`.

### Install The Service

1. Copy the repo to your server at `~/dev/tv-control`.
2. Install dependencies:

   ```bash
   cd ~/dev/tv-control
   pnpm install --frozen-lockfile
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

### Deploy A New Feature Or Code Change

When you change the code, use this flow on the server:

Quick one-command update:

```bash
~/dev/tv-control/deploy/update-tv-control.sh
```

That script:

- pulls the latest commits with `git pull --ff-only`
- runs `pnpm install --frozen-lockfile`
- runs `pnpm build`
- copies `deploy/tv-control.service` into `/etc/systemd/system/tv-control.service`
- runs `sudo systemctl daemon-reload`
- restarts `tv-control`
- prints the current service status

Manual flow:

1. Open the repo:

   ```bash
   cd ~/dev/tv-control
   ```

2. Pull the latest changes:

   ```bash
   git pull
   ```

3. If dependencies changed, install them:

   ```bash
   pnpm install --frozen-lockfile
   ```

4. Rebuild the project so the server uses the latest compiled output:

   ```bash
   pnpm build
   ```

5. Restart the service:

   ```bash
   sudo systemctl restart tv-control
   ```

6. Confirm it started correctly:

   ```bash
   sudo systemctl status tv-control
   journalctl -u tv-control -f
   ```

Short version:

```bash
cd ~/dev/tv-control
git pull
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart tv-control
sudo systemctl status tv-control
```

Notes:

- Use `pnpm install --frozen-lockfile` to install the exact versions committed in `pnpm-lock.yaml`.
- If you intentionally change dependencies, run `pnpm install` or `pnpm up`, review the resulting `pnpm-lock.yaml`, and commit it with the manifest changes.
- If you changed the `systemd` unit file itself, copy it again and run `sudo systemctl daemon-reload` before restarting.

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
