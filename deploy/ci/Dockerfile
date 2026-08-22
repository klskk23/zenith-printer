# Optional: the same environment deploy/ci/setup.sh installs, baked into an
# image. Each CI job spends about a minute installing its toolchain; this
# removes that. Nothing depends on it — .gitlab-ci.yml works from a bare
# debian:trixie-slim on purpose, so a broken registry can never block a release.
#
#   docker build -t registry.example/zenith-build:trixie deploy/ci
#   docker push  registry.example/zenith-build:trixie
#
# then set `image:` in .gitlab-ci.yml to that tag and delete the before_script
# lines that call setup.sh.
FROM debian:trixie-slim

COPY setup.sh /usr/local/bin/zenith-ci-setup
RUN chmod +x /usr/local/bin/zenith-ci-setup \
 && zenith-ci-setup \
 && rm -rf /var/lib/apt/lists/*
