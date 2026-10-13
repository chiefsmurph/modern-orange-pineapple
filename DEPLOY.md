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
`npm run catalog -- /path/to/catalog.json` (Node >= 22.18) rewrites
`lib/catalog/{products,fulfilment}.generated.ts` and `public/images/catalog/`. Commit the
result. Image names carry a content hash, so refreshed mockups (e.g. the skater dress's
new colour grade) get new URLs on the next run and no cache serves the old ones. Full-body
hero shots get a head-to-hips crop for the home-grid card (`scripts/card-crop.mjs`).
Descriptions, option labels and fabric notes live in `lib/catalog/copy.ts`.

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
(source), `crosslink-allover` (from, to). They're fire-and-forget: with Umami blocked,
nothing changes (checkout never waits on it).

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
one item per variant, free US shipping, in stock). Redeploy to refresh it.

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
