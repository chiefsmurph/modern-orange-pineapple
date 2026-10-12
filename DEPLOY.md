# Deploying mopclothing.com

Box: `root@pingpigeon-vps`. The app is `/srv/mopclothing` (not a git checkout), run by
systemd `mopclothing.service` as user `mopclothing` (`npm start`, PORT 3100,
`ProtectHome`, `PrivateTmp`, `NoNewPrivileges`). nginx proxies 443 → 127.0.0.1:3100; Cloudflare is in front.

The steps build a fresh copy next to the live one while the old one keeps serving,
then swap the directories. Downtime is a few seconds. Rollback swaps them back.

## 1. Ship a clean copy of the branch (from the laptop)

`git archive` ships only tracked files. It never includes `node_modules`, `.next`,
`.env*`, the raw videos in `public/videos/`, or `db.json`/`data/`.

```sh
cd ~/code/modern-orange-pineapple && git fetch origin
REF=origin/feat/tighten-up          # or origin/main once merged
rm -rf /tmp/mop-release && mkdir /tmp/mop-release
git archive "$REF" | tar -x -C /tmp/mop-release
rsync -a --delete /tmp/mop-release/ root@pingpigeon-vps:/srv/mopclothing-new/
```

## 2. Build it as the app user (on the box, as root)

```sh
cd /srv/mopclothing-new
cp -a /srv/mopclothing/.env .                       # Stripe keys (mode 600). Next reads .env from the app dir.
[ -f /srv/mopclothing/stripe_orders.json ] && cp -a /srv/mopclothing/stripe_orders.json .
chown -R mopclothing:mopclothing /srv/mopclothing-new
sudo -u mopclothing env HOME=/srv/mopclothing-new NEXT_TELEMETRY_DISABLED=1 \
  bash -c 'cd /srv/mopclothing-new && npm ci && npm run build'
grep '"version"' node_modules/next/package.json    # expect 15.5.27
```

The build downloads Orbitron from Google Fonts (next/font), so the box needs outbound
HTTPS. `npm ci` installs sharp's linux-x64 binary, which next/image uses.

## 3. Data directory for redeem codes (one time)

Codes now live in `$MOP_DATA_DIR/codes.json`, outside the code dir, so no deploy can
overwrite them. Use `/var/lib`: `ProtectHome` hides `/root` and `/home` from the
service, and `PrivateTmp` makes `/tmp` private to it.

```sh
mkdir -p /etc/systemd/system/mopclothing.service.d
cat > /etc/systemd/system/mopclothing.service.d/data-dir.conf <<'EOF'
[Service]
Environment=MOP_DATA_DIR=/var/lib/mopclothing
StateDirectory=mopclothing
StateDirectoryMode=0750
EOF
install -d -o mopclothing -g mopclothing -m 750 /var/lib/mopclothing
# Migrate the legacy list (same JSON format). Never overwrite an existing codes.json:
[ -e /var/lib/mopclothing/codes.json ] || \
  install -o mopclothing -g mopclothing -m 640 /srv/mopclothing/db.json /var/lib/mopclothing/codes.json
systemctl daemon-reload
```

There's a safety net: if `codes.json` is missing at runtime but `./db.json` exists in
the app dir, the app copies it over once and logs `[codes] migrated legacy …`.

## 4. Swap and restart

```sh
systemctl stop mopclothing
mv /srv/mopclothing /srv/mopclothing.prev && mv /srv/mopclothing-new /srv/mopclothing
systemctl start mopclothing
```

Verify:

```sh
systemctl status mopclothing --no-pager | head -5
journalctl -u mopclothing -n 20 --no-pager
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/                     # 200
curl -s http://127.0.0.1:3100/api/list | head -c 300; echo                          # the codes
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H 'Accept: image/avif,image/webp' \
  'http://127.0.0.1:3100/_next/image?url=%2Fimages%2Fclouds-in-sky-shirt%2Ferasebg-transformed(3).png&w=640&q=75'  # 200 image/avif
curl -sI http://127.0.0.1:3100/videos/underthesea-web.mp4 | head -1                 # 200
```

Then open https://mopclothing.com and a product page, and generate and redeem a test
code at /banana-suit-42 and /redeem if you want an end-to-end check.

## Rollback

```sh
systemctl stop mopclothing
cp -a /var/lib/mopclothing/codes.json /srv/mopclothing.prev/db.json   # keep codes made since the deploy
mv /srv/mopclothing /srv/mopclothing.failed && mv /srv/mopclothing.prev /srv/mopclothing
systemctl start mopclothing
```

The old code ignores `MOP_DATA_DIR`, so the drop-in can stay. Once the new version
has run cleanly for a few days, delete `/srv/mopclothing.prev`.

## Orders: Stripe webhook → Printful / Yoycol → email (Phase 1)

What happens on a paid checkout (`app/api/stripe-webhook/route.ts`, `lib/orders/`):

1. Stripe sends `checkout.session.completed` to `https://mopclothing.com/api/stripe-webhook`.
   The signature is checked on the raw body with `STRIPE_WEBHOOK_SECRET`.
2. The order is written to `$MOP_DATA_DIR/orders.jsonl` (and `orders-state.json`)
   **before** any supplier call. The state file makes the webhook idempotent: a repeated
   event is a no-op, and a run that crashed resumes where it stopped on Stripe's retry.
3. Printful items → `POST https://api.printful.com/orders` as a **draft**
   (`external_id` = `mop-<28 hex of sha256(session id)>`; Printful caps it at 32 chars).
   Yoycol items → `POST /api/2025/open/v4/orders`, created **unpaid**. Each call is retried
   once on a network error / 429 / 5xx.
4. One `royalties.jsonl` row per royalty-bearing item.
5. John gets an email (through PingPigeon on this box) with what sold, the supplier order
   and what to do: confirm the Printful draft / pay the Yoycol order / place it by hand.
   Any supplier failure makes the subject start with `ACTION NEEDED`.

### Environment (`/srv/mopclothing/.env`, mode 600)

Already there: `STRIPE_SECRET_KEY`, `PRINTFUL_API_TOKEN`, `YOYCOL_ACCESS_KEY`, `YOYCOL_SECRET_KEY`.
`MOP_DATA_DIR` comes from the systemd drop-in (section 3).

| Variable | Needed | What |
|---|---|---|
| `STRIPE_WEBHOOK_SECRET` | yes | The endpoint's signing secret (`whsec_…`). Until it's set the webhook answers 500 and Stripe keeps retrying (for up to 3 days), so no order is lost while it's missing. |
| `PINGPIGEON_TOKEN` | yes | A PingPigeon token on John's account (emails always go to the token owner's verified address). |
| `PINGPIGEON_URL` | no | Default `http://127.0.0.1:3141` (the pingpigeon pm2 app on this box). |
| `PRINTFUL_AUTO_CONFIRM` | no | `true` = confirm Printful orders straight away. Default: drafts. |
| `PRINTFUL_STORE_ID` | no | Only if `PRINTFUL_API_TOKEN` is an account-wide token (sends `X-PF-Store-Id`). |
| `YOYCOL_DESIGN_CODES` | no | Override the saved-template codes, e.g. `clouds-in-sky-shirt=ABCDE,blue-sky-cotton-shorts=FGHIJ`. Defaults: LRVV1 / LRWGN. |
| `YOYCOL_SHIPPING_LEVEL` | no | Default `vSt5rbZe` (Standard). |
| `MOP_ROYALTY_RATES` | no | Per-item overrides, e.g. `sunshine=1.50`. Defaults come from catalog.json ($1.50). |
| `ORDER_DRY_RUN` | **never in production** | `1` logs the Printful/Yoycol/email payloads instead of sending them. |

### Checks after a deploy

```sh
# Reaches the route through Cloudflare + nginx and fails the signature check: expect 400.
# A 403 here means Cloudflare is blocking POSTs and Stripe will be blocked too.
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mopclothing.com/api/stripe-webhook -d '{}'
journalctl -u mopclothing -n 50 --no-pager | grep -E '\[orders\]|\[stripe-webhook\]|\[checkout\]'
ls -l /var/lib/mopclothing/    # orders.jsonl, orders-state.json, royalties.jsonl appear after the first order
```

### Monthly royalty email (not installed yet)

`scripts/royalty-summary.mjs` emails John the per-artist totals for the previous month
(Pacific time; Stripe test-mode orders are skipped; refunds are not subtracted).
Try it first: `sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/royalty-summary.mjs --dry-run`.
Use the same `node` binary as `mopclothing.service` (`systemctl cat mopclothing`).

```ini
# /etc/systemd/system/mopclothing-royalties.service
[Unit]
Description=MOP monthly royalty summary email
After=network-online.target

[Service]
Type=oneshot
User=mopclothing
Group=mopclothing
WorkingDirectory=/srv/mopclothing
EnvironmentFile=/srv/mopclothing/.env
Environment=MOP_DATA_DIR=/var/lib/mopclothing
ExecStart=/usr/bin/node /srv/mopclothing/scripts/royalty-summary.mjs
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true

# /etc/systemd/system/mopclothing-royalties.timer
[Unit]
Description=MOP royalty summary, 1st of each month

[Timer]
OnCalendar=*-*-01 09:00:00 America/Los_Angeles
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl daemon-reload && systemctl enable --now mopclothing-royalties.timer
systemctl list-timers mopclothing-royalties.timer
```

### Product data

The Printful line-up is generated from the Printful agent's `catalog.json`:
`node scripts/gen-catalog.mjs /path/to/catalog.json` rewrites
`lib/catalog/{products,fulfilment}.generated.ts` and `public/images/catalog/`. Commit the
result. Descriptions, option labels and fabric notes live in `lib/catalog/copy.ts`.
`npm test` checks the generated data (every variant has a Printful sync variant, credits and
royalties follow the spec) and the order code.
