# Card

Spaced-repetition flashcards built for engineering study rather than rote facts. It schedules reviews
with FSRS (the algorithm current Anki uses), runs as one Docker container, and logs in through Authentik.

## Card types

| Type | What it does |
|---|---|
| Basic | Front and back, optionally reversed. |
| Cloze | `{{c1::hidden}}` text, also inside LaTeX. |
| Numeric answer | You type a value; it is checked against a tolerance and unit. SI prefixes and decimal commas are understood (`2.553 mA` = `0,002553 A`). |
| Parametrised problem | Variables with ranges and an answer formula. Every review has new numbers, so you practise the method. |
| Formula | One formula gives several cards: recall it, name each symbol and unit, and each rearrangement. |
| Code | Prompt and highlighted solution (C, C++, Python, MATLAB, Structured Text, VHDL, Verilog, ARM assembly). |
| Derivation | Reveal a derivation one step at a time. |
| Image occlusion | Cover labels on a schematic or diagram; one card per box. |

All text fields take Markdown and LaTeX (`$inline$`, `$$display$$`). Images can be pasted or dropped in.

Also: per-course exam dates (no card is scheduled past the exam), cram mode, undo, stats,
`.apkg` import from Anki, and fitting the FSRS parameters to your own review history.

To keep you coming back: a daily goal ring and streak on Home, a year heatmap of study days,
a "known %" estimate per course, 5-minute sessions that stop after 15 cards, reviews interleaved
across card types and courses, and an answer timer bar that shows the answer when it runs out.

## Deploy on TrueNAS SCALE

1. **Authentik**: create an *OAuth2/OpenID Provider* (confidential client) and an application for it.
   - Redirect URI: `https://card.maidev.dk/auth/callback`
   - Scopes: `openid`, `profile`, `email`
   - Note the client ID, client secret and the *OpenID Configuration Issuer* URL.
   - Who may log in is controlled by the application's bindings in Authentik. Each Authentik user gets their own courses and cards.
2. **Dataset**: create a dataset for the app data, e.g. `tank/apps/card`.
3. **App**: Apps → Discover Apps → ⋮ → *Install via YAML*, paste [`docker-compose.yml`](docker-compose.yml) and fill in the values marked `CHANGE`.
4. Point your reverse proxy at port `8765`.

The image is built by GitHub Actions and pushed to `ghcr.io/subpv/anki2` on every push to `main`.
If the repository is private, either make the package public (GitHub → Packages → Package settings)
or add registry credentials in TrueNAS.

### Configuration

| Variable | Meaning |
|---|---|
| `APP_URL` | Public URL of the app, no trailing slash. Used for the login redirect and secure cookies. |
| `OIDC_ISSUER` | Authentik issuer URL, e.g. `https://auth.example.com/application/o/card/`. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | From the Authentik provider. |
| `TZ` | Time zone. A study day ends at 04:00 local time. |
| `DATA_DIR` | Where the SQLite database and images live (`/data` in the image). |

**Backup**: everything is in the `/data` volume (`card.db` plus `media/`). Snapshot the dataset.

## Development

```bash
npm install
```

```bash
npm run dev:server
```

```bash
npm run dev:client
```

The dev server skips login (`AUTH_DEV_BYPASS=1`) and uses a local `data/` folder. The bypass is
ignored when `NODE_ENV=production`, which the Docker image sets.

```bash
npm test
```

Tests cover the unit checker, scheduler, API, Anki import, parameter fitting, and the full OpenID
login flow against a stub identity provider.

## Layout

- `server/` Fastify API, SQLite, FSRS scheduling (`ts-fsrs`), OpenID login, Anki import
- `client/` React app (Vite)
- `shared/` types and the numeric/unit checker used by both
