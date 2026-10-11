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
