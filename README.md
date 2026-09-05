# New York — containerized

A self-contained Docker image of the browser app at
`https://somethingbig.ai/world/` — a streaming 3D Manhattan built on three.js and
Rapier physics.

The client was **recovered from the site's own published source maps**. The server
was never shipped to browsers, so it has been **reimplemented** against the wire
contract the client documents. Everything runs locally with no network access.

```bash
docker compose up --build
# then open http://localhost:8080/world/
```

---

## What this contains

| Path | What it is | Provenance |
|---|---|---|
| `public/world/` | The client, byte-for-byte as served | mirrored |
| `public/world/world/` | 3,697 map tiles + `index.json` + `areas.json` | mirrored |
| `public/world/assets/` | JS/CSS chunks, 161 textures (×2 variants), 8 character models, fonts | mirrored |
| `src/` | 215 original TypeScript files, 62,887 lines | **extracted from source maps** |
| `server/` | HTTP + WebSocket game server | **written from scratch** |
| `tools/` | Re-mirror and offline-patch scripts | written |

The image is 268 MB, most of it the city.

---

## How the app was reverse engineered

**1. The client shipped its own source.** Every chunk carried a
`//# sourceMappingURL`, and each `.map` included `sourcesContent`. Extracting them
recovered the original TypeScript — not decompiled output, but the authors' files
with comments and architecture notes intact:

```
src/client/src/{core,atmosphere,buildings,streets,character,combat,vehicles,props,landmarks,environment,audio,ui}/
src/shared/{protocol,constants,geo,weapons,version}.ts
```

`src/shared/protocol.ts` opens with *"THE contract between server/ and
client/src/core/net.ts"* and specifies the whole wire format. That file is why a
compatible server could be written at all.

**2. Assets were discovered by following references to closure.** The entry bundle
lists its lazy chunks; those chunks name more. Iterating until no new references
appeared found 48 JS/CSS chunks. `assets/textures/manifest.json` then enumerated
161 texture files (CC0, from ambientCG and Poly Haven), each with a downscaled
`textures-mobile/` twin. Character models were only found by watching a real
browser 404 on them.

**3. The base path is doubled.** The client is built with `BASE_URL=/world/` and
asks for `basePath('/world')`, so world data lives at `/world/world/...`. Tiles are
raw gzip served as `application/gzip` with **no** `Content-Encoding` — the decoder
sniffs the gzip magic bytes, so the server must not double-encode them.

**4. Server behavior was inferred from client-side evidence.** Three examples:

- `main.ts` says *"The server clamps movement to ~70 m/s, so other players see you
  slide there"* — so illegal movement is **clamped**, not rejected. An early
  version here rejected big jumps outright and stranded players after a network
  stall.
- The entry form reads *"You'll appear in the city as a random name like
  amber-fox-42"*, and `net.ts` notes the submitted name and email *"live only in
  this short-lived request, never in localStorage or player state"*. The server
  therefore assigns a random public handle and **discards the email entirely**.
- `net.ts` `sendState()` returns early while the player is dead, so a dead client
  sends only pings. Keying the idle reaper on binary state alone would disconnect
  players on the death screen; liveness tracks all traffic.

---

## The server

`server/index.js`, one dependency (`ws`).

```
GET  /world/*              static client + tiles
GET  /world/api/admin/me   { admin: boolean }
POST /world/api/telemetry  boot/crash beacons -> 204
WS   /world/ws             JSON control + 34-byte binary player states
```

Implemented from `src/shared/protocol.ts`: the handshake (`hello`/`welcome`,
token-based reconnect), 15 Hz area-of-interest snapshots within 350 m, the 34-byte
state codec, hitscan combat with the real weapon table, headshots, armor, the
115 m Bryant Park safe zone, 120 s spawn protection, scoring, landmark discovery,
leaderboard, a 2-hour day cycle, and drifting weather.

Everything is in-memory: **restarting the container resets all progress.**

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | listen port |
| `BASE_PATH` | `/world` | must match the client's build-time base |
| `ADMIN` | `0` | `1` grants every player admin (noclip fly, teleport) |
| `VERBOSE` | `0` | `1` logs the client's telemetry beacons |

### Tests

38 protocol conformance checks driving a headless client through the real binary
codec — handshake, ping/pong, snapshot round-trip, the speed clamp, AOI culling,
safe-zone immunity, damage/death/scoring, respawn, leaderboard, token reconnect:

```bash
cd server && npm install && npm test          # against localhost:8080
PORT=8081 npm test                            # against a running container
```

---

## Things to try

The client has a built-in camera mode, recovered in `src/client/src/core/spots.ts`.
`?spot=<id>` flies to a fixed viewpoint and skips the entry form — handy for
screenshots, and the fastest way to confirm the container renders:

```
http://localhost:8080/world/?spot=times-square&time=13:30&weather=clear&nohud=1
http://localhost:8080/world/?spot=aerial-midtown&time=18:00
http://localhost:8080/world/?spot=brooklyn-bridge
```

29 spots exist: `bryant-park`, `times-square`, `empire-state`, `flatiron`, `soho`,
`wall-street`, `brooklyn-bridge`, `columbus-circle`, `chinatown`, `harlem`,
`hudson-yards`, `skyline-hudson`, `aerial-midtown`, `aerial-downtown`, and more.

Other parameters, from `src/client/src/core/params.ts`:

| Param | Effect |
|---|---|
| `?q=low\|medium\|high\|mobile` | quality preset (default: auto-detected) |
| `?fly=x,z,h,heading,pitch` | free camera at world coordinates |
| `?time=18:00` | freeze the time of day |
| `?weather=clear` | force a weather condition |
| `?debug=1` | debug overlay: fps, draw calls, tile and net counters |
| `?nohud=1` | hide the HUD |
| `?modules=none` | disable game modules (useful for isolating a problem) |

In the browser console, `__game.teleport(x, z)` moves you anywhere in the city;
`__stats()` reports renderer counters.

## Verified

- All 38 protocol checks pass, against both a local process and the container.
- The real client boots in Chromium with **zero failed requests**: all 14 modules
  load (`atmosphere, environment, streets, buildings, landmarks, props, vehicles,
  character, combat, audio, ui` + core), 3,710 tile requests succeed, and it
  renders ~2.5M triangles.
- The full handshake completes: the browser submits the entry form, the server
  replies `welcome`, and the player spawns at `x=-49, z=30` — the Bryant Park
  6th Ave spawn point in `shared/constants.ts`.
- Rendered from the running container: Times Square at street level (4.9M
  triangles — pedestrians on the imported character rig, taxis, animated
  billboards, traffic signals) and an aerial over Midtown at 260 m.

Measured under SwiftShader (software GL) at ~12–22 fps, where a cold start takes
~60–90 s to stream the near scene; on a real GPU both are far faster.

---

## Known gaps

- **Pickups and vehicle persistence are stubs.** The protocol defines
  `pickups`/`vehicle` messages; this server spawns no weapon pickups and tracks
  vehicle ownership only loosely. Combat starts everyone with a Pistol.
- **Weather is synthetic.** The real server reports `source: 'nws'` (US National
  Weather Service); this one drifts through conditions locally and reports
  `'fallback'`, which is a value the client already handles.
- **No persistence.** Profiles live in memory, keyed by token.
- **`src/` does not build.** It is the recovered source for reading and reference.
  Type-only files (`context.ts`, `world.ts`) were erased at compile time and are
  absent, and there is no `vite.config`, `package.json`, or `index.html` for it.
  The container serves the original compiled bundle, not a rebuild of `src/`.
- One deliberate modification to the mirrored bundle: `tools/patch-offline.js`
  repoints the web-font `<link>` from Google Fonts to the vendored copy. Upstream
  already ships system-font fallbacks, so this only removes a network round-trip.

## Re-mirroring

`tools/mirror.sh` regenerates `public/` from the origin (idempotent; skips files
already present). `tools/patch-offline.js` re-applies the font patch afterward.

## Provenance

The city data, textures, models, and compiled client are the original authors'
work, retrieved from a public origin; the textures carry CC0 licenses named in
`assets/textures/manifest.json`. The client's own entry screen describes it as an
*"independent, free-to-play experimental tech demo ... not affiliated with or
endorsed by Rockstar Games or Take-Two Interactive."* This container is for local
and offline use; check with the origin before redistributing or hosting it.
