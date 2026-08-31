# Attendance system — setup and maintenance commands
#
# Running "make" with no target shows the list of commands.

SHELL := /bin/bash
COMPOSE := docker compose
BACKUP_DIR := backups
STAMP := $(shell date +%Y%m%d-%H%M%S)

# Compose plugin v2 is required. The old standalone "docker-compose" (with a
# dash) can't read this file at all: it doesn't support the root-level `name`
# key or `depends_on.condition`. It's also been unsupported since 2023.
COMPOSE_OK := $(shell docker compose version >/dev/null 2>&1 && echo yes)

# Service names
DB := db
BACKEND := backend
WEB := web

# Local deployment (Docker, no domain/SSL) uses its own compose file and env
COMPOSE_LOCAL := docker compose -f docker-compose.local.yml --env-file .env.local

# Liara internal mirror URLs (to work around throttling/filtering on Iranian servers)
GO_PROXY := https://package-mirror.liara.ir/repository/go/
NPM_REGISTRY := https://package-mirror.liara.ir/repository/npm/
PYPI_INDEX := https://package-mirror.liara.ir/repository/pypi/
APT_MIRROR := http://linux-mirror.liara.ir/repository/ubuntu/
APT_SECURITY_MIRROR := http://linux-mirror.liara.ir/repository/ubuntu-security/
DOCKER_MIRROR := https://docker-mirror.liara.ir

.DEFAULT_GOAL := help

# ------------------------------------------------------------------- help

.PHONY: help
help: ## Show this list
	@echo ""
	@echo "  Attendance system available commands"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  Local quick start (Docker, no domain):  make local-setup  ->  make local-up"
	@echo "  VPS quick start (from scratch):         make bootstrap"
	@echo "  VPS quick start (manual):               make setup  ->  edit .env  ->  make mirrors  ->  make deploy  ->  make ssl"
	@echo ""

# ---------------------------------------------------------------- setup

.PHONY: setup
setup: ## Create .env with random keys (first run)
	@if [ -f .env ]; then \
		echo ".env already exists; left untouched."; \
	else \
		cp .env.example .env; \
		secret=$$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-50); \
		dbpass=$$(openssl rand -base64 24 | tr -d '\n/+=' | cut -c1-24); \
		adminpass=$$(openssl rand -base64 12 | tr -d '\n/+=' | cut -c1-12); \
		sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$$secret|" .env; \
		sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$dbpass|" .env; \
		sed -i "s|^FIRST_ADMIN_PASSWORD=.*|FIRST_ADMIN_PASSWORD=$$adminpass|" .env; \
		echo ""; \
		echo ".env created with randomly generated keys."; \
		echo "Initial admin password: $$adminpass"; \
		echo ""; \
		echo "Now set DOMAIN and LETSENCRYPT_EMAIL in .env, then run: make mirrors && make deploy"; \
	fi

.PHONY: check-env
check-env: check-compose
	@test -f .env || { echo ".env not found. Run \"make setup\" first."; exit 1; }

.PHONY: check-compose
check-compose:
	@if [ "$(COMPOSE_OK)" != "yes" ]; then \
		echo ""; \
		echo "  x Docker Compose v2 plugin is not installed on this machine."; \
		echo ""; \
		if command -v docker-compose >/dev/null 2>&1; then \
			echo "    The old standalone \"docker-compose\" (with a dash) is installed,"; \
			echo "    but this file doesn't work with it, and that version is unsupported."; \
			echo ""; \
		fi; \
		echo "    To install:  make install-compose"; \
		echo ""; \
		exit 1; \
	fi

.PHONY: install-compose
install-compose: ## Install the Docker Compose v2 plugin
	@set -e; \
	arch=$$(uname -m); \
	case "$$arch" in \
		x86_64|amd64) target=x86_64 ;; \
		aarch64|arm64) target=aarch64 ;; \
		*) echo "Unsupported architecture: $$arch"; exit 1 ;; \
	esac; \
	dest=/usr/local/lib/docker/cli-plugins; \
	echo "Installing Docker Compose v2 for $$target into $$dest"; \
	mkdir -p $$dest; \
	curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$$target" \
		-o $$dest/docker-compose; \
	chmod +x $$dest/docker-compose; \
	echo ""; \
	docker compose version

# ------------------------------------------------ local deployment (no SSL)
#
# For testing the whole system with Docker on this machine — no domain, no
# Let's Encrypt. The system comes up at http://localhost:<LOCAL_PORT>
# (default 8080). Its files and network are fully separate from the VPS
# deployment (docker-compose.local.yml).

.PHONY: local-setup
local-setup: ## Create .env.local with random keys and a local HTTPS cert (first run)
	@if [ -f .env.local ]; then \
		echo ".env.local already exists; left untouched."; \
	else \
		cp .env.local.example .env.local; \
		secret=$$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-50); \
		dbpass=$$(openssl rand -base64 24 | tr -d '\n/+=' | cut -c1-24); \
		adminpass=$$(openssl rand -base64 12 | tr -d '\n/+=' | cut -c1-12); \
		sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$$secret|" .env.local; \
		sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$dbpass|" .env.local; \
		sed -i "s|^FIRST_ADMIN_PASSWORD=.*|FIRST_ADMIN_PASSWORD=$$adminpass|" .env.local; \
		echo ""; \
		echo ".env.local created with randomly generated keys."; \
		echo "Initial admin password: $$adminpass"; \
	fi
	@if [ ! -s cert.pem ] || [ ! -s key.pem ]; then \
		bash scripts/gen-local-cert.sh || echo "Warning: could not auto-generate a local HTTPS cert. For phone/tablet access run: make local-cert IP=<your LAN IP>"; \
	fi
	@echo ""
	@echo "Now run: make local-up"

.PHONY: local-cert
local-cert: ## (Re)generate the local HTTPS cert for phone/tablet access. IP=<optional, auto-detected otherwise>
	@bash scripts/gen-local-cert.sh $(IP)

.PHONY: check-env-local
check-env-local: check-compose
	@test -f .env.local || { echo ".env.local not found. Run \"make local-setup\" first."; exit 1; }
	@test -s cert.pem && test -s key.pem || { echo "cert.pem/key.pem not found. Run \"make local-cert\" first."; exit 1; }

.PHONY: local-up
local-up: check-env-local ## Build images and bring the system up locally
	$(COMPOSE_LOCAL) build
	$(COMPOSE_LOCAL) up -d
	@port=$$(grep -E '^LOCAL_PORT=' .env.local | cut -d= -f2); \
	httpsport=$$(grep -E '^LOCAL_HTTPS_PORT=' .env.local | cut -d= -f2); \
	lanip=$$(grep -E '^LOCAL_LAN_IP=' .env.local | cut -d= -f2); \
	echo ""; \
	echo "Local system is up: http://localhost:$${port:-8080}"; \
	echo "API docs: http://localhost:$${port:-8080}/docs"; \
	if [ -n "$$lanip" ]; then \
		echo ""; \
		echo "Phone/tablet (same network): https://$$lanip:$${httpsport:-8443}/kiosk"; \
		echo "  (self-signed cert - accept the browser warning once, or install cert.pem as trusted)"; \
	fi
	@$(COMPOSE_LOCAL) ps

.PHONY: local-down
local-down: ## Stop the local system (data is kept)
	$(COMPOSE_LOCAL) down

.PHONY: local-restart
local-restart: ## Restart the local system
	$(COMPOSE_LOCAL) restart

.PHONY: local-status
local-status: ## Local services status
	@$(COMPOSE_LOCAL) ps

.PHONY: local-logs
local-logs: ## Follow local system logs (Ctrl+C to exit)
	$(COMPOSE_LOCAL) logs -f --tail=100

.PHONY: local-seed-demo
local-seed-demo: ## Generate demo data on the local system
	$(COMPOSE_LOCAL) exec $(BACKEND) python -m scripts.seed_demo

.PHONY: local-shell
local-shell: ## Open a shell in the local backend container
	$(COMPOSE_LOCAL) exec $(BACKEND) bash

.PHONY: local-destroy
local-destroy: ## Completely remove the local system including database and photos — irreversible
	@echo "Warning: all local data, including punches and face photos, will be deleted."
	@read -r -p "Type delete to confirm: " r; [ "$$r" = "delete" ] || exit 1
	$(COMPOSE_LOCAL) down -v --rmi local

# ----------------------------------------------------------------- mirrors

.PHONY: mirrors
mirrors: mirrors-go mirrors-npm mirrors-pip ## Set go, npm and pip mirrors for the current user
	@echo ""
	@echo "go, npm and pip mirrors are set."
	@echo "For the OS (apt) and Docker mirrors, which need root access:"
	@echo "    sudo make mirrors-apt"
	@echo "    sudo make mirrors-docker"
	@echo ""

.PHONY: mirrors-go
mirrors-go: ## Set the Go modules mirror
	@if ! command -v go >/dev/null 2>&1; then echo "go is not installed; skipped."; exit 0; fi
	go env -w GOPROXY=$(GO_PROXY)
	go env -w GOSUMDB=off
	@echo "go mirror set: $(GO_PROXY)"

.PHONY: mirrors-npm
mirrors-npm: ## Set the npm mirror (global)
	@if ! command -v npm >/dev/null 2>&1; then echo "npm is not installed; skipped."; exit 0; fi
	npm config set registry $(NPM_REGISTRY) --global
	@echo "npm mirror set: $(NPM_REGISTRY)"

.PHONY: mirrors-pip
mirrors-pip: ## Set the pip mirror for the current user
	@mkdir -p "$$HOME/.pip" "$$HOME/.config/pip"
	@printf '[global]\nindex-url = %s\n' "$(PYPI_INDEX)" > "$$HOME/.pip/pip.conf"
	@printf '[global]\nindex-url = %s\n' "$(PYPI_INDEX)" > "$$HOME/.config/pip/pip.conf"
	@echo "pip mirror set: $(PYPI_INDEX)"

.PHONY: mirrors-apt
mirrors-apt: ## Set the apt mirror (needs sudo/root on the server)
	@test "$$(id -u)" = "0" || { echo "This command must be run with sudo: sudo make mirrors-apt"; exit 1; }
	@if [ -f /etc/apt/sources.list ]; then \
		cp -n /etc/apt/sources.list /etc/apt/sources.list.bak; \
		sed -i \
			-e 's|https\{0,1\}://[^ ]*archive\.ubuntu\.com/ubuntu/|$(APT_MIRROR)|g' \
			-e 's|https\{0,1\}://[^ ]*security\.ubuntu\.com/ubuntu/|$(APT_SECURITY_MIRROR)|g' \
			/etc/apt/sources.list; \
	fi; \
	if [ -d /etc/apt/sources.list.d ]; then \
		for f in /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do \
			[ -f "$$f" ] || continue; \
			cp -n "$$f" "$$f.bak"; \
			sed -i \
				-e 's|https\{0,1\}://[^ ]*archive\.ubuntu\.com/ubuntu/|$(APT_MIRROR)|g' \
				-e 's|https\{0,1\}://[^ ]*security\.ubuntu\.com/ubuntu/|$(APT_SECURITY_MIRROR)|g' \
				"$$f"; \
		done; \
	fi
	apt-get update
	@echo "apt mirror set (previous versions kept with a .bak suffix)."

.PHONY: mirrors-docker
mirrors-docker: ## Set the Docker image pull mirror (needs sudo/root)
	@test "$$(id -u)" = "0" || { echo "This command must be run with sudo: sudo make mirrors-docker"; exit 1; }
	@mkdir -p /etc/docker
	@if [ -f /etc/docker/daemon.json ]; then cp -n /etc/docker/daemon.json /etc/docker/daemon.json.bak; fi
	@if command -v jq >/dev/null 2>&1 && [ -s /etc/docker/daemon.json ]; then \
		jq '.["registry-mirrors"] = ["$(DOCKER_MIRROR)"]' /etc/docker/daemon.json > /tmp/daemon.json.tmp && \
		mv /tmp/daemon.json.tmp /etc/docker/daemon.json; \
	else \
		printf '{\n  "registry-mirrors": ["%s"]\n}\n' "$(DOCKER_MIRROR)" > /etc/docker/daemon.json; \
	fi
	@systemctl restart docker
	@echo "Docker mirror set and the docker service was restarted: $(DOCKER_MIRROR)"

# ---------------------------------------------------------------- deploy

.PHONY: bootstrap
bootstrap: ## Full zero-to-full deployment on a fresh VPS: install Docker + setup + deploy + ssl
	@bash scripts/bootstrap-vps.sh

.PHONY: deploy
deploy: check-env ## Build images and bring the whole system up
	$(COMPOSE) build
	$(COMPOSE) up -d
	@echo ""
	@echo "System is up. To get an SSL certificate: make ssl"
	@$(COMPOSE) ps

.PHONY: build
build: check-env ## Rebuild images only
	$(COMPOSE) build

.PHONY: up
up: check-env ## Bring services up
	$(COMPOSE) up -d

.PHONY: down
down: check-compose ## Stop services (data is kept)
	$(COMPOSE) down

.PHONY: restart
restart: check-compose ## Restart services
	$(COMPOSE) restart

.PHONY: update
update: check-env ## Pull latest code, rebuild and restart
	git pull --ff-only
	$(COMPOSE) build
	$(COMPOSE) up -d
	@$(COMPOSE) ps

.PHONY: status
status: check-compose ## Services status
	@$(COMPOSE) ps

.PHONY: logs
logs: check-compose ## Follow logs for all services (Ctrl+C to exit)
	$(COMPOSE) logs -f --tail=100

.PHONY: logs-backend
logs-backend: ## Backend logs
	$(COMPOSE) logs -f --tail=100 $(BACKEND)

.PHONY: logs-web
logs-web: ## Nginx logs
	$(COMPOSE) logs -f --tail=100 $(WEB)

# -------------------------------------------------------------------- SSL

.PHONY: ssl
ssl: check-env ## Get an SSL certificate from Let's Encrypt (first run)
	@bash scripts/init-ssl.sh

.PHONY: ssl-renew
ssl-renew: ## Manually renew the certificate (auto-renewal is also enabled)
	$(COMPOSE) run --rm certbot renew --webroot -w /var/www/certbot
	$(COMPOSE) exec $(WEB) nginx -s reload

.PHONY: ssl-check
ssl-check: ## Test renewal without making real changes
	$(COMPOSE) run --rm certbot renew --webroot -w /var/www/certbot --dry-run

.PHONY: ssl-info
ssl-info: ## Show certificate expiry date
	$(COMPOSE) run --rm --entrypoint "certbot certificates" certbot

# ----------------------------------------------------------------- backup

.PHONY: backup
backup: check-env ## Back up the database and face photos
	@mkdir -p $(BACKUP_DIR)
	@set -a; . ./.env; set +a; \
	$(COMPOSE) exec -T $(DB) pg_dump -U $$POSTGRES_USER $$POSTGRES_DB \
		| gzip > $(BACKUP_DIR)/db-$(STAMP).sql.gz
	@$(COMPOSE) run --rm -v $(PWD)/$(BACKUP_DIR):/backup \
		--entrypoint "tar czf /backup/media-$(STAMP).tar.gz -C /app/app/static ." $(BACKEND)
	@echo "Backup created:"
	@ls -lh $(BACKUP_DIR)/db-$(STAMP).sql.gz $(BACKUP_DIR)/media-$(STAMP).tar.gz

.PHONY: restore
restore: check-env ## Restore the database (FILE=backups/db-....sql.gz)
	@test -n "$(FILE)" || { echo "Usage: make restore FILE=backups/db-....sql.gz"; exit 1; }
	@test -f "$(FILE)" || { echo "File $(FILE) not found"; exit 1; }
	@echo "Warning: the current database content will be replaced."
	@read -r -p "Continue? [y/N] " r; [ "$$r" = "y" ] || exit 1
	@set -a; . ./.env; set +a; \
	gunzip -c "$(FILE)" | $(COMPOSE) exec -T $(DB) psql -U $$POSTGRES_USER -d $$POSTGRES_DB
	@echo "Restore complete."

# ----------------------------------------------------------------- tools

.PHONY: shell
shell: ## Open a shell in the backend container
	$(COMPOSE) exec $(BACKEND) bash

.PHONY: dbshell
dbshell: ## Open a psql shell
	@set -a; . ./.env; set +a; \
	$(COMPOSE) exec $(DB) psql -U $$POSTGRES_USER -d $$POSTGRES_DB

.PHONY: seed-demo
seed-demo: ## Generate demo data (testing only, not for a real server)
	$(COMPOSE) exec $(BACKEND) python -m scripts.seed_demo

.PHONY: icons
icons: ## Regenerate PWA icons
	$(COMPOSE) run --rm $(BACKEND) python -m scripts.make_pwa_icons

.PHONY: create-admin
create-admin: ## Show instructions for creating a new admin user
	@echo "The first admin user is created automatically on first run."
	@echo "To add another user, use the panel: Settings -> Panel users"

# ------------------------------------------------------------------- dev

.PHONY: test
test: ## Run backend tests
	cd backend && ./.venv/Scripts/python.exe -m pytest tests/ -q \
		|| cd backend && python -m pytest tests/ -q

.PHONY: test-docker
test-docker: check-env ## Run tests inside a container
	@# Tests are intentionally not baked into the production image; mounted at run time
	$(COMPOSE) run --rm --no-deps \
		-e DATABASE_URL=sqlite:////tmp/test.db \
		-v "$(CURDIR)/backend/tests:/app/tests:ro" \
		$(BACKEND) python -m pytest tests/ -q

.PHONY: clean
clean: ## Remove containers and images (data is kept)
	$(COMPOSE) down --rmi local

.PHONY: destroy
destroy: ## Remove everything including database and photos — irreversible
	@echo "Warning: all data, including punches and face photos, will be deleted."
	@read -r -p "Type delete to confirm: " r; [ "$$r" = "delete" ] || exit 1
	$(COMPOSE) down -v --rmi local
