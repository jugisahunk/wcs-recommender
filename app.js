// ── External API config ────────────────────────────────────────────────────
const LASTFM_API_KEY = "894d3461c4f24e31be6b9b23b57b16e6";
const LASTFM_BASE    = "https://ws.audioscrobbler.com/2.0/";
const DEEZER_BASE    = "https://api.deezer.com";

// ── Spotify config ──────────────────────────────────────────────────────────
const SPOTIFY_CLIENT_ID    = "00ad45138ac64dfe8529b1eb0d840672";
const SPOTIFY_REDIRECT_URI = "https://jugisahunk.github.io/wcs-recommender/";
const SPOTIFY_SCOPES       = "streaming user-read-email user-read-private user-modify-playback-state playlist-modify-private playlist-modify-public playlist-read-private";

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
const ALL_GENRES_TAGS = [
  "motown", "soul", "rnb", "neo-soul", "funk", "blues",
  "jazz", "pop", "country", "indie", "singer-songwriter",
];

// ── Persistence ────────────────────────────────────────────────────────────
let approvedSongs  = JSON.parse(localStorage.getItem("wcs_approved")      || "[]");
let disapprovedIds = new Set(JSON.parse(localStorage.getItem("wcs_disapproved") || "[]"));
let bpmOverrides   = JSON.parse(localStorage.getItem("wcs_bpm_overrides") || "{}");
// Spotify track-URI cache keyed by "artist|title" (lowercased).
let spotifyCache   = JSON.parse(localStorage.getItem("wcs_spotify_cache") || "{}");

function persistSpotifyCache() {
  localStorage.setItem("wcs_spotify_cache", JSON.stringify(spotifyCache));
}

function persist() {
  localStorage.setItem("wcs_approved",    JSON.stringify(approvedSongs));
  localStorage.setItem("wcs_disapproved", JSON.stringify([...disapprovedIds]));
}

// Look up a known BPM for a videoId from our curated reference list.
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

  if (state.currentSong?.videoId === videoId) {
    document.querySelector(".p-bpm").textContent = bpm ? `${bpm} BPM` : "";
  }
}

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  tab: "curated",
  genre: "all",
  bpmMin: 85,
  bpmMax: 120,
  selectedForPlaylist: new Set(),
  currentSong: null,
  ytPlayer: null,
  recommendedSongs: null,
};

// ── Spotify runtime state ──────────────────────────────────────────────────
let spotifyDeviceId    = null;
let spotifyPlayer      = null;
let _progressInterval  = null;   // setInterval handle for progress polling
let _isDragging        = false;  // true while user is scrubbing the slider

// ── YouTube IFrame API (kept as silent fallback for legacy approved songs) ──
window.onYouTubeIframeAPIReady = () => {};

function createYTPlayer(videoId) {
  if (state.ytPlayer?.destroy) {
    try { state.ytPlayer.destroy(); } catch (_) {}
  }
  state.ytPlayer = null;

  const playerEl = document.getElementById("yt-player");
  playerEl.innerHTML = "";
  const div = document.createElement("div");
  div.id = "yt-iframe-target";
  playerEl.appendChild(div);
  state.ytPlayer = new YT.Player("yt-iframe-target", {
    videoId,
    width: playerEl.offsetWidth || 280,
    height: playerEl.offsetHeight || 158,
    playerVars: { autoplay: 1, controls: 1, modestbranding: 1, rel: 0, origin: location.origin },
    events: {
      onReady: (e) => { e.target.unMute(); e.target.setVolume(100); e.target.playVideo(); },
    },
  });
}

// ── Playback ───────────────────────────────────────────────────────────────
async function playSong(song) {
  state.currentSong = song;

  const ytEl = document.getElementById("yt-player");
  const spEl = document.getElementById("spotify-now-playing");

  // Always try Spotify first when the SDK player is ready.
  if (spotifyDeviceId) {
    const ok = await playSpotify(song);
    if (ok) {
      if (state.ytPlayer?.destroy) { try { state.ytPlayer.destroy(); } catch (_) {} state.ytPlayer = null; }
      if (ytEl) ytEl.style.display = "none";
      if (spEl) spEl.style.display = "flex";
      updatePlayPauseBtn(false); // playing
      showPlayerBar(song);
      // Enable progress slider and begin polling
      const sl = document.getElementById("progress-slider");
      if (sl) sl.disabled = false;
      startProgressPolling();
      updatePlayingCards();
      return;
    }
  }

  // Fallback: YouTube IFrame for legacy approved songs that carry a real video ID.
  // New songs sourced via Spotify have a spotify:track:… URI — those can't use YT.
  const vid = song.videoId;
  if (vid && !vid.startsWith("spotify:")) {
    if (ytEl) ytEl.style.display = "";
    if (spEl) spEl.style.display = "none";
    createYTPlayer(vid);
    showPlayerBar(song);
    updatePlayingCards();
    return;
  }

  // Nothing worked — show player bar with an informative message
  showPlayerBar(song);
  const reason = !isSpotifyConnected()
    ? " — connect Spotify to play"
    : !spotifyDeviceId
      ? " — Spotify is connecting…"
      : " — not found on Spotify";
  document.querySelector(".p-title").textContent = song.title + reason;
  updatePlayingCards();
}

// ── Spotify open-link helper ───────────────────────────────────────────────
function getSpotifyOpenUrl(song) {
  const uri = song.videoId;
  if (uri?.startsWith("spotify:track:")) {
    return `https://open.spotify.com/track/${uri.split(":")[2]}`;
  }
  // Legacy or unresolved: fall back to a Spotify search for the artist+title
  return `https://open.spotify.com/search/${encodeURIComponent(`${song.artist} ${song.title}`.trim())}`;
}

function showPlayerBar(song) {
  document.getElementById("player-bar").classList.add("visible");
  document.querySelector(".p-title").textContent  = song.title;
  document.querySelector(".p-artist").textContent = song.artist;
  const knownBpm = getSongBpm(song);
  document.querySelector(".p-bpm").textContent    = knownBpm ? `${knownBpm} BPM` : "";
  const spBtn = document.getElementById("player-spotify-btn");
  if (spBtn) spBtn.href = getSpotifyOpenUrl(song);
  resetTap();
}

// ── Tap-BPM detector ──────────────────────────────────────────────────────
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
  void pad.offsetWidth;
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
  if (spotifyPlayer) spotifyPlayer.pause().catch(() => {});
  if (state.ytPlayer?.stopVideo) state.ytPlayer.stopVideo();
  stopProgressPolling();
  resetProgressBar();
  updatePlayPauseBtn(true); // reset to ▶ for next open
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
  const approved  = isApproved(song);
  const selected  = state.selectedForPlaylist.has(song.videoId);
  const isPlaying = state.currentSong?.videoId === song.videoId;

  const card = document.createElement("div");
  card.className = "song-card" +
    (isPlaying  ? " playing"  : "") +
    (selected   ? " selected" : "") +
    (opts.selectable ? " selectable" : "");
  card.dataset.videoId = song.videoId;

  const effectiveBpm = getSongBpm(song);
  const bpmHtml  = effectiveBpm
    ? `<span class="bpm-tag">${effectiveBpm} BPM</span>`
    : `<span class="bpm-tag bpm-empty" title="Play this song and tap the beat in the player to capture its BPM">↓ tap to detect</span>`;
  const genreHtml   = song.genre  ? `<span class="genre-tag">${GENRE_LABELS[song.genre] || song.genre}</span>` : "";
  const approvedBadge = (approved && !opts.selectable) ? `<span class="approved-badge">✓ Approved</span>` : "";
  const spUrl = escHtml(getSpotifyOpenUrl(song));

  card.innerHTML = `
    <div class="song-card-header">
      ${opts.selectable ? `<div class="card-checkbox-wrap"><input type="checkbox" class="song-cb" ${selected ? "checked" : ""} data-id="${escHtml(song.videoId)}"></div>` : ""}
      <div class="song-info">
        <div class="title">${escHtml(song.title)}</div>
        <div class="artist">${escHtml(song.artist)}</div>
      </div>
      <div class="song-thumb-placeholder">🎵</div>
    </div>
    <div class="song-meta">${bpmHtml}${genreHtml}${approvedBadge}</div>
    <div class="song-actions">
      <button class="btn-play"></button>
      <a class="btn-sp-link" href="${spUrl}" target="_blank" rel="noopener" title="Open in Spotify">
        <svg width="13" height="13" viewBox="0 0 168 168" fill="#1db954">
          <path d="M83.996.277C37.747.277.253 37.77.253 84.019c0 46.251 37.494 83.741 83.743 83.741 46.254 0 83.744-37.49 83.744-83.741 0-46.246-37.49-83.738-83.744-83.738l.001-.004zm38.404 120.78a5.217 5.217 0 0 1-7.18 1.73c-19.662-12.01-44.414-14.73-73.564-8.07a5.222 5.222 0 0 1-6.249-3.93 5.213 5.213 0 0 1 3.926-6.25c31.9-7.291 59.263-4.15 81.337 9.34 2.46 1.51 3.24 4.72 1.73 7.18zm10.25-22.805c-1.89 3.075-5.91 4.045-8.98 2.155-22.51-13.839-56.823-17.846-83.448-9.764-3.453 1.043-7.1-.903-8.148-4.35a6.538 6.538 0 0 1 4.354-8.143c30.413-9.228 68.222-4.758 94.072 11.127 3.07 1.89 4.04 5.91 2.15 8.976v-.001zm.88-23.744c-26.99-16.031-71.52-17.505-97.289-9.684-4.138 1.255-8.514-1.081-9.768-5.219a7.835 7.835 0 0 1 5.221-9.771c29.581-8.98 78.756-7.245 109.83 11.202a7.823 7.823 0 0 1 2.74 10.733c-2.2 3.722-7.02 4.949-10.734 2.739z"/>
        </svg>
        Spotify
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

  card.querySelector(".btn-play").addEventListener("click", (e) => {
    e.stopPropagation();
    playSong(song);
  });

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
      if (e.target.closest(".btn-play, .btn-sp-link, .btn-disapprove")) return;
      toggle();
    });
  }

  return card;
}

// ── Curated tab — Last.fm + Deezer BPM + Spotify URI lookup ────────────────
function markFiltersPending() {
  document.querySelector(".btn-refresh")?.classList.add("pending");
}

// Step 1 — Pull top tracks by genre tag from Last.fm.
async function fetchLastFmTopTracks(tag, limit = 30, page = 1) {
  const url = `${LASTFM_BASE}?method=tag.gettoptracks&tag=${encodeURIComponent(tag)}&api_key=${LASTFM_API_KEY}&format=json&limit=${limit}&page=${page}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data?.error) throw new Error(`Last.fm: ${data.message || "request failed"}`);
  return (data?.tracks?.track || []).map(t => ({
    artist: t.artist?.name || "",
    title:  t.name         || "",
  })).filter(t => t.artist && t.title);
}

async function fetchCandidates(genre) {
  if (genre === "all") {
    const lists = await Promise.all(ALL_GENRES_TAGS.map(t => {
      const page = Math.ceil(Math.random() * 3);
      return fetchLastFmTopTracks(t, 8, page).catch(() => []);
    }));
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

// Step 2 — Look up BPM via Deezer's free public JSONP API.
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

function normalizeBpm(bpm) {
  if (!bpm || bpm <= 0) return null;
  let n = Math.round(bpm);
  if (n > 160) n = Math.round(n / 2);
  if (n < 50)  n = Math.round(n * 2);
  return n;
}

async function lookupDeezerBpm(artist, title) {
  try {
    const q      = `artist:"${artist}" track:"${title}"`;
    const search = await jsonp(`${DEEZER_BASE}/search?q=${encodeURIComponent(q)}&limit=1`);
    const trackId = search?.data?.[0]?.id;
    if (!trackId) return null;
    const detail = await jsonp(`${DEEZER_BASE}/track/${trackId}`);
    return normalizeBpm(detail?.bpm);
  } catch (_) {
    return null;
  }
}

const TARGET_DISPLAY = 10;
const MAX_SP_LOOKUPS = TARGET_DISPLAY + 5; // look up more than we show

// Step 3 — Find the Spotify track URI for a candidate. Returns null if not found.
function spotifyCacheKey(artist, title) {
  return `${artist}|${title}`.toLowerCase().trim();
}

async function spotifyFindTrack(artist, title) {
  const key = spotifyCacheKey(artist, title);
  if (key in spotifyCache) return spotifyCache[key];

  const token = await getSpotifyToken();
  if (!token) return null;

  try {
    const q   = encodeURIComponent(`track:${title} artist:${artist}`);
    const res = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=1`, {
      headers: { "Authorization": `Bearer ${token}` },
    });
    const data = await res.json();
    const uri  = data?.tracks?.items?.[0]?.uri || null;
    spotifyCache[key] = uri;
    persistSpotifyCache();
    return uri;
  } catch (_) {
    return null;
  }
}

async function fetchRecommendations() {
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

    const inRange = withBpm.filter(c =>
      c.bpm === null || (c.bpm >= state.bpmMin && c.bpm <= state.bpmMax)
    );

    const fresh = inRange.filter(c => {
      const candidateKey = `${c.artist}|${c.title}`.toLowerCase();
      if (approvedSongs.some(s => `${s.artist}|${s.title}`.toLowerCase() === candidateKey)) return false;
      // Pre-filter: if we already know the Spotify URI and user disapproved it, skip
      const cachedUri = spotifyCache[spotifyCacheKey(c.artist, c.title)];
      if (cachedUri && disapprovedIds.has(cachedUri)) return false;
      return true;
    });

    const toLookup = fresh.slice(0, MAX_SP_LOOKUPS);
    if (toLookup.length === 0) {
      container.innerHTML = `<div class="state-message"><p>No tracks matched your BPM range. Try widening it and refresh.</p></div>`;
      return;
    }

    setStatus(`Looking up ${toLookup.length} tracks on Spotify…`);
    const spResults = await Promise.all(toLookup.map(async c => {
      const spotifyUri = await spotifyFindTrack(c.artist, c.title);
      if (!spotifyUri) return null;
      return { title: c.title, artist: c.artist, videoId: spotifyUri, bpm: c.bpm };
    }));

    state.recommendedSongs = spResults
      .filter(Boolean)
      .filter(s => !isDisapproved(s) && !isApproved(s))
      .slice(0, TARGET_DISPLAY);

    renderCuratedTab();
  } catch (e) {
    container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ ${escHtml(e.message || "Failed to load recommendations.")}</p></div>`;
  }
}

function refreshRecommendations() {
  if (!isSpotifyConnected()) {
    document.getElementById("tab-curated").innerHTML =
      `<div class="state-message"><p class="error-msg">⚠ Connect Spotify to get recommendations.</p></div>`;
    document.querySelector(".btn-refresh")?.classList.add("pending");
    return;
  }
  fetchRecommendations();
}

function renderCuratedTab() {
  const container = document.getElementById("tab-curated");
  container.innerHTML = "";

  if (!isSpotifyConnected()) {
    container.innerHTML = `
      <div class="search-setup">
        <div class="setup-icon">🎵</div>
        <p>Connect Spotify to discover WCS-friendly songs and play them instantly.</p>
        <button class="btn-connect-spotify" id="btn-curated-connect">♪ Connect Spotify</button>
      </div>`;
    document.getElementById("btn-curated-connect").addEventListener("click", connectSpotify);
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
    ? `♪ Create Spotify Playlist (${n} song${n > 1 ? "s" : ""})`
    : "♪ Create Spotify Playlist";
}

// ── Spotify playlist import ────────────────────────────────────────────────
function extractSpotifyPlaylistId(input) {
  if (!input) return null;
  const s = input.trim();
  // https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
  const m1 = s.match(/spotify\.com\/playlist\/([A-Za-z0-9]+)/);
  if (m1) return m1[1];
  // spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
  const m2 = s.match(/spotify:playlist:([A-Za-z0-9]+)/);
  if (m2) return m2[1];
  // Raw 22-char Spotify ID
  if (/^[A-Za-z0-9]{22}$/.test(s)) return s;
  return null;
}

function setImportStatus(msg, kind) {
  const el = document.getElementById("import-status");
  el.textContent = msg || "";
  el.className = "approved-bar-status" + (kind ? ` ${kind}` : "");
}

async function importSpotifyPlaylist() {
  const input = document.getElementById("import-playlist-input");
  const btn   = document.getElementById("btn-import-playlist");

  const playlistId = extractSpotifyPlaylistId(input.value);
  if (!playlistId) {
    setImportStatus("Couldn't find a Spotify playlist ID in that input.", "error");
    return;
  }

  const token = await getSpotifyToken();
  if (!token) {
    setImportStatus("Connect Spotify before importing.", "error");
    return;
  }

  btn.disabled = true;
  setImportStatus("Fetching playlist from Spotify…");

  try {
    const tracks = [];
    let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(name,artists,uri))`;

    while (url) {
      const res  = await fetch(url, { headers: { "Authorization": `Bearer ${token}` } });
      const data = await res.json();
      if (data.error) {
        setImportStatus(`Spotify error: ${data.error.message}`, "error");
        btn.disabled = false;
        return;
      }
      for (const item of (data.items || [])) {
        if (item.track?.uri) {
          tracks.push({
            title:   item.track.name,
            artist:  item.track.artists?.[0]?.name || "",
            videoId: item.track.uri,
          });
        }
      }
      url = data.next || null;
    }

    let added = 0, skipped = 0, disapproved = 0;
    for (const track of tracks) {
      if (isDisapproved(track)) { disapproved++; continue; }
      if (isApproved(track))    { skipped++;     continue; }
      approvedSongs.push(track);
      added++;
    }

    persist();
    updateApprovedCount();
    renderApprovedTab();

    const parts = [`Imported ${added} song${added === 1 ? "" : "s"}`];
    if (skipped)     parts.push(`${skipped} already approved`);
    if (disapproved) parts.push(`${disapproved} skipped (disapproved)`);
    setImportStatus(parts.join(" · "), added > 0 ? "success" : "");
    input.value = "";
  } catch (e) {
    setImportStatus(`Import failed: ${e.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

// ── Spotify playlist creation ──────────────────────────────────────────────
async function createSpotifyPlaylist() {
  const selected = approvedSongs.filter(s => state.selectedForPlaylist.has(s.videoId));
  if (selected.length === 0) return;

  const btn = document.getElementById("btn-create-playlist");
  btn.disabled = true;
  btn.textContent = "Creating playlist…";

  const token = await getSpotifyToken();
  if (!token) {
    alert("Connect Spotify to create playlists.");
    updateCreateBtn();
    return;
  }

  try {
    // Get user ID
    const me = await fetch("https://api.spotify.com/v1/me", {
      headers: { "Authorization": `Bearer ${token}` },
    }).then(r => r.json());
    if (!me.id) throw new Error("Couldn't retrieve Spotify user ID");

    // Create playlist
    const pl = await fetch(`https://api.spotify.com/v1/users/${me.id}/playlists`, {
      method:  "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({
        name:        `WCS Mix — ${new Date().toLocaleDateString()}`,
        description: "West Coast Swing playlist created by WCS Song Recommender",
        public:      false,
      }),
    }).then(r => r.json());
    if (!pl.id) {
      if (pl.error?.status === 403) {
        // Insufficient scope — token was issued before playlist scopes were added.
        // Clear stored tokens so the user can re-authorize with the full scope set.
        if (confirm(
          "Spotify says \"Insufficient client scope\" — your saved login doesn't have " +
          "the permissions needed to create playlists.\n\n" +
          "Click OK to reconnect Spotify with the required permissions."
        )) {
          localStorage.removeItem("wcs_spotify_token");
          localStorage.removeItem("wcs_spotify_refresh");
          localStorage.removeItem("wcs_spotify_token_exp");
          updateCreateBtn();
          connectSpotify();
          return;
        }
        updateCreateBtn();
        return;
      }
      throw new Error(pl.error?.message || "Playlist creation failed");
    }

    // Resolve Spotify URIs for each selected song
    btn.textContent = "Adding tracks…";
    const uris = [];
    for (const song of selected) {
      let uri = song.videoId?.startsWith("spotify:track:") ? song.videoId : null;
      if (!uri) uri = await spotifyFindTrack(song.artist, song.title);
      if (uri) uris.push(uri);
    }

    // Add tracks in batches of 100 (Spotify API limit)
    for (let i = 0; i < uris.length; i += 100) {
      await fetch(`https://api.spotify.com/v1/playlists/${pl.id}/tracks`, {
        method:  "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ uris: uris.slice(i, i + 100) }),
      });
    }

    showPlaylistToast(`Playlist created with ${uris.length} songs!`, `https://open.spotify.com/playlist/${pl.id}`);
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
  link.textContent = "Open in Spotify ↗";
  toast.style.display = "flex";
}

// ── Search tab ─────────────────────────────────────────────────────────────
function renderSearchTab() {
  const container = document.getElementById("tab-search");
  const hint = isSpotifyConnected()
    ? '<span class="signed-in-note">✓ Spotify connected</span>'
    : `<a href="javascript:void(0)" id="search-sp-link">Connect Spotify</a> to search.`;
  container.innerHTML = `
    <div class="state-message">
      <div class="icon">🔍</div>
      <p>Search for an artist, song, or style above.<br>${hint}</p>
    </div>`;
  document.getElementById("search-sp-link")?.addEventListener("click", connectSpotify);
}

async function fetchSearch(q) {
  const container = document.getElementById("tab-search");
  container.innerHTML = `<div class="state-message"><div class="icon">🔍</div><p>Searching…</p></div>`;

  const token = await getSpotifyToken();
  if (!token) {
    container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ Connect Spotify to search.</p></div>`;
    return;
  }

  try {
    const res  = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=6`,
      { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.error) {
      container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ ${escHtml(data.error.message)}</p></div>`;
      return;
    }
    const songs = (data?.tracks?.items || []).map(t => ({
      title:   t.name,
      artist:  t.artists?.[0]?.name || "",
      videoId: t.uri,
    }));
    renderSearchResults(songs, q);
  } catch (e) {
    container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ ${escHtml(e.message) || "Search failed."}</p></div>`;
  }
}

function doSearch() {
  const q = document.getElementById("search-input").value.trim();
  if (!q) return;
  fetchSearch(q);
}

function renderSearchResults(songs, query) {
  const container = document.getElementById("tab-search");
  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "section-header";
  header.innerHTML = `<h2>${query ? `Results for &ldquo;${escHtml(query)}&rdquo;` : "Search Results"}</h2><span class="count-badge">${songs.length}</span>`;
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

// ── Spotify PKCE helpers ───────────────────────────────────────────────────
function generateCodeVerifier() {
  const arr = new Uint8Array(64);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function generateCodeChallenge(verifier) {
  const data   = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ── Spotify auth (PKCE Authorization Code Flow) ────────────────────────────
async function connectSpotify() {
  const verifier  = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem("spotify_cv", verifier);

  const params = new URLSearchParams({
    client_id:             SPOTIFY_CLIENT_ID,
    response_type:         "code",
    redirect_uri:          SPOTIFY_REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge:        challenge,
    scope:                 SPOTIFY_SCOPES,
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function handleSpotifyCallback(code) {
  const verifier = sessionStorage.getItem("spotify_cv");
  sessionStorage.removeItem("spotify_cv");
  if (!verifier) return null;

  const body = new URLSearchParams({
    grant_type:    "authorization_code",
    code,
    redirect_uri:  SPOTIFY_REDIRECT_URI,
    client_id:     SPOTIFY_CLIENT_ID,
    code_verifier: verifier,
  });
  const res  = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (data.access_token) {
    localStorage.setItem("wcs_spotify_token",     data.access_token);
    localStorage.setItem("wcs_spotify_refresh",   data.refresh_token || "");
    localStorage.setItem("wcs_spotify_token_exp", String(Date.now() + (data.expires_in - 60) * 1000));
    return data.access_token;
  }
  return null;
}

async function refreshSpotifyToken() {
  const refresh = localStorage.getItem("wcs_spotify_refresh");
  if (!refresh) return null;

  const body = new URLSearchParams({
    grant_type:    "refresh_token",
    refresh_token: refresh,
    client_id:     SPOTIFY_CLIENT_ID,
  });
  const res  = await fetch("https://accounts.spotify.com/api/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await res.json();
  if (data.access_token) {
    localStorage.setItem("wcs_spotify_token",     data.access_token);
    if (data.refresh_token) localStorage.setItem("wcs_spotify_refresh", data.refresh_token);
    localStorage.setItem("wcs_spotify_token_exp", String(Date.now() + (data.expires_in - 60) * 1000));
    return data.access_token;
  }
  return null;
}

async function getSpotifyToken() {
  const exp = Number(localStorage.getItem("wcs_spotify_token_exp") || 0);
  if (exp > Date.now()) return localStorage.getItem("wcs_spotify_token");
  return refreshSpotifyToken();
}

function isSpotifyConnected() {
  return !!localStorage.getItem("wcs_spotify_refresh");
}

// ── Spotify Web Playback SDK ───────────────────────────────────────────────
let _spotifySDKLoaded = false;
function initSpotifySDK() {
  if (_spotifySDKLoaded) return;
  _spotifySDKLoaded = true;

  window.onSpotifyWebPlaybackSDKReady = async () => {
    const token = await getSpotifyToken();
    if (!token) return;

    spotifyPlayer = new Spotify.Player({
      name: "WCS Song Recommender",
      getOAuthToken: async cb => { cb(await getSpotifyToken()); },
      volume: 1.0,
    });

    spotifyPlayer.addListener("ready", ({ device_id }) => {
      spotifyDeviceId = device_id;
      updateSpotifyUI();
      // Re-render curated tab so the Refresh button shows up after connect
      if (state.recommendedSongs === null) renderCuratedTab();
    });
    spotifyPlayer.addListener("not_ready", () => {
      spotifyDeviceId = null;
      updateSpotifyUI();
    });
    spotifyPlayer.addListener("initialization_error", ({ message }) => {
      console.warn("[Spotify] Init error:", message);
    });
    spotifyPlayer.addListener("authentication_error", ({ message }) => {
      console.warn("[Spotify] Auth error:", message);
      localStorage.removeItem("wcs_spotify_refresh");
      updateSpotifyUI();
    });
    spotifyPlayer.addListener("account_error", ({ message }) => {
      console.warn("[Spotify] Account error:", message);
      alert("Spotify playback requires a Spotify Premium subscription.");
      localStorage.removeItem("wcs_spotify_refresh");
      updateSpotifyUI();
    });

    spotifyPlayer.addListener("player_state_changed", (s) => {
      if (!s) return;
      updatePlayPauseBtn(s.paused);
      updateProgressBar(s.position, s.duration);
      // Pause progress polling while paused; resume it when playing
      if (s.paused) {
        stopProgressPolling();
      } else if (!_progressInterval) {
        startProgressPolling();
      }
    });

    spotifyPlayer.connect();
  };

  const script = document.createElement("script");
  script.src = "https://sdk.scdn.co/spotify-player.js";
  document.head.appendChild(script);
}

// ── Spotify playback ───────────────────────────────────────────────────────
async function playSpotify(song) {
  if (!spotifyDeviceId) return false;

  const uri = await spotifyFindTrack(song.artist, song.title);
  if (!uri) return false;

  const token = await getSpotifyToken();
  if (!token) return false;

  try {
    const res = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`,
      {
        method:  "PUT",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify({ uris: [uri] }),
      }
    );
    return res.ok || res.status === 204;
  } catch (_) {
    return false;
  }
}

// ── Play / Pause toggle ────────────────────────────────────────────────────
function updatePlayPauseBtn(paused) {
  const btn = document.getElementById("btn-player-playpause");
  if (!btn) return;
  btn.textContent = paused ? "▶" : "⏸";
  btn.title       = paused ? "Play" : "Pause";
}

// ── Song progress bar ──────────────────────────────────────────────────────
function formatMs(ms) {
  if (!ms || ms < 0) return "0:00";
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function updateProgressBar(posMs, durMs) {
  const slider  = document.getElementById("progress-slider");
  const elapsed = document.getElementById("p-elapsed");
  const durEl   = document.getElementById("p-duration");
  if (!slider) return;

  slider.max = durMs || 0;
  if (!_isDragging) {
    slider.value = posMs || 0;
    // Update gradient fill (WebKit; Firefox uses ::-moz-range-progress natively)
    const pct = durMs > 0 ? (posMs / durMs) * 100 : 0;
    slider.style.background =
      `linear-gradient(to right, #6244b0 ${pct}%, #dddde8 ${pct}%)`;
  }
  if (elapsed) elapsed.textContent = formatMs(posMs);
  if (durEl)   durEl.textContent   = formatMs(durMs);
}

function resetProgressBar() {
  const slider  = document.getElementById("progress-slider");
  const elapsed = document.getElementById("p-elapsed");
  const durEl   = document.getElementById("p-duration");
  if (slider)  { slider.max = 0; slider.value = 0; slider.disabled = true;
                 slider.style.background = ""; }
  if (elapsed) elapsed.textContent = "0:00";
  if (durEl)   durEl.textContent   = "0:00";
}

function startProgressPolling() {
  stopProgressPolling();
  _progressInterval = setInterval(async () => {
    if (_isDragging || !spotifyPlayer) return;
    const s = await spotifyPlayer.getCurrentState();
    if (!s) return;
    updateProgressBar(s.position, s.duration);
  }, 500);
}

function stopProgressPolling() {
  if (_progressInterval) { clearInterval(_progressInterval); _progressInterval = null; }
}

// ── Spotify UI ────────────────────────────────────────────────────────────
function updateSpotifyUI() {
  const btn = document.getElementById("btn-connect-spotify");
  if (btn) {
    if (spotifyDeviceId) {
      btn.textContent = "♪ Spotify ✓";
      btn.className   = "btn-connect-spotify connected";
      btn.title       = "Spotify connected — click to disconnect";
    } else if (isSpotifyConnected()) {
      btn.textContent = "♪ Connecting…";
      btn.className   = "btn-connect-spotify connecting";
      btn.title       = "Spotify SDK is initializing…";
    } else {
      btn.textContent = "♪ Connect Spotify";
      btn.className   = "btn-connect-spotify";
      btn.title       = "Connect Spotify (Premium required)";
    }
  }
}

// ── Piped cache-warmer (console utility, unchanged) ───────────────────────
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

function ytCacheKey(artist, title) { return `${artist}|${title}`.toLowerCase().trim(); }
function persistYtCache() { localStorage.setItem("wcs_yt_cache", JSON.stringify(ytSearchCache)); }
let ytSearchCache = JSON.parse(localStorage.getItem("wcs_yt_cache") || "{}");

async function pipedFindVideoId(artist, title) {
  const q = `${artist} ${title}`;
  for (const base of PIPED_INSTANCES) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res   = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=music_songs`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data  = await res.json();
      const first = (data.items || []).find(it => /\/watch\?v=([A-Za-z0-9_-]{11})/.test(it.url || ""));
      if (!first) continue;
      const m = first.url.match(/\/watch\?v=([A-Za-z0-9_-]{11})/);
      return m ? m[1] : null;
    } catch (_) { /* try next */ }
  }
  return null;
}

async function warmCache(perGenre = 30) {
  const allTags = Object.keys(LASTFM_TAG_MAP);
  console.log(`[warmCache] Starting pre-warm across ${allTags.length} genres, ${perGenre} tracks each…`);
  let total = 0, hits = 0, misses = 0, skipped = 0;
  for (const genreId of allTags) {
    const tag = LASTFM_TAG_MAP[genreId];
    let candidates;
    try { candidates = await fetchLastFmTopTracks(tag, perGenre); }
    catch (e) { console.warn(`[warmCache] Last.fm failed for ${tag}:`, e.message); continue; }
    console.log(`[warmCache] ${tag}: ${candidates.length} candidates`);
    for (const c of candidates) {
      total++;
      const key = ytCacheKey(c.artist, c.title);
      if (key in ytSearchCache) { skipped++; continue; }
      const videoId = await pipedFindVideoId(c.artist, c.title);
      ytSearchCache[key] = videoId;
      if (videoId) hits++; else misses++;
      await new Promise(r => setTimeout(r, 80));
    }
    persistYtCache();
    console.log(`[warmCache] ${tag} done — hits:${hits} misses:${misses} skipped:${skipped}`);
  }
  console.log(`[warmCache] Complete. Total:${total} hits:${hits} misses:${misses} skipped:${skipped}`);
  return { total, hits, misses, skipped };
}
window.warmCache = warmCache;

// ── Tab switching ──────────────────────────────────────────────────────────
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === tab));

  document.getElementById("tab-curated").style.display  = tab === "curated"  ? "" : "none";
  document.getElementById("tab-approved").style.display = tab === "approved" ? "" : "none";
  document.getElementById("tab-search").style.display   = tab === "search"   ? "" : "none";

  document.getElementById("filters-row").style.display    = tab === "curated"  ? "" : "none";
  document.getElementById("approved-bar").style.display   = tab === "approved" ? "flex" : "none";
  document.getElementById("search-bar-row").style.display = tab === "search"   ? "" : "none";

  if (tab === "search")   renderSearchTab();
  if (tab === "approved") renderApprovedTab();
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

  // Genre filter
  document.getElementById("filter-genre").addEventListener("change", e => {
    state.genre = e.target.value;
    markFiltersPending();
  });

  // BPM sliders
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

  // Progress slider — seek on release, update label live while dragging
  const progressSlider = document.getElementById("progress-slider");
  progressSlider.addEventListener("mousedown",  () => { _isDragging = true; });
  progressSlider.addEventListener("touchstart", () => { _isDragging = true; }, { passive: true });
  progressSlider.addEventListener("input", () => {
    // Show where you'll land while dragging, without seeking yet
    document.getElementById("p-elapsed").textContent = formatMs(+progressSlider.value);
    // Keep the fill gradient in sync while dragging
    const pct = progressSlider.max > 0 ? (+progressSlider.value / +progressSlider.max) * 100 : 0;
    progressSlider.style.background =
      `linear-gradient(to right, #6244b0 ${pct}%, #dddde8 ${pct}%)`;
  });
  progressSlider.addEventListener("change", () => {
    if (spotifyPlayer) spotifyPlayer.seek(+progressSlider.value).catch(console.warn);
    _isDragging = false;
  });

  // Play / pause toggle — use getCurrentState for reliability instead of togglePlay()
  document.getElementById("btn-player-playpause")?.addEventListener("click", async () => {
    if (!spotifyPlayer) return;
    const s = await spotifyPlayer.getCurrentState();
    if (!s) return; // nothing loaded in the player yet
    if (s.paused) {
      spotifyPlayer.resume().catch(console.warn);
    } else {
      spotifyPlayer.pause().catch(console.warn);
    }
    // Don't manually update the button here — player_state_changed will fire
  });

  // Tap-BPM
  document.getElementById("tap-pad").addEventListener("click", tapBeat);
  document.getElementById("btn-tap-reset").addEventListener("click", resetTap);
  document.getElementById("btn-tap-save").addEventListener("click", saveTappedBpm);
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

  document.getElementById("btn-create-playlist").addEventListener("click", createSpotifyPlaylist);

  // Spotify playlist import
  document.getElementById("btn-import-playlist").addEventListener("click", importSpotifyPlaylist);
  document.getElementById("import-playlist-input").addEventListener("keydown", e => {
    if (e.key === "Enter") importSpotifyPlaylist();
  });

  // Spotify connect / disconnect
  document.getElementById("btn-connect-spotify")?.addEventListener("click", () => {
    if (spotifyDeviceId) {
      if (confirm("Disconnect Spotify?")) {
        localStorage.removeItem("wcs_spotify_token");
        localStorage.removeItem("wcs_spotify_refresh");
        localStorage.removeItem("wcs_spotify_token_exp");
        if (spotifyPlayer) { spotifyPlayer.disconnect(); spotifyPlayer = null; }
        _spotifySDKLoaded = false;
        spotifyDeviceId   = null;
        updateSpotifyUI();
        renderCuratedTab(); // revert to connect prompt
      }
    } else if (!isSpotifyConnected()) {
      connectSpotify();
    }
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

  // Spotify: handle PKCE callback or initialize SDK if already authenticated.
  const _urlParams = new URLSearchParams(location.search);
  const _spCode    = _urlParams.get("code");
  const _spError   = _urlParams.get("error");

  if (_spError && sessionStorage.getItem("spotify_cv")) {
    sessionStorage.removeItem("spotify_cv");
    history.replaceState({}, "", location.pathname);
  } else if (_spCode && sessionStorage.getItem("spotify_cv")) {
    history.replaceState({}, "", location.pathname);
    handleSpotifyCallback(_spCode).then(token => {
      if (token) initSpotifySDK();
      updateSpotifyUI();
    });
  } else if (isSpotifyConnected()) {
    initSpotifySDK();
  }

  updateSpotifyUI();
}

document.addEventListener("DOMContentLoaded", init);
