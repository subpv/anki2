# Card

Spaced-repetition flashcards built for engineering study rather than rote facts. It schedules reviews
with FSRS (the algorithm current Anki uses) and runs as one Docker container. Login is through
Authentik or with a username and password. The interface is in German (default) or English and
works on phones (bottom bar, installable to the home screen).

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
| Vocabulary | A word and its meaning, asked in both directions. With a picture (emoji or image), the reverse card shows the picture and a hint button. |

All text fields take Markdown and LaTeX (`$inline$`, `$$display$$`). Images can be pasted or dropped in.

Also: per-course exam dates (no card is scheduled past the exam), cram mode, undo, stats,
`.apkg` import from Anki, and fitting the FSRS parameters to your own review history.

To keep you coming back: a daily goal ring and streak on Home, a year heatmap of study days,
a "known %" estimate per course, 5-minute sessions that stop after 15 cards, reviews interleaved
across card types and courses, and an answer timer bar that shows the answer when it runs out.

## Login

- **Authentik** (OpenID Connect): the *Log in with Authentik* button on the login page.
- **Username and password**: after logging in with Authentik once, set them under *Settings → Login
  without Authentik*. Passwords are stored as scrypt hashes; after 10 failed attempts within 15 minutes
  per username or address, logins are refused for a while.
- **Without Authentik configured** (no `OIDC_ISSUER`), the first visit offers to create the first
  account; after that, setup is closed.

The language (Deutsch/English) can be picked on the login page, in the account menu or in Settings,
and is stored per account.

## Wiki and AI import

The **Wiki** page explains every card type and how to write cards, and has a *Copy instructions*
button with the exact import format for an AI. Paste the AI's JSON under **Import → Paste text**. The
import is all-or-nothing: if one card is wrong, nothing is imported and each problem is listed.
Single backslashes in LaTeX (`\frac` instead of `\\frac`), the most common AI mistake, are repaired
automatically.

## Decks and word lists

The **Import** page in the sidebar has:

- **Ready-made decks**, added with one click. Included: *Danish → German, the 1000 most important
  words* (`decks/danish-german-1000.txt`), in order of importance, with en/et, German articles,
  plurals and verb forms, and 297 pictures for words that can be drawn. The order is based on the
  lemma frequency list of [Det Danske Sprog- og Litteraturselskab](https://dsl.dk) (DSL), used under
  DSL's open licence.
- **Word lists**: a text file with one word per line, `word | meaning | picture | note`
  (tab, `|` or `;` between columns). Each line becomes two cards.
- **Anki decks** (`.apkg`).

To add another ready-made deck, drop a word list with `# title:`, `# description:` and `# course:`
lines at the top into `decks/`.

Like Anki, once one card of a note has been studied, its other cards (e.g. the reverse direction of
a word) wait until the next day.

## Deploy on TrueNAS SCALE

1. **Authentik**: create an *OAuth2/OpenID Provider* (confidential client) and an application for it.
   - Redirect URI: `https://card.maidev.dk/auth/callback`
   - Scopes: `openid`, `profile`, `email`
   - Note the client ID, client secret and the *OpenID Configuration Issuer* URL.
   - Who may log in is controlled by the application's bindings in Authentik. Each Authentik user gets their own courses and cards.
2. **Dataset**: create a dataset for the app data, e.g. `tank/apps/card`.
3. **App**: Apps → Discover Apps → ⋮ → *Install via YAML*, paste [`docker-compose.yml`](docker-compose.yml) and fill in the values marked `CHANGE`.
4. Point your reverse proxy at port `8765`.

The image is built by GitHub Actions on every push to `main` and pushed to `ghcr.io/subpv/anki2`
and, when configured, to the Gitea registry at `git.maidev.dk/<owner>/card`:

1. In Gitea: Settings → Applications → generate a token with **package: Read and Write** and
   **repository: Read and Write** (the code is copied to `git.maidev.dk/<owner>/card` as well).
2. In GitHub: repository Settings → Secrets and variables → Actions:
   - variable `GITEA_USER` = your Gitea username (and optionally `GITEA_OWNER` for an organisation),
   - secret `GITEA_TOKEN` = the token.
3. Re-run the latest "Build image" workflow (Actions → Build image → Run workflow) or push to `main`.

TrueNAS then pulls `git.maidev.dk/<owner>/card:latest`. If the Gitea package is private, log the
server in once with `sudo docker login git.maidev.dk` (a token with package: Read).

### Configuration

| Variable | Meaning |
|---|---|
| `APP_URL` | Public URL of the app, no trailing slash. Used for the login redirect and secure cookies. |
| `OIDC_ISSUER` | Authentik issuer URL, e.g. `https://auth.example.com/application/o/card/`. Optional: without it, only password login. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | From the Authentik provider. |
| `FEEDBACK_URL` | Feedback form opened by the *Feedback* button (default `https://feedback.maidev.dk/`; empty hides the button). |
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

## Security

- Sessions: random 256-bit ids, stored hashed; cookies are `HttpOnly`, `SameSite=Lax` and `Secure` when
  `APP_URL` is https.
- Every request that changes data must come from the app's own origin (`APP_URL`), which blocks
  cross-site request forgery, also from other sites on the same domain.
- Strict Content Security Policy (no inline scripts, no framing of Card), `nosniff`, HSTS on https.
- Every user only sees and changes their own courses, cards and images; images are served to logged-in
  users only. Uploads accept PNG, JPEG, GIF, WebP and AVIF only.
- The OpenID login uses PKCE, state and nonce.

## Feedback

The *Feedback* button opens https://feedback.maidev.dk. To be able to pick Card there, add
`{ slug: "card", name: "Card", icons: [] }` to the `APPS` list of the feedback page.
