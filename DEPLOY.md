# Deploying to a raw VPS

Start-to-finish guide for taking a brand-new Ubuntu/Debian VPS to a running,
HTTPS-secured attendance system — including pairing the kiosk tablet,
enrolling employees, and (optionally) an ESP32 fingerprint gate. For what
each feature does, see [README.md](README.md); this file is only about
getting it deployed and keeping it running.

## 0. Before you start

You need:

- An Ubuntu or Debian VPS (2GB RAM / 20GB disk is enough for a single
  factory's worth of attendance data; more if you'll run other projects on
  it too). Root or sudo SSH access.
- A domain or subdomain whose **A record points at the VPS's public IP**.
  Set this now — DNS propagation can take a while, and you'll need it
  resolving before the SSL step.
- If this VPS **already runs another project**: note which local port
  that project uses (check its `.env` / `docker-compose.yml`), so you can
  pick a different one for this app. See [§12](#12-running-a-second-project-on-the-same-vps).

Everything below is run over SSH on the VPS itself, from inside the cloned
repo directory, unless stated otherwise.

## 1. Get the code onto the server

```bash
ssh root@your-server-ip
git clone <your-repo-url> attendance-system
cd attendance-system
```

## 2. Bring it up

### Path A — fully automated (recommended for a fresh VPS)

```bash
DOMAIN=hozur.example.com LETSENCRYPT_EMAIL=admin@example.com make bootstrap
```

This one command ([scripts/bootstrap-vps.sh](scripts/bootstrap-vps.sh)):
installs Docker Engine + Compose v2, creates `.env` with randomly generated
secrets, builds and starts the app, then configures the host's nginx and
gets a Let's Encrypt certificate. Leave off `DOMAIN=`/`LETSENCRYPT_EMAIL=`
and it'll prompt interactively instead. On servers where outbound
connections to Docker Hub / apt / npm are throttled (common for
Iran-hosted VPS providers), add `MIRRORS=1` to route installs through
mirrors.

Skip to [§3](#3-first-login).

### Path B — step by step (more control, or Docker already installed)

```bash
docker compose version   # must show v2 ("docker compose", no dash)
```

If that fails: `make install-compose`.

```bash
make setup            # creates .env with random SECRET_KEY / DB password / admin password
nano .env              # fill in DOMAIN and LETSENCRYPT_EMAIL
                        # (and APP_HTTP_PORT if another project is on this VPS)
make deploy            # build images, bring up db + backend + web
make ssl               # configure host nginx + get the Let's Encrypt cert
```

`make deploy` brings the app up on `127.0.0.1:<APP_HTTP_PORT>` only — not
public yet. `make ssl` is the step that makes `https://<your domain>`
actually work: it installs nginx/certbot on the host if they aren't
already there, and does the whole HTTP-challenge → certificate →
HTTPS-vhost sequence. See
[scripts/deploy-host-nginx.sh](scripts/deploy-host-nginx.sh) if you want to
know exactly what it does.

If port 80 isn't reachable from the internet on this VPS (behind a
firewall/NAT/load balancer), use `make ssl-dns` instead — it walks you
through a manual DNS TXT record instead of the automatic HTTP check, but
won't auto-renew (see [§11](#11-ssl-renewal)).

**Either path, once done:** the admin panel is at `https://<your domain>`
and the kiosk pairing page is at `https://<your domain>/kiosk`.

## 3. First login

`make setup` (or `make bootstrap`, which calls it) printed a line like:

```
Initial admin password: xK9mPqR2vLtN
```

**Copy it now** — it only prints once and isn't stored anywhere in
plaintext after that. Username is `admin` unless you changed
`FIRST_ADMIN_USERNAME` in `.env` before first deploy.

Log into `https://<your domain>` with it, then immediately:

1. Go to **حساب من** (Account) and change the password to one you control.
2. Go to **تنظیمات ← کاربران پنل** (Settings → Panel users) and create
   named accounts for anyone else who needs access, with the least
   privilege that covers their job (`viewer` for read-only, `manager` for
   day-to-day HR work, `admin` only for whoever should manage devices/users).

## 4. Lock down the firewall

A raw VPS usually has no firewall at all. At minimum, allow only what you
actually need publicly:

```bash
sudo apt-get install -y ufw
sudo ufw allow OpenSSH   # or: ufw allow 22/tcp — do this BEFORE enabling ufw
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Nothing else needs a public port: Postgres and the backend are only
reachable from inside the Docker network, and `web` only listens on
`127.0.0.1` (see [docker-compose.yml](docker-compose.yml)). If you manage
this server with a cloud provider's own security-group/firewall UI
instead, mirror the same rule there (22, 80, 443 only) and skip `ufw`.

## 5. Pair the kiosk tablet

1. On the tablet's browser, go to `https://<your domain>/kiosk`.
2. Back in the admin panel: **تنظیمات ← دستگاه‌ها ← ثبت دستگاه جدید**
   (Settings → Devices → Register new device), type **Tablet** as the
   kind, give it a name (e.g. "درب اصلی"). Copy the key shown — **it's
   shown exactly once.**
3. Paste that key into the tablet's pairing screen and connect.

The tablet needs HTTPS to use the camera at all (browsers block camera
access on plain HTTP except for `localhost`), which is exactly what
`make ssl` set up.

## 6. Enroll employee faces

Two ways, same result:

- **From the admin panel** (any computer): **پرسنل** (Employees) → pick
  someone → face enrollment tab.
- **On the tablet itself**: tap the shield icon on the kiosk scan screen,
  log in with a manager/admin account, search for the employee, and
  capture samples with the tablet's own camera. Useful when the tablet is
  the only camera near where people actually stand.

Enroll at least 3 samples per person from slightly different angles — the
panel shows a running count and flags anyone under that as
"face_enrolled: false" so you can find who's missing.

## 7. Optional: ESP32 fingerprint gate

If you're adding fingerprint readers (see
[firmware/esp32-fingerprint](firmware/esp32-fingerprint) /
[firmware/esp32-fingerprint-arduino](firmware/esp32-fingerprint-arduino)):

1. **Settings → Devices → Register new device**, kind **Fingerprint**, one
   per physical gate. Copy each key immediately.
2. Flash the firmware to each ESP32 (PlatformIO or Arduino IDE — see that
   folder's README), and provision it with WiFi + this server's HTTPS URL
   + its device key via the captive portal on first boot.
3. Enroll a fingerprint from the admin panel (or from the tablet's admin
   mode, next to face enrollment) — pick the employee and which gate
   they're standing at. Once enrolled on one gate, it syncs to every other
   fingerprint gate automatically.

## 8. Choose which check-in methods are allowed

**Settings → روش‌های تأیید هویت** (Auth methods) lets you enable any
combination of face / fingerprint / PIN — at least one must stay on. The
kiosk tablet and any ESP32 gates pick this up automatically (tablets on
their next handshake, ESP32 gates within ~2 minutes) and hide/disable
whatever's turned off; the backend also rejects a disabled method outright
if something tries to use it anyway.

## 9. Backups

```bash
crontab -e
```

```cron
0 2 * * * cd /root/attendance-system && make backup >> /var/log/attendance-backup.log 2>&1
```

`make backup` dumps the database and the face-photo/snapshot volume into
`backups/`. Copy that directory off-server periodically (rsync, S3, etc.)
— a backup that only lives on the same disk as the thing it's backing up
doesn't survive a disk failure. To restore:
`make restore FILE=backups/db-<timestamp>.sql.gz`.

## 10. Day-2 operations

| Task | Command |
|---|---|
| Pull latest code, rebuild, restart | `make update` |
| View live logs (all services) | `make logs` |
| Backend logs only | `make logs-backend` |
| Service status | `make status` |
| Restart without rebuilding | `make restart` |
| Stop (data kept) | `make down` |
| Shell into backend container | `make shell` |
| psql shell | `make dbshell` |

## 11. SSL renewal

Automatic — certbot's own systemd timer (`certbot.timer`, installed by
`make ssl`) checks twice daily, and a renewal-hook reloads nginx after any
actual renewal. Nothing to do. To double-check it'll work when it matters:

```bash
make ssl-check    # dry-run, makes no real changes
make ssl-info     # shows current expiry date
```

(This doesn't apply if you used `make ssl-dns` — that certificate does
**not** auto-renew; re-run `make ssl-dns` before it expires.)

## 12. Running a second project on the same VPS

This app's containers never touch ports 80/443 — only the host's nginx
does, and it's shared across every project the same way. To add another
project alongside this one:

1. Clone that project into its own directory.
2. Give it a domain/subdomain and, if it also uses this same deployment
   pattern, a different `APP_HTTP_PORT` than any project already on this
   VPS (check `grep APP_HTTP_PORT */attendance-system/.env`-style across
   your projects, or just keep a running list somewhere).
3. Run its own `make deploy` + `make ssl`. Its `make ssl` installs nginx
   only if missing (won't disturb this app's vhost) and writes a vhost
   named after *its own* domain — the two projects' host-nginx configs
   coexist as separate files under `/etc/nginx/sites-available/`.

If this is the **first** project on a truly virgin VPS, Ubuntu's default
nginx site can interfere with the very first `make ssl` run for reasons
unrelated to this app. If you hit unexpected routing to a stock
"Welcome to nginx" page:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 13. Troubleshooting

**`make ssl` fails with a DNS warning or certbot timeout** — the domain's
A record isn't pointing at this server yet, or hasn't propagated. Check
with `dig +short <domain>` from your own machine and compare to the
server's IP (`curl -4 ifconfig.me` on the server); wait and retry.

**`docker compose` says "unknown command"** — the old standalone
`docker-compose` (with a dash) is installed instead of the v2 plugin; run
`make install-compose`.

**Port already in use / `web` won't start** — another project is already
using this app's `APP_HTTP_PORT`. Change it in `.env`, `make down && make
deploy`, then re-run `make ssl` to rewrite the vhost with the new port.

**Forgot the admin password and it's the only admin account** —
there's no CLI reset yet; use `make dbshell` and update the `users` table
directly, or `make destroy` on a fresh instance if there's no real data
yet (irreversible — reads out loud and asks for confirmation).

**Camera doesn't work on the tablet** — it must be on `https://`, not
`http://`; browsers block camera access on plain HTTP for anything other
than `localhost`. Confirm `make ssl` completed successfully.

**Backend container unhealthy right after deploy** — check
`make logs-backend`; the most common cause is `SECRET_KEY` or
`POSTGRES_PASSWORD` missing from `.env` (both are required — the compose
file refuses to start without them, which shows up as an immediate exit
rather than a health-check failure).

## 14. Security checklist (recap)

- [ ] Changed the admin password from the one `make setup` generated
- [ ] Named accounts created for other panel users, least-privilege roles
- [ ] Firewall allows only 22/80/443
- [ ] `.env` is not world-readable and never committed to git (it's
      gitignored already — verify with `git status`)
- [ ] Backups are copied *off* this server on a schedule, not just sitting
      in `backups/`
- [ ] Each tablet/ESP32 device has its own key (never share one key across
      multiple physical devices — if one is lost, rotate just that key)
