# Running a relay

A relay gives home-hosted NoPostNow sites a public address. Each site keeps an
outbound connection open to the relay; the relay hands visitors' requests down
that connection. Sites need no domain, no open ports and no tunnel account —
only your relay's address.

Most people never need to run one. This page is for whoever wants to offer a
relay to friends or to the public.

## What you take on

- **You can see the traffic.** HTTPS ends at your relay, so everything passing
  between visitors and sites is readable on your machine. The relay stores
  none of it — only the list of claimed names — but sites are trusting you.
- **You carry the bandwidth.** Every photo viewed travels through your server.
- **You are the address.** Sites live at `name.your-domain`. Content hosted
  there is published under your domain, so think about who you give keys to.
  Access keys are on by default for this reason.

## What you need

- A small server with a public IP address (the cheapest VPS is plenty).
- A domain, or a subdomain of one, used only for the relay — for example
  `sites.example.com`. Sites become `lake-house.sites.example.com`.
- DNS records pointing both `sites.example.com` and `*.sites.example.com` at
  the server.
- Node.js 22.18 or newer (the launcher fetches it if it is missing).

Use a domain separate from anything else you host. Sites on a relay are
separate web origins, and NoPostNow locks its session cookie to the exact
host, but a dedicated domain keeps other services out of reach entirely.

## Set it up

```bash
sh nopostnow.sh relay setup
```

It asks for the domain, the local port to listen on, and whether anyone may
claim a name or only people with an access key. It prints the first key.
Settings and the list of claimed names are kept in `relay-data/`.

```bash
sh nopostnow.sh relay          # run it
sh nopostnow.sh relay key      # make another access key
```

The relay listens on `127.0.0.1` by default and speaks plain HTTP. Put an
HTTPS front on the same machine.

## HTTPS with Caddy

[Caddy](https://caddyserver.com) can obtain a certificate for each site as it
is first visited, and asks the relay whether a name is real before doing so:

```
{
    on_demand_tls {
        ask http://127.0.0.1:8080/_relay/ask
    }
}

sites.example.com, *.sites.example.com {
    tls {
        on_demand
    }
    reverse_proxy 127.0.0.1:8080
}
```

Open ports 80 and 443 on the server. Any other front works too, as long as it
passes the `Host` header through unchanged, sets `X-Forwarded-Proto`, allows
connection upgrades, and does not buffer responses.

## Giving people access

Tell a host your relay's address (`https://sites.example.com`) and, if you use
them, an access key. They enter both in **Options → Getting online**. A name
belongs to whichever site claimed it first; that site holds a secret that
proves it, so nobody else can attach to the name.

To free a name, stop the relay, remove its entry from `relay-data/sites.json`,
and start the relay again.

## Keeping it running

Run it as a service, the same way as a site — see "Keeping it running" in
[GOING-ONLINE.md](GOING-ONLINE.md), with `relay` in place of `start`.
