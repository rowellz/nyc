# New York — containerized

A self-contained Docker image of the browser app at
`https://somethingbig.ai/world/` — a streaming 3D Manhattan built on three.js and
Rapier physics.

The client was **recovered from the site's own published source maps**. The server
was never shipped to browsers, so it has been **reimplemented** against the wire
contract the client documents. Everything runs locally with no network access.

```bash
docker compose up --build
# the original service:   http://localhost:8080/world/
# the SvelteKit port:     http://localhost:3000/
```

Two containers serve the same city. `nyc` is the original reconstruction — a Node
http server with the game welded into it. `web` is the same service **ported to
SvelteKit**, which serves the client, the tiles, the REST API, its own pages and
the authoritative game loop from one process. They do not talk to each other and
do not share a world.

---

## What this contains

| Path | What it is | Provenance |
|---|---|---|
| `public/world/` | The client, byte-for-byte as served | mirrored |
| `public/world/world/` | 3,697 map tiles + `index.json` + `areas.json` | mirrored |
| `public/world/assets/` | JS/CSS chunks, 161 textures (×2 variants), 8 character models, fonts | mirrored |
| `src/` | 215 original TypeScript files, 62,887 lines | **extracted from source maps** |
| `server/` | HTTP + WebSocket game server | **written from scratch** |
| `web/` | The same service as a SvelteKit app | **ported from `server/`** |
| `tools/` | Re-mirror and offline-patch scripts | written |

Most of each image is the city: `nyc` and `web` carry the same `public/`
payload and end up within a few tens of MB of each other.

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

41 protocol conformance checks driving a headless client through the real binary
codec — handshake, ping/pong, snapshot round-trip, the speed clamp, AOI culling,
safe-zone immunity, damage/death/scoring, respawn, leaderboard, token reconnect:

```bash
cd server && npm install && npm test          # against localhost:8080
PORT=8081 npm test                            # against a running container
```

---

## The SvelteKit port

`web/` is the same service written as a SvelteKit app. It is a port, not a
wrapper: the `web` container serves the mirrored client, the world tiles, the
REST endpoints and the game socket itself, and never contacts `nyc`.

```
/                          overview, rendered from the live world
/play                      launcher: quality, time, weather, viewpoint
/spots                     the client's 29 named cameras
/status                    players, weather, leaderboard, landmarks (polls every 2 s)

GET  /world/*              static client + tiles          src/routes/world/[...file]
GET  /world/api/admin/me   { admin: boolean }             src/routes/world/api/admin/me
POST /world/api/telemetry  boot/crash beacons -> 204      src/routes/world/api/telemetry
GET  /world/api/status     live world as JSON (new)       src/routes/world/api/status
WS   /world/ws             JSON control + binary states   src/lib/server/net.js
```

Four things decided the shape of it:

**The game had to come out of the http server.** `server/index.js` interleaves
routing, the world and the socket in one file. `src/lib/server/world.js` is that
simulation with the transport removed — it takes anything that can `send()` and
`close()` — so the wire behaviour is unchanged while SvelteKit owns the routes.

**SvelteKit cannot accept a WebSocket upgrade.** So `server.js` creates the http
server, mounts adapter-node's handler on it, and attaches the socket alongside.
`net.js` uses `noServer: true` and its own `upgrade` listener rather than
`new WebSocketServer({ server, path })`, which aborts every upgrade that does not
match its path — including Vite's HMR socket. The same wiring runs under
`vite dev`, so the real client is playable against the dev server.

**The world is loaded twice, and must exist once.** `server.js` imports the game
directly; SvelteKit bundles its own copy for the routes. `runtime.js` parks the
instance on a `Symbol.for` key, so the pages and the API read the same live world
the socket is mutating — the overview and `/status` are rendered from it directly,
with no HTTP hop and no second WebSocket.

**Tile headers are load-bearing.** Tiles are raw gzip served as
`application/gzip` with no `Content-Encoding`; announcing the encoding would make
the browser inflate them and the streamer worker, which sniffs the magic bytes
itself, would fail. `static.js` reproduces the original's headers exactly —
verified by diffing both servers' responses.

`src/lib/shared/` holds `protocol.js` and `constants.js`, unchanged apart from
being ESM, mirroring the recovered `src/shared/` that both halves import.

### Changing the client without touching `public/`

The compiled client is shared with `nyc` and stays byte-for-byte as mirrored, so
this service adds to it on the way out instead: `client-addons.js` appends script
tags to the pages it extends — `index.html` and `safe.html` — as they are served,
and the scripts live in `web/static/`. They
reach the running game through `window.__game`, the handle `main.ts` already
exposes for playtesting. Every other file goes out untransformed.

Five addons ship today.

**`mobile-map.js` makes the play-mode minimap collapsible on touch devices.**
It keeps the map itself at the upper-left edge, ahead of the HUD status chips,
and adds a small in-map control. The map starts expanded; tapping the control
collapses it to a `MAP +` pill without hiding health, location, or status, and
tapping again restores it. The whole map, vitals, and location stack is pinned
to the safe upper-left corner on desktop and mobile; the desktop notification
feed sits in the lower-left corner. A `HUD −` button on desktop and mobile
collapses the whole stack to a `HUD +` button; expanding restores its contents.
Admins also get a live traffic-density slider
beside the map, scaled from zero to a 400-car ceiling (or the device's native
budget when that is higher); it is hidden from everyone else. `?mobilemap=1`
exposes the map control on desktop for testing, while `?mobilemap=0` disables
the addon.

The SvelteKit vehicle transform in `traffic-assets.js` loads
`traffic-distribution.js` to distribute traffic by available lane length and
occupancy across highways, ramps, arterials, and side streets. It includes short
OSM segments and follows curved lane paths when choosing spawn points. Camera
views favor roads ahead without excluding the surrounding network. Vehicle mixes
vary by road type, with fewer taxis and more passenger and delivery vehicles on
highways. The rendering pools allow more simultaneous cars, including distant
models on iOS. Run `cd web && npm run test:traffic` for the Cross Bronx replay.

**`look-stick.js` gives touch devices a thumbstick for the camera**, in both of
the client's modes.

*Play mode.* Upstream (`src/client/src/ui/touch.ts`) has a movement stick
bottom-left and a drag-anywhere look zone, but no right stick. The addon adds one
to the client's own overlay, in the opposite corner, moving the action buttons
above itself, and feeds `input.addTouchLook()`. Going through that method rather
than the gamepad path means it also picks up the mouse-sensitivity multiplier and
the aim-down-sights slowdown, and goes quiet whenever input is blocked.

*Camera mode (`?spot=` / `?fly=`).* Nothing worked here on a phone, and none of
it was one missing feature — the client closes three separate doors. It builds
`InputManager` with `enabled: false`, so `addTouchLook()` and `setTouchMove()`
are both no-ops. `ui/index.ts` computes `touchActive` with `!st.screenshotMode`,
so the touch overlay is never un-hidden, and its sticks would be inert anyway.
And the free camera looks by **mouse** drag — `mousedown` on the canvas then
`mousemove` on window — which a touch drag never produces, while it reads
movement straight off `input.keys`. So in camera mode the addon puts up its own
overlay with both sticks and drives those two paths directly: the left stick
holds WASD in `input.keys` (and `ShiftLeft` at the rim, which the free camera
reads as "fast"), and the right stick synthesises the mouse drag.

*Getting there at all.* On iOS, camera mode used to lock itself out. The client
keeps a crash guard in localStorage (`core/crashGuard.ts`): each load pushes a
start, and only `markReady()` forgives it — two unforgiven starts in five minutes
and `boot.ts` opens safe mode before any game code runs. Off iOS `markReady()`
fires at the first drawn frame; on iOS it fires from one place only, when
`shots.ready` flips, and that is the full screenshot contract — every module
built, near tiles decoded, no outstanding work. In camera mode on a phone that
is minutes away, because iOS constructs the city one module per 1.5 s slot after
the first frame. So a visit you gave up on counted as a crash, two of them locked
you out, and iOS safe mode is a `location.replace()` to `/world/safe.html`, which
drops the query string and lands you in Bryant Park in play mode.

`camera-boot.js` applies the rule every other platform already gets: in camera
mode, once the renderer has drawn and the page has stayed up for 20 s, the start
is marked clean. An out-of-memory kill happens while the city is still being
built, well before that, and is still caught — and the addon stands down
completely on a page error, on the client's own safe-mode panel, on a page that
never drew, and for a record another tab now owns. `?bootguard=0` restores the
strict rule. `safe-return.js` covers the other half: it puts the viewpoint you
were opening back on the safe-mode page, carrying the `safe=1` that lets one load
through the guard, instead of only offering the trip to Bryant Park.

Rates come from the client, not from taste. `core/input.ts` drives the gamepad's
right stick at 720 px/s past a 0.15 dead zone, so the look stick uses those
numbers. The two modes turn a pixel into a different angle — `character/camera.ts`
uses 0.0022 rad/px, `core/screenshot.ts` uses 0.0035 — so camera mode is scaled
by their ratio and both feel the same under the thumb.

**`water-reflection.js` takes the reflections off the river**, all of them, by
default. The water (`environment/water.ts`) reflects in four ways, and they are
four separate knobs:

1. The **environment map** — the sky, through a Fresnel term at ior 1.33. This is
   `envMapIntensity`, 0.8 upstream: the broad sheen on the Hudson.
2. A **planar skyline mirror** — a half-res render of the far-LOD layer through a
   camera reflected about the water plane, mixed in by Fresnel. This is what puts
   towers in the river, and it is off on the `mobile` preset upstream, so phones
   never had it.
3. Two **extra sun lobes** the client's shader patch adds by hand, a tight GGX
   glitter at `pow(envMu, 26)` and a broad one at `pow(envMu, 6)`.
4. The ordinary **PBR specular highlight**, which answers the sun and every
   street lamp. `specularIntensity` is 1 upstream, and this is the one that keeps
   a bright streak on the water after the other three are gone — the easiest to
   miss, because nothing in the water shader mentions it.

Two of them are ordinary material properties. The other two are bare expressions
in the client's shader with no uniform to turn, so the addon chains a second
compile hook and adds them. That is safe because `environment/patch.ts`
`chainCompile` was written for it: assigning `onBeforeCompile` runs your hook
*after* the material's own patch rather than replacing it. The anchors are
verbatim GLSL from `water.ts`, which survives bundling because it lives in
template literals — and the test asserts each appears exactly once in the shipped
chunk, so a re-mirror that changes the shader fails loudly instead of leaving the
river glossy.

| Param | Effect |
|---|---|
| `?water=0` | no reflections at all — the default here |
| `?water=1` | upstream, untouched |
| `?water=0.35` | a dulled river that still reflects a little |
| `?waterglitter=0.6` | sun and lamp specular on its own scale; without it, the glitter follows `?water` |

`__water.scale` and `__water.glitter` retune both live, with no recompile.

| Param | Effect |
|---|---|
| `?bootguard=0` | keep the client's strict crash-guard rule in camera mode |
| `?lookstick=0` | off in both modes |
| `?lookstick=1` | force it on with a mouse, for testing on a desktop (it reveals the overlay too, since the client keeps it hidden without touch hardware) |
| `?looksens=480` | pixels per second at full deflection (default 720) |

`__lookStick.rate = 480` retunes it live from the console.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | listen port |
| `HOST` | `0.0.0.0` | bind address |
| `BASE_PATH` | `/world` | prefix for the game, its API and the socket |
| `ADMIN` | `0` | `1` grants every player admin (noclip fly, teleport) |
| `VERBOSE` | `0` | `1` logs the client's telemetry beacons |

### Working on it

```bash
cd web && npm install
npm run dev            # http://localhost:5173 — pages, game and socket, with HMR
npm run build && npm start
npm test               # the server/ protocol suite, against localhost:3000
npm run test:ui        # the look stick, driven through jsdom (no server needed)
```

`npm run dev` needs `public/` beside it, which it is in this repo; set
`PUBLIC_DIR` to point elsewhere.

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

- All 41 protocol checks in `server/test-protocol.js` pass against the original
  service, and against the SvelteKit port — from source, from `vite dev`, and from
  the built `web` image.
- The two services return byte-identical headers for the client, the hashed
  assets, the character models and the gzip tiles; the only difference is that
  SvelteKit sets `content-length` on the JSON API responses, where the original
  used chunked encoding.
- Every one of the 403 non-tile files under `public/world/`, plus a sample of the
  3,697 tiles, comes back 200 from the port at exactly its on-disk size — and
  still does with the addon injection in place, which rewrites `index.html` only.
- The addons' 98 checks pass under jsdom: where it installs, when it stays
  out of the way, the deltas it feeds for full, half, diagonal and dead-zone
  deflection, and, in camera mode, the keys it holds and the synthetic mouse drag
  it emits; plus when the crash guard is and is not forgiven, where the safe-mode
  page sends you, and — against the real shipped chunk, not a mock — that the
  water shader patch still applies. **They have not been rendered in a browser** —
  there is none on the machine this was built on, so the water change in
  particular is verified as a correct patch, not as a look.
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
- **No persistence.** Profiles live in memory, keyed by token. The two containers
  each hold their own world, so a player in one is invisible in the other.
- **The port has not been opened in a browser here.** Its protocol conformance
  and every byte it serves were checked programmatically, but the Chromium boot
  in *Verified* above was run against `nyc`, not `web`.
- **`src/` does not build.** It is the recovered source for reading and reference.
  Type-only files (`context.ts`, `world.ts`) were erased at compile time and are
  absent, and there is no `vite.config`, `package.json`, or `index.html` for it.
  The container serves the original compiled bundle, not a rebuild of `src/`.
- Deliberate modifications to the mirrored bundle:
  - `tools/patch-offline.js` repoints the web-font `<link>` from Google Fonts to
    the vendored copy. Upstream already ships system-font fallbacks, so this only
    removes a network round-trip.
  - `assets/tile.worker-*.js` carries three bug fixes to the bridge builder:
    - Adjacent decks of one elevated structure (a ramp beside the motorway it
      merges with, or the two carriageways of a viaduct) used to be walled off
      from each other by a parapet each, with an unreachable slot between them.
    - A deck took its height from the OSM `layer` tag alone, so where one span of
      a continuous roadway is tagged a layer above the next — routine, since
      `layer` only records what passes over what — the two met at a shared node
      at different heights and the deck simply stepped. 80 of the city's 760
      shared bridge nodes broke this way, by up to 11 m on the Brooklyn Bridge
      and by 6 m on the Riverside Drive viaduct at W 138th. Decks meeting at a
      node now agree on one height and ramp to their own crown from it.
    - A ramp joining a motorway at a gore angle failed the "beside me" test that
      drops the parapet between two decks, so its barrier ran out across the
      lanes it was merging into. A deck edge that lands *on* a neighbouring
      carriageway at the same height now drops its wall whatever the angle.

    `buildBridges` was rewritten in place from the fixed
    `src/client/src/streets/bridges.ts`, using the bundle's own minified helper
    names. Because `src/` does not build, the two have to be kept in step by
    hand.

  - `tools/patch-tunnels.mjs` replaces blocked tunnel mouths with continuous
    underground roads, walls, ceilings, lane markings, and colliders. Traffic
    uses the same elevation profiles, connects through tunnel portals across
    OSM layer changes, and ignores surface traffic lights while underground.
    Approach openings are cut out of the ground, paving, and ground collider;
    the water and distant ground planes no longer fill those openings.

    Elevations are synthetic: a 10% grade descends to at most 8 m below ground.
    Short tunnels use shallower profiles to keep their entrances connected.
    This is not surveyed NYC tunnel geometry. The shared implementation is
    `src/client/src/streets/tunnels.js`; run `node tools/patch-tunnels.mjs` after
    editing it to update the served copy. The guarded patch also reapplies the
    client hooks after re-mirroring the same upstream chunks. Run
    `npm --prefix web run test:tunnels` for geometry and traffic regressions.

  - `tools/patch-foundations.mjs` raises buildings whose footprints overlap a
    vehicular tunnel to the entrance roof height (6.025 m). The complete building,
    rooftop props, collision mesh, and distant model move together. A thin
    foundation slab closes the underside while preserving tunnel clearance.
    Overlap tests include road width and respect courtyards. A small city-wide
    tunnel index keeps results independent of tile loading order; regenerate
    it with `node tools/index-tunnels.mjs` after changing the map tiles, then run
    `node tools/patch-foundations.mjs`. The shared rules live in
    `src/client/src/buildings/foundations.js`.

  - `tools/patch-road-layers.mjs` keeps road markings attached to their own
    sampled decks, including at tile borders, and keeps surface paint and
    asphalt wear below overpasses. Bridge columns move outside lower roadways
    with wider support beams, or skip stations that cannot provide clearance.
    Run this patch after `patch-tunnels.mjs` when re-mirroring; it transplants
    the recovered markings builder and copies `streets/supports.js` into the
    served worker. Run `npm --prefix web run test:roads` for stacked-road,
    support-collider, and actual Highbridge tile regressions.

  - `tools/patch-lane-continuity.mjs` publishes `streets/lane-layout.js`, the
    one lane plan that asphalt, paint and traffic share on one-way motorways,
    trunks and primary bridges. Where OSM splits a carriageway into ways, the
    lane lines of consecutive ways meet, dash phase carries across, a lane
    that opens or closes tapers the wider deck instead of stepping it, and at a
    merge or split each branch's lanes are assigned to the trunk's lane slots.
    Two branches leaving (or joining) a trunk used to be built to their own
    tagged widths from the shared node outward — the Trans-Manhattan levels are
    each tagged 14.7 m wide for two lanes — so the decks lay across each other
    for a hundred metres and each painted its edge line through the other's
    lanes. Sibling branches now partition the roadway: from the node until
    their lane envelopes have parted, each deck stops at the gore, halfway
    between its outer lane line and its sibling's, and the shared boundary is
    painted once. A lane both branches keep (a trunk with fewer lanes than its
    branches) stays on the trunk's slot at the node and is split down its
    middle until it has widened into two. Where the ways' centrelines are
    closer than their lanes are wide, the lanes move aside by half the
    overlap so traffic on the two ways never shares a surface. The bridge
    builder's neighbour test (`bridges.ts` `facingDeck`, kept in step by hand
    in the served worker) measures the gap to the edge a neighbour is actually
    built to rather than its nominal half-width, so fascias and jersey
    barriers follow the same edges. `npm --prefix web run test:roads` checks
    synthetic fans, an option lane, a lane addition, every seam and fan in
    the Highbridge tiles, and that the two Trans-Manhattan approaches keep
    their inner traffic lanes a lane apart.

## Developing on the client

```bash
docker compose --profile dev up web-dev   # http://localhost:5173/world/
```

`web-dev` runs the same service under `vite dev`, with `web/src`, `web/static`
and the whole mirrored `public/` tree bind-mounted, so edits land without an
image rebuild. Saving a file under `public/world/assets/` reloads the page: the
watcher is in `web/vite.config.js`, and the reload reaches the mirrored client
through Vite's HMR client, which `client-addons.js` injects into `index.html`
alongside the usual addons. `web/src` gets SvelteKit's own HMR as normal.

It is a full page reload rather than a module swap, which is what the client can
actually use — it is one compiled bundle with no HMR boundaries, and the tile
worker rebuilds its geometry from scratch on load anyway.

Two things make this necessary rather than a convenience:

- **`docker compose up` bakes `public/` into the image** (`COPY public/`), so
  without the bind mount an edit to the client is invisible until `--build`.
- **The production service sends `immutable, max-age=31536000` for
  `/world/assets/`**, and the mirrored filenames carry the *origin's* content
  hashes, which do not change when the bytes behind them do. A browser that
  loaded the page once will keep the old bundle — worker scripts especially,
  since a reload does not revalidate them. In development `static.js` sends
  `no-store` instead. On the production service on :3000, a hard reload
  (Cmd/Ctrl-Shift-R) is the way to pick up a rebuilt bundle.

If saving a file does not reload, the bind mount is not delivering filesystem
events; set `VITE_POLL: "1"` on the `web-dev` service.

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
