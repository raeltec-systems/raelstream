// Writes MediaMTX's TURN settings (MTX_WEBRTCICESERVERS2_n_*) for the Codespaces stack.
// MediaMTX sits behind GitHub's HTTP-only port forwarding, so it can only reach the studio through a
// relay: it needs its own Cloudflare TURN credentials, refreshed on every Codespace start.
import { writeFileSync } from 'node:fs';

const [out] = process.argv.slice(2);
const keyId = process.env.RS_TURN_CF_KEY_ID;
const token = process.env.RS_TURN_CF_API_TOKEN;
if (!keyId || !token) {
  writeFileSync(
    out,
    '# No Cloudflare TURN secrets: private test / Go live cannot connect from a Codespace.\n',
  );
  console.log('TURN: not configured');
  process.exit(0);
}
const res = await fetch(
  `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 }),
  },
);
if (!res.ok) {
  writeFileSync(out, `# Cloudflare TURN request failed: HTTP ${res.status}\n`);
  console.log(
    `TURN: Cloudflare refused the request (HTTP ${res.status}); check the two Codespaces secrets`,
  );
  process.exit(0);
}
const body = await res.json();
const servers = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
const lines = [];
let n = 0;
for (const s of servers) {
  for (const url of [s.urls].flat()) {
    // TURN only (STUN adds nothing behind port forwarding); browsers and relays skip port 53.
    if (!/^turns?:/.test(url) || /:53(\?|$)/.test(url)) continue;
    lines.push(
      `MTX_WEBRTCICESERVERS2_${n}_URL=${url}`,
      `MTX_WEBRTCICESERVERS2_${n}_USERNAME=${s.username}`,
      `MTX_WEBRTCICESERVERS2_${n}_PASSWORD=${s.credential}`,
    );
    n++;
  }
}
writeFileSync(out, lines.join('\n') + '\n', { mode: 0o600 });
console.log(`TURN: ${n} Cloudflare relay addresses configured`);
