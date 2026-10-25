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
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/list             # 410 (old admin, retired)
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' -H 'Accept: image/avif,image/webp' \
  'http://127.0.0.1:3100/_next/image?url=%2Fimages%2Fclouds-in-sky-shirt%2Ferasebg-transformed(3).png&w=640&q=75'  # 200 image/avif
curl -sI http://127.0.0.1:3100/videos/underthesea-web.mp4 | head -1                 # 200
```

Then open https://mopclothing.com and a product page (and /redeem with a test old-card code
if you want an end-to-end check; reject the test claim afterwards).

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
6. The customer gets a "Thanks for your MOP order! Here's what happens next" email, **once
   `MOP_CONFIRMATION_EMAIL_ENABLED=1` is set** (off by default; see "Order confirmation email" below).
7. When a package ships, the customer gets a "your order has shipped" email with tracking
   (Printful webhook, Yoycol cron; see "Shipped emails to customers" below).
8. Later, from a daily cron: "How's it fit?" a few days after the last package arrives, and for
   the Yoycol shorts a "being made" note 12–14 days in, **once each is switched on** (off by
   default; see "Follow-up emails" below).

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

### Shipped emails to customers (Printful webhook, Yoycol cron)

When a package ships, the customer gets one branded "Your MOP order has shipped 📦" email
(HTML + plain text) with the items in that box, the carrier, a **Track your package** button
and the tracking number. Sent through **Resend** (PingPigeon can only email John). The order
confirmation (below) uses the same sender, look and exactly-once ledger.

- **Printful** (`app/api/printful-webhook/[token]/route.ts`, `lib/orders/printful-shipped.ts`):
  Printful sends `package_shipped` to `https://mopclothing.com/api/printful-webhook/<PRINTFUL_WEBHOOK_TOKEN>`.
  A wrong token gets a 404; every other event type gets a 200 and is ignored. v1 webhooks
  aren't signed, so only the payload's order id is read: the order is re-fetched with
  `GET https://api.printful.com/orders/{id}` (`PRINTFUL_API_TOKEN`, `PRINTFUL_STORE_ID`) and
  the shipments, tracking, items and recipient come from that.
- **Who gets it**: the Printful order's `external_id` is our order ref. An exact match in
  `orders.jsonl` gives the email typed at checkout; otherwise (an order re-placed by hand as
  `mop-…r1`) the recipient on the Printful order. Never any other address. Orders without a
  `mop-` external_id (samples, dashboard orders) get no email.
- **One email per box**: a partial shipment lists only what's in it ("Part of your MOP order
  has shipped", then "The rest of…"); a reshipment says "Your MOP replacement has shipped".
  The webhook skips boxes that shipped over 30 days ago (use the backfill script below for those).
- **Yoycol** (the shorts): no webhooks, so `scripts/yoycol-tracking.mjs` runs from cron. It reads
  Yoycol orders from `orders-state.json` (read only), asks
  `GET /api/2025/open/v4/orders/{orderId}/tracking` (signed like order creation) and emails the
  customer once there's a number (the last-mile `tailTrackCode` if any, else `waybillCode`).
  Those fields come from Yoycol's API spec and haven't been seen on a real shipped order yet:
  check the first one with `--order <ref> --verbose --dry-run`.
- **Exactly once**: `$MOP_DATA_DIR/shipments-emailed.jsonl` gets a `sending` line before the
  send and an `emailed` line once Resend accepts it (key `<supplier>:<order id>:<shipment id or
  tracking number>`). An emailed package is never sent again, through Printful's retries or a
  rerun of either script. Each send also carries a Resend `Idempotency-Key`.
- **Failures**: a failed send is logged (`[shipping]`), not marked emailed, and John gets one
  PingPigeon email "ACTION NEEDED: shipped email failed for <ref>". The webhook answers 500 for
  a send that could work later, so Printful retries (after 1, 4, 16, 64, 256 and 1024 minutes);
  the Yoycol cron retries on its next run. Without `MOP_RESEND_API_KEY`, the webhook still
  answers 200 and logs `MOP_RESEND_API_KEY is not set: shipped email NOT sent` (nothing is
  retried later, so set the key before registering the webhook). Checkout doesn't use any of
  this, and the Stripe webhook only for the order confirmation (off unless switched on).

**Environment** (add to `/srv/mopclothing/.env`; already there: `PRINTFUL_API_TOKEN`,
`PRINTFUL_STORE_ID` if used, `YOYCOL_ACCESS_KEY`, `YOYCOL_SECRET_KEY`, `PINGPIGEON_TOKEN`):

| Variable | Needed | What |
|---|---|---|
| `MOP_RESEND_API_KEY` | yes | Resend API key with **sending access** for the `mopclothing.com` domain. Unset: shipped emails are skipped and logged. |
| `PRINTFUL_WEBHOOK_TOKEN` | yes | The secret in the webhook URL, e.g. `openssl rand -hex 24`. Unset: the route answers 404 to everything. |
| `MOP_EMAIL_FROM` | no | Default `MOP Clothing <orders@mopclothing.com>`. Its domain must be verified in Resend. |
| `MOP_EMAIL_REPLY_TO` | no | Default `orders@mopclothing.com`. The email says "Just reply to this email", so this address must receive mail (e.g. Cloudflare Email Routing → John's inbox). |
| `MOP_EMAIL_DRY_RUN` | no | `1` logs each customer email instead of sending it (and marks nothing emailed). For a first look only. |
| `MOP_CONFIRMATION_EMAIL_ENABLED` | no | `1` turns on the order confirmation email (next section). Unset / anything else: off. |
| `MOP_FOLLOWUP_FIT_ENABLED` | no | `1` turns on the "How's it fit?" email ("Follow-up emails" below). Unset / anything else: off. |
| `MOP_FOLLOWUP_YOYCOL_ENABLED` | no | `1` turns on the Yoycol "being made" note ("Follow-up emails" below). Unset / anything else: off. |
| `MOP_YOYCOL_DELIVERED_STATUS` | no | Yoycol `deliveryStatus` value(s) that mean delivered, e.g. `3` (comma-separated). Unset: only a "Delivered" tracking event counts. Set it once a real delivered order shows the number. |

**One-time setup**

1. Resend → Domains → add `mopclothing.com`, add the DNS records it shows in Cloudflare
   (DNS only, not proxied), wait for **Verified**. Create an API key: Sending access, domain
   `mopclothing.com`. Put it in `.env` as `MOP_RESEND_API_KEY`.
2. Make `orders@mopclothing.com` (or whatever `MOP_EMAIL_REPLY_TO` is) deliver somewhere John reads.
3. Add `PRINTFUL_WEBHOOK_TOKEN` to `.env`, deploy, restart.
4. Register the webhook. **A Printful store has one webhook config, and `POST /webhooks` replaces
   it**, so look first and keep any types already there:

```sh
# on the box, as root; reads the tokens from .env without printing them
set -a; . /srv/mopclothing/.env; set +a
PF=(-H "Authorization: Bearer $PRINTFUL_API_TOKEN" ${PRINTFUL_STORE_ID:+-H "X-PF-Store-Id: $PRINTFUL_STORE_ID"})
curl -s "${PF[@]}" https://api.printful.com/webhooks; echo           # what's configured now
curl -s "${PF[@]}" -H 'Content-Type: application/json' -X POST https://api.printful.com/webhooks \
  -d "{\"url\":\"https://mopclothing.com/api/printful-webhook/$PRINTFUL_WEBHOOK_TOKEN\",\"types\":[\"package_shipped\"]}" \
  | sed "s/$PRINTFUL_WEBHOOK_TOKEN/<token>/g"; echo
```

A 401/403 there means the token lacks the Webhooks permission: add it to the private token in
Printful's developer portal. The token is in the URL, so it also shows in nginx's access log.

5. The Yoycol cron (as the app user, twice a day). The box's clock decides the hours
   (`timedatectl`); on UTC, 16:15 and 01:15 are 9:15 am and 6:15 pm Pacific (daylight time):

```sh
cat > /etc/cron.d/mopclothing-yoycol-tracking <<'EOF'
# Yoycol tracking -> "your order has shipped" emails (scripts/yoycol-tracking.mjs, DEPLOY.md)
15 1,16 * * * mopclothing cd /srv/mopclothing && MOP_DATA_DIR=/var/lib/mopclothing /usr/bin/flock -n /var/lib/mopclothing/yoycol-tracking.lock /usr/bin/node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=/srv/mopclothing/.env scripts/yoycol-tracking.mjs >> /var/lib/mopclothing/yoycol-tracking.log 2>&1
EOF
chmod 644 /etc/cron.d/mopclothing-yoycol-tracking
```

Both scripts import the site's TypeScript (`lib/orders`), so they need Node >= 22.18
(`/usr/bin/node --version`; use the same `node` as `mopclothing.service`).

**Backfill: orders that shipped before the webhook** (or whose email failed).
`scripts/send-shipped-email.mjs` runs the webhook's path for one Printful order: re-fetch,
the same recipient rule, the same email, the same ledger. Any shipment already in
`shipments-emailed.jsonl` is refused, so running it twice sends nothing new. No 30-day limit.

```sh
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node --env-file=/srv/mopclothing/.env \
  /srv/mopclothing/scripts/send-shipped-email.mjs --printful-order 180742757 --dry-run   # prints the email(s)
# then the same without --dry-run. It prints "Customer from: our order record" for an exact ref match.
```

First use: Printful order **180742757** (the site's first order, 3 items, shipped 10/16 by DHL
GlobalMail; external_id `mop-b25662f98fbdbf6d77984351dfca`, an exact match in `orders.jsonl`).

**Checks after a deploy**

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mopclothing.com/api/printful-webhook/wrong -d '{}'   # 404 (a 403 = Cloudflare blocking POSTs)
curl -s -o /dev/null -w '%{http_code}\n' https://mopclothing.com/images/email/mop-logo.png                    # 200 (the email's logo)
# on the box, the real token and a harmless event: expect {"received":true,"ignored":"ping"}
set -a; . /srv/mopclothing/.env; set +a
curl -s -X POST "https://mopclothing.com/api/printful-webhook/$PRINTFUL_WEBHOOK_TOKEN" -H 'Content-Type: application/json' -d '{"type":"ping"}'; echo
# the email for a real shipped order, not sent:
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node --env-file=/srv/mopclothing/.env \
  /srv/mopclothing/scripts/send-shipped-email.mjs --printful-order 180742757 --dry-run
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node --env-file=/srv/mopclothing/.env \
  /srv/mopclothing/scripts/yoycol-tracking.mjs --dry-run --verbose
journalctl -u mopclothing -n 100 --no-pager | grep '\[shipping\]'
tail -n 5 /var/lib/mopclothing/shipments-emailed.jsonl /var/lib/mopclothing/yoycol-tracking.log
```

### Order confirmation email (off until John approves the preview)

"Thanks for your MOP order! Here's what happens next": the shipped email's look (same header,
colours, item rows and footer: `lib/orders/email-layout.ts`) with a greeting, a **What happens
next** timeline (made just for you → printed & packed → shipped with a tracking email → at your
door), the items with thumbnails, options, qty and line price, the totals (subtotal, discount
with the code's name, shipping "Free", total paid), the short order number, two care tips, and
"Questions? Just reply to this email." + Shipping & returns.

- **Times** come from `vendorDelivery` in `public/products.ts`: Printful printed & packed
  `2–5 business days`, at the door `about 1–2 weeks`; Yoycol `about 10–12 days` / `about 3–4 weeks`
  (`production` is the made-and-packed part). An order with items from both lists each item's
  times and says they may arrive in separate packages.
- **Amounts** are the Stripe session's own (`amount_subtotal`, `total_details`, `amount_total`, and
  each item's unit amount from our session metadata). If the items don't add up to the session's
  subtotal, the line prices are left out and only the session's totals show.
- **Discount code**: the event only carries the promotion code's id, so the webhook asks Stripe
  (`GET /v1/promotion_codes/{id}`, `STRIPE_SECRET_KEY`, 5 s timeout). A restricted key needs
  **Promotion Codes: Read**; without it the line just says "Discount" (logged `[confirm]`).
- **When**: from the Stripe webhook (`lib/orders/process.ts` step 5) after the order is recorded,
  the supplier orders are placed and John's email has gone. It never fails the webhook or the
  order: errors are caught and logged, and the webhook waits for it at most 8 s (a slower send
  finishes in the background and records itself).
- **To**: the email typed at Stripe Checkout (`customer_details.email`, the same address our
  order record keeps and the shipped email uses), greeting the shipping name's first word.
- **Exactly once** per order ref: `$MOP_DATA_DIR/confirmations-emailed.jsonl` (`sending` before,
  `emailed` after Resend accepts it; same rules as `shipments-emailed.jsonl`) + a Resend
  `Idempotency-Key` `mop-confirmation/<ref>`. Stripe's retries, replays and resumed runs never
  send a second one.
- **Off** (the default): nothing is sent and nothing is written; a debug line
  `[confirm] mop-…: confirmation email is off … would have sent "<subject>" to an address at <domain>`.
  `MOP_EMAIL_DRY_RUN=1` logs the whole email instead of sending it (so does `ORDER_DRY_RUN=1`).
- **Failures**: logged (`[confirm] … CONFIRMATION EMAIL FAILED`), not marked emailed, and John gets
  one PingPigeon email "ACTION NEEDED: order confirmation email failed for <ref>". Stripe doesn't
  retry a webhook that answered 200, so resend it by hand once it's fixed (below). No
  `MOP_RESEND_API_KEY`: logged and skipped, like the shipped email.

**Preview / resend one order by hand** (`scripts/send-confirmation-email.mjs`; reads
`orders.jsonl`, refuses an order that was already emailed unless `--force`):

```sh
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node --env-file=/srv/mopclothing/.env \
  /srv/mopclothing/scripts/send-confirmation-email.mjs --order-ref mop-<ref> --dry-run --html /var/lib/mopclothing/confirm-preview.html
# --dry-run prints it (works while the email is off). Without --dry-run it sends (needs the switch on).
# --force sends again an order that was already emailed. Exit 0 = sent / previewed.
```

**Turning it on** (after John has approved the preview):

1. `MOP_RESEND_API_KEY` is already set for the shipped emails (check: `grep -c MOP_RESEND_API_KEY /srv/mopclothing/.env`).
2. Optional: give the Stripe restricted key **Promotion Codes: Read** so the discount line names the code.
3. Add `MOP_CONFIRMATION_EMAIL_ENABLED=1` to `/srv/mopclothing/.env` and `systemctl restart mopclothing`.
4. The next order: `journalctl -u mopclothing | grep '\[confirm\]'` shows `confirmation email sent to a***@…`,
   and `tail /var/lib/mopclothing/confirmations-emailed.jsonl` shows `sending` then `emailed`.

To turn it off again: remove the line (or set it to anything but `1`) and restart.

### Follow-up emails (off until John approves the previews)

Two more emails in the same look (`lib/orders/followup-email.ts`, built from `email-layout.ts`
like the confirmation and shipped emails), decided once a day by `scripts/followup-emails.mjs`
(`lib/orders/followups.ts`). No prices and nobody else's name in either.

- **"How's it fit? 📸"** (every supplier, once per order): greeting, "We hope it fits just right",
  the items with thumbnails, a **Send us a photo** button (`mailto:orders@mopclothing.com`, subject
  "My MOP photo, order MOP-XXXXXXXX") for "Out in the wild" on the home page, and "Something not
  right? Reply and we'll make it right" + Shipping & returns.
  - **When**: 3 days after the order's **last** package was delivered, so an order in several
    boxes gets one email, after the last one. It waits until everything has shipped (Printful's
    shipments hold every Printful item, and the Yoycol parcel has its shipped email).
  - **Delivered** comes from Printful **v2** `GET /v2/orders/{id}/shipments` (`delivery_status`
    `delivered`, `delivered_at`; v1 orders have no delivery fields) and from Yoycol's tracking
    events (a "Delivered" event, or `MOP_YOYCOL_DELIVERED_STATUS`). Both are from the API specs
    and haven't been seen on a real delivered order: check the first one with `--verbose`.
  - **No delivery report** (the carrier never says, or Printful refuses the call): 12 days after the
    last shipped email. **Still in transit** per the carrier: up to 21 days after it. A package
    **returned / failed** (and not reshipped) is held and never sent automatically (logged `HELD`).
  - Orders with items John places by hand (`manual`) aren't tracked and get none.
- **"Your Blue Sky Cotton Shorts are being made ☁️"** (orders with Yoycol items, once): "made to
  order, just for you", about 3–4 weeks in total from order to door, the item, "We'll email
  tracking as soon as they ship".
  - **When**: 12–14 days after the order was paid (the `orders.jsonl` line), only if the Yoycol
    parcel has no shipped email yet, and only if Yoycol's order (`GET /api/2025/open/v4/orders/{id}`)
    isn't still unpaid (`canPay`) or cancelled: nothing is made until John pays it. Unpaid is logged
    `NOT SENT: Yoycol order is still unpaid`. A run on day 15 or later doesn't send it.
- **No backfill**: the first run with a switch on writes the time to
  `$MOP_DATA_DIR/followups-start.json`. Only orders delivered after it (no delivery date: whose last
  shipped email went out after it), or for the Yoycol note paid after it, qualify. Older orders:
  `--include-before <YYYY-MM-DD>` by hand (orders from that date on; run it again for any not due yet).
- **Exactly once**: `$MOP_DATA_DIR/followups-emailed.jsonl` (`sending` → `emailed`, keys
  `fit:<ref>` / `being-made:<ref>`; same rules as the other ledgers) + Resend `Idempotency-Key`
  `mop-followup/<key>`.
- **Off** (the default): nothing is sent or written; the run logs
  `would send "<subject>" to an address at <domain>` for each order that's due. `--dry-run` prints
  the whole emails, sends nothing and records no start, on or off.
- **Failures**: a failed send is logged, not marked emailed, and John gets one PingPigeon email
  `ACTION NEEDED: "How's it fit?" email failed for <ref>` (or the "being made" note); the next
  day's run tries again. A Printful / Yoycol blip (no answer, 429, 5xx) puts that order off to the
  next run. Exit code 1 when anything failed.
- **Calls**: read-only GETs, at most one per supplier order per run, 0.6 s apart; orders already
  emailed, not shipped, or last shipped over 60 days ago cost none. Needs the keys already in `.env`
  (`PRINTFUL_API_TOKEN` (+ `PRINTFUL_STORE_ID`), `YOYCOL_ACCESS_KEY` / `YOYCOL_SECRET_KEY`,
  `MOP_RESEND_API_KEY`, `PINGPIGEON_TOKEN`).
- It reads `kind` on the shipped-email lines (written from this version on) to know a box finished
  the order when Printful can't be asked. Older lines without it still work.

**Preview** (works with both switches off; prints every email that's due):

```sh
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --env-file=/srv/mopclothing/.env /srv/mopclothing/scripts/followup-emails.mjs --dry-run --verbose
```

**The cron** (as the app user, once a day at 10:30 am Eastern; the box's clock is America/New_York,
check with `timedatectl`; on UTC it would be `30 14` in daylight time, `30 15` in winter):

```sh
cat > /etc/cron.d/mopclothing-followups <<'EOF'
# Follow-up emails: "How's it fit?" + the Yoycol "being made" note (scripts/followup-emails.mjs, DEPLOY.md)
30 10 * * * mopclothing cd /srv/mopclothing && MOP_DATA_DIR=/var/lib/mopclothing /usr/bin/flock -n /var/lib/mopclothing/followup-emails.lock /usr/bin/node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=/srv/mopclothing/.env scripts/followup-emails.mjs >> /var/lib/mopclothing/followup-emails.log 2>&1
EOF
chmod 644 /etc/cron.d/mopclothing-followups
```

Install the cron first with both switches off and read `/var/lib/mopclothing/followup-emails.log`
for a few days (`would send …` lines). **Turning one on** (after John has approved the previews):
add `MOP_FOLLOWUP_FIT_ENABLED=1` and/or `MOP_FOLLOWUP_YOYCOL_ENABLED=1` to `/srv/mopclothing/.env`
(the cron reads `.env` each run; no restart needed). The next run logs `switched on for the first
time` and writes `followups-start.json`. To turn one off: remove the line (the start stays, so
turning it back on doesn't backfill either).

### Monthly royalty email (timer installed 10/2026; first run Sun 11/1 09:00 PT)

`scripts/royalty-summary.mjs` emails John the per-artist totals for the previous month
(Pacific time; Stripe test-mode orders are skipped), the payouts/refunds recorded that month,
and each artist's **balance**: lifetime owed (every `royalties.jsonl` row) − refunds − payouts
(`royalty-payouts.jsonl`). The subject ends with the total due now.
Try it first: `sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/royalty-summary.mjs --dry-run`.
Use the same `node` binary as `mopclothing.service` (`systemctl cat mopclothing`).

**Recording a payout** (appends one line to `/var/lib/mopclothing/royalty-payouts.jsonl`, created
0640 on first use; lines are never edited):

```sh
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/royalty-payout.mjs \
  --artist janette --amount 3.00 --date 2026-11-02 --note "Venmo @janette"     # --dry-run first to see the new balance
```

It refuses an artist the catalog doesn't pay or more than the balance (`--force` for an advance).
A payout recorded by mistake: record the opposite with `--amount -3.00 --correct --note "…"`.
**Refunds**: Stripe refunds don't reach the ledger (the webhook only records paid orders), so
record one with `--refund-order <order_ref>` (from John's order email / `royalties.jsonl`); it
takes that order's royalties off each artist once (`--artist` / `--slug` for part of a bag).

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

### Street sales (shirts sold in person)

Shirts sold from the car or at a market (cash, Venmo) owe the same royalties as website
orders: alpaca → austin, star → sunshine, Grind Beanie pelican → janette, $1.50 an item
(the website's own rules, `lib/orders/royalties.ts`, `MOP_ROYALTY_RATES` included).
`scripts/street-sale.mjs` logs each sale: one `royalties.jsonl` row per royalty-bearing
item (the webhook's format, marked `source: "street"`) and one line in
`street-sales.jsonl` (price, place, payment) for analysis. The monthly email and the
balances then include them, with "street sales: N items" shown apart.

```sh
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/street-sale.mjs \
  --product pelican --style beanie --size M --qty 1 --price 25 --place "Pacific Beach" --paid cash --dry-run
```

- `--product`: `alpaca`, `pelican`, `rabbit`, `star`, or any website slug (`alpaca-tee`, `star-polo`, …).
- `--style beanie|classic`: required for the pelican (only the beanie pays Janette).
- `--size` (XS–5XL), `--qty` (default 1), `--price` (dollars each), `--place`, `--paid`,
  `--color`, `--note` (optional), `--date YYYY-MM-DD` (default today, Pacific time).
- The same sale logged twice on one day is refused; `--again` logs another one.
- `--dry-run` prints the lines and writes nothing. Without it, it prints the sale's
  `street-…` ref. A sale logged by mistake: `royalty-payout.mjs --refund-order street-… --note "logged by mistake"`.

### Product data

The Printful line-up is generated from the Printful agent's `catalog.json`:
`npm run catalog -- /path/to/catalog.json` (Node >= 22.18) rewrites
`lib/catalog/{products,fulfilment}.generated.ts` and `public/images/catalog/`. Commit the
result. Image names carry a content hash, so refreshed mockups (e.g. the skater dress's
new colour grade) get new URLs on the next run and no cache serves the old ones. Full-body
hero shots get a head-to-hips crop for the home-grid card (`scripts/card-crop.mjs`).
Descriptions, option labels and fabric notes live in `lib/catalog/copy.ts`.
To take a generated product off sale without deleting it, add its slug to `lib/catalog/retired.ts`
(e.g. the Printful Sky Shorts → `/blue-sky-cotton-shorts`): it leaves the grid, feeds and bag, its
URL 301s, new checkouts get 410, and paid checkouts started before still go to Printful. The older
hand-written products in `public/products.ts` use `retired` / `comingSoon` for the same.
The home page's **Featured** section is the `featured` list in `lib/catalog/copy.ts` (order,
picks, `photo: "womens"`); everything else follows in the main grid without repeats. Reorder or
remove freely; after changing a pick or photo run `npm run featured` (crops the card photo into
`public/images/featured/`; `npm run catalog` runs it too) and commit.

"Out in the wild" (home page) photos come from the gallery manifest:
`node scripts/gen-wild.mjs /path/to/mop-gallery/manifest.json` writes `public/images/wild/`
and `lib/wild.generated.ts`. Which photos show, their captions, links and alt text are in
`scripts/wild/photos.json`; a photo marked `"hidden": true` gets no files at all (it stays out
of the public repo) until the flag goes and the script runs again.
`npm test` checks the generated data (every variant has a Printful sync variant, credits and
royalties follow the spec) and the order code.

## New-drops email list

`POST /api/subscribe` (the "Get notified of new drops" forms on the home page and under each
product's description) appends `{email, ts, source, ua_hash}` to
`$MOP_DATA_DIR/subscribers.jsonl`, deduplicated case-insensitively. No IPs are stored (the
rate limit, 5 tries / 10 min, keys on a salted in-memory hash) and addresses never go to the
logs. Each NEW signup sends John "New MOP subscriber (#N)" through PingPigeon
(`PINGPIGEON_TOKEN`, same as the order emails); if that fails, the signup still counts.

Export (prints CSV; never commit the output):

```sh
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node /srv/mopclothing/scripts/export-subscribers.mjs > /root/mop-subscribers.csv
```

**TODO before the first newsletter:** there's no double opt-in yet, and the form promises
"Unsubscribe anytime": every newsletter must carry a working unsubscribe link (and honour it
by removing the address from `subscribers.jsonl` or the sending tool).

## Analytics (Umami)

Umami (stats.chiefsmurph.com) records page views with their query string, so Instagram
links like `?ref=ig` show on the landing page view. Product pages rewrite the query on every
pick; `lib/umami.ts` drops those as page views (same path) and keeps the other params in the
URL. Custom events: `buy-click` (slug, options, price), `gallery-open` (from, photo), `signup`
(source), `crosslink-allover` (from, to), `idea-submit` (no data), and `meta-checkout` from the server (see Instagram Shop). They're fire-and-forget: with Umami blocked,
nothing changes (checkout never waits on it). John's `/moderate/…` pages are never recorded
(page views or events): their links carry the signature that opens them.

Feed links are tagged, after the variant's picks, so listing clicks show up as campaigns:
Google `utm_source=google&utm_medium=shopping&utm_campaign=free_listings`, Meta
`utm_source=meta&utm_medium=shop&utm_campaign=catalog` (Meta can't say Facebook or Instagram
in the link; the referrer and `/meta-checkout`'s `cart_origin` tell them apart). The product
page keeps them through its URL rewrite, and the landing page view carries them to Umami.

### Weekly scorecard email ("MOP weekly", not installed yet)

`scripts/weekly-scorecard.mjs` emails John every Monday 08:00 PT: the last 7 days (Mon–Sun,
Pacific) vs the 7 before. Umami: unique visitors, page views, visitors by source (Google
Shopping, Google search, Instagram, Facebook, old cards, direct, top 3 other referrers; from
each visitor's landing page), top 5 pages, buy clicks (top products), signups, custom
requests, gallery opens, Meta Shop checkouts by `cart_origin`. Likely bots are left out and
counted: Meta's catalog-review crawler on its own line (referrer facebook.com / m.facebook.com,
not l.facebook.com; desktop Windows; `fbclid` on the landing with a feed variant link, or on
every page; up to 6 page views; ~250 of them the night the Meta Shop was set up), and others (a single page view from CN; several page views in the
same second). Real Facebook / Instagram visitors (phones, l.facebook.com, Macs, no `fbclid`,
browsing on after landing) are kept. From
`$MOP_DATA_DIR`: live orders + revenue, new subscribers, shirt registrations, custom
requests, reviews/photos waiting for approval. John's own visits count unless that browser
has opened `mopclothing.com/?nostats` once. If Umami can't be read the email still goes, with
the shop numbers.

It reads Umami's Postgres directly with a read-only user (the `pg` package is now a
dependency, installed by the usual `npm ci`). Create the user as the Postgres superuser, in
Umami's database (the name at the end of `DATABASE_URL` in `/root/umami/.env`):

```sql
-- sudo -u postgres psql -d <umami db>
-- password: openssl rand -hex 24
CREATE ROLE mop_scorecard LOGIN PASSWORD '<password>' CONNECTION LIMIT 2;
ALTER ROLE mop_scorecard SET default_transaction_read_only = on;
GRANT CONNECT ON DATABASE <umami db> TO mop_scorecard;
GRANT USAGE ON SCHEMA public TO mop_scorecard;
GRANT SELECT ON public.website_event, public.session, public.event_data TO mop_scorecard;
```

Table grants can't be limited to one website, so this user can read the other sites' rows in
the same Umami too (read-only, local only). A view filtered to MOP's website id would be
tighter, but views on Umami's tables block its own migrations when an upgrade changes a
column type, so it's left out. If `DATABASE_URL` has `?schema=…`, use that schema instead of
`public`.

Then add to `/srv/mopclothing/.env` (same host and port as Umami's `DATABASE_URL`):
`MOP_UMAMI_DB_URL=postgresql://mop_scorecard:<password>@127.0.0.1:5432/<umami db>`.
Check it reads and can't write:
`psql "$MOP_UMAMI_DB_URL" -c "select count(*) from website_event"` (a number), then
`psql "$MOP_UMAMI_DB_URL" -c "delete from session where false"` (fails: read-only transaction).

Try it (prints, sends nothing):

```sh
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing \
  MOP_UMAMI_DB_URL="$(grep '^MOP_UMAMI_DB_URL=' /srv/mopclothing/.env | cut -d= -f2-)" \
  node /srv/mopclothing/scripts/weekly-scorecard.mjs --dry-run
```

Options: `--end YYYY-MM-DD` (the week ends at that day's midnight PT), `--html` (with
`--dry-run`, also print the HTML), `--include-test` (count Stripe test-mode orders),
`--fixture file.json --data-dir dir` (no database: `test/fixtures/scorecard/`).

```ini
# /etc/systemd/system/mopclothing-scorecard.service
[Unit]
Description=MOP weekly scorecard email
After=network-online.target postgresql.service

[Service]
Type=oneshot
User=mopclothing
Group=mopclothing
WorkingDirectory=/srv/mopclothing
EnvironmentFile=/srv/mopclothing/.env
Environment=MOP_DATA_DIR=/var/lib/mopclothing
ExecStart=/usr/bin/node /srv/mopclothing/scripts/weekly-scorecard.mjs
ProtectHome=true
PrivateTmp=true
NoNewPrivileges=true

# /etc/systemd/system/mopclothing-scorecard.timer
[Unit]
Description=MOP weekly scorecard, Mondays 08:00 Pacific

[Timer]
OnCalendar=Mon *-*-* 08:00:00 America/Los_Angeles
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
systemctl daemon-reload && systemctl enable --now mopclothing-scorecard.timer
systemctl list-timers mopclothing-scorecard.timer
systemctl start mopclothing-scorecard.service && journalctl -u mopclothing-scorecard -n 20   # send one now
```

Use the same `node` binary as `mopclothing.service` (`systemctl cat mopclothing`). A failed
send exits 1 with the whole email in the journal.

## Link previews (Open Graph / Twitter cards)

A mopclothing.com link in Instagram DMs, Messages, Facebook or X shows a 1200×630 image,
a title and a line (`lib/share-meta.ts`):
- **Home** (and /custom, /register, /shipping-returns, other pages): the designed image in
  `public/images/share/home.<hash>.jpg` (wordmark in Orbitron on the site's backdrop, Day,
  Dusk, Night and the Orbital Sunset Sky Tee, "Art-inspired shirts on real cotton"); title
  "Modern Orange Pineapple"; the site description.
- **Product pages**: the product's photo letterboxed on the photo-tile grey
  (`public/images/share/<slug>.<hash>.jpg`), "Pelican Tee · from $29" / "Sky Tee · $44", and
  the first sentence of the product copy.

The images are made by `npm run share-images` (`scripts/gen-share-images.mjs`, sharp + the
bundled Orbitron in `scripts/share/`, SIL OFL) and committed; `npm run catalog` re-runs it.
File names carry a content hash, because Facebook and Instagram cache a preview per image
URL. They also cache the page's tags: after a deploy that changes them, paste the URL into
Facebook's Sharing Debugger (developers.facebook.com/tools/debug) and press **Scrape Again**.

## Shopping bag (/bag)

Product pages: **Add to bag** (primary) and **Buy now** (that one item straight to Stripe, as
before). The bag lives in the browser (`localStorage` `mop-bag`: variant ids, the same as the
feeds' `g:id`, and quantities 1–20, up to 20 lines) and is checked against the catalog on load;
anything no longer sold is dropped with a note. The bag button (top right, every page) shows
the count. `/bag` → **Checkout** → `POST /api/bag-checkout` → one Stripe Checkout session for
every line, priced on the server by the same code as `/meta-checkout` (`resolveMetaCart` +
`cartSessionParams`): "Add promotion code", US only, phone, free shipping; session metadata
`mop_source={"via":"bag"}`; back to `/bag?status=success`, which empties the bag (cancel → `/bag`).
The webhook handles multi-line orders as before: one Printful order (and one Yoycol order if
any), a registration code per unit, royalties per item, one email. Umami: `add-to-bag` (slug,
variant, price), `bag-checkout` (lines, items, value); `buy-click` is now **Buy now**. The weekly
scorecard reports all three. Box log: `[bag-checkout] …`.

## Custom orders (/custom)

`POST /api/custom-request` saves each request to `$MOP_DATA_DIR/custom-requests.jsonl` (with
an id) and its optional reference image to `$MOP_DATA_DIR/custom-uploads/<id>.<ext>` (JPEG /
PNG / WebP / HEIC by their bytes, ≤10 MB), then emails John every field through PingPigeon
(the order helper, which retries once; a failed email is logged by id and the request stays
saved). Honeypot + 3 requests / 10 min per visitor; nothing the visitor wrote is logged.

| Variable | Needed | What |
|---|---|---|
| `MOP_LINK_SECRET` | recommended | Signs the image link in John's email (`/api/custom-upload/<id>?sig=…`). Any long random string (`openssl rand -hex 32`). Without it the email says "saved on the server as custom-uploads/<id>.<ext>" instead of a link. |
| `MOP_SITE_URL` | no | Base of that link. Default `https://mopclothing.com`. |

**nginx:** its default `client_max_body_size` is 1 MB, which would turn away most phone
photos with a 413 (the form then says the image is too big). Allow ~12 MB for this route:

```nginx
location = /api/custom-request {
    client_max_body_size 12m;
    proxy_pass http://127.0.0.1:3100;
    # + the same proxy_set_header lines as `location /`
}
```

(or `client_max_body_size 12m;` in the mopclothing.com server block). Then `nginx -t` and reload.

## Shirt ideas (/ideas)

Anyone can send a T-shirt idea in words; MOP makes the art. John approves or denies each
one, and an idea made into a shirt earns its sender **$1.50 a shirt sold** (website or Etsy),
paid monthly by Venmo or Zelle from $20. Linked from the home page ("Submit an idea →", under
Custom orders). Code: `lib/ideas.ts` (fields, terms, checks), `lib/ideas-server.ts`,
`lib/ideas-email.ts`, `components/IdeaForm.tsx`, `app/moderate/ideas/page.tsx`.

- **The form**: idea (≤1,000 characters), name, email, and a ticked box agreeing to the terms
  shown on the page (`TERMS`; each idea saves `terms: TERMS_VERSION`, so change the version when
  the wording changes). No payout field: John asks for a Venmo/Zelle once he approves one.
  Honeypot + 3 ideas / 10 min per visitor (the /custom limiter). A thank-you shows on the page;
  **no email goes to the sender**.
- **Storage**: `$MOP_DATA_DIR/ideas.jsonl`, one line per idea: `id, createdAt, idea, name, email,
  payout, ipHash, status (new | approved | denied | launched), notes, productUrl, decidedAt, terms`.
  Every write rewrites the file to a temp file and renames it over (atomic), in one queue.
  `ipHash` is an HMAC of the IP with `MOP_LINK_SECRET` (same sender = same hash); the IP itself
  is never stored. Emails and payout handles never reach a public page or a log line (logs carry
  the idea id; even masked addresses are hidden). Keep the file in the nightly backup.
- **John's email** (PingPigeon, like /custom): "New shirt idea #N from <name>: <start of the
  idea>", with the idea, name, email and the review link. A failed email is logged by id; the
  idea stays saved.
- **Review page**: `https://mopclothing.com/moderate/ideas?sig=…`, the same protection as the other
  `/moderate` pages (signed with `MOP_LINK_SECRET`; a wrong or missing `sig` is a 404; each button
  is a POST with its own signature to `/api/ideas/admin`). The link is in every new-idea email;
  to print it on the box (it's a password: don't paste it anywhere public):

```sh
sudo -u mopclothing env MOP_DATA_DIR=/var/lib/mopclothing node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --env-file=/srv/mopclothing/.env /srv/mopclothing/scripts/ideas-admin.mjs
```

  It lists ideas newest first with All / New / Approved / Denied / Launched filters, and per idea:
  **Approve**, **Deny** (+ "also send the 'not this time' email" when that email is on),
  **Mark launched** (needs the shirt's https link; "Update link" afterwards), and **Save notes**
  (private notes + their Venmo/Zelle once they send it).
- **Delete a test idea**: `… scripts/ideas-admin.mjs --delete <id> --dry-run`, then without `--dry-run`.

### Emails to the sender (off until John approves the wording)

| Variable | What |
|---|---|
| `MOP_IDEA_LIVE_EMAIL_ENABLED` | `1`: **Mark launched** emails them "Your idea is live! 🎉" (the shirt's link to share + the royalty line; asks for their Venmo/Zelle unless John recorded one). |
| `MOP_IDEA_DECLINE_EMAIL_ENABLED` | `1`: **Deny** shows "also send the 'not this time' email"; ticked, it sends "About your MOP shirt idea". |

Unset / anything but `1`: nothing is sent (the log says `… email is off … not sent`, without the
address) and the review page says the email is off. Both go through Resend from `MOP_EMAIL_FROM`
(reply-to `MOP_EMAIL_REPLY_TO`), in the order emails' look, **once per idea**
(`$MOP_DATA_DIR/idea-emails.jsonl` + a Resend Idempotency-Key): pressing the button again never
sends a second one. A failed send is logged, John gets "ACTION NEEDED: idea email failed for …",
and pressing the button again retries. To turn one on: add the line to `/srv/mopclothing/.env` and
`systemctl restart mopclothing`. An idea marked launched while the email was off gets it if John
presses **Update link** after turning it on.

**Checks after a deploy**

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://mopclothing.com/ideas                                  # 200
curl -s -o /dev/null -w '%{http_code}\n' https://mopclothing.com/moderate/ideas                         # 404 (no signature)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mopclothing.com/api/ideas -H 'Content-Type: application/json' -d '{}'   # 400
journalctl -u mopclothing -n 50 --no-pager | grep '\[ideas\]'
```

## Welcome code (10% off a first order)

Checkout shows "Add promotion code" (`allow_promotion_codes`; no extra restricted-key scope
needed: the code is checked on Stripe's own page). The signup forms show the code only when
`MOP_WELCOME_CODE` is set, so make the code in Stripe FIRST, then set it.

John's steps (dashboard.stripe.com in the phone browser, **live mode**):
1. ☰ → **Product catalog** → **Coupons** tab → **+ New** (or **Create coupon**).
2. Name: `Welcome 10%`. Type: **Percentage discount**, `10` %. Duration: **Once**. Leave
   "Apply to specific products" off.
3. Turn on **Use customer-facing coupon codes** (promotion codes). Code: `WELCOME10`.
4. Tick **Eligible for first-time order only** and **Limit to one redemption per customer**.
   (Optional: an expiry date or a total redemption limit.)
5. **Create coupon**.
6. On the box: add `MOP_WELCOME_CODE=WELCOME10` to `/srv/mopclothing/.env` and restart.

Test: sign up on the site with a fresh address (the code shows), then open a checkout and
apply WELCOME10 (the total drops 10%; close the tab without paying). Orders with a code arrive
at the webhook with `amount_discount` set; the Printful draft's retail costs and John's email
show the discounted total, and royalties are unchanged (per item).

## Shipping & returns, size guides

`/shipping-returns` is linked under the buy button and next to the delivery line on product
pages. Set `MOP_CONTACT_EMAIL` to show an email address there (otherwise it points to the
contact form; the page is built at build time, so rebuild after setting it).

Size guides come from Printful's public catalog (no token): `node scripts/gen-sizes.mjs`
rewrites `lib/catalog/sizes.generated.ts` (run it when a new garment joins the line-up); fit
notes are in the script.

## Google free listings (Merchant Center)

The feed is `https://mopclothing.com/feeds/google.xml` (built at build time from the catalog:
one item per variant, free US shipping, in stock; links tagged `utm_medium=shopping`, see
Analytics). Redeploy to refresh it.

John's steps:
1. **merchants.google.com** → sign in → create a Merchant Center account (business name
   Modern Orange Pineapple, website https://mopclothing.com, country United States).
2. **Verify the website**: choose the **HTML tag** method and copy the `content="…"` value.
   Put it in `/srv/mopclothing/.env` as `GOOGLE_SITE_VERIFICATION=<that value>`, rebuild +
   restart (it's a build-time tag), check `view-source:https://mopclothing.com` shows
   `<meta name="google-site-verification" …>`, then press **Verify** and **Claim**.
3. **Products → Add products → Add products from a file → Enter a link to your file**:
   `https://mopclothing.com/feeds/google.xml`, fetch daily.
4. **Shipping**: Settings → Shipping and returns → Shipping policy → add a US policy:
   free shipping, handling 2–7 business days, transit 3–8 business days (Printful).
5. **Returns**: add a return policy: no returns or exchanges for change of mind; free
   replacement for misprints, damage or defects reported within 30 days; policy URL
   `https://mopclothing.com/shipping-returns`.
6. Turn on **free listings** (Growth → Manage programs → Free listings) and wait for review.

## Old card codes (/redeem): claims John checks

The printed cards' two-part codes (COW-76) were checked against `$MOP_DATA_DIR/codes.json`,
which an old deploy overwrote (it holds 1 code now). `/redeem` now takes any code with the old
card format (FOX OWL DOG BAT ANT CAT RAM COW HEN + two digits from 2 3 6 7 8: 225 codes) or still
on codes.json, **once**: name, fun fact, a required photo of the shirt or card (10 MB, JPG/PNG/
WebP/HEIC, checked by content) and an optional email or Instagram handle. Lookups 10 / claims 5
per 10 minutes per visitor (as /register). John gets an email (PingPigeon, as /register) with
the code, name, fun fact, contact, a private photo link and a link to `/moderate/<id>` ("Old
card claims") with **Approve** / **Reject** (needs `MOP_LINK_SECRET`). Approve only marks the
claim approved (and the code redeemed on codes.json if it's there); nothing is paid or sent
automatically. Reject frees the code for another claim.
- Storage: `$MOP_DATA_DIR/legacy-claims.jsonl` (append-only: claims, then status changes) and
  `$MOP_DATA_DIR/claim-uploads/`. Never in the repo; keep the data dir in the nightly backup.
- `/api/redeem` and `/api/validate-code` are retired (410) so nothing skips the photo check.

## Shirt registration, verified reviews, The MOP Crew

- **Codes:** the webhook issues one code per unit sold (`COW-76-K3P9`: John's legacy animals
  and digits + 4 characters with no 0/O/1/I/L) into `$MOP_DATA_DIR/item-codes.jsonl`, and puts the
  Printful items' codes on Printful's **packing slip** (`packing_slip.message`, ≤200 characters
  by our own cap; one order-level code if the list wouldn't fit). Yoycol's API has only an
  internal order remark, so Yoycol items' codes are just listed in John's order email.
- **/register:** code → the piece → first name (+ optional email / new-drops opt-in), an optional
  owner photo ("Show us yours!", ≤10 MB, same checks as /custom) and/or review. Each code registers
  once. Two-part legacy codes (`COW-76`) go to `/redeem` as before. Files:
  `registrations.jsonl`, `reviews.jsonl`, `review-uploads/` (private originals), `crew/`
  (web copies of approved owner photos, made on approval, metadata stripped).
- **Moderation:** John's email has signed links (needs `MOP_LINK_SECRET`) for **Approve / Hide the
  review** and **Approve photo for The MOP Crew / Hide the photo**. Each opens a confirmation page;
  only its button (a POST) changes anything. Approved reviews show on the product page (any
  variant) with "Verified buyer", plus "Friend of MOP" when they said they know John (FTC).
  The MOP Crew (home page, after Out in the wild) shows approved, OK-to-feature owner photos once
  there are 3. Everything is read at request time: no rebuild needed.
- **nginx:** `/api/register` takes photos up to 10 MB too: give it the same
  `client_max_body_size 12m;` as `/api/custom-request` (or set it for the whole server block).

### Thank-you code THANKS10 (reward after registering)

Stripe dashboard (phone browser, live mode): ☰ → **Product catalog** → **Coupons** → **+ New**:
name `Thanks 10%`, **Percentage discount** `10` %, duration **Once** → turn on **customer-facing
codes**, code `THANKS10`, tick **Limit to one redemption per customer**, and leave **first-time
order only OFF** (they're existing customers) → **Create coupon**. Then on the box add
`MOP_REGISTER_REWARD_CODE=THANKS10` (and optionally `MOP_REGISTER_REWARD_OFF=10%`, the default)
to `/srv/mopclothing/.env` and restart. Unset = no reward shown.

## Instagram Shop (Meta Commerce Manager)

The feed for Meta is `https://mopclothing.com/feeds/meta.xml`: the Google feed in Meta's
spelling (`in stock`) with JPEG images only (Meta's catalog takes JPG/PNG). Steps for John:
1. **business.facebook.com** → Business settings → **Brand safety → Domains** → Add
   `mopclothing.com` → choose the **meta tag** method → copy the `content` value → put it in
   `/srv/mopclothing/.env` as `META_DOMAIN_VERIFICATION=<value>` → rebuild + restart → **Verify**.
2. **Commerce Manager** (facebook.com/commerce_manager) → **Add shop** → Instagram (and Facebook)
   → checkout method **Checkout on another website** (the site's Stripe Checkout) → pick the
   MOP Instagram account and the business account.
3. **Catalog → Data sources → Add items → Data feed** → **Use a URL** →
   `https://mopclothing.com/feeds/meta.xml`, currency USD, schedule **daily**.
4. Check **Catalog → Items** for errors, then **Shop → Submit for review**. After approval, tag
   products in Instagram posts and stories.

### Checkout URL (`/meta-checkout`)

In Commerce Manager → **Settings → Checkout method → Checkout on another website**, the
checkout URL is `https://mopclothing.com/meta-checkout`. Meta sends the cart as
([Meta's format](https://developers.facebook.com/documentation/ads-commerce/commerce-platform/setup-checkout-url))
`?products=<id>:<qty>,<id>:<qty>` (URL-encoded; the ids are the `<g:id>`s in `/feeds/meta.xml`),
an optional `coupon=CODE`, `cart_origin=facebook|instagram|meta_shops` and any `utm_*` tags.

- Every id is checked against the catalog (same ids as the feed) and priced by the site, never
  by the URL. Unknown or off-sale ids are skipped; with nothing left, the visitor lands on
  `/meta-checkout/unavailable` (links to the shop).
- One Stripe Checkout session for the whole cart, built by the same code as the product page
  (`lib/orders/checkout.ts` `cartSessionParams`), so the webhook, Printful, royalties, codes,
  US-only shipping and the phone field work the same. The session's metadata also gets
  `mop_source` (`{"via":"meta","origin":…,"utm_…":…,"coupon":…}`).
- `coupon`: looked up as a live promotion code and applied up front (`discounts`). An unknown
  code, or one Stripe won't apply to the cart, falls back to "Add promotion code" on Stripe's
  page. **The lookup needs "Promotion Codes: Read" on the restricted key**; without it every
  coupon falls back (checkout still opens).
- Umami event `meta-checkout` (origin, items, lines, value, utm_*, coupon: applied / not found /
  rejected, skipped) sent from the server after the redirect; `meta-checkout-unavailable` and
  `meta-checkout-error` for the other outcomes. The box log line is `[meta-checkout] …`.
- `robots.txt` disallows `/meta-checkout`.

Test (Meta's **Add URL** test does the same):
`https://mopclothing.com/meta-checkout?products=pelican-tee-large-classic-lagoon-blue-m%3A1%2Csky-tee-golden-hour-m%3A2&coupon=WELCOME10&cart_origin=instagram`
should open Stripe Checkout with 1 Pelican Tee and 2 Sky Tees and WELCOME10 applied; close the
tab without paying.
