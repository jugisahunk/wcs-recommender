// ── Persistence ────────────────────────────────────────────────────────────
let approvedSongs  = JSON.parse(localStorage.getItem("wcs_approved")     || "[]");
let disapprovedIds = new Set(JSON.parse(localStorage.getItem("wcs_disapproved") || "[]"));
let oauthClientId  = localStorage.getItem("wcs_oauth_client_id") || "";
let oauthToken     = null;

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
  document.querySelector(".p-bpm").textContent    = song.bpm ? `${song.bpm} BPM` : "";
  document.getElementById("player-ytm-btn").href  = `https://music.youtube.com/watch?v=${song.videoId}`;
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

  const bpmHtml    = song.bpm    ? `<span class="bpm-tag">${song.bpm} BPM</span>` : "";
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
function buildCurationQuery() {
  const energyTerms = { low: "slow mellow", medium: "", high: "upbeat energetic" };
  const parts = ["west coast swing"];

  if (state.genre !== "all") {
    const label = GENRES.find(g => g.id === state.genre)?.label || state.genre;
    parts.push(label.replace(" / ", " "));
  }

  if (state.energy !== "all") parts.push(energyTerms[state.energy] || "");

  const bpmMid = Math.round((state.bpmMin + state.bpmMax) / 2);
  parts.push(`${bpmMid} bpm dance song`);

  return parts.filter(Boolean).join(" ");
}

function markFiltersPending() {
  document.querySelector(".btn-refresh")?.classList.add("pending");
}

async function fetchRecommendations(token) {
  document.querySelector(".btn-refresh")?.classList.remove("pending");
  const container = document.getElementById("tab-curated");
  container.innerHTML = `<div class="state-message"><div class="icon">🔍</div><p>Finding songs…</p></div>`;
  try {
    const query = buildCurationQuery();
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=12`,
      { headers: { "Authorization": `Bearer ${token}` } }
    );
    const data = await res.json();
    if (data.error) {
      if (data.error.code === 401) oauthToken = null;
      container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ ${escHtml(data.error.message)}</p></div>`;
      return;
    }
    state.recommendedSongs = (data.items || [])
      .map(item => ({
        title: item.snippet.title,
        artist: item.snippet.channelTitle,
        videoId: item.id.videoId,
      }))
      .filter(s => !isDisapproved(s) && !isApproved(s));
    renderCuratedTab();
  } catch (e) {
    oauthToken = null;
    container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ ${escHtml(e.message) || "Failed to load recommendations."}</p></div>`;
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

  if (!oauthClientId) {
    container.innerHTML = `
      <div class="search-setup">
        <div class="setup-icon">🎵</div>
        <p>Connect your <strong>YouTube account</strong> to get song recommendations.</p>
        <div class="setup-key-row">
          <input type="text" id="inline-oauth-input" placeholder="Google OAuth Client ID" autocomplete="off">
          <button class="btn-save-key" id="inline-oauth-save">Connect</button>
        </div>
        <p class="setup-hint">
          Need a Client ID?
          <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a>
          → APIs &amp; Services → Credentials → Create OAuth 2.0 Client ID (Web application).
          Add <code>${location.origin}</code> to Authorized JavaScript origins.
        </p>
      </div>`;
    const input = container.querySelector("#inline-oauth-input");
    container.querySelector("#inline-oauth-save").addEventListener("click", () => {
      const val = input.value.trim();
      if (!val) return;
      oauthClientId = val;
      localStorage.setItem("wcs_oauth_client_id", val);
      document.getElementById("oauth-client-input").value = val.slice(0, 12) + "…";
      updateOAuthStatus();
      // triggerOAuth must be called synchronously inside this click handler
      triggerOAuth(
        (token) => fetchRecommendations(token),
        (err) => {
          container.innerHTML = `<div class="state-message"><p class="error-msg">⚠ Sign-in failed: ${escHtml(String(err))}.<br>Make sure <code>${location.origin}</code> is in your OAuth Client's Authorized JavaScript origins.</p></div>`;
        }
      );
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") container.querySelector("#inline-oauth-save").click();
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
  if (!oauthClientId) {
    container.innerHTML = `
      <div class="search-setup">
        <div class="setup-icon">🔑</div>
        <p>Enter your <strong>Google OAuth Client ID</strong> in the header to enable search and playlist creation.</p>
        <p class="setup-hint">Uses your signed-in YouTube account — no separate API key needed.</p>
      </div>`;
    return;
  }
  container.innerHTML = `
    <div class="state-message">
      <div class="icon">🔍</div>
      <p>Search for an artist, song, or style above.<br>
      ${oauthToken ? '<span class="signed-in-note">✓ Signed in to YouTube</span>' : 'You\'ll be prompted to sign in on first search.'}</p>
    </div>`;
}

// Must be called synchronously from a click handler — browsers require
// a user gesture to open the Google account picker popup.
function triggerOAuth(onSuccess, onFail) {
  if (!oauthClientId) { if (onFail) onFail("no_client_id"); return; }
  if (typeof google === "undefined" || !google.accounts?.oauth2) {
    alert("Google sign-in library not loaded. Please refresh the page and try again.");
    if (onFail) onFail("gis_not_loaded");
    return;
  }
  google.accounts.oauth2.initTokenClient({
    client_id: oauthClientId,
    scope: "https://www.googleapis.com/auth/youtube",
    callback: (resp) => {
      if (resp.error) {
        oauthToken = null;
        if (onFail) onFail(resp.error);
        return;
      }
      oauthToken = resp.access_token;
      if (onSuccess) onSuccess(oauthToken);
    },
  }).requestAccessToken();
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
      title: item.snippet.title,
      artist: item.snippet.channelTitle,
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
  if (!oauthClientId) { renderSearchTab(); return; }
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
  if (!oauthClientId) { switchTab("curated"); return; }

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

// ── OAuth setup ────────────────────────────────────────────────────────────
function updateOAuthStatus() {
  const el = document.getElementById("oauth-status");
  if (oauthClientId) {
    el.textContent = "Google linked";
    el.className = "oauth-status set";
    document.getElementById("oauth-client-input").value = oauthClientId.slice(0, 12) + "…";
  } else {
    el.className = "oauth-status missing";
  }
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

  // OAuth
  document.getElementById("btn-save-oauth").addEventListener("click", () => {
    const val = document.getElementById("oauth-client-input").value.trim();
    oauthClientId = val;
    oauthToken = null;
    if (val) localStorage.setItem("wcs_oauth_client_id", val);
    else localStorage.removeItem("wcs_oauth_client_id");
    updateOAuthStatus();
    renderCuratedTab();
    renderSearchTab();
  });
  document.getElementById("oauth-client-input").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("btn-save-oauth").click();
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
  updateOAuthStatus();
  wire();
  renderCuratedTab();
  switchTab("curated");
}

document.addEventListener("DOMContentLoaded", init);
