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

# The one place a version number lives. `npm version` moves it and everything
# downstream — the .deb filename, the control file — follows.
VERSION      := $(shell node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)
DEB_REVISION ?= 1
DEB_VERSION   = $(VERSION)-$(DEB_REVISION)
DEB_ARCH     := $(shell dpkg --print-architecture 2>/dev/null || echo unknown)
DEB_FILE      = $(DIST_DIR)/zenith-printer_$(DEB_VERSION)_$(DEB_ARCH).deb

NODE_MAJOR_MIN := 26

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
	@printf '\033[32m[deps]\033[0m node %s, npm %s\n' "$$(node -v)" "$$(npm -v)"

.PHONY: check-deb-tools
check-deb-tools: ## Verify the Debian packaging tools are present
	$(call require_tool,dpkg-deb,building the .deb,sudo apt-get install dpkg-dev)
	$(call require_tool,dpkg,reading the target architecture,part of any Debian system)
	@printf '\033[32m[deps]\033[0m dpkg-deb ok, target architecture %s\n' '$(DEB_ARCH)'

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
	@for t in dpkg-deb python3 lintian objdump; do \
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
	@printf '\nversion %s  ->  %s\n\n' '$(VERSION)' '$(DEB_FILE)'

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
# Packaging
# ---------------------------------------------------------------------------

.PHONY: deb
deb: check-deb-tools build ## Build dist/zenith-printer_<version>_<arch>.deb
	bash packaging/deb/build-deb.sh \
	  --version '$(DEB_VERSION)' \
	  --arch '$(DEB_ARCH)' \
	  --build-dir '$(BUILD_DIR)' \
	  --out-dir '$(DIST_DIR)'

.PHONY: deb-check
deb-check: ## Inspect the built .deb (contents, control, lintian if present)
	$(call require_file,$(DEB_FILE),there is nothing to inspect yet,make deb)
	@dpkg-deb --info '$(DEB_FILE)'
	@dpkg-deb --contents '$(DEB_FILE)' | head -40
	@printf '...\n\n'
	@command -v lintian >/dev/null 2>&1 && lintian --no-tag-display-limit '$(DEB_FILE)' || \
	  printf '\033[33m[deb]\033[0m lintian not installed; skipped\n'

# ---------------------------------------------------------------------------
# Housekeeping
# ---------------------------------------------------------------------------

.PHONY: deb-install-test
deb-install-test: ## Install the .deb in a throwaway Debian container and boot it
	$(call require_tool,docker,installing the package somewhere disposable,sudo apt-get install docker.io)
	$(call require_file,$(DEB_FILE),there is nothing to install yet,make deb)
	bash packaging/deb/install-test.sh '$(DEB_FILE)'

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
	@printf '\n  version %s   arch %s\n\n' '$(VERSION)' '$(DEB_ARCH)'
