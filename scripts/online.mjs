// What to do after setup: how to start the site and the ways to put it online.
import { bold, cyan, dim, yellow } from "./lib.mjs";

export function printGoingOnline({ siteName, host, port, publicUrl, ips }) {
  const local = `http://localhost:${port}`;
  console.log(`
${bold("Start your site")}
  ${cyan("npm start")}

  Then open ${cyan(local)} and sign in with the admin account.${
    host === "0.0.0.0" && ips.length
      ? `\n  Others on your home network can use ${cyan(`http://${ips[0]}:${port}`)}.`
      : ""
  }

${bold(`Getting ${siteName} online`)}
  Right now only ${host === "127.0.0.1" ? "this computer" : "your own network"} can reach it. Friends elsewhere need a
  public ${bold("https://")} address — phones also require https before they will
  install the app, use the camera button, or deliver notifications.
${publicUrl ? `\n  You entered ${cyan(publicUrl)} as the public address.\n` : ""}
  ${bold("A. Try it in one command")} ${dim("— free, no account, temporary address")}
     Install cloudflared, then run:
       ${cyan(`cloudflared tunnel --url ${local}`)}
     It prints a https://….trycloudflare.com address you can share right away.
     The address changes every time, so use this to try things out.

  ${bold("B. A permanent address on your own domain")} ${dim("— recommended")}
     1. Buy a domain (around $10 a year) and add it to a free Cloudflare account.
     2. Create a named Cloudflare Tunnel that points your domain at
        ${cyan(local)}. No router changes, and your home IP stays hidden.
     3. Run ${cyan("npm run setup")} again and enter the address as the public address.

  ${bold("C. Your own reverse proxy")} ${dim("— if you already run Caddy, nginx or Tailscale")}
     Point it at ${cyan(local)} and let it handle https.

  Step-by-step instructions for each: ${cyan("docs/GOING-ONLINE.md")}

${yellow("Before inviting anyone:")} back up the data folder regularly, and turn on
two-factor sign-in for your admin account (Admin → Overview).
`);
}
