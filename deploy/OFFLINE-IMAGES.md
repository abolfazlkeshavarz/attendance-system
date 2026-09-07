# Building elsewhere (prebuilt images, no build on the VPS)

The frontend build wants well over 1 GB of RAM and is slow because of the
face-recognition assets. On a small VPS (1 core, little memory) building in
place is slow at best and gets OOM-killed at worst. Build the images on a
machine that has the resources, carry a single tarball to the server, and
there only load and start them.

The tarball holds the two images that must be compiled — `attendance-backend`
and `attendance-web`. `postgres:16-alpine` is pulled from Docker Hub on the
server (it is very likely already present if another project uses it); pass
`INCLUDE_BASE=1` to bundle it too if the server cannot reach Docker Hub.

---

## On your machine

```bash
make images
# -> dist/attendance-images.tar.gz
```

Options (environment variables):

| var | default | meaning |
|---|---|---|
| `PLATFORM` | `linux/amd64` | target arch — set `linux/arm64` for an ARM VPS |
| `INCLUDE_BASE` | `0` | also bundle `postgres:16-alpine` |
| `OUT` | `dist/attendance-images.tar.gz` | bundle path |

The script verifies the built images actually match `PLATFORM` before packing
(an arch mismatch otherwise only surfaces as `exec format error` at container
start on the server).

Copy it over:

```bash
scp dist/attendance-images.tar.gz USER@SERVER:/opt/attendance/
```

---

## On the server

```bash
cd /opt/attendance
make load-images        # gunzip | docker load, then re-checks the architecture
```

Then, depending on whether the server is already set up:

**First-time setup** (no `.env` yet, needs the SSL step):

```bash
./scripts/bootstrap-vps.sh
```

It sees the loaded `attendance-backend:latest` / `attendance-web:latest` and
runs `make up-prebuilt` instead of building.

**Already deployed** (just shipping a new build):

```bash
make up-prebuilt        # docker compose up -d --no-build
```

The database and the `media` volume are untouched. To roll back, keep the old
`dist/attendance-images.tar.gz`, `docker load` it again, and `make up-prebuilt`.

---

## Notes

- **`make deploy` / `make update` are unchanged** — they still build on the
  box they run on. This prebuilt path is an alternative, not a replacement.
- **DB schema:** the backend creates missing tables at startup but does not
  `ALTER` existing ones. A release that adds a column to an existing table
  needs a one-off `ALTER TABLE` (noted in that service's docstring when it
  happens).
- **Host nginx / SSL** is not affected by any of this. `make ssl` is only
  needed the first time or when the domain changes.
