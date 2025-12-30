# Kometa UI (companion container)

Kometa UI is a lightweight web UI + API that edits Kometa's YAML config, triggers manual runs via Docker exec, and shows run history + logs. Your existing Kometa container stays unchanged.

## Quickstart

1) Build and start the UI alongside Kometa:

```bash
docker compose -f docker-compose.example.yml up --build
```

2) Open the UI:

```
http://localhost:6161
```

### Pointing at an existing Kometa container

If you already run Kometa elsewhere, set the container name and share the same volumes:

- Set `KOMETA_CONTAINER_NAME` to the running container name.
- Mount the same `/config` and `/logs` volumes into `kometa-ui`.
- Mount `/var/run/docker.sock` and set `ALLOW_DOCKER_SOCKET=true`.

Example (compose override):

```yaml
services:
  kometa-ui:
    environment:
      KOMETA_CONTAINER_NAME: "kometa"
      KOMETA_RUN_CMD: "python kometa.py -c /config/config.yml"
      ALLOW_DOCKER_SOCKET: "true"
    volumes:
      - kometa_config:/config
      - kometa_logs:/logs
      - /var/run/docker.sock:/var/run/docker.sock
```

## Security warning

Mounting the Docker socket gives root-equivalent control of your host Docker. The UI will refuse to start unless `ALLOW_DOCKER_SOCKET=true` is set when the socket is mounted. Consider using a reverse proxy + auth if exposing this outside your LAN.

## Ports

- Default UI port: `6161`
- Override with `PORT`

Port 6161 was chosen to avoid common arr stack ports (e.g. 7878/8989/8686/9696/6767/5055/9117).

## Environment variables

- `PORT` (default `6161`)
- `DATA_DIR` (default `/data`) - stores SQLite DB + run lock
- `CONFIG_FILE` (default `/config/config.yml`)
- `LOG_DIR` (default `/logs`)
- `KOMETA_CONTAINER_NAME` (default `kometa`)
- `KOMETA_RUN_CMD` (default `python kometa.py -c /config/config.yml`)
- `AUTH_MODE` (`none|basic|token`, default `none`)
- `BASIC_USER`, `BASIC_PASS` (required for `AUTH_MODE=basic`)
- `API_TOKEN` (required for `AUTH_MODE=token`)
- `ALLOW_DOCKER_SOCKET` (required if Docker socket is mounted)

## Authentication

Set `AUTH_MODE` to `basic` or `token` to protect API endpoints. The UI will prompt for credentials and store them in local storage.

## API overview

- `GET /api/health`
- `GET /api/config`
- `POST /api/config/validate`
- `POST /api/config`
- `POST /api/runs`
- `GET /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/logs?tail=500`
- `GET /api/runs/{run_id}/download`
- `GET /api/logs/latest`
- `GET /api/logs/latest/download`

## Known limitations (v1)

- YAML-only editor (no form mode)
- Single-run lock (one run at a time)
- Polling for logs (no websocket streaming)

## Troubleshooting

- **Config file not found**: Ensure `/config/config.yml` exists in the shared volume.
- **Kometa container not found**: Check `KOMETA_CONTAINER_NAME` and ensure the container is running.
- **Permission errors**: Verify the UI container can read/write the shared `/config` and `/logs` volumes.
- **Docker socket error**: Mount `/var/run/docker.sock` and set `ALLOW_DOCKER_SOCKET=true`.

## Screenshots

Add screenshots in `README.md` when ready:

- Dashboard
- Config editor
- Runs history
- Run detail / log tail
