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
Everyone gets a live traffic-density slider beside the map, from zero to their
device's native budget. Admins can explicitly raise it to 400 cars (or the native
budget when higher). Showing the control preserves the selected count, including
the iPhone default of six cars. `?mobilemap=1`
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

Traffic signals group poles by road junction and level, so wide intersections
share a controller and overpasses do not control the street below. Opposing
approaches share a phase; diagonal branches receive separate greens with yellow
and all-red clearance. Ordinary four-way intersections retain their 90-second
cycle. Junctions with more than two approach axes add a 27-second vehicle-red
pedestrian interval. Stop lines account for crossing road width and angle, and
cars obey signals on elevated roads at the matching level. This is a synthetic
signal plan, not surveyed NYC timing or protected turn-lane control.
Run `npm --prefix web run test:signals` for four-way/multi-arm behavior, tile
ordering, road levels, and the West 155th Street/Harlem River tile replay.
`node tools/patch-signals.mjs` republishes the recovered controller and its
placement/rendering/vehicle hooks after source edits or reapplying mirror patches.


The SvelteKit streaming transform in `streaming-assets.js` installs
`predictive-streaming.js` before the first tile request. Mobile loads tiles within
a **512 m radius** of the player/free camera; desktop presets use **1,500 m**.
Distance is measured to tile edges, so tiles intersecting the radius are included.
Mobile's far distance is also 512 m, avoiding an additional far-building layer.
The mobile atmosphere uses its original fog fade from 180 to 700 m.
Mobile keeps the simplified roads and existing device-specific effects budgets.
Mobile landmarks also use the 512 m range, measured from their approximate edge
so nearby bridge spans remain visible. Distant landmarks release after an extra
tile of hysteresis once their owning tiles unload. Desktop retains the separate
6 km skyline range. Landmark cleanup releases instanced furniture buffers as well
as geometry; shared materials live until the landmark module is disposed.

iOS allows up to **32 resident tiles** to accommodate the 512 m neighborhood, one
additional route tile and three recently used tiles. `IOS_STREAMING` in
`predictive-streaming.js` holds its resident and request limits. The immediate
surrounding nine tiles take priority over farther work; startup waits for only
those nine before expanding.
iOS looks up to 256 m beyond the radius in the travel direction; Android retains
three forward slots and its longer search window. Desktop looks up to 512 m beyond
the draw distance. Camera facing supplies the direction when stationary. These
windows are search limits, not promises to build every tile within them.

Street workers, queued mobile building workers and terrain/building commits use
the shared tile priority, with regular FIFO turns to finish older background work.
Recent tiles survive brief turns for up to six seconds. Mobile retires at most
one tile per frame, separately from publishing new tiles. iOS overlaps four tile
requests on its existing decoder; Android retains two. Decoded replies waiting
for scene publication count against those request limits. Mobile still commits
at most one tile per frame. Obsolete replies release their slots even while
scene building is backed up. On iOS, an already-decoded missing occupied tile can
pass the busy-job gate; neighboring tiles still wait for builders to catch up.
When memory permits, that occupied tile also precedes further scene retirement.
The occupied-tile exception also applies to desktop/admin camera and Android
travel; neighboring tiles still wait for the ordinary scene build budget.
Async shader compilation retains its original program references and tolerates
their disposal when a tile unloads. The original renderer timer read a deleted
material's current program, throwing without settling its promise; enough such
unloads permanently filled the scene-job gate. Polling errors now reject so
build jobs can release their busy counts. The regression test reproduces twenty
simultaneous unload/compile races against the served renderer and build queue.
Abandoned fetches are cancelled as soon as the focus moves away, and requests
that fail to fetch/decode within 30 seconds release their slots and retry after
the existing ten-second delay. An unresponsive decoder pool is restarted.
Decoded tiles waiting for scene publication are exempt from the network timeout.
The streaming tests include repeated city-length trips, callback/worker cleanup,
late replies and recovery from a fully stalled request pool. Run
`node tools/patch-streamer-worker.mjs` after changing the recovered tile decoder.

Run `cd web && npm run test:streaming` for the served quality/fog settings, mobile
512 m and desktop 1.5 km coverage, actual GWB upper-level road data, nearby
priority, blocked builders, turns, teleports, retries and memory bounds. These simulations check scheduling
and data availability; they do not measure Safari frame rates or real device
scene-construction latency.
Run `cd web && npm run test:memory` for repeated landmark travel and resource
disposal checks against the served client.

Tunnel terrain uses the same complete nearby road context as street workers,
including tunnel ways whose owner tiles are not resident. Profile/elevation
changes refresh affected resident ground and collision surfaces; tile removal
also triggers a refresh. Unchanged local cutouts reuse their geometry, and newly
created ground meshes receive the existing cuts. This prevents ground sheets
from remaining over entrances when the bore and approach stream separately.
`web/tests/tunnel-terrain.test.mjs` covers these arrival/removal cases.

Below-ground approaches use the tunnel builder's graded lane paint. The surface
marking builder skips those portions of its owning road, preventing a second
set of lane lines and oil decals at street height over buried approaches. Paint
on separate streets crossing above a bore, and on portions that return to ground
level, remains. `web/tests/tunnel-markings.test.mjs` checks both the synthetic
failure and a real Trans-Manhattan approach stripe.

The iOS startup policy in `web/static/world/assets/startup-policy.js` yields to
the next frame between modules and waits for outstanding scene jobs and the
nearby tiles, replacing the fixed 1.5-second slots. In play mode, terrain, roads,
buildings, landmarks, character, combat and UI finish before entry; street
furniture and traffic populate afterward, in that order. Screenshot mode still
waits for every scene module. Physics, first-render and scene-job readiness
checks remain in force. Audio waits for the post-entry factory/jobs to drain.
The loading message names the current construction stage; nine decoded tiles
no longer make the progress bar claim completion. Per-module timings, including
worker/scene completion, are available at `__game.ctx.startup.timings` on iOS.

The production Docker build also runs `web/scripts/prepare-world.mjs`. It writes
a road catalog and gzip/Brotli copies of the **transformed and versioned** mirrored
JS/CSS into `/app/generated`. The first tile request reads this road catalog
instead of decompressing all 3,697 tiles. JS/CSS responses negotiate compression
with `Accept-Encoding`; tiles retain their raw gzip body without
`Content-Encoding`. HTML addons still run at request time. Regenerate these
artifacts whenever the source assets or serving transforms change.
Port 5173 keeps live transforms and disables these production artifacts. Use
port 3000 after rebuilding to compare production download times on a phone.
`cd web && npm run test:startup` checks the served startup policy, compressed
response bytes/headers and road-context equivalence with the full tile scan.

Mobile roads use plain gray shades in
`web/static/world/assets/mobile-road-material.js`: darker asphalt, lighter
concrete, and medium-gray cobblestone, with subtle variation between roads.
This material removes surface texture sampling, cracks, tire wear, normal maps
and animated puddles; ordinary lighting, fog, lane markings and geometry remain.
Mobile skips downloading, generating and uploading the unused asphalt and
cobblestone maps. Desktop retains its detailed road material.

Other mobile street performance settings are tuned in
`web/static/world/assets/mobile-build-policy.js` (`MOBILE_STREET_BUDGET`). Surface
maps are capped at 128 px, procedural noise at 64 px, and the lane-paint/decal
atlas at 512 px, with 2× anisotropy and mipmaps retained. The worker and no-worker
texture paths share this limit. Mobile facade color and normal maps are also
capped at 128 px with 2× anisotropy (`MOBILE_BUILDING_BUDGET`), reducing their
pixel memory by 75% from the previous 256 px cap. Desktop maps retain their
original resolution and filtering.
The procedural generator now recognizes `mobile`, which previously selected
1024 px maps. Mobile also uses the drawn manhole decal without fetching its two
photographs. Maps load once per street module, so this reduces startup work,
uploads and resident texture memory, rather than per-tile network traffic.
`mobile-performance-assets.js` applies these hooks to the served chunks.

The shared scene commit queue gives mobile road jobs three generator steps per
background step, choosing road tiles with the streamer's travel priority. Its
3 ms deadline, one-texture-upload limit, cancellation and shader-compilation
waits remain in force. Buildings still receive a share while roads are busy.
Street worker dispatch also combines invalidations within 100 ms (waiting at
most 400 ms during continuous arrivals) and prevents two workers from rebuilding
different revisions of the same tile concurrently. Existing geometry stays in
place until its replacement is ready. These timings live beside the texture
settings in `MOBILE_STREET_BUDGET`.
The mobile pedestrian startup grace period uses four seconds of wall time;
slow frames no longer stretch that wait and delay the HUD. Crowd spawning keeps
running after the startup gate is released.
Mobile parking refreshes keep lane references and highway paths intact, update
only parking inside the 80 m window, and reuse cars that remain in that window.
`mobile-props.js` moves lamp-clearance geometry to `mobile-props.worker.js`,
caches placements across camera movement, and stages terrain queries and buffer
updates through the shared scene queue. Rounded instance capacity avoids
reallocating meshes when a kind gains or loses a single prop. Run
`cd web && npm run test:movement` for parking identity, worker placement,
per-frame work, cancellation and instance reuse checks.
Run `cd web && npm run test:textures` for texture dimensions, a dense-building
queue replay, cancellation, upload limits and static-serving checks.

For remaining iPhone stalls, record an actual device through
[Safari remote Web Inspector](https://webkit.org/web-inspector/enabling-web-inspector/)
and inspect the [Timelines tab](https://webkit.org/web-inspector/timelines-tab/):
compare network completion with JavaScript/worker work and long rendering frames.
The iOS preset already disables shadows, SSAO, bloom and reflections. Texture
dimensions, shader cost, geometry generation and scene commits are the next
useful areas to measure; a desktop replay does not establish iPhone frame time.

Port 3000 serves the production image, so changes require
`docker compose up -d --build web`. Port 5173 uses the source bind mounts.
The regular traffic control works with `ADMIN=0`; enabling admin mode is not
required to lower density, and the control never increases traffic on its own.
The served HTML and module/worker imports carry the revision from
`web/src/lib/server/client-cache.js`, bypassing older immutable copies of the
mirror's unchanged hashed filenames. A normal page reload picks up this release.

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
| `PREPARED_ASSET_DIR` | unset locally; `/app/generated` in Docker | production road catalog and compressed mirrored JS/CSS, generated from the same release |

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

For production optimizations outside Docker, run `npm run prepare:world` from
`web/`, then start with `NODE_ENV=production PREPARED_ASSET_DIR=./generated npm start`.
Re-run both `npm run build` and `npm run prepare:world` after changing the client.

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
  - The scene texture decoder caps mobile building and street maps at 256 px
    on the longest edge, preserving aspect ratio and leaving desktop maps at
    their original resolution. The worker and its main-thread fallback both
    apply the cap before upload. Run `cd web && npm run test:textures` to check
    both paths against the shipped client.
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

### Rail network

Rail coverage is generated from OpenStreetMap railway features, using the same
planning-before-streaming approach as the road renderer. The checked-in extract
contains 4,480 railway ways. `rail/map-compiler.js` preserves shared OSM node IDs,
track types, tunnel/bridge/cutting tags and layers, joins continuous track chains,
and solves grades over the whole connected graph before assigning tile owners.
Geometric crossings with different node IDs stay separate. Platform sections
remain level; connecting approaches absorb elevation changes at a maximum 5.5%
grade. Heights are synthetic because OSM layers describe stacking, not elevation.

The current import generates 592 platform records beyond the tailored Broadway
and Metro-North corridors below. These are platforms, not 592 distinct stations.
Imported stations use procedural platforms, stairs, canopies and signs at mapped
locations. Source platform polygons, station tags and entrance coordinates remain
in `rail/map-features.json`; the renderer does not yet reproduce their exact
outlines, mezzanines or entrance paths. Train movements are synthetic, follow
connected track chains, and are not an implementation of every named service.

Subway boards use the [MTA station catalog](https://data.ny.gov/Transportation/MTA-Subway-Stations/39hk-dx4f)
and [regular GTFS feed](https://www.mta.info/developers) for normal daytime routes,
colors and destinations. The offline sign index matches platform GTFS tags,
station references and adjacent OSM tracks, including their travel directions.
Each platform and inter-level stair displays its destination services; street
boards list services reachable through that entrance. Local stops exclude
express services that do not stop there. Cross-town services show destinations
such as Brooklyn or West Side. Signs are repeated between platform columns.
These are normal-service wayfinding boards, not live service-change information;
train timetables and the simplified infrastructure remain simulated.

To refresh service metadata, download the regular subway GTFS ZIP and the MTA
station catalog JSON, then run:

```bash
python tools/import-subway-services.py /path/to/gtfs_subway.zip /path/to/stations.json
node tools/index-subway-signs.mjs
```

The source URLs are in the importer. `subway-services.json` and
`subway-tracks.json` retain offline inputs; only the compact `sign-data.js` is
loaded during play. Pass an OSM body/geometry extract as the optional argument
to `index-subway-signs.mjs` to refresh track directions. The map importer does
this automatically. Source hashes and the GTFS feed version are recorded.
PATH platforms retain their own network/destination labels.

To refresh the map, fetch the checked-in Overpass query and run the importer:

```bash
curl --fail --get --data-urlencode data@tools/railways.overpass \
  https://overpass-api.de/api/interpreter -o /tmp/railways.json
node tools/import-railways.mjs /tmp/railways.json
```

The importer rejects incomplete responses, clips to the world's bounds, records
the source timestamp and SHA256, and regenerates the track catalog, station
access connections and worker footprint index. Runtime play requires no Overpass or MTA requests.
Rail map data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
under ODbL 1.0. The authored corridors are explicit replacement regions: matching
mapped tracks inside them are omitted to avoid duplicate geometry. New lines
outside those regions need map data, not another hand-written corridor.

The SvelteKit world includes a Broadway local corridor with 13 stations between
Times Square–42 St and 137 St–City College. Five-car trains run in both directions,
brake into stations, dwell, and open their platform-side doors. The tracks rise
from underground to the elevated 125 St station and descend again. Platforms,
stairs, connecting passages, tunnel walls, roofs and elevated decks have collision;
stations include name signs, benches, canopies and light strips. The `/play`
launcher has direct camera links to the platforms.

Metro-North adds nine stations: Grand Central, Harlem–125 St on Park Avenue,
Yankees–E 153 St, Morris Heights, University Heights, Marble Hill, Spuyten Duyvil,
Melrose and Tremont. The shared four-track Park Avenue trunk climbs from the
Grand Central tunnel to the viaduct, crosses the Harlem River on a supported
bridge, and splits at Mott Haven. Hudson and Harlem/New Haven services continue
along their branches to the edge of the loaded world. The shared trunk and its
two island platforms are built once, regardless of the number of services.
Stations have stairs to street level; the Harlem branch uses open cut stations.

Metro-North's horizontal alignment and station coordinates come from the
[official MTA GTFS feed](https://www.mta.info/developers). Regenerate the checked-in
`metro-north-data.js` with `python tools/import-metro-north.py /path/to/gtfsmnr.zip`;
the output records the feed URL and archive SHA256. Elevations, platform layouts,
structures and timetables are authored approximations, not survey or live service
data. Grand Central uses a simplified terminal within the shared four-track layout.

The Broadway corridor uses approximate station positions and synthetic service.
Map coverage depends on the extract and loaded world bounds; station details
and every service are not complete reproductions of the real networks.
Players can board at an open train door with **F** or the on-screen button.
Press F aboard a moving train to request the next available platform; at a stop,
F exits immediately. Boarding requires a resident platform at the player's level,
and terminal arrivals automatically unload passengers. Rides use the normal player
position updates; dedicated passenger occupancy and free walking inside moving
carriages are not implemented.

`rail/access-data.js` connects 1,296 existing street entrance props to 514 platform
records. The old painted stairwell is replaced by a terrain opening, collidable
stairs, a passage and a platform stair opening. Visible treads use continuous
walking collision to avoid catching the player capsule on step edges. These connections are procedural,
not surveyed station interiors. `tools/index-station-access.mjs` rebuilds them from
the mirrored entrance props and rail platforms. Existing NPCs can leave their
sidewalk routes, enter stations, wait on platforms, and return to the street.
They keep to separate directions in passages and retain their underground height
and visibility. NPCs currently visit stations without boarding trains.

Mapped underground entrances descend near their street positions and connect to
nearby platforms. The planner reserves an aisle beside the stairs within the
available track clearance; confined platforms retain their existing end access.
Platform walking paths are navigation data, not additional enclosed hallways.
Stairs between levels begin on the platforms, with UP/DOWN level signs at their
openings. Platform mesh, collision and floor-height queries share those openings.
The planner separates neighboring entrance flights and protects existing platforms.
Fourteen entrances without a clear route are gated and marked CLOSED.

Stair runs use short flights with resting landings. Inter-level connections use
turn landings where the underlying railway changes direction. NPCs select any
connected platform and preserve their intended floor where paths cross vertically.
Wall and roof openings retain lintels, sills and corner returns. Shared endpoint
frames close curved tunnel seams, and station end walls join the narrower bore.
Retained map polygons restore lower platforms discarded by the original nearest-
track deduplication, including Lexington Avenue–125th Street.
Platform assignment prefers the mapped layer over tiny differences in distance
to stacked tracks. `tools/refine-rail-platforms.mjs` applies that correction to an
existing snapshot without another download.

`web/static/world/assets/rail/network.js` owns the routes, bounded grades, station
levels, train schedules and portal/stair footprints. Geometry and train carriages
sample those same routes. Track sections have fixed tile owners and a neighbor halo;
one section or station is built per frame. Train rendering is limited to four
nearby consists across all lines on mobile and ten on desktop. Unloading releases geometry, signs
and collision, while train geometry and materials are shared.

`rail-assets.js` installs the module and the street-worker/height hooks. Rail uses
the existing tunnel terrain cutter for ground, paving, water and collision, while
preserving independent overhead road decks. The street height sampler applies
rail support at the player's level so a street above a platform cannot pull the
player back to ground level. The camera/fall guard recognizes supported underground
travel, and elevated piers use the motorway support planner to span lower road
lanes. Walls leave connected track and neighboring platform passages open.
Workers import the compact footprint index rather than the full rail graph;
terrain and water cuts are selected from spatial buckets for resident tiles.
The geometry/runtime Three.js imports carry the same
revision as `client-cache.js`; keep those in step when updating the client revision.

Run `npm --prefix web run test:rail` for grades, seams, train spacing and stopping,
station collision, connected entrance clearance, boarding and riding, NPC visits
to stacked levels, short stair flights,
branch seams, shared station ownership, served street cutouts, module loading
order, and repeated streaming/disposal. The existing tunnel, road, startup and streaming suites cover
the shared machinery. Changes apply to the SvelteKit services, including `web-dev`.
With Chromium installed, `npm --prefix web run test:station-browser` also walks
the actual player capsule down to underground platforms, up to an elevated
platform, along their full walking aisles, and back to the street. It includes all
eight 77th Street entrances, both Lexington–125th levels from every entrance,
and all Grand Concourse platforms from one entrance with
neighboring tracks and stations loaded together. Enclosure regressions cast rays
through platforms and stair junctions to detect missing walls and ceilings.
Each walking waypoint also checks the actual floor reached.
Set `CHROMIUM` to override the browser path; screenshots are saved under `/tmp`.

### Development server

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
