# WCS Song Recommender

A static web app for discovering West Coast Swing songs. Pulls candidate
tracks from Last.fm by genre tag, looks up BPM via Deezer, finds the YouTube
video for playback, and lets you build a YouTube playlist from songs you
approve.

**Live app:** https://jugisahunk.github.io/wcs-recommender

---

## Tech stack

- Plain HTML / CSS / JavaScript — no build step, no framework
- Hosted on GitHub Pages
- Google Identity Services (GIS) for OAuth — your signed-in YouTube account
  powers search and playlist creation
- **Last.fm** — `tag.gettoptracks` for genre-based candidate songs
- **Deezer** (via JSONP — no CORS headers) — per-track BPM lookup
- **YouTube Data API v3** — finds the playable video ID for each candidate
  and creates playlists; the IFrame Player API streams the audio
- **localStorage** — approved/disapproved lists, BPM overrides, and the
  YouTube search cache

Data flow on a Refresh:

```
filters → Last.fm top tracks for tag → Deezer BPM (filtered by slider)
       → YouTube search per surviving candidate → cards rendered
```

---

## Setting up your dev environment

You need very little to hack on this — it's static files.

### Prerequisites

- Git
- Node.js (only for the dev server — any recent LTS works)
- A modern browser (the app uses standard fetch, ES modules-style globals)

### Get the code running locally

```bash
git clone https://github.com/jugisahunk/wcs-recommender.git
cd wcs-recommender
npx serve -l 3030 .
```

Open http://localhost:3030.

If you use Claude Code, `.claude/launch.json` is already configured — the
**Preview** integration starts the server with one click.

### Credentials needed to fully exercise the app

The repo ships with the **maintainer's** Google OAuth Client ID and Last.fm
API key embedded in `app.js`. These are public identifiers (Client ID is not
a secret, Last.fm keys are rate-limit gated not auth-gated), so it's fine
that they're in source. But:

- **Forking the repo?** Replace the constants `YOUTUBE_OAUTH_CLIENT_ID` and
  `LASTFM_API_KEY` in `app.js` with your own. Otherwise quota and rate
  limits charge against the maintainer's account.
- **Want OAuth to work on localhost too?** The maintainer's OAuth Client
  has `http://localhost:3030` in its Authorized JavaScript origins, so
  forks need to do the same in their own Google Cloud project.

### Creating your own Google OAuth Client (if forking)

1. [console.cloud.google.com/apis/credentials/consent](https://console.cloud.google.com/apis/credentials/consent)
   → set up OAuth consent screen as **External**, fill in app name + emails,
   add yourself as a **test user**
2. [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
   → **+ Create Credentials → OAuth client ID** → **Web application**
3. Add to **Authorized JavaScript origins**:
   - `https://<your-username>.github.io`
   - `http://localhost:3030`
4. Copy the Client ID into `YOUTUBE_OAUTH_CLIENT_ID` in `app.js`

### Creating your own Last.fm API key (if forking)

1. [last.fm/api/account/create](https://www.last.fm/api/account/create) →
   fill in the form (no callback URL needed)
2. Copy the **API key** into `LASTFM_API_KEY` in `app.js`

### File layout

```
.
├── index.html         # All markup
├── style.css          # Light theme, ~1000 lines
├── app.js             # All behavior (single file by design)
├── songs.js           # Curated WCS reference list (used for known-BPM lookups)
├── README.md
└── .claude/launch.json
```

---

## How to use the recommender

### First-time setup

1. Open the app at https://jugisahunk.github.io/wcs-recommender
2. The **Curated Songs** tab shows a **Sign in with Google** button
3. Sign in with the Google account that's allowed in the app's OAuth test
   users list (the maintainer's account by default — fork the repo to use
   your own)
4. On future visits, sign-in happens silently if your Google session is
   still alive

### Curated Songs tab — getting recommendations

1. Set your filters at the top:
   - **Genre** — pick a WCS-friendly genre (Motown, R&B, Blues, etc.) or
     leave on "All Genres" for a mix
   - **BPM** — drag the dual-handle slider to your dance tempo range
     (default 85–120)
   - **Energy** — Low / Medium / High pills (currently advisory only —
     reliable energy data isn't available from any free API)
2. Click **Refresh** (or **Get Recommendations** on first run)
3. Up to **10 cards** appear, each with title, artist, BPM badge (when
   known), a Play button, a YouTube Music link, and Approve / Disapprove
4. Filter changes mark the Refresh button purple (pending) — the displayed
   set doesn't change until you click Refresh

What happens behind the scenes:
- Last.fm returns the top tracks tagged with that genre
- Deezer is queried in parallel for BPM for each candidate (with double/half
  time correction so a 200 BPM detection becomes 100)
- Tracks outside your BPM range are dropped; tracks without BPM data pass
  through
- The top 10 surviving candidates are searched on YouTube to get a playable
  video ID
- Cached lookups don't re-hit YouTube

### Approving / disapproving songs

- **✓ Approve** — adds the song to your Approved list. Approved songs stop
  appearing in Curated recommendations (you've already got 'em)
- **✕ Disapprove** — hides the song from future recommendations across all
  refreshes (with a confirm prompt)
- Both are persisted in `localStorage`

### Approved tab — building a YouTube playlist

1. Approved songs appear here with checkboxes
2. Tick **Select all** or pick individual songs
3. Click **▶ Create YouTube Playlist** — a private playlist is created on
   your YouTube account with the selected videos
4. A toast at the bottom links you to the new playlist in YouTube Music

### Search YouTube Music tab

Direct YouTube search using your OAuth quota. Type a query, hit **Search**,
get up to 6 cards. Useful for adding songs you already know about by name
that haven't surfaced through genre browsing. Approve them to add to your
Approved list.

### Player bar — playback and BPM detection

When you click Play on any card, the bottom player bar appears with the
embedded YouTube player.

**Tap-BPM detector:**

If a song has no known BPM (you'll see a dashed "↓ tap to detect" badge on
its card), you can capture the tempo yourself while it plays:

1. Click the **Tap** pad in the player bar in time with the beat
2. After 2+ taps, a live BPM reading appears
3. After 4+ taps, the **Save** button enables
4. Click **Save** — the BPM is now stamped onto that song everywhere it
   appears (cards, player, future sessions)
5. If the song already had a BPM, you'll be asked to confirm before
   overwriting

The **⟲** button resets the count. A 2.5-second gap between taps also
auto-resets, so you can tap a fresh tempo cleanly without using the reset
button.

### Pre-warming the YouTube cache (advanced)

The YouTube Data API has a default quota of 10,000 units/day. Each search
costs 100 units, so ~10 Refreshes/day before you hit the wall.

`findYouTubeVideo` caches results in localStorage by `artist|title` — so
once a song's video ID is known, future Refreshes don't re-query YouTube.

To pre-populate the cache without using any YT quota, the app exposes a
console function that uses **Piped** (an open-source YouTube frontend) as
the lookup source instead:

1. Open the deployed app in a browser
2. Open **DevTools → Console**
3. Run:
   ```js
   warmCache()         // ~30 tracks per genre, ~5 minutes
   warmCache(10)       // lighter pass — ~10 per genre
   ```
4. It logs progress per-genre. When done, your cache holds hundreds of
   song → video mappings. Subsequent Refreshes mostly hit cache.

Piped instances are third-party; the function falls through 5 fallback
instances and skips songs cleanly if all of them are unreachable.

---

## Known limitations

- **Energy filter** doesn't actually constrain results — Spotify deprecated
  the Audio Features endpoint in late 2024 and no free replacement exists.
  Pills remain in the UI as a future expansion point.
- **BPM coverage** depends on Deezer having tempo data for a given track.
  Many tracks return `null`; those pass through the filter and show the
  "↓ tap to detect" teaser, inviting you to tap the BPM yourself.
- **OAuth scope is `youtube`** (full read/write) so creating playlists works.
  An app in "Testing" OAuth status only lets test users sign in; for public
  use, the app would need OAuth verification from Google.
- **YouTube quota is not purchasable.** Higher limits require the
  [quota extension form](https://support.google.com/youtube/contact/yt_api_form).
