# Operation: Urban Assault

A first-person shooter built with Three.js — wave-based combat in a modern-warfare
urban combat zone.

## Running

The easy way:

```bash
python3 run.py
```

That installs anything missing, approves the npm install scripts Vite needs, starts the
server and opens the game in your browser. It also picks a free port if 3000 is taken.

```
python3 run.py              dev server + browser
python3 run.py --build      production build, then serve it
python3 run.py --port 8080  use a specific port
python3 run.py --no-open    don't launch a browser
python3 run.py --verify     run the functional test suite
python3 run.py --soak       run the stability soak test
```

If you'd rather use npm directly:

```bash
npm install
npm run dev      # http://localhost:3000
npm run build && npm run preview
```

> **If `npm run dev` fails with "esbuild not found"**, npm 11+ blocks dependency
> lifecycle scripts by default, and esbuild's postinstall is what fetches the binary Vite
> runs on. Fix with `npm install-scripts approve --all`. `run.py` does this for you.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| Mouse | Look |
| Left mouse | Fire |
| Right mouse | Aim down sights |
| `Shift` | Sprint |
| `Ctrl` / `C` | Crouch (Shift while crouching = slide) |
| `Space` | Jump |
| `Q` / `E` | Lean |
| `R` | Reload |
| `1` `2` `3` `4` | Rifle / SMG / Sniper / Pistol |
| Mouse wheel | Cycle weapon |
| `P` | Cycle quality tier |
| `Esc` | Pause |

## Rendering

Lighting, materials and grading are all owned by `core/Engine.js` and `world/Lighting.js`
so there is a single source of truth for the look.

- Colour grading runs as one full-screen pass that folds ACES tone mapping and the
  sRGB transfer into the grade itself. Grading happens in **perceptual space** (after
  the sRGB encode), not in linear space — a contrast pivot of 0.5 in linear space
  crushes a dark scene to black.
- A small PMREM environment map generated from a procedural sky gradient. Without it,
  high-metalness materials (gunmetal, glass) have nothing to reflect and render black.
- Ambient occlusion is baked into vertex colours at merge time from a coarse occupancy
  grid, so it costs nothing at runtime.
- The sky dome is depth-tested and drawn *last*, so it only shades pixels that no
  geometry covered instead of filling the frame and being overdrawn.

Static level geometry is merged by material, so adding detail is nearly free in draw
calls — only triangles, which are cheap.

## Performance

The game auto-detects the GPU and picks a quality tier, then continuously adjusts
internal render resolution to hold the framerate. The tier badge in the top-right and
the overlay at the top of the screen show the current tier, resolution, scale and
draw-call count.

Tiers: `potato` → `low` → `medium` → `high` → `ultra`. You can also pick one manually on
the start screen, or press `P` to cycle at runtime.

## Testing

The test harness drives a real browser against a running dev server, so it exercises
the actual render loop, input handling and game state rather than mocking them.

```bash
npm run dev            # in one terminal

npm run verify         # 19 functional checks: movement, weapons, ADS, reload,
                       # death/redeploy, pause, quality tiers. Exits non-zero on failure.
npm run soak           # sustained combat: fps range, wave progress, heap drift
npm run shots          # screenshots from 8 viewpoints into shots/
```

`verify` and `soak` start headless Chrome themselves, or reuse one already listening on
port 9222. Point them at a production build with `GAME_URL=http://127.0.0.1:4173/`.

Useful knobs: `SECONDS` / `SEGMENTS` (soak length), `VIEWS` / `TAG` (screenshots).

Because the harness, Vite and Chrome all share two CPU cores, absolute fps measured under
test is pessimistic. Watch the *spread* and whether the adaptive scaler drops resolution,
not the absolute number.

## Architecture

```
src/
├── main.js                 game loop, wave director, integration
├── core/
│   ├── Engine.js           renderer, camera, colour grade pass, env map, adaptive size
│   ├── PerformanceManager.js  GPU detection, quality tiers, dynamic resolution
│   ├── Input.js            keyboard/mouse with press latching
│   ├── Physics.js          spatial hash grid + DDA raycasting, collision resolution
│   ├── Audio.js            Web Audio, positional playback
│   └── AssetFactory.js     procedural textures, normal/roughness maps
├── world/                  level, props, skybox, lighting, baked vertex AO
├── weapons/                weapon models, animation, ballistics, effects
├── enemies/                soldier models, AI, animation, A* pathfinding
├── effects/                particles, explosions, screen effects
├── player/                 controller, health, first-person arms
└── ui/                     HUD, kill feed, minimap, menus
```

Everything is generated procedurally at runtime — there are no external art assets.
