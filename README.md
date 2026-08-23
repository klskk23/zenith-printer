# Zenith Printer

Design labels in a browser, print them on the label printer at your desk. One
container on your LAN — no cloud, no account, no reverse proxy.

**[中文文档 →](docs/README_zh.md)**

- **Editor in the browser.** SVG canvas: text, barcodes, QR codes, images,
  rulers, snapping, undo.
- **Variables and data sources.** Type them in, draw them from a sequence pool,
  upload a CSV, or link a Google Sheet and refresh it when you want.
- **Two printer families.** NIIMBOT over USB serial, Honeywell/ZPL over TCP 9100.
- **Deterministic rendering.** Fonts ship inside the image and system fonts are
  switched off, so one template prints identically on every machine.

## Quick start

```bash
curl -O https://raw.githubusercontent.com/klskk23/zenith-printer/main/deploy/docker-compose.yml
docker compose up -d
```

Then open `http://<host>:3000` from any machine on the same network.

Data — the database and uploaded images — lands in `./data` next to the compose
file. Moving the service to another machine is `rsync -a data/` and nothing
else.

## Two things to know before you run it

**The container is privileged and binds the host's `/dev`.** A NIIMBOT arrives
as a USB CDC device at `/dev/ttyACM0`, and `privileged` alone is not enough:
Docker gives a privileged container a *tmpfs* `/dev`, a snapshot of the device
nodes that existed when it started, so a printer plugged in afterwards never
appears. Both settings are in the compose file, with the reasoning next to them.

**There is no authentication.** Anyone who can reach port 3000 can print labels
and cancel other people's jobs. That is a deliberate trade for a tool used from
a bench — keep it on a LAN or a VPN, and nowhere with a route to the internet.

## From source

```bash
make            # list the targets
make doctor     # what this machine is missing
make check      # typecheck, lint, tests
make image      # build the deployment image
make up         # docker compose up -d
```

Needs Node 26 (**not 26.4 or newer** — its serial reads stall, see
[`deploy/README.md`](deploy/README.md)) and npm 12.

## Documentation

| | |
|---|---|
| [中文说明](docs/README_zh.md) | Quick start and everyday use, in Chinese |
| [`deploy/README.md`](deploy/README.md) | Building, deploying, releasing, troubleshooting |
| [`docs/design-consensus.md`](docs/design-consensus.md) | Why the architecture is what it is |
| [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | The rules this codebase is held to |

## Licence

None yet. This repository carries no licence file, which means no rights are
granted — it is published to be read and to be deployed by the people who work
on it, not to be reused. That will change when somebody decides what it should
say.
