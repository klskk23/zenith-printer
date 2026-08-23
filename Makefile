# Zenith Printer — build, checks and packaging.
#
# Every target that needs a tool says so before it starts. A build that dies
# half-way through `npm ci` because python3 is missing costs more than the
# check that would have caught it, and says less about what to do next.
#
# Run `make` for the list.

SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

BUILD_DIR ?= build
DIST_DIR  ?= dist
STAMPS     = $(BUILD_DIR)/stamps

# The one place a version number lives. `npm version` moves it and the image
# tag follows.
VERSION      := $(shell node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)
# One image name in one place: the compose file reads it from the same
# variable, so `make image` and `docker compose up` cannot disagree.
# Local builds keep the short name; releases carry the registry prefix, which
# is where deploy/docker-compose.yml pulls from by default.
IMAGE        ?= zenith-printer
IMAGE_TAG    ?= $(VERSION)
REGISTRY     ?= ghcr.io/klskk23

NODE_MAJOR_MIN := 26
NPM_MAJOR_MIN  := 12

FONT_FULL   := fonts/full
FONT_SUBSET := fonts/subset
WEB_DIST    := packages/web/dist/index.html
WEB_FONTS   := packages/web/public/fonts/subset

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
# Three lines, in the order somebody needs them: what is missing, what it was
# for, and what to type. Constitution III.0 asks the same of every error the
# product shows a user; a build failure is no different.

define require_tool
@command -v $(1) >/dev/null 2>&1 || { \
  printf '\n\033[1;31m[deps]\033[0m %s not found\n' '$(1)'; \
  printf '       needed for: %s\n' '$(2)'; \
  printf '       install:    %s\n\n' '$(3)'; \
  exit 1; }
endef

define require_file
@test -e '$(1)' || { \
  printf '\n\033[1;31m[deps]\033[0m missing: %s\n' '$(1)'; \
  printf '       needed for: %s\n' '$(2)'; \
  printf '       next:       %s\n\n' '$(3)'; \
  exit 1; }
endef

.PHONY: check-node
check-node: ## Verify the Node.js runtime is new enough
	$(call require_tool,node,everything — the service runs TypeScript directly,https://nodejs.org or the NodeSource apt repository)
	$(call require_tool,npm,installing dependencies,ships with Node.js)
	@major=$$(node -p 'process.versions.node.split(".")[0]'); \
	if [ "$$major" -lt $(NODE_MAJOR_MIN) ]; then \
	  printf '\n\033[1;31m[deps]\033[0m node $(NODE_MAJOR_MIN)+ required, found %s\n' "$$(node -v)"; \
	  printf '       needed for: running .ts sources without a compile step\n'; \
	  printf '       install:    curl -fsSL https://deb.nodesource.com/setup_$(NODE_MAJOR_MIN).x | sudo -E bash - && sudo apt-get install -y nodejs\n\n'; \
	  exit 1; \
	fi
	@npmmajor=$$(npm -v | cut -d. -f1); \
	if [ "$$npmmajor" -lt $(NPM_MAJOR_MIN) ]; then \
	  printf '\n\033[1;31m[deps]\033[0m npm $(NPM_MAJOR_MIN)+ required, found %s\n' "$$(npm -v)"; \
	  printf '       needed for: package.json carries an `allowScripts` block, and only npm $(NPM_MAJOR_MIN)\n'; \
	  printf '                   honours it. Older npm runs the install scripts of three BLE\n'; \
	  printf '                   packages nothing here loads, and node-gyp then needs a compiler.\n'; \
	  printf '       install:    npm install -g npm@^$(NPM_MAJOR_MIN)\n\n'; \
	  exit 1; \
	fi
	@printf '\033[32m[deps]\033[0m node %s, npm %s\n' "$$(node -v)" "$$(npm -v)"
	@# A warning, not a gate: it only bites when a serial printer is attached,
	@# and plenty of work here never touches one. The deployment image pins its
	@# own version — see deploy/Dockerfile and the test that keeps it pinned.
	@node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>26||(a===26&&b>=4)?1:0)' || \
	  printf '\033[1;33m[deps]\033[0m node %s stalls serial reads — a USB printer will time out on every probe\n       measured: 26.0-26.3 fine, 26.4 onwards broken. Use 26.3.x for printer work.\n' "$$(node -v)"

.PHONY: check-docker
check-docker: ## Verify docker and compose are usable
	$(call require_tool,docker,building and running the deployment image,sudo apt-get install docker.io docker-compose-v2)
	@docker compose version >/dev/null 2>&1 || { \
	  printf '\n\033[1;31m[deps]\033[0m docker compose v2 not available\n'; \
	  printf '       needed for: deploy/docker-compose.yml\n'; \
	  printf '       install:    sudo apt-get install docker-compose-v2\n\n'; \
	  exit 1; }
	@printf '\033[32m[deps]\033[0m docker %s\n' "$$(docker --version | cut -d' ' -f3 | tr -d ,)"

.PHONY: check-subset-tools
check-subset-tools: ## Verify fonttools is available for regenerating the web subsets
	$(call require_tool,python3,subsetting the editor fonts,sudo apt-get install python3)
	@python3 -c 'import fontTools, brotli' 2>/dev/null || { \
	  printf '\n\033[1;31m[deps]\033[0m python fontTools/brotli not importable\n'; \
	  printf '       needed for: regenerating fonts/subset (the editor web fonts)\n'; \
	  printf '       install:    python3 -m venv .venv && .venv/bin/pip install fonttools brotli\n'; \
	  printf '                   then: .venv/bin/python scripts/subset-fonts.py\n\n'; \
	  exit 1; }

.PHONY: doctor
doctor: check-node ## Report on every tool and asset the build can use
	@printf '\n--- optional tools ---\n'
	@for t in docker python3; do \
	  if command -v $$t >/dev/null 2>&1; then printf '  \033[32mok     \033[0m %s\n' "$$t"; \
	  else printf '  \033[33mabsent \033[0m %s\n' "$$t"; fi; \
	done
	@printf '\n--- assets ---\n'
	@if [ -d node_modules ]; then printf '  \033[32mok     \033[0m node_modules\n'; \
	  else printf '  \033[33mabsent \033[0m node_modules            (make deps)\n'; fi
	@if $(MAKE) --no-print-directory -s fonts-verify >/dev/null 2>&1; then \
	    printf '  \033[32mok     \033[0m fonts/full              (matches MANIFEST.sha256)\n'; \
	  else printf '  \033[33mabsent \033[0m fonts/full              (make fonts)\n'; fi
	@if [ -L '$(WEB_FONTS)' ]; then printf '  \033[32mok     \033[0m web font link\n'; \
	  else printf '  \033[33mabsent \033[0m web font link           (make web-fonts-link)\n'; fi
	@if [ -f '$(WEB_DIST)' ]; then printf '  \033[32mok     \033[0m packages/web/dist       (built %s)\n' "$$(date -r '$(WEB_DIST)' '+%Y-%m-%d %H:%M')"; \
	  else printf '  \033[33mabsent \033[0m packages/web/dist       (make build)\n'; fi
	@printf '\nversion %s  ->  %s:%s\n\n' '$(VERSION)' '$(IMAGE)' '$(IMAGE_TAG)'

# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------

# npm writes this file at the end of a successful install, so it is the honest
# marker for "the tree matches the lockfile".
NODE_STAMP := node_modules/.package-lock.json

$(NODE_STAMP): package-lock.json package.json $(wildcard packages/*/package.json) | check-node
	npm ci --no-audit --no-fund
	@touch $@

.PHONY: deps
deps: $(NODE_STAMP) ## Install npm dependencies from the lockfile

# ---------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------
# Rendering determinism (constitution) depends on these exact bytes: the
# renderer runs with loadSystemFonts disabled and reads fonts/full only. A
# mismatch is a build failure, not a warning — a drifted font makes the same
# template print differently on two machines, silently.

.PHONY: fonts
fonts: ## Copy the pinned fonts from the system and verify them
	bash scripts/fetch-fonts.sh
	@$(MAKE) --no-print-directory fonts-verify

.PHONY: fonts-verify
fonts-verify: ## Check fonts/full against MANIFEST.sha256
	$(call require_file,$(FONT_FULL),deterministic label rendering,make fonts)
	@cd $(FONT_FULL) && sha256sum -c ../MANIFEST.sha256 --quiet
	@printf '\033[32m[fonts]\033[0m fonts/full matches MANIFEST.sha256\n'

.PHONY: fonts-subset
fonts-subset: check-subset-tools ## Regenerate the GB2312 web subsets from fonts/full
	python3 scripts/subset-fonts.py

$(WEB_FONTS):
	@mkdir -p $(dir $(WEB_FONTS))
	ln -sfn ../../../../fonts/subset $(WEB_FONTS)
	@printf '\033[32m[fonts]\033[0m linked %s -> fonts/subset\n' '$(WEB_FONTS)'

.PHONY: web-fonts-link
web-fonts-link: $(WEB_FONTS) ## Link the editor's web fonts into packages/web/public

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
# The server has no build step — Node runs the .ts sources. Only the frontend
# is compiled, and only its dist/ is shipped.

.PHONY: build
build: deps fonts-verify web-fonts-link ## Build the frontend bundle
	npm run build --workspace @zenith/web
	@test -d packages/web/dist/fonts/subset || { \
	  printf '\n\033[1;31m[build]\033[0m the bundle has no fonts\n'; \
	  printf '       why:  packages/web/public/fonts/subset did not resolve\n'; \
	  printf '       next: make fonts-subset && make web-fonts-link && make build\n\n'; \
	  exit 1; }

# ---------------------------------------------------------------------------
# Quality gates — the same set CI runs
# ---------------------------------------------------------------------------

.PHONY: typecheck
typecheck: deps ## tsc across every workspace
	npm run typecheck

.PHONY: lint
lint: deps ## eslint
	npm run lint

.PHONY: test
test: deps fonts-verify ## The default suite (no printer, no network)
	npm test

.PHONY: coverage
coverage: deps fonts-verify ## The suite with coverage thresholds
	npm run test:coverage

.PHONY: test-hardware
test-hardware: deps fonts-verify ## The suite that needs a real printer attached
	npm run test:hardware

.PHONY: check
check: typecheck lint test ## Everything CI checks, in CI's order

# ---------------------------------------------------------------------------
# Deployment image
# ---------------------------------------------------------------------------
# The image builds the frontend and vendors its dependencies itself, so it does
# not need `make build` first — a build that depended on the host's tree would
# ship whatever happened to be lying in it.

.PHONY: image
image: check-docker ## Build the deployment image
	docker build -f deploy/Dockerfile -t '$(IMAGE):$(IMAGE_TAG)' -t '$(IMAGE):latest' .
	@printf '\n\033[32m[image]\033[0m %s:%s  (%s)\n\n' '$(IMAGE)' '$(IMAGE_TAG)' \
	  "$$(docker image inspect '$(IMAGE):$(IMAGE_TAG)' --format '{{.Size}}' | numfmt --to=iec)"

.PHONY: image-smoke
image-smoke: ## Start the image on a scratch volume, call it, tear it down
	$(call require_tool,docker,running the image,sudo apt-get install docker.io)
	bash deploy/smoke.sh '$(IMAGE):$(IMAGE_TAG)'

.PHONY: up
up: check-docker ## docker compose up -d, from deploy/
	docker compose -f deploy/docker-compose.yml up -d
	docker compose -f deploy/docker-compose.yml ps

.PHONY: down
down: check-docker ## docker compose down (the data volume is kept)
	docker compose -f deploy/docker-compose.yml down

.PHONY: logs
logs: check-docker ## Follow the service log
	docker compose -f deploy/docker-compose.yml logs -f

# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------

.PHONY: clean
clean: ## Remove build output, keep node_modules and fonts
	rm -rf $(BUILD_DIR) $(DIST_DIR) packages/web/dist coverage
	find packages -name '*.tsbuildinfo' -delete
	rm -f tsconfig.tsbuildinfo

.PHONY: distclean
distclean: clean ## Also remove node_modules (fonts and data are left alone)
	rm -rf node_modules packages/*/node_modules

.PHONY: help
help: ## This list
	@printf '\nZenith Printer — make targets\n\n'
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf '\n  version %s   image %s:%s\n\n' '$(VERSION)' '$(IMAGE)' '$(IMAGE_TAG)'
