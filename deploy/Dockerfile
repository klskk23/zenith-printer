# Zenith Printer — the deployment image.
#
# Two stages. The builder installs the whole toolchain, fetches and verifies the
# pinned fonts and compiles the frontend; the runtime carries none of that. What
# ships is the service, its production dependencies, its fonts and its bundle.
#
# The server has no compile step of its own: Node strips the types at load time,
# so the .ts sources under packages/*/src are the program. There is nothing to
# build for the backend and nothing gained by pretending otherwise.

# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------
FROM node:26-trixie-slim AS builder

# curl for the pinned font packages, dpkg-dev for unpacking them, and the two
# Debian font packages as the fast path: scripts/fetch-fonts.sh takes the
# system copy when it already hashes to the manifest and downloads the pinned
# package when it does not. On trixie that means the three 20MB Noto files come
# from apt and only DejaVu is fetched.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl dpkg-dev fonts-noto-cjk fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# npm 12 explicitly: package.json carries an `allowScripts` block that only
# npm 12 honours. Under npm 11 the install scripts of three BLE packages —
# which nothing here imports — run, and node-gyp then wants a compiler this
# image does not have. Matching the npm the lockfile was written by is the fix;
# installing a compiler would only build code the service never loads.
RUN npm install -g npm@^12

WORKDIR /build

# Dependencies first, keyed on the lockfile alone, so editing a source file
# does not re-run a two-minute install.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json    packages/cli/
COPY packages/web/package.json    packages/web/
RUN npm ci --no-audit --no-fund

COPY . .

# Rendering determinism (constitution): the renderer runs with system font
# loading disabled and reads fonts/full only, so these exact bytes decide what
# comes out of the printer. Verified here, in the image that will ship them.
RUN bash scripts/fetch-fonts.sh \
 && cd fonts/full && sha256sum -c ../MANIFEST.sha256 --quiet

# The editor loads the GB2312 subsets over HTTP; vite copies them out of
# packages/web/public, which reaches them through this symlink. Without it the
# build still succeeds and the bundle carries no fonts at all.
RUN mkdir -p packages/web/public/fonts \
 && ln -sfn ../../../../fonts/subset packages/web/public/fonts/subset \
 && npm run build --workspace @zenith/web \
 && test -d packages/web/dist/fonts/subset

# A second, production-only tree. The web workspace is asked for by name and
# left out: react and friends are compiled into the bundle and are dead weight
# at runtime — including them costs 80MB for code the server never loads.
RUN mkdir -p /runtime \
 && cp package.json package-lock.json /runtime/ \
 && for ws in shared server cli web; do \
      mkdir -p "/runtime/packages/$ws" \
      && cp "packages/$ws/package.json" "/runtime/packages/$ws/"; \
    done \
 && cd /runtime \
 && npm ci --omit=dev --no-audit --no-fund \
      --workspace @zenith/server --workspace @zenith/cli --workspace @zenith/shared \
      --include-workspace-root \
 && find node_modules -type d \( -name 'win32-*' -o -name 'darwin-*' -o -name 'android-*' \) \
      -prune -exec rm -rf {} + 2>/dev/null || true

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:26-trixie-slim AS runtime

# The service derives its own root from import.meta.url, three levels up from
# packages/server/src — so this tree has to keep the repository's shape, and
# WORKDIR has to be that root.
WORKDIR /app

COPY --from=builder /runtime/node_modules      ./node_modules
COPY --from=builder /runtime/package.json      ./package.json
COPY --from=builder /build/packages/shared/src ./packages/shared/src
COPY --from=builder /build/packages/server/src ./packages/server/src
COPY --from=builder /build/packages/cli/src    ./packages/cli/src
COPY --from=builder /build/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /build/packages/server/package.json ./packages/server/package.json
COPY --from=builder /build/packages/cli/package.json    ./packages/cli/package.json
COPY --from=builder /build/packages/web/dist   ./packages/web/dist
COPY --from=builder /build/fonts/full          ./fonts/full
COPY --from=builder /build/fonts/MANIFEST.sha256 ./fonts/MANIFEST.sha256

# Both default under /data, which is where the compose file mounts a volume.
# Left as environment rather than baked into the code so a different layout is
# a compose edit, not a rebuild.
ENV NODE_ENV=production \
    ZENITH_HOST=0.0.0.0 \
    ZENITH_PORT=3000 \
    ZENITH_DB=/data/zenith.db \
    ZENITH_UPLOADS=/data/uploads \
    LOG_LEVEL=info

# Runs as root, and that is the point of this deployment: the container is
# privileged so the service can reach a USB printer that appears at
# /dev/ttyACM0 after the container started. Dropping to a non-root user would
# mean chasing device-node ownership on every host instead.
VOLUME ["/data"]
EXPOSE 3000

# Node's own fetch rather than curl, so the runtime layer stays as it came.
# It asks the endpoint that reports which frontend build is being served, which
# fails if the bundle is missing as well as if the process is wedged.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.ZENITH_PORT||3000)+'/api/frontend-build').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# No init system, no wrapper script: one process, PID 1, signals straight from
# docker. The service already handles SIGTERM by draining the queue and closing
# the database.
CMD ["node", "--experimental-strip-types", "packages/server/src/index.ts"]
