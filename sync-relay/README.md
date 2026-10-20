# MedTap family sync relay

Optional. Lets phones in a family sync automatically. Without it, family sync still works by sending an
update file from one phone to another.

The relay stores each phone's latest snapshot, **encrypted on the phone** with the family key. The relay never
has the key, so it can't read anything: not names, medications or doses.

## Set it up (free, about 5 minutes)

1. Make a free Cloudflare account at https://dash.cloudflare.com/sign-up.
2. On a computer, in this folder:
   ```sh
   npx wrangler login
   npx wrangler kv namespace create SYNC
   ```
   Copy the `id` it prints into `wrangler.toml`.
3. Deploy:
   ```sh
   npx wrangler deploy
   ```
   It prints an address like `https://medtap-sync.<you>.workers.dev`.
4. In MedTap: Settings → Family sync → Sync server, paste the address, and tap Save. Invite codes made after
   that include the address, so other phones pick it up when they join.

Cloudflare's free plan allows 100,000 requests a day, far more than a family needs.
