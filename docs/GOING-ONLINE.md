# Getting your site online

After setup, the site answers at `http://localhost:3000` and, if you chose it,
on your home network. This guide lets friends reach it from anywhere.

You want an address that starts with **`https://`**. Without it, phones won't
install the app, open the camera, or deliver notifications.

If you picked a different port, use it in place of `3000` below.

| Route | Best for | Cost |
| --- | --- | --- |
| [A. Temporary address](#a-temporary-address) | A first look | Free |
| [B. Cloudflare Tunnel](#b-cloudflare-tunnel-recommended) | Most people | Domain, about $10 a year |
| [C. Your own reverse proxy](#c-your-own-reverse-proxy) | You already run Caddy or nginx | Domain |
| [D. Private network](#d-private-network) | No public address at all | Free |

Then: [invite people](#after-you-are-online) and
[start the site with the computer](#keeping-it-running).

## A. Temporary address

1. Install [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. With the site running, open a second terminal and run:

   ```
   cloudflared tunnel --url http://localhost:3000
   ```

3. Open the `.trycloudflare.com` address it prints.

The address changes every run, which breaks invite links and installed apps.
Use route B before inviting anyone for real.

## B. Cloudflare Tunnel (recommended)

No open router ports, your home IP stays hidden, and Cloudflare provides the
`https://` certificate.

1. **Get a domain.** Buy one from Cloudflare (Dashboard → Domain
   Registration), or buy it elsewhere and add it to a free Cloudflare account.
2. **Create the tunnel.** In the dashboard: **Zero Trust → Networks → Tunnels
   → Create a tunnel → Cloudflared**. Give it a name.
3. **Install the connector.** Run the command the dashboard shows on the
   computer hosting the site. It restarts by itself after a reboot.
4. **Add a public hostname** in the tunnel's settings:

   | Field | Value |
   | --- | --- |
   | Subdomain + domain | for example `photos` + `example.com` |
   | Service type | `HTTP` |
   | URL | `localhost:3000` |

5. **Tell the site its address.** In the control panel: **Options → Getting
   online**. In the terminal: `sh nopostnow.sh setup`.

Optional: in the same settings, limit who can open the site directly to
**Only this computer**, so the tunnel is the only way in.

## C. Your own reverse proxy

Point your proxy at `http://localhost:3000`. With Caddy, that is:

```
photos.example.com {
    reverse_proxy localhost:3000
}
```

- Pass `Host`, `X-Forwarded-Host` and `X-Forwarded-Proto` through. The site
  uses them to build links and to mark its cookie HTTPS-only.
- Do not buffer `/api/store/events`. It is a long-lived stream for live
  updates.
- Forward ports 80 and 443 from your router, and point your domain's DNS at
  your home IP.
- Enter the address under **Options → Getting online**, as in route B.

## D. Private network

[Tailscale](https://tailscale.com) puts you and your friends on one private
network, and its `serve` feature gives the site an `https://` address only
that network can open. Everyone has to install Tailscale.

## After you are online

1. Sign in at the new address and open **Profile → Admin**.
2. **Overview** tab: turn on two-factor sign-in for your admin account.
3. **Members** tab: create an invite link and send it to a friend.
4. Your friend opens the link, creates an account, and adds the site to their
   Home Screen when prompted.

## Keeping it running

The site runs while the launcher runs. To start it with the computer:

**Linux (systemd).** Create `/etc/systemd/system/nopostnow.service` with your
own user and path:

```ini
[Unit]
Description=NoPostNow
After=network-online.target

[Service]
User=YOUR_USER
WorkingDirectory=/home/YOUR_USER/nopostnow
ExecStart=/bin/sh /home/YOUR_USER/nopostnow/nopostnow.sh start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl enable --now nopostnow`.

**Windows.** In **Task Scheduler → Create Task**:

| Setting | Value |
| --- | --- |
| Trigger | At startup |
| Action | Start `nopostnow.cmd` from your NoPostNow folder |
| Add arguments | `start` (without it, the task tries to open the panel window) |
| General | Run whether user is logged on or not |

Also stop the computer from going to sleep, and back up the data folder.
