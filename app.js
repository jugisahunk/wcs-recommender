// ── External API config ────────────────────────────────────────────────────
const LASTFM_API_KEY = "894d3461c4f24e31be6b9b23b57b16e6";
const LASTFM_BASE    = "https://ws.audioscrobbler.com/2.0/";
const DEEZER_BASE    = "https://api.deezer.com";

// Map our internal genre IDs → Last.fm tag names.
const LASTFM_TAG_MAP = {
  motown:       "motown",
  rnb:          "rnb",
  "neo-soul":   "neo-soul",
  blues:        "blues",
  funk:         "funk",
  jazz:         "jazz",
  contemporary: "singer-songwriter",
  pop:          "pop",
  country:      "country",
  indie:        "indie",
};

// For the "All Genres" option we pull a mix of WCS-friendly tags.
const ALL_GENRES_TAGS = ["motown", "soul", "blues", "funk", "neo-soul", "rnb"];

// ── Persistence ────────────────────────────────────────────────────────────
let approvedSongs  = JSON.parse(localStorage.getItem("wcs_approved")     || "[]");
let disapprovedIds = new Set(JSON.parse(localStorage.getItem("wcs_disapproved") || "[]"));
let bpmOverrides   = JSON.parse(localStorage.getItem("wcs_bpm_overrides") || "{}");
// Cache of YouTube search results keyed by "artist|title" (lowercased).
// Value is the videoId string, or null if no match was found.
// Saves YouTube Data API quota — each cache hit avoids a 100-unit search call.
let ytSearchCache  = JSON.parse(localStorage.getItem("wcs_yt_cache") || "{}");

// Decode HTML entities returned by YouTube API (e.g. &#39; &amp;)
function decodeHtml(str) {
  if (!str) return str;
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
}

// Look up a known BPM for a videoId from our curated reference list.
// Returns null if the song isn't a known WCS curated track.
const CURATED_BPM_BY_ID = Object.freeze(
  Object.fromEntries((typeof CURATED_SONGS !== "undefined" ? CURATED_SONGS : []).map(s => [s.videoId, s.bpm]))
);
function getSongBpm(song) {
  return bpmOverrides[song.videoId] ?? song.bpm ?? CURATED_BPM_BY_ID[song.videoId] ?? null;
}

function setSongBpm(videoId, bpm) {
  if (bpm) bpmOverrides[videoId] = bpm;
  else delete bpmOverrides[videoId];
  localStorage.setItem("wcs_bpm_overrides", JSON.stringify(bpmOverrides));

  const approved = approvedSongs.find(s => s.videoId === videoId);
  if (approved) { approved.bpm = bpm; persist(); }

  // Update visible song cards (curated, search, approved)
  document.querySelectorAll(`.song-card[data-video-id="${videoId}"] .song-meta`).forEach(meta => {
    const existing = meta.querySelector(".bpm-tag");
    if (bpm) {
      if (existing) {
        existing.textContent = `${bpm} BPM`;
        existing.classList.remove("bpm-empty");
        existing.removeAttribute("title");
      } else {
        meta.insertAdjacentHTML("afterbegin", `<span class="bpm-tag">${bpm} BPM</span>`);
      }
    } else if (existing) {
      existing.textContent = "↓ tap to detect";
      existing.classList.add("bpm-empty");
      existing.title = "Play this song and tap the beat in the player to capture its BPM";
    }
  });

  // Update the player bar if this is the currently playing song
  if (state.currentSong?.videoId === videoId) {
    document.querySelector(".p-bpm").textContent = bpm ? `${bpm} BPM` : "";
  }
}
const YOUTUBE_OAUTH_CLIENT_ID = "869950477741-r543qe74sk7e1gj7m1f80iv991unbf9g.apps.googleusercontent.com";
let oauthToken = null;
let oauthClient = null;
// Cleanup legacy localStorage key from earlier versions
localStorage.removeItem("wcs_oauth_client_id");
localStorage.removeItem("wcs_yt_api_key");

function persist() {
  localStorage.setItem("wcs_approved",    JSON.stringify(approvedSongs));
  localStorage.setItem("wcs_disapproved", JSON.stringify([...disapprovedIds]));
}

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  tab: "curated",
  genre: "all",
  energy: "all",
  bpmMin: 85,
  bpmMax: 120,
  selectedForPlaylist: new Set(),
  currentSong: null,
  ytPlayer: null,
  recommendedSongs: null,
};

// ── YouTube IFrame API ─────────────────────────────────────────────────────
window.onYouTubeIframeAPIReady = () => {};

function createYTPlayer(videoId) {
  const playerEl = document.getElementById("yt-player");
  playerEl.innerHTML = "";
  const div = document.createElement("div");
  div.id = "yt-iframe-target";
  playerEl.appendChild(div);
  state.ytPlayer = new YT.Player("yt-iframe-target", {
    videoId,
    width: playerEl.offsetWidth || 280,
    height: playerEl.offsetHeight || 158,
    playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0 },
    events: {
      onReady: (e) => { e.target.unMute(); e.target.setVolume(100); e.target.playVideo(); },
    },
  });
}

// ── Playback ───────────────────────────────────────────────────────────────
function playSong(song) {
  state.currentSong = song;
  if (state.ytPlayer) {
    state.ytPlayer.loadVideoById(song.videoId);
    state.ytPlayer.unMute();
    state.ytPlayer.setVolume(100);
  } else {
    createYTPlayer(song.videoId);
  }
  showPlayerBar(song);
  updatePlayingCards();
}

function showPlayerBar(song) {
  document.getElementById("player-bar").classList.add("visible");
  document.querySelector(".p-title").textContent  = song.title;
  document.querySelector(".p-artist").textContent = song.artist;
  const knownBpm = getSongBpm(song);
  document.querySelector(".p-bpm").textContent    = knownBpm ? `${knownBpm} BPM` : "";
  document.getElementById("player-ytm-btn").href  = `https://music.youtube.com/watch?v=${song.videoId}`;
  resetTap();
}

// ── Tap-BPM detector ──────────────────────────────────────────────────────
// Click along to the beat; we record timestamps and compute BPM from the
// average interval between taps. After 2.5s of no taps we hold the value
// but the next tap starts fresh.
let tapTimestamps = [];
const TAP_RESET_MS = 2500;

function tapBeat() {
  const now = performance.now();
  if (tapTimestamps.length > 0 && now - tapTimestamps[tapTimestamps.length - 1] > TAP_RESET_MS) {
    tapTimestamps = [];
  }
  tapTimestamps.push(now);

  const pad = document.getElementById("tap-pad");
  pad.classList.remove("pulse");
  void pad.offsetWidth; // force reflow so the animation can restart
  pad.classList.add("pulse");

  renderTapDisplay();
}

function calcTapBpm() {
  if (tapTimestamps.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < tapTimestamps.length; i++) {
    intervals.push(tapTimestamps[i] - tapTimestamps[i - 1]);
  }
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return Math.round(60000 / avg);
}

function renderTapDisplay() {
  const bpm = calcTapBpm();
  const count = tapTimestamps.length;
  document.getElementById("tap-pad-bpm").textContent  = bpm ? `${bpm} BPM` : "— BPM";
  document.getElementById("tap-pad-hint").textContent =
    count === 0 ? "Tap to detect" : `${count} tap${count === 1 ? "" : "s"}`;
  document.getElementById("btn-tap-save").disabled = !(bpm && count >= 4 && state.currentSong);
}

function resetTap() {
  tapTimestamps = [];
  renderTapDisplay();
}

function saveTappedBpm() {
  if (!state.currentSong) return;
  const bpm = calcTapBpm();
  if (!bpm) return;
  const existing = getSongBpm(state.currentSong);
  if (existing && existing !== bpm) {
    const ok = window.confirm(
      `This song already has a BPM of ${existing}. Replace it with your tapped value of ${bpm}?`
    );
    if (!ok) return;
  }
  setSongBpm(state.currentSong.videoId, bpm);
  resetTap();
}

function closePlayer() {
  document.getElementById("player-bar").classList.remove("visible");
  if (state.ytPlayer?.stopVideo) state.ytPlayer.stopVideo();
  state.currentSong = null;
  updatePlayingCards();
}

function updatePlayingCards() {
  document.querySelectorAll(".song-card").forEach(c => {
    const playing = state.currentSong &&
      c.dataset.videoId === state.currentSong.videoId;
    c.classList.toggle("playing", playing);
    const btn = c.querySelector(".btn-play");
    if (btn) renderPlayBtn(btn, c.dataset.videoId === state.currentSong?.videoId);
  });
}

// ── Approve / Disapprove ───────────────────────────────────────────────────
function isApproved(song)    { return approvedSongs.some(s => s.videoId === song.videoId); }
function isDisapproved(song) { return disapprovedIds.has(song.videoId); }

function approveSong(song) {
  disapprovedIds.delete(song.videoId);
  if (!isApproved(song)) approvedSongs.push({ ...song });
  persist();
  updateApprovedCount();
  renderCuratedTab();
  if (state.tab === "approved") renderApprovedTab();
}

function disapproveSong(song) {
  disapprovedIds.add(song.videoId);
  approvedSongs = approvedSongs.filter(s => s.videoId !== song.videoId);
  state.selectedForPlaylist.delete(song.videoId);
  if (state.recommendedSongs) state.recommendedSongs = state.recommendedSongs.filter(s => s.videoId !== song.videoId);
  persist();
  updateApprovedCount();
  renderCuratedTab();
  if (state.tab === "approved") renderApprovedTab();
}

function updateApprovedCount() {
  const el = document.getElementById("approved-count");
  el.textContent = approvedSongs.length > 0 ? approvedSongs.length : "";
}

// ── Card rendering ─────────────────────────────────────────────────────────
const GENRE_LABELS = {
  blues: "Blues", rnb: "R&B", "neo-soul": "Neo-Soul",
  funk: "Funk", jazz: "Jazz", motown: "Motown",
  contemporary: "Contemporary", pop: "Pop",
  country: "Country", indie: "Indie",
};

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderPlayBtn(btn, isPlaying) {
  btn.innerHTML = isPlaying
    ? `<span class="playing-indicator"><span></span><span></span><span></span></span> Playing`
    : `▶ Play`;
}

function createSongCard(song, opts = {}) {
  // opts: { selectable, showApproveButtons }
  const approved    = isApproved(song);
  const selected    = state.selectedForPlaylist.has(song.videoId);
  const isPlaying   = state.currentSong?.videoId === song.videoId;

  const card = document.createElement("div");
  card.className = "song-card" +
    (isPlaying  ? " playing"  : "") +
    (selected   ? " selected" : "") +
    (opts.selectable ? " selectable" : "");
  card.dataset.videoId = song.videoId;

  const effectiveBpm = getSongBpm(song);
  const bpmHtml    = effectiveBpm
    ? `<span class="bpm-tag">${effectiveBpm} BPM</span>`
    : `<span class="bpm-tag bpm-empty" title="Play this song and tap the beat in the player to capture its BPM">↓ tap to detect</span>`;
  const genreHtml  = song.genre  ? `<span class="genre-tag">${GENRE_LABELS[song.genre] || song.genre}</span>` : "";
  const energyHtml = song.energy ? `<span class="energy-dot ${song.energy}"></span>` : "";
  const approvedBadge = (approved && !opts.selectable) ? `<span class="approved-badge">✓ Approved</span>` : "";

  const ytmUrl = `https://music.youtube.com/watch?v=${song.videoId}`;

  card.innerHTML = `
    <div class="song-card-header">
      ${opts.selectable ? `<div class="card-checkbox-wrap"><input type="checkbox" class="song-cb" ${selected ? "checked" : ""} data-id="${escHtml(song.videoId)}"></div>` : ""}
      <div class="song-info">
        <div class="title">${escHtml(song.title)}</div>
        <div class="artist">${escHtml(song.artist)}</div>
      </div>
      <div class="song-thumb-placeholder">🎵</div>
    </div>
    <div class="song-meta">${bpmHtml}${genreHtml}${energyHtml}${approvedBadge}</div>
    <div class="song-actions">
      <button class="btn-play"></button>
      <a class="btn-ytm" href="${ytmUrl}" target="_blank" rel="noopener" title="Open in YouTube Music">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.376 0 0 5.376 0 12s5.376 12 12 12 12-5.376 12-12S18.624 0 12 0zm0 19.104c-3.924 0-7.104-3.18-7.104-7.104S8.076 4.896 12 4.896s7.104 3.18 7.104 7.104-3.18 7.104-7.104 7.104zm0-13.332c-3.432 0-6.228 2.796-6.228 6.228S8.568 18.228 12 18.228s6.228-2.796 6.228-6.228S15.432 5.772 12 5.772zM9.684 15.54V8.46L16.2 12l-6.516 3.54z"/>
        </svg>
        YTM
      </a>
    </div>
    ${opts.showApproveButtons ? `
    <div class="song-vote">
      <button class="btn-approve ${approved ? "active" : ""}" title="Approve this song">
        ✓ Approve
      </button>
      ${!opts.approveOnly ? `<button class="btn-disapprove" title="Hide from recommendations">✕ Disapprove</button>` : ""}
    </div>` : `
    <div class="song-vote">
      <button class="btn-disapprove" title="Remove from approved list">
        ✕ Remove
      </button>
    </div>`}
  `;

  renderPlayBtn(card.querySelector(".btn-play"), isPlaying);

  // Play
  card.querySelector(".btn-play").addEventListener("click", (e) => {
    e.stopPropagation();
    playSong(song);
  });

  // Approve / disapprove
  if (opts.showApproveButtons) {
    card.querySelector(".btn-approve").addEventListener("click", (e) => {
      e.stopPropagation();
      if (isApproved(song)) {
        approvedSongs = approvedSongs.filter(s => s.videoId !== song.videoId);
        state.selectedForPlaylist.delete(song.videoId);
        persist();
        updateApprovedCount();
        if (!opts.approveOnly) renderCuratedTab();
        card.querySelector(".btn-approve").classList.remove("active");
      } else {
        approveSong(song);
        card.querySelector(".btn-approve").classList.add("active");
      }
    });
    if (!opts.approveOnly) {
      card.querySelector(".btn-disapprove").addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(`Hide "${song.title}" from recommendations?`)) disapproveSong(song);
      });
    }
  } else {
    // Approved tab — remove button
    card.querySelector(".btn-disapprove").addEventListener("click", (e) => {
      e.stopPropagation();
      approvedSongs = approvedSongs.filter(s => s.videoId !== song.videoId);
      state.selectedForPlaylist.delete(song.videoId);
      persist();
      updateApprovedCount();
      renderApprovedTab();
      renderCuratedTab();
      updateCreateBtn();
    });
  }

  // Checkbox (approved tab)
  if (opts.selectable) {
    const cb = card.querySelector(".song-cb");
    const toggle = () => {
      if (state.selectedForPlaylist.has(song.videoId)) {
        state.selectedForPlaylist.delete(song.videoId);
        card.classList.remove("selected");
        cb.checked = false;
      } else {
        state.selectedForPlaylist.add(song.videoId);
        card.classList.add("selected");
        cb.checked = true;
      }
      syncSelectAll();
      updateCreateBtn();
    };
    cb.addEventListener("change", (e) => { e.stopPropagation(); toggle(); });
    card.addEventListener("click", (e) => {
      if (e.target.closest(".btn-play, .btn-ytm, .btn-disapprove")) return;
      toggle();
    });
  }

  return card;
}

// ── Curated tab ────────────────────────────────────────────────────────────
// ── Curated tab — YTM search-driven ────────────────────────────────────────
// Title patterns that almost never represent real dance songs.
const NON_SONG_PATTERNS = [
  /backing\s*track/i,
  /karaoke/i,
  /jam\s*track/i,
  /jam\s*for/i,
  /no\s*(vocals?|bass|drums|guitar)/i,
  /\blesson\b/i,
  /tutorial/i,
  /instructional/i,
  /how\s+to/i,
  /reaction/i,
  /\bmix\s*(set|tape)\b/i,
  /\b(1|one)\s*hour\b/i,
  /\bnightcore\b/i,
  /\bsped\s*up\b/i,
  /\bslowed\b/i,
  /【[^】]*】/,                      // CJK brackets — common backing-track signal
  /\b(G|A|B|C|D|E|F)#?\s+(major|minor)\b.*\d+\s*bpm/i, // "G major 127bpm" pattern
];

function isLikelyDanceSong(item) {
  const title = item.snippet?.title || "";
  return !NON_SONG_PATTERNS.some(p => p.test(title));
}

function markFiltersPending() {
  document.querySelector(".btn-refresh")?.classList.add("pending");
}

// Step 1 — Pull top tracks by genre tag from Last.fm.
async function fetchLastFmTopTracks(tag, limit = 30) {
  const url = `${LASTFM_BASE}?method=tag.gettoptracks&tag=${encodeURIComponent(tag)}&api_key=${LASTFM_API_KEY}&format=json&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data?.error) throw new Error(`Last.fm: ${data.message || "request failed"}`);
  return (data?.tracks?.track || []).map(t => ({
    artist: t.artist?.name || "",
    title: t.name || "",
  })).filter(t => t.artist && t.title);
}

async function fetchCandidates(genre) {
  if (genre === "all") {
    // Combine top tracks from a mix of WCS-friendly tags.
    const lists = await Promise.all(ALL_GENRES_TAGS.map(t =>
      fetchLastFmTopTracks(t, 10).catch(() => [])
    ));
    // Dedupe by artist+title
    const seen = new Set();
    const merged = [];
    for (const list of lists) {
      for (const t of list) {
        const key = `${t.artist}|${t.title}`.toLowerCase();
        if (!seen.has(key)) { seen.add(key); merged.push(t); }
      }
    }
    return merged.sort(() => Math.random() - 0.5);
  }
  const tag = LASTFM_TAG_MAP[genre] || genre;
  return fetchLastFmTopTracks(tag, 30);
}

// Deezer's API doesn't set CORS headers but does support JSONP via
// `output=jsonp&callback=...`. We inject a <script> tag and wait for the
// callback. Each call gets a unique callback name to avoid collisions.
let _jsonpCounter = 0;
function jsonp(url) {
  return new Promise((resolve, reject) => {
    const cb = `_wcs_jsonp_${Date.now()}_${++_jsonpCounter}`;
    const script = document.createElement("script");
    const cleanup = () => { delete window[cb]; script.remove(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("JSONP timeout")); }, 8000);
    window[cb] = (data) => { clearTimeout(timer); cleanup(); resolve(data); };
    script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error("JSONP load error")); };
    const sep = url.includes("?") ? "&" : "?";
    script.src = `${url}${sep}output=jsonp&callback=${cb}`;
    document.head.appendChild(script);
  });
}

// BPM detection algorithms often report double or half time. WCS dance
// tempos sit in 60–140 BPM, so squeeze extremes into that band.
function normalizeBpm(bpm) {
  if (!bpm || bpm <= 0) return null;
  let n = Math.round(bpm);
  if (n > 160) n = Math.round(n / 2);   // double-time → halve
  if (n < 50)  n = Math.round(n * 2);   // half-time → double
  return n;
}

// Step 2 — Look up BPM via Deezer's free public API. Returns null if not found.
async function lookupDeezerBpm(artist, title) {
  try {
    const q = `artist:"${artist}" track:"${title}"`;
    const search = await jsonp(`${DEEZER_BASE}/search?q=${encodeURIComponent(q)}&limit=1`);
    const trackId = search?.data?.[0]?.id;
    if (!trackId) return null;
    const detail = await jsonp(`${DEEZER_BASE}/track/${trackId}`);
    return normalizeBpm(detail?.bpm);
  } catch (_) {
    return null;
  }
}

function ytCacheKey(artist, title) {
  return `${artist}|${title}`.toLowerCase().trim();
}

function persistYtCache() {
  localStorage.setItem("wcs_yt_cache", JSON.stringify(ytSearchCache));
}

// ── Cache pre-warming via Piped (no YouTube Data API quota) ───────────────
// Piped is an open-source YouTube frontend. Its public API returns videoIds
// for search queries without any auth or API key. We use it ONLY to populate
// the YT cache — actual playback still uses YouTube's embed player.
//
// Call from the browser console: warmCache()
// Optional first arg = max tracks per genre (default 30).
const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.leptons.xyz",
  "https://piped-api.privacy.com.de",
  "https://pipedapi.darkness.services",
  "https://api.piped.private.coffee",
  "https://pipedapi.owo.si",
  "https://pipedapi.drgns.space",
  "https://pipedapi.adminforge.de",
];

async function pipedFindVideoId(artist, title) {
  const q = `${artist} ${title}`;
  for (const base of PIPED_INSTANCES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=music_songs`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      const first = (data.items || []).find(it => /\/watch\?v=([A-Za-z0-9_-]{11})/.test(it.url || ""));
      if (!first) continue;
      const m = first.url.match(/\/watch\?v=([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    } catch (_) { /* try next instance */ }
  }
  return null;
}

async function warmCache(perGenre = 30) {
  const allTags = state.genre === "all"
    ? Object.keys(LASTFM_TAG_MAP)
    : Object.keys(LASTFM_TAG_MAP);
  console.log(`[warmCache] Starting pre-warm across ${allTags.length} genres, ${perGenre} tracks each…`);

  let total = 0, hits = 0, misses = 0, skipped = 0;
  for (const genreId of allTags) {
    const tag = LASTFM_TAG_MAP[genreId];
    let candidates;
    try {
      candidates = await fetchLastFmTopTracks(tag, perGenre);
    } catch (e) {
      console.warn(`[warmCache] Last.fm failed for ${tag}:`, e.message);
      continue;
    }
    console.log(`[warmCache] ${tag}: ${candidates.length} candidates from Last.fm`);

    for (const c of candidates) {
      total++;
      const key = ytCacheKey(c.artist, c.title);
      if (key in ytSearchCache) { skipped++; continue; }
      const videoId = await pipedFindVideoId(c.artist, c.title);
      ytSearchCache[key] = videoId;
      if (videoId) hits++; else misses++;
      // Throttle a bit so we don't hammer Piped
      await new Promise(r => setTimeout(r, 80));
    }
    persistYtCache();
    console.log(`[warmCache] ${tag} done. Running totals — hits:${hits} misses:${misses} skipped:${skipped}`);
  }

  console.log(`[warmCache] Complete. Total looked-at: ${total}, hits: ${hits}, misses: ${misses}, skipped (already cached): ${skipped}`);
  console.log(`[warmCache] Cache size is now ${Object.keys(ytSearchCache).length} entries.`);
  return { total, hits, misses, skipped, cacheSize: Object.keys(ytSearchCache).length };
}

// Expose globally so it's reachable from the browser console.
window.warmCache = warmCache;

// ── YTM playlist import (no YouTube Data API) ─────────────────────────────
// Accepts a YouTube/YTM playlist URL (or raw ID) and fetches its tracks via
// Piped, dropping each into the Approved list. Zero YT Data API quota used.
function extractPlaylistId(input) {
  if (!input) return null;
  const s = input.trim();
  const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

async function fetchPipedPlaylist(playlistId) {
  for (const base of PIPED_INSTANCES) {
    const host = base.replace("https://", "");
    setImportStatus(`Trying ${host}…`);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(`${base}/playlists/${encodeURIComponent(playlistId)}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        setImportStatus(`${host} → HTTP ${res.status}, trying next…`);
        continue;
      }
      const data = await res.json();
      if (data?.relatedStreams) return data;
      setImportStatus(`${host} → unexpected response, trying next…`);
    } catch (e) {
      setImportStatus(`${host} → ${e.name === "AbortError" ? "timed out" : "unreachable"}, trying next…`);
    }
  }
  return null;
}

function setImportStatus(msg, kind) {
  const el = document.getElementById("import-status");
  el.textContent = msg || "";
  el.className = "approved-bar-status" + (kind ? ` ${kind}` : "");
}

async function importYtmPlaylist() {
  const input = document.getElementById("import-playlist-input");
  const btn = document.getElementById("btn-import-playlist");

  const playlistId = extractPlaylistId(input.value);
  if (!playlistId) {
    setImportStatus("Couldn't find a playlist ID in that input.", "error");
    return;
  }

  btn.disabled = true;
  setImportStatus("Fetching playlist via Piped…");

  const data = await fetchPipedPlaylist(playlistId);
  if (!data) {
    setImportStatus("Couldn't fetch playlist — Piped instances may be unreachable or the playlist is private.", "error");
    btn.disabled = false;
    return;
  }

  const tracks = (data.relatedStreams || []).map(s => {
    const m = (s.url || "").match(/\/watch\?v=([A-Za-z0-9_-]{11})/);
    if (!m) return null;
    return {
      videoId: m[1],
      title: s.title || "Untitled",
      artist: s.uploaderName || "Unknown",
    };
  }).filter(Boolean);

  let added = 0, skipped = 0, disapproved = 0;
  for (const track of tracks) {
    if (isDisapproved(track))    { disapproved++; continue; }
    if (isApproved(track))       { skipped++;     continue; }
    approvedSongs.push(track);
    added++;
  }

  persist();
  updateApprovedCount();
  renderApprovedTab();

  const name = data.name ? `"${data.name}"` : "the playlist";
  const parts = [`Imported ${added} song${added === 1 ? "" : "s"} from ${name}`];
  if (skipped)     parts.push(`${skipped} already approved`);
  if (disapproved) parts.push(`${disapproved} skipped (disapproved)`);
  setImportStatus(parts.join(" · "), added > 0 ? "success" : "");
  input.value = "";
  btn.disabled = false;
}

// Step 3 — Find the YouTube video that matches a known track. Returns videoId or null.
// Cached forever in localStorage to save API quota (100 units per uncached lookup).
async function findYouTubeVideo(artist, title, token) {
  const key = ytCacheKey(artist, title);
  if (key in ytSearchCache) return ytSearchCache[key];

  try {
    const q = `${artist} ${title}`;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&videoCategoryId=10&maxResults=1`;
    const res = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
    const data = await res.json();
    if (data.error) {
      if (data.error.code === 401) oauthToken = null;
      throw new Error(data.error.message);
    }
    const item = (data.items || []).find(it => isLikelyDanceSong(it));
    const videoId = item?.id?.videoId || null;
    ytSearchCache[key] = videoId;
    persistYtCache();
    return videoId;
  } catch (_) {
    // Don't cache errors — let the next attempt retry
    return null;
  }
}

const MAX_YT_LOOKUPS = 10;        // cap YouTube searches per refresh (quota)
const TARGET_DISPLAY  = 12;       // cards to show

async function fetchRecommendations(token) {
  document.querySelector(".btn-refresh")?.classList.remove("pending");
  const container = document.getElementById("tab-curated");
  const setStatus = (msg) => {
    container.innerHTML = `<div class="state-message"><div class="icon">🔍</div><p>${escHtml(msg)}</p></div>`;
  };

  try {
    setStatus(state.genre === "all"
      ? "Finding popular WCS-friendly tracks…"
      : `Finding popular ${state.genre} tracks…`);
    const candidates = await fetchCandidates(state.genre);
    if (candidates.length === 0) {
      container.innerHTML = `<div class="state-message"><p>No tracks found for this genre.</p></div>`;
      return;
    }

    setStatus(`Checking BPM data for ${candidates.length} tracks…`);
    const withBpm = await Promise.all(candidates.map(async c => ({
      ...c,
      bpm: await lookupDeezerBpm(c.artist, c.title),
    })));

    // Filter by BPM range. Tracks with unknown BPM pass through (better to
    // show too many than too few — user can disapprove duds).
    const inRange = withBpm.filter(c =>
      c.bpm === null || (c.bpm >= state.bpmMin && c.bpm <= state.bpmMax)
    );

    // Skip ones the user already approved or disapproved.
    const fresh = inRange.filter(c => {
      const candidateKey = `${c.artist}|${c.title}`.toLowerCase();
      if (approvedSongs.some(s => `${s.artist}|${s.title}`.toLowerCase() === candidateKey)) return false;
      // We can't know videoId yet for disapproved; will re-check after YT lookup
      return true;
    });

    const toLookup = fresh.slice(0, MAX_YT_LOOKUPS);
    if (toLookup.length === 0) {
      container.innerHTML = `<div class="state-message"><p>No tracks matched your BPM range. Try widening it and refresh.</p></div>`;
      return;
    }

    setStatus(`Looking up ${toLookup.length} on YouTube…`);
    const ytResults = await Promise.all(toLookup.map(async c => {
      const videoId = await findYouTubeVideo(c.artist, c.title, token);
      if (!videoId) return null;
      return { title: c.title, artist: c.artist, videoId, bpm: c.bpm };
    }));

    state.recommendedSongs = ytResults
      .filter(Boolean)
      .filter(s => !isDisapproved(s) && !isApproved(s))
      .slice(0, TARGET_DISPLAY);

    renderCuratedTab();
  } catch (e) {
    container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ ${escHtml(e.message || "Failed to load recommendations.")}</p></div>`;
  }
}

function refreshRecommendations() {
  if (oauthToken) { fetchRecommendations(oauthToken); return; }
  triggerOAuth(
    (token) => fetchRecommendations(token),
    () => {
      document.getElementById("tab-curated").innerHTML =
        `<div class="state-message"><p class="error-msg">⚠ Sign-in failed or was cancelled. Click Refresh to try again.</p></div>`;
      document.querySelector(".btn-refresh")?.classList.add("pending");
    }
  );
}

function renderCuratedTab() {
  const container = document.getElementById("tab-curated");
  container.innerHTML = "";

  if (!oauthToken) {
    container.innerHTML = `
      <div class="search-setup">
        <div class="setup-icon">🎵</div>
        <p>Sign in with your Google account to get YouTube song recommendations.</p>
        <button class="btn-google-signin" id="btn-google-signin">
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
            <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>
      </div>`;
    document.getElementById("btn-google-signin").addEventListener("click", () => {
      triggerOAuth(
        () => fetchRecommendations(oauthToken),
        (err) => {
          container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ Sign-in failed: ${escHtml(String(err))}</p><p>Make sure <code>${location.origin}</code> is in this OAuth client's Authorized JavaScript origins, and that your Google account is in the app's test users list.</p></div>`;
        }
      );
    });
    return;
  }

  const songs = state.recommendedSongs;
  const header = document.createElement("div");
  header.className = "section-header";
  header.innerHTML = `<h2>Curated WCS Songs</h2>${songs ? `<span class="count-badge">${songs.length} songs</span>` : ""}`;
  const refreshBtn = document.createElement("button");
  refreshBtn.className = "btn-refresh" + (songs === null ? " pending" : "");
  refreshBtn.innerHTML = songs === null ? "&#8635; Get Recommendations" : "&#8635; Refresh";
  refreshBtn.addEventListener("click", refreshRecommendations);
  header.appendChild(refreshBtn);
  container.appendChild(header);

  if (songs === null) {
    container.insertAdjacentHTML("beforeend", `
      <div class="state-message">
        <div class="icon">🎵</div>
        <p>Set your filters above, then click <strong>Get Recommendations</strong>.</p>
      </div>`);
    return;
  }

  if (songs.length === 0) {
    container.insertAdjacentHTML("beforeend", `
      <div class="state-message">
        <div class="icon">🎵</div>
        <p>No results. Try adjusting your filters and refreshing.</p>
      </div>`);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "song-grid";
  songs.forEach(s => grid.appendChild(createSongCard(s, { showApproveButtons: true })));
  container.appendChild(grid);
}

// ── Approved tab ───────────────────────────────────────────────────────────
function renderApprovedTab() {
  const container = document.getElementById("tab-approved");
  container.innerHTML = "";

  if (approvedSongs.length === 0) {
    container.innerHTML = `
      <div class="state-message">
        <div class="icon">✓</div>
        <p>No approved songs yet.<br>
        Browse the <strong>Curated Songs</strong> tab and click <strong>✓ Approve</strong> on songs you like.</p>
      </div>`;
    updateCreateBtn();
    return;
  }

  const header = document.createElement("div");
  header.className = "section-header";
  header.innerHTML = `<h2>Approved Songs</h2><span class="count-badge">${approvedSongs.length} songs</span>`;
  container.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "song-grid";
  approvedSongs.forEach(s => grid.appendChild(createSongCard(s, { selectable: true })));
  container.appendChild(grid);

  syncSelectAll();
  updateCreateBtn();
}

function syncSelectAll() {
  const cb = document.getElementById("select-all-cb");
  if (!cb) return;
  const all = approvedSongs.length > 0 &&
    approvedSongs.every(s => state.selectedForPlaylist.has(s.videoId));
  cb.checked = all;
  cb.indeterminate = !all && state.selectedForPlaylist.size > 0;
}

function updateCreateBtn() {
  const btn = document.getElementById("btn-create-playlist");
  if (!btn) return;
  const n = state.selectedForPlaylist.size;
  btn.disabled = n === 0;
  btn.textContent = n > 0
    ? `▶ Create YouTube Playlist (${n} song${n > 1 ? "s" : ""})`
    : "▶ Create YouTube Playlist";
}

// ── Search tab ─────────────────────────────────────────────────────────────
function renderSearchTab() {
  const container = document.getElementById("tab-search");
  container.innerHTML = `
    <div class="state-message">
      <div class="icon">🔍</div>
      <p>Search for an artist, song, or style above.<br>
      ${oauthToken ? '<span class="signed-in-note">✓ Signed in to YouTube</span>' : 'You\'ll be prompted to sign in on first search.'}</p>
    </div>`;
}

// Reusable token client. The callback fires for both popup and silent requests.
function getOAuthClient() {
  if (oauthClient) return oauthClient;
  if (typeof google === "undefined" || !google.accounts?.oauth2) return null;
  oauthClient = google.accounts.oauth2.initTokenClient({
    client_id: YOUTUBE_OAUTH_CLIENT_ID,
    scope: "https://www.googleapis.com/auth/youtube",
    callback: (resp) => {
      const cb = oauthClient._pending;
      oauthClient._pending = null;
      if (resp.error) {
        oauthToken = null;
        if (cb?.fail) cb.fail(resp.error);
      } else {
        oauthToken = resp.access_token;
        if (cb?.success) cb.success(resp.access_token);
      }
    },
  });
  return oauthClient;
}

// For visible sign-in: MUST be called synchronously from a click handler.
function triggerOAuth(onSuccess, onFail) {
  const client = getOAuthClient();
  if (!client) { if (onFail) onFail("gis_not_loaded"); return; }
  client._pending = { success: onSuccess, fail: onFail };
  client.requestAccessToken();
}

// Silent token request — no popup, no UI. Only succeeds if user is signed in
// to Google and has previously authorized the app.
function trySilentAuth(onSuccess, onFail) {
  const client = getOAuthClient();
  if (!client) { if (onFail) onFail("gis_not_loaded"); return; }
  client._pending = { success: onSuccess, fail: onFail };
  client.requestAccessToken({ prompt: "none" });
}

async function fetchSearch(token, q) {
  const container = document.getElementById("tab-search");
  container.innerHTML = `<div class="state-message"><div class="icon">🔍</div><p>Searching…</p></div>`;
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&videoCategoryId=10&maxResults=6`,
      { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.error) {
      if (data.error.code === 401) oauthToken = null;
      container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ ${escHtml(data.error.message)}</p></div>`;
      return;
    }
    renderSearchResults((data.items || []).map(item => ({
      title: decodeHtml(item.snippet.title),
      artist: decodeHtml(item.snippet.channelTitle),
      videoId: item.id.videoId,
    })), q);
  } catch (e) {
    oauthToken = null;
    container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ ${escHtml(e.message) || "Search failed."}</p></div>`;
  }
}

function doSearch() {
  const q = document.getElementById("search-input").value.trim();
  if (!q) return;
  if (oauthToken) { fetchSearch(oauthToken, q); return; }
  triggerOAuth(
    (token) => fetchSearch(token, q),
    () => {
      document.getElementById("tab-search").innerHTML =
        `<div class="state-message"><p class="error-msg">⚠ Sign-in failed or was cancelled.</p></div>`;
    }
  );
}

function renderSearchResults(songs, query) {
  const container = document.getElementById("tab-search");
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "section-header";
  header.innerHTML = `<h2>${query ? `Results for &ldquo;${escHtml(query)}&rdquo;` : "Added Song"}</h2><span class="count-badge">${songs.length}</span>`;
  container.appendChild(header);

  if (songs.length === 0) {
    container.insertAdjacentHTML("beforeend", `<div class="state-message"><p>No results found.</p></div>`);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "song-grid";
  songs.forEach(s => grid.appendChild(createSongCard(s, { showApproveButtons: true, approveOnly: true })));
  container.appendChild(grid);
}

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab));

  document.getElementById("tab-curated").style.display  = tab === "curated"  ? "" : "none";
  document.getElementById("tab-approved").style.display = tab === "approved" ? "" : "none";
  document.getElementById("tab-search").style.display   = tab === "search"   ? "" : "none";

  document.getElementById("filters-row").style.display   = tab === "curated"  ? "" : "none";
  document.getElementById("approved-bar").style.display  = tab === "approved" ? "flex" : "none";
  document.getElementById("search-bar-row").style.display = tab === "search"  ? "" : "none";

  if (tab === "search")   renderSearchTab();
  if (tab === "approved") renderApprovedTab();
}

// ── YouTube Playlist creation ──────────────────────────────────────────────
function createPlaylist() {
  const selected = approvedSongs.filter(s => state.selectedForPlaylist.has(s.videoId));
  if (selected.length === 0) return;

  const btn = document.getElementById("btn-create-playlist");
  btn.disabled = true;
  btn.textContent = "Connecting…";

  const proceed = (token) => doCreatePlaylist(token, selected, btn);
  const onFail = (err) => {
    alert("Google sign-in failed: " + err);
    updateCreateBtn();
  };

  if (oauthToken) { proceed(oauthToken); return; }
  triggerOAuth(proceed, onFail);
}

async function doCreatePlaylist(token, selected, btn) {
  btn.textContent = "Creating playlist…";

  try {
    // Create playlist
    const plRes = await fetch(
      "https://www.googleapis.com/youtube/v3/playlists?part=snippet,status",
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          snippet: {
            title: `WCS Mix — ${new Date().toLocaleDateString()}`,
            description: "West Coast Swing playlist created by WCS Song Recommender",
          },
          status: { privacyStatus: "private" },
        }),
      }
    ).then(r => r.json());

    if (!plRes.id) throw new Error(plRes.error?.message || "Playlist creation failed");

    // Add videos sequentially
    for (const song of selected) {
      await fetch(
        "https://www.googleapis.com/youtube/v3/playlistItems?part=snippet",
        {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            snippet: {
              playlistId: plRes.id,
              resourceId: { kind: "youtube#video", videoId: song.videoId },
            },
          }),
        }
      );
    }

    const ytmUrl = `https://music.youtube.com/playlist?list=${plRes.id}`;
    showPlaylistToast(`Playlist created with ${selected.length} songs!`, ytmUrl);
  } catch (err) {
    alert("Failed to create playlist: " + err.message);
  } finally {
    updateCreateBtn();
  }
}

function showPlaylistToast(msg, url) {
  const toast = document.getElementById("playlist-toast");
  document.getElementById("playlist-toast-msg").textContent = msg;
  const link = document.getElementById("playlist-toast-link");
  link.href = url;
  link.textContent = "Open in YouTube Music ↗";
  toast.style.display = "flex";
}

// ── BPM dual slider ────────────────────────────────────────────────────────
function updateBpmTrack() {
  const lo = 60, hi = 180, span = hi - lo;
  const leftPct  = ((state.bpmMin - lo) / span) * 100;
  const widthPct = ((state.bpmMax - state.bpmMin) / span) * 100;
  document.getElementById("bpm-track-fill").style.left  = `${leftPct}%`;
  document.getElementById("bpm-track-fill").style.width = `${widthPct}%`;
  document.getElementById("bpm-range-label").textContent = `${state.bpmMin} – ${state.bpmMax}`;
}

// ── Event wiring ───────────────────────────────────────────────────────────
function wire() {
  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

  // Filters — update state only; Refresh applies them
  document.getElementById("filter-genre").addEventListener("change", e => {
    state.genre = e.target.value;
    markFiltersPending();
  });

  document.querySelectorAll(".pill[data-energy]").forEach(pill => {
    pill.addEventListener("click", () => {
      const val = pill.dataset.energy;
      state.energy = state.energy === val ? "all" : val;
      document.querySelectorAll(".pill[data-energy]").forEach(p =>
        p.classList.toggle("active", p.dataset.energy === state.energy));
      markFiltersPending();
    });
  });

  const bpmMin = document.getElementById("bpm-min");
  const bpmMax = document.getElementById("bpm-max");
  bpmMin.addEventListener("input", () => {
    state.bpmMin = Math.min(+bpmMin.value, state.bpmMax - 5);
    bpmMin.value = state.bpmMin;
    updateBpmTrack();
    markFiltersPending();
  });
  bpmMax.addEventListener("input", () => {
    state.bpmMax = Math.max(+bpmMax.value, state.bpmMin + 5);
    bpmMax.value = state.bpmMax;
    updateBpmTrack();
    markFiltersPending();
  });
  updateBpmTrack();

  // Search
  document.getElementById("btn-search").addEventListener("click", doSearch);
  document.getElementById("search-input").addEventListener("keydown", e => {
    if (e.key === "Enter") doSearch();
  });

  // Player close
  document.getElementById("btn-close-player").addEventListener("click", closePlayer);

  // Tap-BPM detector
  document.getElementById("tap-pad").addEventListener("click", tapBeat);
  document.getElementById("btn-tap-reset").addEventListener("click", resetTap);
  document.getElementById("btn-tap-save").addEventListener("click", saveTappedBpm);
  // Allow Space/Enter on the pad
  document.getElementById("tap-pad").addEventListener("keydown", e => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); tapBeat(); }
  });

  // Approved bar
  document.getElementById("select-all-cb").addEventListener("change", (e) => {
    if (e.target.checked) {
      approvedSongs.forEach(s => state.selectedForPlaylist.add(s.videoId));
    } else {
      state.selectedForPlaylist.clear();
    }
    renderApprovedTab();
  });

  document.getElementById("btn-create-playlist").addEventListener("click", createPlaylist);

  // YTM playlist import
  document.getElementById("btn-import-playlist").addEventListener("click", importYtmPlaylist);
  document.getElementById("import-playlist-input").addEventListener("keydown", e => {
    if (e.key === "Enter") importYtmPlaylist();
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  const sel = document.getElementById("filter-genre");
  GENRES.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.label;
    sel.appendChild(opt);
  });

  updateApprovedCount();
  wire();
  renderCuratedTab();
  switchTab("curated");

  // Try silent auth — if the user is signed in to Google and has previously
  // authorized this app, we get a token without any UI. GIS may not be loaded
  // yet, so retry briefly until it is.
  let attempts = 0;
  const trySilent = () => {
    if (typeof google !== "undefined" && google.accounts?.oauth2) {
      trySilentAuth(
        () => { renderCuratedTab(); renderSearchTab(); },
        () => { /* silent failure is expected for first-time users */ }
      );
    } else if (attempts++ < 20) {
      setTimeout(trySilent, 150);
    }
  };
  trySilent();
}

document.addEventListener("DOMContentLoaded", init);
