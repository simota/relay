# relay — developer Makefile
#
# Thin wrapper around the bun scripts in package.json (root) and
# web/nextjs/package.json. Lets you run `make web-build` instead of
# `cd web/nextjs && bun run build`, and groups the multi-project
# typecheck / install steps.
#
# Requires: bun >= 1.1.0 (root project uses bun:sqlite and Bun.serve).

SHELL := /bin/bash
BUN   ?= bun
WEB   := web/nextjs

# CLI entry — `bun run src/cli.ts` works without a build step.
RELAY := $(BUN) run src/cli.ts

# Default web port (matches src/commands/web.ts default).
PORT  ?= 7340
HOST  ?= 127.0.0.1

.DEFAULT_GOAL := help

# ---- meta -----------------------------------------------------------

.PHONY: help
help: ## Show this help.
	@awk 'BEGIN {FS = ":.*?## "} \
	     /^[a-zA-Z0-9_.-]+:.*?## / {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}' \
	     $(MAKEFILE_LIST) | sort

# ---- setup ----------------------------------------------------------

.PHONY: install
install: ## Install root dependencies.
	$(BUN) install

.PHONY: install-web
install-web: ## Install web/nextjs dependencies.
	cd $(WEB) && $(BUN) install

.PHONY: install-all
install-all: install install-web ## Install root + web dependencies.

.PHONY: bootstrap
bootstrap: install-all web-build ## Fresh-clone bootstrap: deps + first Web build.
	@echo "✓ ready. Run 'make init' then 'make web'."

.PHONY: setup
setup: ## relay setup — install root+web deps and build the Web UI in one shot.
	$(RELAY) setup

# ---- relay CLI commands --------------------------------------------

.PHONY: init
init: ## relay init — create ~/.relay/ and apply schema.
	$(RELAY) init

.PHONY: sync
sync: ## relay sync — ingest from all enabled adapters.
	$(RELAY) sync

.PHONY: today
today: ## relay today — show today's top tasks.
	$(RELAY) today

.PHONY: web
web: web-build ## Build Next.js then start Hono server (UI + API) at :$(PORT).
	$(RELAY) web --port $(PORT) --host $(HOST)

.PHONY: doctor
doctor: ## relay doctor — check rg/gh/claude/git availability.
	$(RELAY) doctor

.PHONY: hook-install
hook-install: ## Install the Claude Code Stop hook.
	$(RELAY) hook install

.PHONY: hook-status
hook-status: ## Show whether the Stop hook is installed.
	$(RELAY) hook status

# ---- frontend (web/nextjs) -----------------------------------------

.PHONY: web-build
web-build: ## Build Next.js static export → web/nextjs/out/ (served by `make web`).
	cd $(WEB) && $(BUN) run build

.PHONY: web-dev
web-dev: ## Run `next dev` on :3340 — proxies /api to $(HOST):$(PORT).
	cd $(WEB) && $(BUN) run dev

.PHONY: web-lint
web-lint: ## Lint the Next.js project.
	cd $(WEB) && $(BUN) run lint

# Live development: API on :7340, UI on :3340 with HMR.
# Run in two shells, or use `make dev` to start both.
.PHONY: dev
dev: ## Run API (:$(PORT)) + Next.js dev (:3340) concurrently.
	@trap 'kill 0' EXIT INT TERM; \
	$(RELAY) web --port $(PORT) --host $(HOST) --no-open & \
	cd $(WEB) && $(BUN) run dev & \
	wait

# ---- quality --------------------------------------------------------

.PHONY: typecheck
typecheck: ## Typecheck the root project.
	$(BUN) run typecheck

.PHONY: typecheck-web
typecheck-web: ## Typecheck web/nextjs.
	cd $(WEB) && $(BUN) run typecheck

.PHONY: typecheck-all
typecheck-all: typecheck typecheck-web ## Typecheck root + web.

.PHONY: test
test: ## Run bun test (root).
	$(BUN) test --pass-with-no-tests

.PHONY: check
check: typecheck-all test ## Run all checks (typecheck both projects + tests).

# ---- build / dist ---------------------------------------------------

.PHONY: build
build: ## Bundle the CLI to dist/cli.js (for distribution).
	$(BUN) run build

.PHONY: build-all
build-all: build web-build ## Build CLI bundle + Next.js static export.

# ---- housekeeping ---------------------------------------------------

.PHONY: clean
clean: ## Remove build artifacts (dist, web/nextjs/out, .next).
	rm -rf dist $(WEB)/out $(WEB)/.next $(WEB)/tsconfig.tsbuildinfo

.PHONY: clean-deps
clean-deps: ## Remove node_modules in root and web/nextjs.
	rm -rf node_modules $(WEB)/node_modules
