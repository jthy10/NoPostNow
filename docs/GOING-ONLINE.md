# Getting your site online

After setup, your site answers on your own computer (`http://localhost:3000`)
and, if you chose that option, on your home network. This guide covers letting
friends reach it from anywhere.

Whichever route you take, you want an address that starts with **`https://`**.
Phones refuse to install the app, open the camera from the post button, or
deliver notifications over plain `http://`.

Replace `3000` below with your port if you picked a different one.

- [A. Try it in one command](#a-try-it-in-one-command)
- [B. A permanent address with Cloudflare Tunnel](#b-a-permanent-address-with-cloudflare-tunnel) (recommended)
- [C. Your own reverse proxy](#c-your-own-reverse-proxy)
- [D. Friends only, no public address](#d-friends-only-no-public-address)
- [After you are online](#after-you-are-online)
- [Keeping it running](#keeping-it-running)

## A. Try it in one command

Free, no account, and gone when you close it. Good for a first look.

1. Install `cloudflared` from
   <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>.
2. With your site running, open a second terminal and run:

   ```
   cloudflared tunnel --url http://localhost:3000
   ```

3. It prints an address ending in `.trycloudflare.com`. Open it on your phone.

The address changes every time you run the command, so invite links and
installed apps stop working when you restart it. Move to option B before
inviting people for real.

## B. A permanent address with Cloudflare Tunnel

A tunnel connects out from your computer to Cloudflare, so you do not open
ports on your router and your home IP address is never published. Cloudflare
provides the `https://` certificate. The tunnel itself is free; the domain
costs about $10 a year.

1. **Get a domain.** Buy one from any registrar, or directly from Cloudflare
   (Dashboard → Domain Registration). If you bought it elsewhere, add it to a
   free Cloudflare account and switch its nameservers when Cloudflare asks.
2. **Create the tunnel.** In the Cloudflare dashboard open **Zero Trust →
   Networks → Tunnels → Create a tunnel**, choose **Cloudflared**, and name it.
3. **Install the connector.** The dashboard shows one command for your
   operating system. Run it on the computer hosting the site. It installs
   `cloudflared` as a service, so the tunnel comes back after a reboot.
4. **Point your address at the site.** Still in the tunnel's settings, add a
   **public hostname**:
   - Subdomain and domain: for example `photos` + `example.com`
   - Service type: `HTTP`
   - URL: `localhost:3000`
5. **Tell the site its address.** In the control panel open **Options →
   Getting online** and enter it as the public address. (In the terminal:
   `sh nopostnow.sh setup`.) Invite and reset links will now use it.

With a tunnel in place you can also re-run setup and choose **Only this
computer** for who may open the site directly, so the tunnel is the only way
in.

## C. Your own reverse proxy

If you already run Caddy, nginx, Traefik or similar with a domain and
certificates, point it at `http://localhost:3000`. Two things matter:

- Pass the original host and scheme through (`Host`, `X-Forwarded-Host`,
  `X-Forwarded-Proto`). The site uses them to build links and to mark its
  cookie as HTTPS-only.
- Do not buffer `/api/store/events` — it is a long-lived event stream that
  drives live updates.

A complete Caddy configuration is two lines:

```
photos.example.com {
    reverse_proxy localhost:3000
}
```

This route needs ports 80 and 443 forwarded from your router to the machine,
and your domain's DNS pointed at your home IP address.

## D. Friends only, no public address

A private network such as [Tailscale](https://tailscale.com) puts your devices
and your friends' devices on one network without exposing anything publicly.
Tailscale's `serve` feature can give the site an `https://` address that only
members of your network can open. The trade-off is that everyone has to
install Tailscale.

## After you are online

1. Sign in at your new address and open **Profile → Admin**.
2. On the **Overview** tab, set up two-factor sign-in for your admin account.
3. On the **Members** tab, create an invite link and send it to a friend.
4. On their phone, they open the link, create an account, and follow the
   prompt to add the site to their Home Screen.

## Keeping it running

The site runs for as long as the launcher is running. To have it start with
the computer:

**Linux (systemd).** Create `/etc/systemd/system/nopostnow.service`, replacing
the user and path with your own:

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

**Windows.** Open **Task Scheduler → Create Task**. Set the trigger to **At
startup**, the action to start `nopostnow.cmd` from your NoPostNow folder with
`start` in **Add arguments** (without it the task would try to open the control
panel window), and tick **Run whether user is logged on or not**.

Also keep the computer from going to sleep, and back up the data folder — it
holds every photo and account.
