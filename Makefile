# سامانه حضور و غیاب — دستورهای راه‌اندازی و نگهداری
#
# «make» بدون آرگومان، فهرست دستورها را نشان می‌دهد.

SHELL := /bin/bash
COMPOSE := docker compose
BACKUP_DIR := backups
STAMP := $(shell date +%Y%m%d-%H%M%S)

# نسخه ۲ افزونه Compose لازم است. نسخه قدیمی و جداگانه «docker-compose» (که با
# خط تیره صدا زده می‌شود) این فایل را اصلاً نمی‌تواند بخواند: کلید `name` در
# ریشه فایل و `depends_on.condition` را پشتیبانی نمی‌کند. ضمناً از سال ۲۰۲۳
# دیگر پشتیبانی نمی‌شود.
COMPOSE_OK := $(shell docker compose version >/dev/null 2>&1 && echo yes)

# نام سرویس‌ها
DB := db
BACKEND := backend
WEB := web

# آدرس آینه‌های داخلی Liara (برای دور زدن کندی/فیلترینگ روی سرورهای ایران)
GO_PROXY := https://package-mirror.liara.ir/repository/go/
NPM_REGISTRY := https://package-mirror.liara.ir/repository/npm/
PYPI_INDEX := https://package-mirror.liara.ir/repository/pypi/
APT_MIRROR := http://linux-mirror.liara.ir/repository/ubuntu/
APT_SECURITY_MIRROR := http://linux-mirror.liara.ir/repository/ubuntu-security/
DOCKER_MIRROR := https://docker-mirror.liara.ir

.DEFAULT_GOAL := help

# ---------------------------------------------------------------- راهنما

.PHONY: help
help: ## نمایش همین فهرست
	@echo ""
	@echo "  سامانه حضور و غیاب — دستورهای موجود"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  شروع سریع روی VPS:  make setup  →  ویرایش .env  →  make mirrors  →  make deploy  →  make ssl"
	@echo ""

# ------------------------------------------------------------ راه‌اندازی

.PHONY: setup
setup: ## ساخت فایل .env با کلیدهای تصادفی (بار اول)
	@if [ -f .env ]; then \
		echo "فایل .env از قبل وجود دارد؛ دست نخورد."; \
	else \
		cp .env.example .env; \
		secret=$$(openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-50); \
		dbpass=$$(openssl rand -base64 24 | tr -d '\n/+=' | cut -c1-24); \
		adminpass=$$(openssl rand -base64 12 | tr -d '\n/+=' | cut -c1-12); \
		sed -i "s|^SECRET_KEY=.*|SECRET_KEY=$$secret|" .env; \
		sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$dbpass|" .env; \
		sed -i "s|^FIRST_ADMIN_PASSWORD=.*|FIRST_ADMIN_PASSWORD=$$adminpass|" .env; \
		echo ""; \
		echo "فایل .env ساخته شد و کلیدها تصادفی تولید شدند."; \
		echo "رمز اولیه مدیر: $$adminpass"; \
		echo ""; \
		echo "حالا DOMAIN و LETSENCRYPT_EMAIL را در .env تنظیم کنید، سپس: make mirrors && make deploy"; \
	fi

.PHONY: check-env
check-env: check-compose
	@test -f .env || { echo "فایل .env نیست. اول «make setup» را اجرا کنید."; exit 1; }

.PHONY: check-compose
check-compose:
	@if [ "$(COMPOSE_OK)" != "yes" ]; then \
		echo ""; \
		echo "  ✗ افزونه Docker Compose نسخه ۲ روی این سرور نصب نیست."; \
		echo ""; \
		if command -v docker-compose >/dev/null 2>&1; then \
			echo "    نسخه قدیمی «docker-compose» (با خط تیره) نصب است، ولی این"; \
			echo "    فایل با آن کار نمی‌کند و آن نسخه هم دیگر پشتیبانی نمی‌شود."; \
			echo ""; \
		fi; \
		echo "    برای نصب:  make install-compose"; \
		echo ""; \
		exit 1; \
	fi

.PHONY: install-compose
install-compose: ## نصب افزونه Docker Compose نسخه ۲
	@set -e; \
	arch=$$(uname -m); \
	case "$$arch" in \
		x86_64|amd64) target=x86_64 ;; \
		aarch64|arm64) target=aarch64 ;; \
		*) echo "معماری پشتیبانی‌نشده: $$arch"; exit 1 ;; \
	esac; \
	dest=/usr/local/lib/docker/cli-plugins; \
	echo "نصب Docker Compose v2 برای $$target در $$dest"; \
	mkdir -p $$dest; \
	curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$$target" \
		-o $$dest/docker-compose; \
	chmod +x $$dest/docker-compose; \
	echo ""; \
	docker compose version

# ------------------------------------------------------- آینه‌های داخلی

.PHONY: mirrors
mirrors: mirrors-go mirrors-npm mirrors-pip ## تنظیم آینه‌های go، npm و pip برای کاربر جاری
	@echo ""
	@echo "آینه‌های go، npm و pip تنظیم شدند."
	@echo "برای آینه سیستم‌عامل (apt) و داکر که نیاز به دسترسی root دارند:"
	@echo "    sudo make mirrors-apt"
	@echo "    sudo make mirrors-docker"
	@echo ""

.PHONY: mirrors-go
mirrors-go: ## تنظیم آینه ماژول‌های Go
	@if ! command -v go >/dev/null 2>&1; then echo "go نصب نیست؛ رد شد."; exit 0; fi
	go env -w GOPROXY=$(GO_PROXY)
	go env -w GOSUMDB=off
	@echo "آینه go تنظیم شد: $(GO_PROXY)"

.PHONY: mirrors-npm
mirrors-npm: ## تنظیم آینه npm (سراسری)
	@if ! command -v npm >/dev/null 2>&1; then echo "npm نصب نیست؛ رد شد."; exit 0; fi
	npm config set registry $(NPM_REGISTRY) --global
	@echo "آینه npm تنظیم شد: $(NPM_REGISTRY)"

.PHONY: mirrors-pip
mirrors-pip: ## تنظیم آینه pip برای کاربر جاری
	@mkdir -p "$$HOME/.pip" "$$HOME/.config/pip"
	@printf '[global]\nindex-url = %s\n' "$(PYPI_INDEX)" > "$$HOME/.pip/pip.conf"
	@printf '[global]\nindex-url = %s\n' "$(PYPI_INDEX)" > "$$HOME/.config/pip/pip.conf"
	@echo "آینه pip تنظیم شد: $(PYPI_INDEX)"

.PHONY: mirrors-apt
mirrors-apt: ## تنظیم آینه apt (نیاز به sudo/root روی سرور)
	@test "$$(id -u)" = "0" || { echo "این دستور باید با sudo اجرا شود: sudo make mirrors-apt"; exit 1; }
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
	@echo "آینه apt تنظیم شد (نسخه‌های قبلی با پسوند .bak نگه داشته شدند)."

.PHONY: mirrors-docker
mirrors-docker: ## تنظیم آینه دریافت ایمیج داکر (نیاز به sudo/root)
	@test "$$(id -u)" = "0" || { echo "این دستور باید با sudo اجرا شود: sudo make mirrors-docker"; exit 1; }
	@mkdir -p /etc/docker
	@if [ -f /etc/docker/daemon.json ]; then cp -n /etc/docker/daemon.json /etc/docker/daemon.json.bak; fi
	@if command -v jq >/dev/null 2>&1 && [ -s /etc/docker/daemon.json ]; then \
		jq '.["registry-mirrors"] = ["$(DOCKER_MIRROR)"]' /etc/docker/daemon.json > /tmp/daemon.json.tmp && \
		mv /tmp/daemon.json.tmp /etc/docker/daemon.json; \
	else \
		printf '{\n  "registry-mirrors": ["%s"]\n}\n' "$(DOCKER_MIRROR)" > /etc/docker/daemon.json; \
	fi
	@systemctl restart docker
	@echo "آینه docker تنظیم شد و سرویس docker ری‌استارت شد: $(DOCKER_MIRROR)"

# ------------------------------------------------------------- استقرار

.PHONY: deploy
deploy: check-env ## ساخت ایمیج‌ها و بالا آوردن کل سامانه
	$(COMPOSE) build
	$(COMPOSE) up -d
	@echo ""
	@echo "سامانه بالا آمد. برای گرفتن گواهی SSL: make ssl"
	@$(MAKE) --no-print-directory status

.PHONY: build
build: check-env ## فقط ساخت مجدد ایمیج‌ها
	$(COMPOSE) build

.PHONY: up
up: check-env ## بالا آوردن سرویس‌ها
	$(COMPOSE) up -d

.PHONY: down
down: check-compose ## خواباندن سرویس‌ها (داده‌ها پاک نمی‌شوند)
	$(COMPOSE) down

.PHONY: restart
restart: check-compose ## راه‌اندازی مجدد سرویس‌ها
	$(COMPOSE) restart

.PHONY: update
update: check-env ## دریافت آخرین کد، ساخت مجدد و راه‌اندازی
	git pull --ff-only
	$(COMPOSE) build
	$(COMPOSE) up -d
	@$(MAKE) --no-print-directory status

.PHONY: status
status: check-compose ## وضعیت سرویس‌ها
	@$(COMPOSE) ps

.PHONY: logs
logs: check-compose ## دنبال کردن لاگ همه سرویس‌ها (Ctrl+C برای خروج)
	$(COMPOSE) logs -f --tail=100

.PHONY: logs-backend
logs-backend: ## لاگ سرور
	$(COMPOSE) logs -f --tail=100 $(BACKEND)

.PHONY: logs-web
logs-web: ## لاگ nginx
	$(COMPOSE) logs -f --tail=100 $(WEB)

# ------------------------------------------------------------------ SSL

.PHONY: ssl
ssl: check-env ## گرفتن گواهی SSL از Let's Encrypt (بار اول)
	@bash scripts/init-ssl.sh

.PHONY: ssl-renew
ssl-renew: ## تمدید دستی گواهی (تمدید خودکار هم فعال است)
	$(COMPOSE) run --rm certbot renew --webroot -w /var/www/certbot
	$(COMPOSE) exec $(WEB) nginx -s reload

.PHONY: ssl-check
ssl-check: ## آزمایش تمدید بدون تغییر واقعی
	$(COMPOSE) run --rm certbot renew --webroot -w /var/www/certbot --dry-run

.PHONY: ssl-info
ssl-info: ## نمایش تاریخ انقضای گواهی
	$(COMPOSE) run --rm --entrypoint "certbot certificates" certbot

# ------------------------------------------------------- پشتیبان‌گیری

.PHONY: backup
backup: check-env ## پشتیبان از پایگاه داده و تصاویر چهره
	@mkdir -p $(BACKUP_DIR)
	@set -a; . ./.env; set +a; \
	$(COMPOSE) exec -T $(DB) pg_dump -U $$POSTGRES_USER $$POSTGRES_DB \
		| gzip > $(BACKUP_DIR)/db-$(STAMP).sql.gz
	@$(COMPOSE) run --rm -v $(PWD)/$(BACKUP_DIR):/backup \
		--entrypoint "tar czf /backup/media-$(STAMP).tar.gz -C /app/app/static ." $(BACKEND)
	@echo "پشتیبان ساخته شد:"
	@ls -lh $(BACKUP_DIR)/db-$(STAMP).sql.gz $(BACKUP_DIR)/media-$(STAMP).tar.gz

.PHONY: restore
restore: check-env ## بازگردانی پایگاه داده (FILE=backups/db-....sql.gz)
	@test -n "$(FILE)" || { echo "استفاده: make restore FILE=backups/db-....sql.gz"; exit 1; }
	@test -f "$(FILE)" || { echo "فایل $(FILE) پیدا نشد"; exit 1; }
	@echo "هشدار: محتوای فعلی پایگاه داده جایگزین می‌شود."
	@read -r -p "ادامه می‌دهید؟ [y/N] " r; [ "$$r" = "y" ] || exit 1
	@set -a; . ./.env; set +a; \
	gunzip -c "$(FILE)" | $(COMPOSE) exec -T $(DB) psql -U $$POSTGRES_USER -d $$POSTGRES_DB
	@echo "بازگردانی انجام شد."

# ------------------------------------------------------------- ابزارها

.PHONY: shell
shell: ## ورود به پوسته کانتینر سرور
	$(COMPOSE) exec $(BACKEND) bash

.PHONY: dbshell
dbshell: ## ورود به psql
	@set -a; . ./.env; set +a; \
	$(COMPOSE) exec $(DB) psql -U $$POSTGRES_USER -d $$POSTGRES_DB

.PHONY: seed-demo
seed-demo: ## ساخت داده نمونه (فقط برای آزمایش، نه روی سرور واقعی)
	$(COMPOSE) exec $(BACKEND) python -m scripts.seed_demo

.PHONY: icons
icons: ## ساخت مجدد آیکون‌های PWA
	$(COMPOSE) run --rm $(BACKEND) python -m scripts.make_pwa_icons

.PHONY: create-admin
create-admin: ## نمایش راهنمای ساخت کاربر مدیر جدید
	@echo "کاربر مدیر بار اول خودکار ساخته می‌شود."
	@echo "برای افزودن کاربر جدید، از پنل: تنظیمات ← کاربران پنل"

# ------------------------------------------------------------- توسعه

.PHONY: test
test: ## اجرای آزمون‌های سرور
	cd backend && ./.venv/Scripts/python.exe -m pytest tests/ -q \
		|| cd backend && python -m pytest tests/ -q

.PHONY: test-docker
test-docker: check-env ## اجرای آزمون‌ها داخل کانتینر
	@# آزمون‌ها عمداً داخل ایمیج تولید نیستند؛ موقع اجرا mount می‌شوند
	$(COMPOSE) run --rm --no-deps \
		-e DATABASE_URL=sqlite:////tmp/test.db \
		-v "$(CURDIR)/backend/tests:/app/tests:ro" \
		$(BACKEND) python -m pytest tests/ -q

.PHONY: clean
clean: ## حذف کانتینرها و ایمیج‌ها (داده‌ها می‌مانند)
	$(COMPOSE) down --rmi local

.PHONY: destroy
destroy: ## حذف کامل شامل پایگاه داده و تصاویر — برگشت‌ناپذیر
	@echo "هشدار: همه داده‌ها شامل ترددها و تصاویر چهره پاک می‌شوند."
	@read -r -p "برای تأیید، عبارت delete را تایپ کنید: " r; [ "$$r" = "delete" ] || exit 1
	$(COMPOSE) down -v --rmi local
