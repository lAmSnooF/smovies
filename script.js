const TMDB_API_KEY = '5b4cffaeeb76a725a0d5654bbe3e5716';
const API_BASE_URL = 'https://api.themoviedb.org/3';
const IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/';
const YOUTUBE_EMBED_URL = 'https://www.youtube.com/embed/';
const ACCENT_HEX = 'e50914';

// --- PROFILE AVATARS ---
const AVATAR_COLORS = [
    { bg: '#e50914', icon: '😎' },
    { bg: '#0080ff', icon: '🦊' },
    { bg: '#e87c03', icon: '🐱' },
    { bg: '#b9090b', icon: '🎬' },
    { bg: '#46d369', icon: '🌿' },
    { bg: '#6b3fa0', icon: '👾' },
    { bg: '#f5c518', icon: '⭐' },
    { bg: '#ff6b9d', icon: '🦄' },
    { bg: '#00c8ff', icon: '🐬' },
    { bg: '#ff4500', icon: '🔥' },
];

const KIDS_AVATARS = [
    { bg: '#46d369', icon: '🧸' },
    { bg: '#f5c518', icon: '🌟' },
    { bg: '#ff6b9d', icon: '🦋' },
    { bg: '#00c8ff', icon: '🐠' },
    { bg: '#e87c03', icon: '🦁' },
];

// --- DEVICE / VIEWPORT HELPERS ---
const canHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches && window.innerWidth > 1024;
const isMobile = () => window.innerWidth <= 740;
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };

// Pick the best official title-logo image (Netflix-style art) from a TMDB images object.
// Prefers English, then language-neutral, then anything; prefers PNG and more-voted logos.
function pickBestLogo(images) {
    const logos = images && images.logos;
    if (!logos || !logos.length) return null;
    const score = (l) => {
        let s = 0;
        if (l.iso_639_1 === 'en') s += 100;
        else if (l.iso_639_1 === null || l.iso_639_1 === undefined) s += 50;
        if ((l.file_path || '').toLowerCase().endsWith('.png')) s += 10; // transparent art
        s += Math.min(l.vote_count || 0, 9);
        return s;
    };
    return [...logos].sort((a, b) => score(b) - score(a))[0];
}

// --- PROFILE SYSTEM ---
const MAX_PROFILES = 5;

const getProfiles = () => JSON.parse(localStorage.getItem('smovies_profiles')) || [];
const saveProfiles = (profiles) => localStorage.setItem('smovies_profiles', JSON.stringify(profiles));
const getActiveProfileId = () => localStorage.getItem('smovies_active_profile');
const setActiveProfileId = (id) => localStorage.setItem('smovies_active_profile', id);
const getActiveProfile = () => {
    const profiles = getProfiles();
    const id = getActiveProfileId();
    return profiles.find(p => p.id === id) || null;
};

function generateProfileId() {
    return 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
}

function createDefaultProfile() {
    return {
        id: generateProfileId(),
        name: 'User',
        avatarIndex: 0,
        isKids: false,
        tastes: [],
        myList: [],
    };
}

function initProfiles() {
    let profiles = getProfiles();
    if (profiles.length === 0) {
        const defaultProfile = createDefaultProfile();
        profiles = [defaultProfile];
        saveProfiles(profiles);
    }
    return profiles;
}

// --- MY LIST (per-profile) ---
function getMyList() {
    const profile = getActiveProfile();
    return profile ? (profile.myList || []) : [];
}

function isInMyList(itemId) {
    return getMyList().some(item => item.id === itemId);
}

function toggleMyList(mediaItem) {
    const profiles = getProfiles();
    const activeId = getActiveProfileId();
    const profile = profiles.find(p => p.id === activeId);
    if (!profile) return false;

    if (!profile.myList) profile.myList = [];
    const idx = profile.myList.findIndex(item => item.id === mediaItem.id);
    let added;
    if (idx > -1) {
        profile.myList.splice(idx, 1);
        added = false;
    } else {
        profile.myList.unshift({
            id: mediaItem.id,
            title: mediaItem.title || mediaItem.name,
            name: mediaItem.name,
            poster_path: mediaItem.poster_path,
            backdrop_path: mediaItem.backdrop_path,
            media_type: mediaItem.media_type || (mediaItem.title ? 'movie' : 'tv'),
            overview: mediaItem.overview || '',
        });
        added = true;
    }
    saveProfiles(profiles);
    return added;
}

// --- WATCH PROGRESS / CONTINUE WATCHING (per-profile) ---
// Real progress is captured from the embedded players via postMessage (see listener below).
let progressCache = null;
let progressCacheProfile = null;
let progressSaveTimer = null;
let currentlyPlaying = null;

function getProgressStore() {
    const pid = getActiveProfileId();
    if (progressCacheProfile !== pid || !progressCache) {
        try { progressCache = JSON.parse(localStorage.getItem('smovies_progress_' + pid)) || {}; }
        catch (e) { progressCache = {}; }
        progressCacheProfile = pid;
    }
    return progressCache;
}

function persistProgressStore(store) {
    const pid = getActiveProfileId();
    progressCache = store;
    progressCacheProfile = pid;
    clearTimeout(progressSaveTimer);
    progressSaveTimer = setTimeout(() => {
        try { localStorage.setItem('smovies_progress_' + pid, JSON.stringify(store)); } catch (e) {}
    }, 1200);
}

function removeProgress(id) {
    const store = getProgressStore();
    delete store[String(id)];
    progressCache = store;
    try { localStorage.setItem('smovies_progress_' + getActiveProfileId(), JSON.stringify(store)); } catch (e) {}
}

function updateProgress(info) {
    if (!info || info.id == null || info.id === 'undefined' || info.id === 'null') return;
    if (!getActiveProfileId()) return;

    const store = getProgressStore();
    const id = String(info.id);
    const prev = store[id] || {};
    const meta = (currentlyPlaying && String(currentlyPlaying.id) === id) ? currentlyPlaying : {};

    const currentTime = info.currentTime || prev.currentTime || 0;
    const duration = info.duration || prev.duration || 0;
    let percent = duration > 0
        ? Math.min(100, (currentTime / duration) * 100)
        : num(info.percent) || prev.percent || 0;

    // Ignore the very first "0 second" blips so we don't create empty cards.
    if (currentTime < 2 && percent < 1 && !prev.updatedAt) return;

    const item = {
        id,
        mediaType: info.mediaType || prev.mediaType || meta.mediaType || 'movie',
        title: meta.title || prev.title || '',
        name: meta.name || prev.name || '',
        poster_path: meta.poster_path || prev.poster_path || null,
        backdrop_path: meta.backdrop_path || prev.backdrop_path || null,
        season: info.season != null ? info.season : (prev.season != null ? prev.season : meta.season),
        episode: info.episode != null ? info.episode : (prev.episode != null ? prev.episode : meta.episode),
        currentTime,
        duration,
        percent,
        updatedAt: Date.now(),
    };

    if (item.mediaType === 'movie' && percent >= 95) {
        delete store[id]; // finished movie — drop from Continue Watching
    } else {
        store[id] = item;
    }
    persistProgressStore(store);
}

// Best-effort parser for VidLink's MEDIA_DATA payload.
function handleVidlinkData(data) {
    try {
        const entries = Object.values(data);
        if (!entries.length) return;
        const e = entries[0];
        const watched = e.progress ? e.progress.watched : 0;
        const duration = e.progress ? e.progress.duration : 0;
        updateProgress({
            id: e.id != null ? e.id : (currentlyPlaying && currentlyPlaying.id),
            mediaType: (e.type === 'tv' || e.type === 'series') ? 'tv' : 'movie',
            currentTime: num(watched),
            duration: num(duration),
            season: e.last_season_watched,
            episode: e.last_episode_watched,
        });
    } catch (err) { /* ignore */ }
}

// Unified message listener — handles Videasy, VidKing and VidLink progress events.
window.addEventListener('message', (event) => {
    let payload = event.data;
    if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (e) { return; }
    }
    if (!payload || typeof payload !== 'object') return;

    try {
        // VidLink
        if (payload.type === 'MEDIA_DATA' && payload.data && typeof payload.data === 'object') {
            handleVidlinkData(payload.data);
            return;
        }
        // VidKing
        if (payload.type === 'PLAYER_EVENT' && payload.data) {
            const d = payload.data;
            updateProgress({
                id: d.id != null ? d.id : (currentlyPlaying && currentlyPlaying.id),
                mediaType: d.mediaType || (currentlyPlaying && currentlyPlaying.mediaType) || 'movie',
                currentTime: num(d.currentTime),
                duration: num(d.duration),
                percent: num(d.progress),
                season: d.season,
                episode: d.episode,
            });
            return;
        }
        // Videasy (and generic { id, type, timestamp, duration, progress, season, episode })
        if (payload.id != null && (payload.type === 'movie' || payload.type === 'tv' || payload.type === 'anime')) {
            updateProgress({
                id: payload.id,
                mediaType: payload.type === 'anime' ? 'tv' : payload.type,
                currentTime: num(payload.timestamp),
                duration: num(payload.duration),
                percent: num(payload.progress),
                season: payload.season,
                episode: payload.episode,
            });
            return;
        }
    } catch (err) { /* malformed message — ignore */ }
});

// --- DOM Elements ---
const profileScreen = document.getElementById('profile-screen');
const profileManageScreen = document.getElementById('profile-manage-screen');
const profileEditScreen = document.getElementById('profile-edit-screen');
const profileAddScreen = document.getElementById('profile-add-screen');
const tastePickerScreen = document.getElementById('taste-picker-screen');
const homeScreen = document.getElementById('home-screen');
const playerScreen = document.getElementById('player-screen');
const playerPreview = document.getElementById('player-preview');
const backToHomeBtn = document.getElementById('back-to-home-btn');
const searchInput = document.getElementById('search-input');
const searchResultsList = document.getElementById('search-results-list');
const mainNav = document.getElementById('main-nav');
const heroSection = document.getElementById('hero-section');
const heroVideoContainer = document.getElementById('hero-video-container');
const heroTitle = document.getElementById('hero-title');
const heroOverview = document.getElementById('hero-overview');
const heroPlayBtn = document.getElementById('hero-play-btn');
const heroInfoBtn = document.getElementById('hero-info-btn');
const heroAddBtn = document.getElementById('hero-add-btn');
const heroAgeRating = document.getElementById('hero-age-rating');
const heroMuteBtn = document.getElementById('hero-mute-btn');
const contentRows = document.getElementById('content-rows');
const navLinks = document.querySelectorAll('.nav-link');
const continueWatchingSection = document.getElementById('continue-watching-section');
const continueWatchingDisplay = document.getElementById('continue-watching-display');
const detailsModal = document.getElementById('details-modal');
const playerSelectorContainer = document.querySelector('.player-selector-container');
const playerSelectorBtn = document.getElementById('player-selector-btn');
const playerMenu = document.getElementById('player-menu');
const currentPlayerName = document.getElementById('current-player-name');
const myListPage = document.getElementById('mylist-page');
const myListGrid = document.getElementById('mylist-grid');
const myListEmpty = document.getElementById('mylist-empty');
const searchOverlay = document.getElementById('search-overlay');
const searchOverlayInput = document.getElementById('search-overlay-input');
const searchOverlayResults = document.getElementById('search-overlay-results');

let searchTimeout;
let hoverEnterTimeout;
let hoverLeaveTimeout;
let currentHeroItem = null;
let heroTrailerTimeout;
const detailsCache = new Map();
let isHeroMuted = false;
let isModalMuted = false;
let currentPlayerAPI = 'videasy';
let editingProfileId = null;
let addAvatarIndex = 0;
let editAvatarIndex = 0;
let tasteSelections = [];
let currentPage = 'home';

// --- SVG Icons ---
const volumeUpIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"></path></svg>`;
const volumeOffIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"></path></svg>`;
const plusIcon = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"></path></svg>`;
const checkIcon = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"></path></svg>`;
const playIconSvg = `<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"></path></svg>`;
const prevArrowIcon = `&#8249;`;
const nextArrowIcon = `&#8250;`;

// --- API Data for Tabbed Rows ---
const GENRE_CONFIG = {
    title: 'Genres', type: 'movie',
    tabs: [
        { name: 'Comedy', id: 35 }, { name: 'Action', id: 28 },
        { name: 'Horror', id: 27 }, { name: 'Romance', id: 10749 },
        { name: 'Sci-Fi', id: 878 }, { name: 'Drama', id: 18 },
        { name: 'Animation', id: 16 }
    ]
};
const KIDS_GENRE_CONFIG = {
    title: 'Genres', type: 'movie',
    tabs: [
        { name: 'Animation', id: 16 }, { name: 'Comedy', id: 35 },
        { name: 'Family', id: 10751 },
    ]
};
const NETWORK_CONFIG = {
    title: 'Series on', type: 'tv',
    tabs: [
        { name: 'Netflix', id: 213 }, { name: 'Prime', id: 1024 },
        { name: 'Max', id: 3187 }, { name: 'Disney+', id: 2739 },
        { name: 'AppleTV', id: 2552 }, { name: 'Paramount', id: 4330 }
    ]
};
const CONTENT_CONFIG = {
    home: [
        { title: 'Trending Today', endpoint: '/trending/all/week' },
        { type: 'tabbed', config: GENRE_CONFIG },
        { type: 'tabbed', config: NETWORK_CONFIG }
    ],
    tv: [
        { title: 'Popular TV Shows', endpoint: '/tv/popular' },
        { title: 'Top Rated TV Shows', endpoint: '/tv/top_rated' },
        { title: 'Airing Today', endpoint: '/tv/airing_today' }
    ],
    movies: [
        { title: 'Popular Movies', endpoint: '/movie/popular' },
        { title: 'Top Rated Movies', endpoint: '/movie/top_rated' },
        { title: 'Now Playing', endpoint: '/movie/now_playing' }
    ]
};
const KIDS_CONTENT_CONFIG = {
    home: [
        { title: 'Popular for Kids', endpoint: '/discover/movie', params: '&with_genres=16,10751&sort_by=popularity.desc' },
        { type: 'tabbed', config: KIDS_GENRE_CONFIG },
    ],
    tv: [
        { title: 'Kids TV Shows', endpoint: '/discover/tv', params: '&with_genres=16,10762&sort_by=popularity.desc' },
    ],
    movies: [
        { title: 'Family Movies', endpoint: '/discover/movie', params: '&with_genres=10751&sort_by=popularity.desc' },
        { title: 'Animated Movies', endpoint: '/discover/movie', params: '&with_genres=16&sort_by=popularity.desc' },
    ]
};


// --- Helper Functions ---
const apiFetch = async (endpoint, params = '') => {
    const url = `${API_BASE_URL}${endpoint}?api_key=${TMDB_API_KEY}${params}`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.json();
    } catch (error) {
        console.error(`Error fetching from ${endpoint}:`, error);
        return { results: [] };
    }
};

// --- LEGACY HISTORY (used by "For You" / "Because You Watched" genre analysis) ---
const getHistory = () => JSON.parse(localStorage.getItem('smovies_history')) || [];

const saveToHistory = (mediaItem) => {
    let history = getHistory();
    history = history.filter(item => item.id !== mediaItem.id);
    history.unshift({
        id: mediaItem.id,
        title: mediaItem.title || mediaItem.name,
        name: mediaItem.name,
        poster_path: mediaItem.poster_path,
        backdrop_path: mediaItem.backdrop_path,
        media_type: mediaItem.media_type || mediaItem.mediaType || (mediaItem.title ? 'movie' : 'tv'),
    });
    if (history.length > 20) history = history.slice(0, 20);
    localStorage.setItem('smovies_history', JSON.stringify(history));
};

// --- CONTINUE WATCHING RENDERING ---
const createContinueCard = (item) => {
    const img = item.backdrop_path ? `${IMAGE_BASE_URL}w500${item.backdrop_path}`
        : item.poster_path ? `${IMAGE_BASE_URL}w342${item.poster_path}` : null;
    if (!img) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'poster-card-wrapper';
    const pct = Math.max(2, Math.min(100, item.percent || 0));
    const titleText = item.title || item.name || '';
    const label = (item.mediaType === 'tv' && item.season != null && item.episode != null)
        ? `${titleText} · S${item.season}:E${item.episode}` : titleText;

    wrapper.innerHTML = `
        <div class="continue-card">
            <img src="${img}" alt="${titleText}">
            <div class="continue-card-overlay">
                <button class="continue-play-btn" aria-label="Resume">${playIconSvg}</button>
            </div>
            <button class="continue-remove-btn" title="Remove from Continue Watching">✕</button>
            <span class="continue-label">${label}</span>
            <div class="continue-progress-track"><div class="continue-progress-fill" style="width:${pct}%"></div></div>
        </div>`;

    const resume = (e) => {
        if (e) e.stopPropagation();
        loadMedia(item, item.season || 1, item.episode || 1, item.currentTime || 0);
    };
    wrapper.querySelector('.continue-play-btn').addEventListener('click', resume);
    wrapper.addEventListener('click', resume);
    wrapper.querySelector('.continue-remove-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        removeProgress(item.id);
        renderContinueWatching();
    });
    return wrapper;
};

const renderContinueWatching = () => {
    const store = getProgressStore();
    const items = Object.values(store)
        .filter(it => (it.title || it.name) && (it.backdrop_path || it.poster_path))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        .slice(0, 20);

    continueWatchingDisplay.innerHTML = '';
    if (items.length > 0) {
        items.forEach(it => {
            const card = createContinueCard(it);
            if (card) continueWatchingDisplay.appendChild(card);
        });
        continueWatchingSection.style.display = 'block';
    } else {
        continueWatchingSection.style.display = 'none';
    }
    const slider = continueWatchingSection.querySelector('.slider');
    if (slider) setupSlider(slider);
};

// --- SCREEN MANAGEMENT ---
function showScreen(screenEl) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    screenEl.classList.add('active');
}

const showHomeScreen = () => {
    showScreen(homeScreen);
    // Refresh Continue Watching with any progress captured while the player was open.
    renderContinueWatching();
    const handleTransitionEnd = (event) => {
        if (event.propertyName !== 'opacity') return;
        if (!playerScreen.classList.contains('active')) {
             playerPreview.innerHTML = '';
        }
        playerScreen.removeEventListener('transitionend', handleTransitionEnd);
    };
    playerScreen.addEventListener('transitionend', handleTransitionEnd);
};

const showPlayerScreen = () => {
    showScreen(playerScreen);
};

// --- PROFILE AVATAR RENDERING ---
function renderProfileAvatar(el, avatarIndex, isKids) {
    const avatars = isKids ? KIDS_AVATARS : AVATAR_COLORS;
    const idx = avatarIndex % avatars.length;
    const avatar = avatars[idx];
    el.style.backgroundColor = avatar.bg;
    el.textContent = avatar.icon;
}

// --- PROFILE SELECTION SCREEN ---
function renderProfileScreen() {
    const profiles = initProfiles();
    const list = document.getElementById('profile-list');
    list.innerHTML = '';

    profiles.forEach(profile => {
        const item = document.createElement('div');
        item.className = 'profile-item';
        if (profile.isKids) item.classList.add('kids');
        item.innerHTML = `
            <div class="profile-avatar"></div>
            <span class="profile-name"></span>
        `;
        item.querySelector('.profile-name').textContent = profile.name;
        renderProfileAvatar(item.querySelector('.profile-avatar'), profile.avatarIndex, profile.isKids);
        item.addEventListener('click', () => selectProfile(profile.id));
        list.appendChild(item);
    });

    if (profiles.length < MAX_PROFILES) {
        const addItem = document.createElement('div');
        addItem.className = 'profile-item add-profile';
        addItem.innerHTML = `
            <div class="profile-avatar add-avatar"><span>+</span></div>
            <span class="profile-name">Add Profile</span>
        `;
        addItem.addEventListener('click', () => openAddProfile());
        list.appendChild(addItem);
    }
}

function selectProfile(profileId) {
    setActiveProfileId(profileId);
    const profile = getActiveProfile();
    if (profile && (!profile.tastes || profile.tastes.length === 0)) {
        openTastePicker(profileId);
    } else {
        enterApp();
    }
}

function enterApp() {
    updateNavProfileAvatar();
    showScreen(homeScreen);
    homeScreen.scrollTop = 0;
    setActivePage('home');
    loadPageContent('home');
    heroObserver.observe(heroSection);
    setupSlider(continueWatchingSection.querySelector('.slider'));
}

function updateNavProfileAvatar() {
    const profile = getActiveProfile();
    if (!profile) return;
    const el = document.getElementById('nav-profile-avatar');
    renderProfileAvatar(el, profile.avatarIndex, profile.isKids);
    renderProfileDropdown();
}

function renderProfileDropdown() {
    const profiles = getProfiles();
    const activeId = getActiveProfileId();
    const list = document.getElementById('profile-dropdown-list');
    list.innerHTML = '';
    profiles.forEach(p => {
        if (p.id === activeId) return;
        const item = document.createElement('a');
        item.href = '#';
        item.className = 'profile-dropdown-item';
        item.innerHTML = `<div class="profile-avatar tiny"></div><span></span>`;
        item.querySelector('span').textContent = p.name;
        renderProfileAvatar(item.querySelector('.profile-avatar'), p.avatarIndex, p.isKids);
        item.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('profile-dropdown').classList.remove('open');
            document.querySelector('.profile-menu-container').classList.remove('open');
            setActiveProfileId(p.id);
            enterApp();
        });
        list.appendChild(item);
    });
}

// --- PROFILE MANAGE SCREEN ---
function renderProfileManageScreen() {
    const profiles = getProfiles();
    const list = document.getElementById('profile-manage-list');
    list.innerHTML = '';

    profiles.forEach(profile => {
        const item = document.createElement('div');
        item.className = 'profile-item manage-mode';
        item.innerHTML = `
            <div class="profile-avatar"></div>
            <div class="profile-edit-overlay"><svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"></path></svg></div>
            <span class="profile-name"></span>
        `;
        item.querySelector('.profile-name').textContent = profile.name;
        renderProfileAvatar(item.querySelector('.profile-avatar'), profile.avatarIndex, profile.isKids);
        item.addEventListener('click', () => openEditProfile(profile.id));
        list.appendChild(item);
    });

    if (profiles.length < MAX_PROFILES) {
        const addItem = document.createElement('div');
        addItem.className = 'profile-item add-profile';
        addItem.innerHTML = `
            <div class="profile-avatar add-avatar"><span>+</span></div>
            <span class="profile-name">Add Profile</span>
        `;
        addItem.addEventListener('click', () => openAddProfile());
        list.appendChild(addItem);
    }
}

// --- EDIT PROFILE ---
function rerenderEditAvatarPicker() {
    const isKids = document.getElementById('edit-kids-toggle').checked;
    renderProfileAvatar(document.getElementById('edit-avatar-preview'), editAvatarIndex, isKids);
    renderAvatarPicker('avatar-picker', isKids, editAvatarIndex, (idx) => {
        editAvatarIndex = idx;
        rerenderEditAvatarPicker();
    });
}

function openEditProfile(profileId) {
    editingProfileId = profileId;
    const profiles = getProfiles();
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;

    editAvatarIndex = profile.avatarIndex;
    document.getElementById('edit-profile-name').value = profile.name;
    document.getElementById('edit-kids-toggle').checked = profile.isKids;
    rerenderEditAvatarPicker();

    document.getElementById('delete-profile-btn').style.display = profiles.length > 1 ? 'inline-block' : 'none';

    showScreen(profileEditScreen);
}

function renderAvatarPicker(containerId, isKids, selectedIdx, onClick) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const avatars = isKids ? KIDS_AVATARS : AVATAR_COLORS;
    avatars.forEach((av, idx) => {
        const el = document.createElement('div');
        el.className = 'avatar-option' + (idx === selectedIdx ? ' selected' : '');
        el.style.backgroundColor = av.bg;
        el.textContent = av.icon;
        el.addEventListener('click', () => onClick(idx));
        container.appendChild(el);
    });
}

// --- ADD PROFILE ---
function rerenderAddAvatarPicker() {
    const isKids = document.getElementById('add-kids-toggle').checked;
    renderProfileAvatar(document.getElementById('add-avatar-preview'), addAvatarIndex, isKids);
    renderAvatarPicker('add-avatar-picker', isKids, addAvatarIndex, (idx) => {
        addAvatarIndex = idx;
        rerenderAddAvatarPicker();
    });
}

function openAddProfile() {
    addAvatarIndex = Math.floor(Math.random() * AVATAR_COLORS.length);
    document.getElementById('add-profile-name').value = '';
    document.getElementById('add-kids-toggle').checked = false;
    rerenderAddAvatarPicker();
    showScreen(profileAddScreen);
}

// --- TASTE PICKER ---
function openTastePicker(profileId) {
    tasteSelections = [];
    document.getElementById('taste-count').textContent = '0';
    document.getElementById('taste-done-btn').disabled = true;
    document.getElementById('taste-search-input').value = '';
    document.getElementById('taste-selected-bar').innerHTML = '';
    showScreen(tastePickerScreen);
    loadTasteGrid();
}

async function loadTasteGrid(query) {
    const grid = document.getElementById('taste-grid');
    grid.innerHTML = '<div class="taste-loading">Loading...</div>';
    let results;
    if (query && query.length > 1) {
        const data = await apiFetch('/search/multi', `&query=${encodeURIComponent(query)}`);
        results = data.results.filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path).slice(0, 20);
    } else {
        const data = await apiFetch('/movie/popular');
        const data2 = await apiFetch('/tv/popular');
        results = [...data.results, ...data2.results].filter(r => r.poster_path).sort(() => 0.5 - Math.random()).slice(0, 20);
        results.forEach(r => { if (!r.media_type) r.media_type = r.title ? 'movie' : 'tv'; });
    }
    grid.innerHTML = '';
    results.forEach(item => {
        const card = document.createElement('div');
        card.className = 'taste-card' + (tasteSelections.some(s => s.id === item.id) ? ' selected' : '');
        card.innerHTML = `
            <img src="${IMAGE_BASE_URL}w342${item.poster_path}" alt="${item.title || item.name}">
            <div class="taste-card-check"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg></div>
            <div class="taste-card-title">${item.title || item.name}</div>
        `;
        card.addEventListener('click', () => toggleTasteSelection(item, card));
        grid.appendChild(card);
    });
}

function toggleTasteSelection(item, card) {
    const idx = tasteSelections.findIndex(s => s.id === item.id);
    if (idx > -1) {
        tasteSelections.splice(idx, 1);
        card.classList.remove('selected');
    } else {
        if (tasteSelections.length >= 5) return;
        tasteSelections.push({ id: item.id, title: item.title || item.name, media_type: item.media_type || 'movie' });
        card.classList.add('selected');
    }
    document.getElementById('taste-count').textContent = tasteSelections.length;
    document.getElementById('taste-done-btn').disabled = tasteSelections.length < 5;
    renderTasteSelectedBar();
}

function renderTasteSelectedBar() {
    const bar = document.getElementById('taste-selected-bar');
    bar.innerHTML = '';
    tasteSelections.forEach(s => {
        const chip = document.createElement('span');
        chip.className = 'taste-chip';
        chip.textContent = s.title;
        bar.appendChild(chip);
    });
}

// --- MY LIST PAGE ---
function renderMyListPage() {
    const list = getMyList();
    myListGrid.innerHTML = '';
    if (list.length === 0) {
        myListEmpty.style.display = 'flex';
        myListGrid.style.display = 'none';
    } else {
        myListEmpty.style.display = 'none';
        myListGrid.style.display = 'grid';
        list.forEach(item => {
            const card = document.createElement('div');
            card.className = 'mylist-card';
            const imgUrl = item.backdrop_path
                ? `${IMAGE_BASE_URL}w500${item.backdrop_path}`
                : `${IMAGE_BASE_URL}w342${item.poster_path}`;
            card.innerHTML = `
                <div class="mylist-card-img" style="background-image: url(${imgUrl})">
                    <div class="mylist-card-overlay">
                        <button class="mylist-play-btn">▶</button>
                    </div>
                </div>
                <div class="mylist-card-info">
                    <span class="mylist-card-title"></span>
                    <button class="mylist-remove-btn" title="Remove from My List">✕</button>
                </div>
            `;
            card.querySelector('.mylist-card-title').textContent = item.title || item.name;
            card.querySelector('.mylist-play-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                loadMedia(item);
            });
            card.querySelector('.mylist-remove-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleMyList(item);
                renderMyListPage();
            });
            card.addEventListener('click', () => openDetailsModal(item));
            myListGrid.appendChild(card);
        });
    }
}

// --- ADD TO LIST BUTTON HELPERS ---
function updateAddToListButton(btn, itemId) {
    const inList = isInMyList(itemId);
    btn.classList.toggle('in-list', inList);
    btn.innerHTML = inList ? checkIcon : plusIcon;
    btn.title = inList ? 'Remove from My List' : 'Add to My List';
}

function updateHeroAddBtn() {
    if (!currentHeroItem) return;
    const inList = isInMyList(currentHeroItem.id);
    heroAddBtn.innerHTML = inList
        ? `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"></path></svg>`
        : `<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"></path></svg>`;
    heroAddBtn.classList.toggle('in-list', inList);
}


// --- Popup Logic ---
const clearPopup = (instant = false) => {
    const popups = document.querySelectorAll('.hover-popup.active');
    popups.forEach(popup => {
        if (instant) {
            popup.style.transition = 'none';
            popup.classList.remove('active');
            popup.style.display = 'none';
            void popup.offsetWidth;
            popup.style.transition = '';
        } else {
            popup.classList.remove('active');
            function handleTransitionEnd(e) {
                if (e.propertyName === 'opacity' && !popup.classList.contains('active')) {
                    popup.style.display = 'none';
                    popup.removeEventListener('transitionend', handleTransitionEnd);
                }
            }
            popup.addEventListener('transitionend', handleTransitionEnd);
        }
    });
    document.querySelectorAll('.poster-card-wrapper.dimmed').forEach(el => el.classList.remove('dimmed'));
    document.querySelectorAll('.category-row.lifted').forEach(el => el.classList.remove('lifted'));
};


// --- Lazy "small banner" title-logo overlay for row cards ---
const logoCache = new Map(); // tmdbId -> logo object | null (each title fetched once)

const cardLogoObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            observer.unobserve(entry.target);
            loadCardLogo(entry.target);
        }
    });
}, { rootMargin: '150px' });

async function loadCardLogo(cardWrapper) {
    const item = cardWrapper._item;
    const overlay = cardWrapper.querySelector('.card-logo');
    if (!item || !overlay) return;
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');

    let logo = logoCache.get(item.id);
    if (logo === undefined) {
        const data = await apiFetch(`/${mediaType}/${item.id}/images`, '&include_image_language=en,null');
        const best = pickBestLogo(data);
        // Only English / language-neutral logos, so we never show odd foreign-language art.
        logo = (best && (best.iso_639_1 === 'en' || best.iso_639_1 == null)) ? best : null;
        logoCache.set(item.id, logo);
    }
    if (logo) {
        const img = document.createElement('img');
        img.className = 'card-logo-img';
        img.src = `${IMAGE_BASE_URL}w500${logo.file_path}`;
        img.alt = (item.title || item.name || '') + ' logo';
        img.loading = 'lazy';
        overlay.appendChild(img);
        cardWrapper.classList.add('has-logo');
    }
}

const createPosterCard = (item, usePoster = false) => {
    const imagePath = usePoster ? item.poster_path : (item.backdrop_path || item.poster_path);
    if (!imagePath) return null;

    const cardWrapper = document.createElement('div');
    cardWrapper.className = 'poster-card-wrapper';

    const imageUrl = `${IMAGE_BASE_URL}${usePoster ? 'w342' : 'w500'}${imagePath}`;
    const title = item.title || item.name || '';

    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = title;
    img.loading = 'lazy';
    cardWrapper.appendChild(img);

    // Official title-logo overlay (the "small banner" art), lazy-loaded when scrolled into view.
    const logoOverlay = document.createElement('div');
    logoOverlay.className = 'card-logo';
    cardWrapper.appendChild(logoOverlay);
    cardWrapper._item = item;
    cardLogoObserver.observe(cardWrapper);

    cardWrapper.addEventListener('click', () => {
        const isPopupActive = cardWrapper.closest('.category-row')?.querySelector('.hover-popup.active');
        if (!isPopupActive) {
            openDetailsModal(item);
        }
    });

    // Hover preview is desktop-only; touch devices tap straight through to the modal.
    cardWrapper.addEventListener('mouseenter', () => {
        if (!canHover()) return;
        clearTimeout(hoverLeaveTimeout);
        hoverEnterTimeout = setTimeout(() => {
            positionAndShowPopup(cardWrapper, item);
        }, 500);
    });

    cardWrapper.addEventListener('mouseleave', () => {
        clearTimeout(hoverEnterTimeout);
        hoverLeaveTimeout = setTimeout(() => clearPopup(false), 300);
    });

    return cardWrapper;
};

const positionAndShowPopup = async (cardWrapper, item) => {
    if (!canHover()) return;
    clearPopup(true);

    const row = cardWrapper.closest('.category-row');
    if (!row) return;
    let popup = row.querySelector('.hover-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.className = 'hover-popup';
        row.appendChild(popup);
        popup.addEventListener('mouseenter', () => clearTimeout(hoverLeaveTimeout));
        popup.addEventListener('mouseleave', () => hoverLeaveTimeout = setTimeout(() => clearPopup(false), 300));
    }

    popup.style.display = 'block';

    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    let details = detailsCache.get(item.id);
    if (!details || !details.images) {
        details = await apiFetch(`/${mediaType}/${item.id}`, `&append_to_response=content_ratings,keywords,images&include_image_language=en,null`);
        detailsCache.set(item.id, details);
    }

    const bannerUrl = details.backdrop_path ? `${IMAGE_BASE_URL}w780${details.backdrop_path}` : `${IMAGE_BASE_URL}w500${details.poster_path}`;
    const year = new Date(details.release_date || details.first_air_date).getFullYear() || 'N/A';
    const rating = details.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating || 'NR';
    const tags = details.keywords?.keywords?.slice(0, 3).map(k => `<span>${k.name}</span>`).join('') || details.genres?.slice(0, 3).map(g => `<span>${g.name}</span>`).join('') || '';

    const logo = details.images?.logos?.find(l => l.iso_639_1 === 'en');
    let titleHTML;
    if (logo) {
        titleHTML = `<img src="${IMAGE_BASE_URL}w300${logo.file_path}" class="popup-title-logo" alt="${details.title || details.name}">`;
    } else {
        titleHTML = `<h3 class="popup-title-text">${details.title || details.name}</h3>`;
    }

    popup.innerHTML = `
        <div class="popup-media-container" style="background-image: url(${bannerUrl});">
            ${titleHTML}
        </div>
        <div class="popup-details">
            <div class="popup-actions">
                <button class="play-btn" title="Play">▶</button>
                <button class="popup-add-btn" title="${isInMyList(item.id) ? 'Remove from My List' : 'Add to My List'}">${isInMyList(item.id) ? '✓' : '＋'}</button>
                <button title="Like">👍</button>
                <button class="more-info-btn" title="More Info">ℹ</button>
            </div>
            <div class="popup-meta">
                <span>${year}</span>
                <span class="age-rating">${rating}</span>
                ${mediaType === 'tv' ? `<span>${details.number_of_seasons} Seasons</span>` : `<span>${details.runtime} min</span>`}
            </div>
            <div class="popup-tags">${tags}</div>
        </div>`;

    popup.querySelector('.play-btn').addEventListener('click', () => loadMedia(item));
    const popupAddBtn = popup.querySelector('.popup-add-btn');
    if (isInMyList(item.id)) popupAddBtn.classList.add('in-list');
    popupAddBtn.addEventListener('click', () => {
        const added = toggleMyList(item);
        popupAddBtn.textContent = added ? '✓' : '＋';
        popupAddBtn.classList.toggle('in-list', added);
        updateHeroAddBtn();
    });
    popup.querySelector('.more-info-btn').addEventListener('click', () => openDetailsModal(item));
    popup.querySelector('.popup-media-container').addEventListener('click', () => loadMedia(item));
    popup.querySelector('.popup-details').addEventListener('click', (e) => {
        if (e.target.closest('.popup-actions button')) {
            return;
        }
        openDetailsModal(item);
    });

    const rect = cardWrapper.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const popupWidth = 420;
    const popupHeight = 250;
    const left = Math.max(10, Math.min(rect.left - rowRect.left + rect.width / 2 - popupWidth / 2, rowRect.width - popupWidth - 10));
    const top = rect.top - rowRect.top - (popupHeight / 2) + (rect.height / 2) - 40;

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;

    setTimeout(() => popup.classList.add('active'), 10);

    cardWrapper.parentElement.querySelectorAll('.poster-card-wrapper').forEach(sib => {
        if (sib !== cardWrapper) sib.classList.add('dimmed');
    });
    row.classList.add('lifted');
};


// --- Page Content & Row Generation ---
function setupSlider(sliderElement) {
    if (!sliderElement) return;
    const container = sliderElement.querySelector('.posters-container, #continue-watching-display');
    const prevBtn = sliderElement.querySelector('.slider-arrow.prev');
    const nextBtn = sliderElement.querySelector('.slider-arrow.next');
    if (!container || !prevBtn || !nextBtn) return;

    const handleScroll = () => {
        const scrollLeft = Math.ceil(container.scrollLeft);
        const maxScroll = container.scrollWidth - container.clientWidth;
        prevBtn.classList.toggle('hidden', scrollLeft < 10);
        nextBtn.classList.toggle('hidden', scrollLeft >= maxScroll - 10);
    };

    nextBtn.addEventListener('click', () => {
        const scrollAmount = container.clientWidth * 0.9;
        container.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });

    prevBtn.addEventListener('click', () => {
        const scrollAmount = container.clientWidth * 0.9;
        container.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });

    container.addEventListener('scroll', handleScroll, { passive: true });

    const observer = new MutationObserver(() => {
        setTimeout(handleScroll, 100);
    });
    observer.observe(container, { childList: true });
    handleScroll();
}

const createCategoryRow = (title, endpoint) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.dataset.endpoint = endpoint;
    row.innerHTML = `<div class="category-header"><h2 class="category-title">${title}</h2></div>`;

    const slider = document.createElement('div');
    slider.className = 'slider';
    slider.innerHTML = `
        <button class="slider-arrow prev hidden">${prevArrowIcon}</button>
        <div class="posters-container"></div>
        <button class="slider-arrow next">${nextArrowIcon}</button>`;

    row.appendChild(slider);
    setupSlider(slider);
    return row;
};

const populateRow = async (row) => {
    const endpoint = row.dataset.endpoint;
    if (!endpoint || row.dataset.loaded) return;
    row.dataset.loaded = 'true';
    const { results } = await apiFetch(endpoint);
    const postersContainer = row.querySelector('.posters-container');
    results.forEach(item => {
        const cardWrapper = createPosterCard(item);
        if (cardWrapper) postersContainer.appendChild(cardWrapper);
    });
};

const createTabbedCategoryRow = (config) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    const header = document.createElement('div');
    header.className = 'category-header';
    const titleEl = document.createElement('h2');
    titleEl.className = 'category-title';
    titleEl.textContent = config.title;
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'tabs-container';

    config.tabs.forEach((tab, index) => {
        const tabEl = document.createElement('span');
        tabEl.className = 'tab-item';
        tabEl.textContent = tab.name;
        tabEl.dataset.tabId = tab.id;
        if (index === 0) {
            tabEl.classList.add('active');
            if (config.title === 'Series on') titleEl.textContent = `${config.title} ${tab.name}`;
        }
        tabsContainer.appendChild(tabEl);
    });

    header.append(titleEl, tabsContainer);
    row.appendChild(header);

    const slider = document.createElement('div');
    slider.className = 'slider';
    slider.innerHTML = `
        <button class="slider-arrow prev hidden">${prevArrowIcon}</button>
        <div class="posters-container"></div>
        <button class="slider-arrow next">${nextArrowIcon}</button>`;

    row.appendChild(slider);
    setupSlider(slider);

    tabsContainer.addEventListener('click', e => {
        if (e.target.matches('.tab-item:not(.active)')) {
            tabsContainer.querySelector('.active').classList.remove('active');
            e.target.classList.add('active');
            const selectedTab = config.tabs.find(t => t.id == e.target.dataset.tabId);
            if (config.title === 'Series on') titleEl.textContent = `${config.title} ${selectedTab.name}`;
            populateTabbedRow(row, selectedTab, config.type);
        }
    });
    return row;
};

const populateTabbedRow = async (row, tabConfig, mediaType) => {
    const postersContainer = row.querySelector('.posters-container');
    Array.from(postersContainer.children).forEach(child => child.classList.add('fading-out'));

    setTimeout(async () => {
        postersContainer.innerHTML = '';
        const endpoint = mediaType === 'movie' ? '/discover/movie' : '/discover/tv';
        const params = mediaType === 'movie'
            ? `&with_genres=${tabConfig.id}&sort_by=popularity.desc`
            : `&with_networks=${tabConfig.id}&sort_by=popularity.desc`;
        const { results } = await apiFetch(endpoint, params);

        results.forEach(item => {
            item.media_type = mediaType;
            const cardWrapper = createPosterCard(item);
            if (cardWrapper) {
                cardWrapper.classList.add('fading-in');
                postersContainer.appendChild(cardWrapper);
            }
        });

        setTimeout(() => {
            postersContainer.querySelectorAll('.fading-in').forEach(p => p.classList.remove('fading-in'));
        }, 10);
    }, 300);
};

const createForYouRow = async (history) => {
    if (history.length < 1) return null;

    const genreCounts = new Map();
    const itemsToScan = history.slice(0, 5);

    for (const item of itemsToScan) {
        const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
        let details = detailsCache.get(item.id);
        if (!details) {
            details = await apiFetch(`/${mediaType}/${item.id}`);
            if(details) detailsCache.set(item.id, details);
        }
        if (details && details.genres) {
            details.genres.forEach(genre => {
                genreCounts.set(genre.id, (genreCounts.get(genre.id) || 0) + 1);
            });
        }
    }

    if (genreCounts.size === 0) return null;

    const sortedGenres = [...genreCounts.entries()].sort((a, b) => b[1] - a[1]);
    const topGenreIds = sortedGenres.slice(0, 2).map(g => g[0]).join(',');

    const { results: movieResults } = await apiFetch('/discover/movie', `&with_genres=${topGenreIds}&sort_by=popularity.desc`);
    const { results: tvResults } = await apiFetch('/discover/tv', `&with_genres=${topGenreIds}&sort_by=popularity.desc`);

    const combinedResults = [...movieResults, ...tvResults].sort(() => 0.5 - Math.random());
    if (combinedResults.length < 1) return null;

    const row = createCategoryRow("Top Picks For You", '');
    row.dataset.loaded = 'true';
    const postersContainer = row.querySelector('.posters-container');
    postersContainer.innerHTML = '';

    const historyIds = new Set(history.map(h => h.id));
    const filteredResults = combinedResults.filter(r => !historyIds.has(r.id));

    filteredResults.slice(0, 20).forEach(item => {
        item.media_type = item.media_type || (item.name ? 'tv' : 'movie');
        const cardWrapper = createPosterCard(item);
        if (cardWrapper) postersContainer.appendChild(cardWrapper);
    });

    return postersContainer.children.length > 0 ? row : null;
};

const createBecauseYouWatchedRow = async (lastWatchedItem) => {
    if (!lastWatchedItem) return null;

    const mediaType = lastWatchedItem.media_type || (lastWatchedItem.title ? 'movie' : 'tv');
    const { results } = await apiFetch(`/${mediaType}/${lastWatchedItem.id}/recommendations`);

    if (!results || results.length < 1) return null;

    const row = document.createElement('div');
    row.className = 'category-row';
    const title = lastWatchedItem.title || lastWatchedItem.name;

    const header = document.createElement('div');
    header.className = 'category-header recommendation-header';
    header.innerHTML = `
        <h2 class="category-title">
            <span>Because you watched</span>
            <img class="title-poster" src="${IMAGE_BASE_URL}w92${lastWatchedItem.poster_path}" alt="${title}">
            <span class="watched-title">${title}</span>
        </h2>
    `;
    row.appendChild(header);

    const slider = document.createElement('div');
    slider.className = 'slider';
    slider.innerHTML = `
        <button class="slider-arrow prev hidden">${prevArrowIcon}</button>
        <div class="posters-container"></div>
        <button class="slider-arrow next">${nextArrowIcon}</button>`;
    row.appendChild(slider);

    const postersContainer = slider.querySelector('.posters-container');
    results.forEach(item => {
        item.media_type = item.media_type || mediaType;
        const cardWrapper = createPosterCard(item);
        if (cardWrapper) postersContainer.appendChild(cardWrapper);
    });

    setupSlider(slider);
    return postersContainer.children.length > 0 ? row : null;
};


const updateHero = async (page) => {
    const profile = getActiveProfile();
    const isKids = profile && profile.isKids;
    const config = isKids ? (KIDS_CONTENT_CONFIG[page] || CONTENT_CONFIG[page]) : CONTENT_CONFIG[page];
    if (!config) return;
    const heroCategory = config.find(cat => cat.endpoint);
    if (!heroCategory) return;
    const { results } = await apiFetch(heroCategory.endpoint, heroCategory.params || '');
    const heroData = results.find(item => item.backdrop_path);
    if (heroData) {
        const mediaType = heroData.media_type || (heroData.title ? 'movie' : 'tv');
        const details = await apiFetch(`/${mediaType}/${heroData.id}`, '&append_to_response=content_ratings,images&include_image_language=en,null');
        currentHeroItem = { ...heroData, ...details };

        stopHeroTrailer();
        if (isMobile()) {
            // Bottom-up fade so the centered logo + buttons stay legible.
            heroSection.style.backgroundImage = `linear-gradient(to top, #141414 0%, rgba(20,20,20,0.6) 30%, rgba(20,20,20,0) 65%), url(${IMAGE_BASE_URL}w780${currentHeroItem.backdrop_path})`;
        } else {
            heroSection.style.backgroundImage = `linear-gradient(to right, rgba(20,20,20,1) 0%, rgba(20,20,20,0) 50%), url(${IMAGE_BASE_URL}original${currentHeroItem.backdrop_path})`;
        }

        const logo = currentHeroItem.images?.logos?.find(l => l.iso_639_1 === 'en');
        if (logo) {
            heroTitle.innerHTML = `<img src="${IMAGE_BASE_URL}w500${logo.file_path}" alt="${currentHeroItem.title || currentHeroItem.name}" class="hero-title-logo">`;
        } else {
            heroTitle.textContent = currentHeroItem.title || currentHeroItem.name;
        }

        heroOverview.textContent = currentHeroItem.overview;
        heroAgeRating.textContent = currentHeroItem.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating || '';
        heroPlayBtn.onclick = () => loadMedia(currentHeroItem);
        heroInfoBtn.onclick = () => openDetailsModal(currentHeroItem);
        heroAddBtn.onclick = () => {
            toggleMyList(currentHeroItem);
            updateHeroAddBtn();
        };
        updateHeroAddBtn();
    }
};

const updateMuteButtonIcon = () => {
    heroMuteBtn.innerHTML = isHeroMuted ? volumeOffIcon : volumeUpIcon;
};

const toggleHeroMute = () => {
    isHeroMuted = !isHeroMuted;
    updateMuteButtonIcon();
    const player = heroVideoContainer.querySelector('iframe');
    if (player) {
        const command = isHeroMuted ? 'mute' : 'unMute';
        player.contentWindow.postMessage(JSON.stringify({ event: 'command', func: command, args: [] }), '*');
    }
};

const playHeroTrailerAfterDelay = () => {
    clearTimeout(heroTrailerTimeout);
    // Skip auto-playing trailers on phones (saves data, avoids blocked autoplay).
    if (isMobile()) return;
    heroTrailerTimeout = setTimeout(async () => {
        if (currentHeroItem) {
            const mediaType = currentHeroItem.media_type || (currentHeroItem.title ? 'movie' : 'tv');
            const { results } = await apiFetch(`/${mediaType}/${currentHeroItem.id}/videos`);
            const trailer = results.find(vid => vid.site === 'YouTube' && (vid.type === 'Trailer' || vid.type === 'Teaser'));
            if (trailer) {
                const muteState = isHeroMuted ? 1 : 0;
                const origin = encodeURIComponent(window.location.origin);
                heroVideoContainer.innerHTML = `<iframe src="${YOUTUBE_EMBED_URL}${trailer.key}?autoplay=1&mute=${muteState}&controls=0&loop=1&playlist=${trailer.key}&rel=0&enablejsapi=1&origin=${origin}&iv_load_policy=3&modestbranding=1" allow="autoplay; encrypted-media" frameborder="0"></iframe>`;
                heroVideoContainer.classList.add('visible');
                updateMuteButtonIcon();
                heroMuteBtn.style.display = 'flex';
            }
        }
    }, 1000);
};

const stopHeroTrailer = () => {
    clearTimeout(heroTrailerTimeout);
    heroVideoContainer.classList.remove('visible');
    heroMuteBtn.style.display = 'none';
    setTimeout(() => {
        heroVideoContainer.innerHTML = '';
    }, 500);
};

// --- loadPageContent ---
const loadPageContent = async (page) => {
    currentPage = page;
    contentRows.innerHTML = '';

    // Handle My List page
    if (page === 'mylist') {
        heroSection.style.display = 'none';
        contentRows.style.display = 'none';
        myListPage.style.display = 'block';
        stopHeroTrailer();
        renderMyListPage();
        return;
    } else {
        heroSection.style.display = '';
        contentRows.style.display = '';
        myListPage.style.display = 'none';
    }

    const profile = getActiveProfile();
    const isKids = profile && profile.isKids;
    const config = isKids ? (KIDS_CONTENT_CONFIG[page] || CONTENT_CONFIG[page]) : CONTENT_CONFIG[page];

    if (page === 'home') {
        contentRows.appendChild(continueWatchingSection);
        renderContinueWatching();

        // My List row on home page
        const myList = getMyList();
        if (myList.length > 0) {
            const myListRow = createCategoryRow('My List', '');
            myListRow.dataset.loaded = 'true';
            const postersContainer = myListRow.querySelector('.posters-container');
            myList.slice(0, 20).forEach(item => {
                const cardWrapper = createPosterCard(item);
                if (cardWrapper) postersContainer.appendChild(cardWrapper);
            });
            contentRows.appendChild(myListRow);
        }

        const history = getHistory();
        if (history.length > 0) {
            const forYouRow = await createForYouRow(history);
            if (forYouRow) contentRows.appendChild(forYouRow);

            const becauseRow = await createBecauseYouWatchedRow(history[0]);
            if (becauseRow) contentRows.appendChild(becauseRow);
        }
    }

    await updateHero(page);

    config.forEach(cat => {
        let row;
        if (cat.type === 'tabbed') {
            row = createTabbedCategoryRow(cat.config);
            contentRows.appendChild(row);
            populateTabbedRow(row, cat.config.tabs[0], cat.config.type);
        } else if (cat.endpoint) {
            row = createCategoryRow(cat.title, cat.endpoint + (cat.params || ''));
            contentRows.appendChild(row);
            rowObserver.observe(row);
        }
    });
};

// --- NETFLIX-STYLE DETAILS MODAL & EPISODES LOGIC ---
function formatRuntime(minutes) {
    if (!minutes) return 'N/A';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h > 0 ? h + 'h ' : ''}${m}m`;
}

function createGridCard(item, parentMediaType) {
    if (!item.backdrop_path && !item.poster_path) return null;
    const card = document.createElement('div');
    card.className = 'grid-card';
    const year = item.release_date || item.first_air_date ? new Date(item.release_date || item.first_air_date).getFullYear() : 'N/A';
    item.media_type = item.media_type || parentMediaType;
    const inList = isInMyList(item.id);

    card.innerHTML = `
        <div class="grid-card-img" style="background-image: url(${IMAGE_BASE_URL}w500${item.backdrop_path || item.poster_path})"></div>
        <div class="grid-card-info">
            <div class="grid-card-header">
                <div class="grid-card-meta">
                    <span>${year}</span>
                </div>
                <button class="grid-card-add-btn${inList ? ' in-list' : ''}">${inList ? '✓' : '+'}</button>
            </div>
            <p class="grid-card-overview">${item.overview ? item.overview.substring(0, 100) + '...' : ''}</p>
        </div>
    `;
    const addBtn = card.querySelector('.grid-card-add-btn');
    addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const added = toggleMyList(item);
        addBtn.textContent = added ? '✓' : '+';
        addBtn.classList.toggle('in-list', added);
    });
    card.addEventListener('click', () => openDetailsModal(item));
    return card;
}

const loadEpisodes = async (tvId, seasonNumber) => {
    const seasonDetails = await apiFetch(`/tv/${tvId}/season/${seasonNumber}`);
    const episodeList = document.getElementById('episode-list');
    episodeList.innerHTML = '';

    if (seasonDetails && seasonDetails.episodes) {
        seasonDetails.episodes.forEach(ep => {
            const li = document.createElement('li');
            li.className = 'episode-item';
            const overview = ep.overview ? ep.overview.substring(0, 200) + (ep.overview.length > 200 ? '...' : '') : 'No overview available.';
            li.innerHTML = `
                <span class="episode-number">${ep.episode_number}</span>
                <div class="episode-thumbnail-container">
                    <img class="episode-thumbnail" src="${ep.still_path ? IMAGE_BASE_URL + 'w300' + ep.still_path : ''}" alt="Episode ${ep.episode_number}">
                    <div class="play-icon-overlay">
                        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5v14l11-7z"></path></svg>
                    </div>
                </div>
                <div class="episode-details">
                    <div class="episode-title-bar">
                        <h3></h3>
                        <span class="episode-runtime">${ep.runtime ? ep.runtime + 'm' : ''}</span>
                    </div>
                    <p></p>
                </div>
            `;
            li.querySelector('h3').textContent = ep.name || `Episode ${ep.episode_number}`;
            li.querySelector('.episode-details p').textContent = overview;
            li.onclick = () => {
                closeDetailsModal();
                const tvShowInfo = detailsCache.get(tvId) || { id: tvId, media_type: 'tv' };
                tvShowInfo.media_type = 'tv';
                loadMedia(tvShowInfo, Number(seasonNumber), ep.episode_number);
            };
            episodeList.appendChild(li);
        });
    }
};

const updateModalMuteButton = () => {
    const modalMuteBtn = document.getElementById('modal-mute-btn');
    modalMuteBtn.innerHTML = isModalMuted ? volumeOffIcon : volumeUpIcon;
};

const toggleModalMute = () => {
    isModalMuted = !isModalMuted;
    updateModalMuteButton();
    const player = document.querySelector('#modal-backdrop iframe');
    if (player) {
        const command = isModalMuted ? 'mute' : 'unMute';
        player.contentWindow.postMessage(JSON.stringify({ event: 'command', func: command, args: [] }), '*');
    }
};

const openDetailsModal = async (item) => {
    const mediaType = item.media_type || (item.title ? 'movie' : 'tv');
    const details = await apiFetch(`/${mediaType}/${item.id}`, `&append_to_response=credits,videos,content_ratings,recommendations,keywords,images&include_image_language=en,null`);

    if (!details || !details.id) {
        alert("Sorry, could not load details for this title.");
        return;
    }
    details.media_type = mediaType;
    detailsCache.set(details.id, details);

    detailsModal.querySelector('.modal-content').scrollTop = 0;

    const modalBackdrop = document.getElementById('modal-backdrop');
    const trailer = details.videos?.results.find(v => v.site === 'YouTube' && v.type === 'Trailer');

    // Mobile browsers block autoplay WITH sound, so start muted on phones (the user
    // can tap unmute). `playsinline=1` keeps iOS from forcing native fullscreen.
    isModalMuted = isMobile();
    if (trailer) {
        const muteState = isModalMuted ? 1 : 0;
        const origin = encodeURIComponent(window.location.origin);
        modalBackdrop.innerHTML = `<iframe src="${YOUTUBE_EMBED_URL}${trailer.key}?autoplay=1&mute=${muteState}&controls=0&loop=1&playlist=${trailer.key}&rel=0&enablejsapi=1&origin=${origin}&iv_load_policy=3&modestbranding=1&playsinline=1" allow="autoplay; encrypted-media" frameborder="0"></iframe>`;
        updateModalMuteButton();
        document.getElementById('modal-mute-btn').style.display = 'flex';
    } else {
        modalBackdrop.innerHTML = '';
        modalBackdrop.style.backgroundImage = `url(${IMAGE_BASE_URL}original${details.backdrop_path || details.poster_path})`;
        document.getElementById('modal-mute-btn').style.display = 'none';
    }

    const titleContainer = document.getElementById('modal-title-logo-container');
    const logo = details.images?.logos?.find(l => l.iso_639_1 === 'en');
    if (logo) {
        titleContainer.innerHTML = `<img src="${IMAGE_BASE_URL}w500${logo.file_path}" alt="${details.title || details.name}" class="modal-title-logo">`;
    } else {
        titleContainer.innerHTML = `<h1 class="modal-title-text"></h1>`;
        titleContainer.querySelector('h1').textContent = details.title || details.name;
    }

    document.getElementById('modal-play-btn').onclick = () => {
        closeDetailsModal();
        loadMedia(details);
    };

    // Add to List button in modal
    const modalAddBtn = document.getElementById('modal-add-btn');
    updateAddToListButton(modalAddBtn, details.id);
    modalAddBtn.onclick = () => {
        toggleMyList(details);
        updateAddToListButton(modalAddBtn, details.id);
        updateHeroAddBtn();
    };

    document.getElementById('modal-year').textContent = new Date(details.release_date || details.first_air_date).getFullYear() || 'N/A';
    const rating = details.content_ratings?.results?.find(r => r.iso_3166_1 === 'US')?.rating || 'NR';
    document.getElementById('modal-age-rating').textContent = rating;
    document.getElementById('modal-overview').textContent = details.overview;

    document.getElementById('modal-cast').textContent = (details.credits?.cast.slice(0, 3).map(c => c.name).join(', ') || 'N/A') + ', more';
    document.getElementById('modal-genres').textContent = details.genres?.map(g => g.name).join(', ');
    const keywords = details.keywords?.keywords || details.keywords?.results || [];
    document.getElementById('modal-keywords').textContent = keywords.slice(0, 3).map(k => k.name).join(', ');

    const episodesSection = document.getElementById('episodes-section');
    const seasonsSpan = document.getElementById('modal-seasons');
    if (mediaType === 'tv') {
        seasonsSpan.textContent = `${details.number_of_seasons} Seasons`;
        seasonsSpan.style.display = 'inline';
        episodesSection.style.display = 'block';
        const seasonSelector = document.getElementById('season-selector');
        seasonSelector.innerHTML = '';
        details.seasons.forEach(season => {
            if (season.season_number > 0 && season.episode_count > 0) {
                const option = document.createElement('option');
                option.value = season.season_number;
                option.textContent = `Season ${season.season_number}`;
                seasonSelector.appendChild(option);
            }
        });
        seasonSelector.onchange = () => loadEpisodes(details.id, seasonSelector.value);
        if(seasonSelector.options.length > 0) {
            loadEpisodes(details.id, seasonSelector.value);
        }
    } else {
        seasonsSpan.style.display = 'none';
        episodesSection.style.display = 'none';
    }

    const gridContainer = document.getElementById('modal-recommendations-grid');
    gridContainer.innerHTML = '';
    details.recommendations?.results.slice(0, 9).forEach(recItem => {
        const card = createGridCard(recItem, mediaType);
        if (card) gridContainer.appendChild(card);
    });

    detailsModal.classList.add('active');
};

const closeDetailsModal = () => {
    detailsModal.classList.remove('active');
    document.getElementById('modal-backdrop').innerHTML = '';
};

// --- Player Logic ---
const loadMedia = (mediaItem, season = 1, episode = 1, startTime = 0) => {
    stopHeroTrailer();
    const mediaType = mediaItem.media_type || mediaItem.mediaType || (mediaItem.title ? 'movie' : 'tv');

    // Track what's playing so progress events can be tagged with real metadata.
    currentlyPlaying = {
        id: String(mediaItem.id),
        mediaType,
        title: mediaItem.title || mediaItem.name || '',
        name: mediaItem.name || '',
        poster_path: mediaItem.poster_path || null,
        backdrop_path: mediaItem.backdrop_path || null,
        season: mediaType === 'tv' ? season : undefined,
        episode: mediaType === 'tv' ? episode : undefined,
    };

    saveToHistory(mediaItem);
    generatePlayer(mediaItem, season, episode, startTime);
    showPlayerScreen();
    if (document.getElementById('search-overlay').classList.contains('active')) closeSearchOverlay();
};

const generatePlayer = (mediaItem, season = 1, episode = 1, startTime = 0) => {
    let embedUrl = '';
    const tmdbId = mediaItem.id;
    const mediaType = mediaItem.media_type || mediaItem.mediaType || (mediaItem.title ? 'movie' : 'tv');
    const start = Math.floor(startTime || 0);

    if (currentPlayerAPI === 'videasy') {
        const base = 'https://player.videasy.net/';
        const path = mediaType === 'movie' ? `movie/${tmdbId}` : `tv/${tmdbId}/${season}/${episode}`;
        const params = new URLSearchParams({
            color: ACCENT_HEX,
            episodeSelector: 'true',
            nextEpisode: 'true',
            autoplayNextEpisode: 'true',
            overlay: 'true'
        });
        if (start > 0) params.set('progress', start);
        embedUrl = `${base}${path}?${params.toString()}`;

    } else if (currentPlayerAPI === 'vidking') {
        const vidkingBaseUrl = 'https://www.vidking.net/embed/';
        const path = mediaType === 'movie' ? `movie/${tmdbId}` : `tv/${tmdbId}/${season}/${episode}`;
        const params = new URLSearchParams({
            color: ACCENT_HEX,
            nextEpisode: 'true',
            episodeSelector: 'true',
            autoPlay: 'true'
        });
        if (start > 0) params.set('progress', start);
        embedUrl = `${vidkingBaseUrl}${path}?${params.toString()}`;

    } else if (currentPlayerAPI === 'vidsrc') {
        const vidsrcBaseUrl = 'https://vidsrc.xyz/embed/';
        const path = mediaType === 'movie'
            ? `movie?tmdb=${tmdbId}`
            : `tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
        embedUrl = `${vidsrcBaseUrl}${path}`;

    } else if (currentPlayerAPI === 'anyembed') {
        const anyembedBaseUrl = 'https://player.autoembed.cc/embed/';
        const path = mediaType === 'movie' ? `movie/${tmdbId}` : `tv/${tmdbId}/${season}/${episode}`;
        embedUrl = `${anyembedBaseUrl}${path}`;

    } else if (currentPlayerAPI === 'vidlink') {
        const vidlinkBaseUrl = 'https://vidlink.pro/';
        const path = mediaType === 'movie' ? `movie/${tmdbId}` : `tv/${tmdbId}/${season}/${episode}`;
        const params = new URLSearchParams({
            primaryColor: ACCENT_HEX,
            autoplay: 'true',
            nextButton: 'true',
            episodeList: 'true'
        });
        embedUrl = `${vidlinkBaseUrl}${path}?${params.toString()}`;
    }

    // NOTE: These players actively detect the iframe `sandbox` attribute and refuse to
    // run ("Iframe Sandbox Detected"), so we cannot block their popups/redirects in-page.
    // Ad-blocking has to be done at the browser level (uBlock Origin / Brave / AdGuard DNS).
    playerPreview.innerHTML = `<iframe src="${embedUrl}" allowfullscreen allow="autoplay; encrypted-media; fullscreen"></iframe>`;
};


// --- Search Logic ---
async function fetchSearchResults(query) {
    const { results } = await apiFetch(`/search/multi`, `&query=${encodeURIComponent(query)}`);
    return (results || []).filter(r => (r.media_type === 'movie' || r.media_type === 'tv') && r.poster_path);
}

const handleSearch = (event) => {
    clearTimeout(searchTimeout);
    const query = event.target.value.trim();
    if (query.length < 2) {
        searchResultsList.style.display = 'none';
        return;
    }
    searchTimeout = setTimeout(async () => {
        const validResults = (await fetchSearchResults(query)).slice(0, 5);
        searchResultsList.innerHTML = '';
        if (validResults.length > 0) {
            validResults.forEach(result => {
                const item = document.createElement('div');
                item.className = 'result-item';
                const title = result.title || result.name;
                const releaseDate = result.release_date || result.first_air_date;
                const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';
                item.innerHTML = `<img src="${IMAGE_BASE_URL}w92${result.poster_path}" alt=""><div class="result-details"><h3></h3><p>${result.media_type === 'tv' ? 'TV Show' : 'Movie'} &bull; ${year}</p></div>`;
                item.querySelector('h3').textContent = title;
                item.addEventListener('click', () => {
                    openDetailsModal(result);
                    searchResultsList.style.display = 'none';
                    searchInput.value = '';
                });
                searchResultsList.appendChild(item);
            });
            searchResultsList.style.display = 'block';
        } else {
            searchResultsList.innerHTML = '<div style="padding: 10px; text-align: center;">No results found</div>';
            searchResultsList.style.display = 'block';
        }
    }, 300);
};

// --- Mobile Search Overlay ---
let mobileSearchTimeout;
function openSearchOverlay() {
    searchOverlay.classList.add('active');
    searchOverlayResults.innerHTML = '<div class="search-overlay-hint">Search for movies and TV shows.</div>';
    setTimeout(() => searchOverlayInput.focus(), 60);
}
function closeSearchOverlay() {
    searchOverlay.classList.remove('active');
    searchOverlayInput.value = '';
    searchOverlayResults.innerHTML = '';
}
function handleMobileSearch() {
    clearTimeout(mobileSearchTimeout);
    const query = searchOverlayInput.value.trim();
    if (query.length < 2) {
        searchOverlayResults.innerHTML = '<div class="search-overlay-hint">Search for movies and TV shows.</div>';
        return;
    }
    searchOverlayResults.innerHTML = '<div class="search-overlay-hint">Searching…</div>';
    mobileSearchTimeout = setTimeout(async () => {
        const results = (await fetchSearchResults(query)).slice(0, 20);
        searchOverlayResults.innerHTML = '';
        if (!results.length) {
            searchOverlayResults.innerHTML = '<div class="search-overlay-hint">No results found.</div>';
            return;
        }
        results.forEach(result => {
            const row = document.createElement('div');
            row.className = 'search-result-row';
            const title = result.title || result.name;
            const releaseDate = result.release_date || result.first_air_date;
            const year = releaseDate ? new Date(releaseDate).getFullYear() : 'N/A';
            row.innerHTML = `<img src="${IMAGE_BASE_URL}w154${result.poster_path}" alt=""><div><h3></h3><p>${result.media_type === 'tv' ? 'TV Show' : 'Movie'} &bull; ${year}</p></div>`;
            row.querySelector('h3').textContent = title;
            row.addEventListener('click', () => {
                closeSearchOverlay();
                openDetailsModal(result);
            });
            searchOverlayResults.appendChild(row);
        });
    }, 350);
}

// --- API Selector Logic ---
const VALID_PLAYERS = ['videasy', 'vidking', 'vidsrc', 'anyembed', 'vidlink'];
const PLAYER_DISPLAY_NAMES = { videasy: 'Videasy', vidking: 'VidKing', vidsrc: 'VidSrc', anyembed: 'Anyembed', vidlink: 'VidLink' };

function setPlayerAPI(apiName) {
    if (!VALID_PLAYERS.includes(apiName)) {
        apiName = 'videasy';
    }

    currentPlayerAPI = apiName;
    localStorage.setItem('playerAPI', apiName);

    currentPlayerName.textContent = PLAYER_DISPLAY_NAMES[apiName] || apiName;

    document.querySelectorAll('#player-menu li').forEach(li => {
        const checkmark = li.querySelector('.checkmark');
        if (li.dataset.api === apiName) {
            li.classList.add('active');
            if (checkmark) checkmark.style.display = 'inline';
        } else {
            li.classList.remove('active');
            if (checkmark) checkmark.style.display = 'none';
        }
    });
}

// --- NAVIGATION (desktop + mobile in sync) ---
function setActivePage(page) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
    document.querySelectorAll('#mobile-nav .mobile-nav-item[data-page]').forEach(l => l.classList.toggle('active', l.dataset.page === page));
}

function goToPage(page) {
    setActivePage(page);
    homeScreen.scrollTop = 0;
    loadPageContent(page);
}


// --- Event Listeners ---
backToHomeBtn.addEventListener('click', showHomeScreen);
searchInput.addEventListener('input', handleSearch);
heroMuteBtn.addEventListener('click', toggleHeroMute);
homeScreen.addEventListener('scroll', () => mainNav.classList.toggle('scrolled', homeScreen.scrollTop > 10));

navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        goToPage(e.currentTarget.dataset.page);
    });
});

// Mobile bottom nav
document.querySelectorAll('#mobile-nav .mobile-nav-item[data-page]').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        goToPage(link.dataset.page);
    });
});
document.getElementById('mobile-nav-search').addEventListener('click', (e) => { e.preventDefault(); openSearchOverlay(); });
document.getElementById('mobile-search-btn').addEventListener('click', openSearchOverlay);

// Logo -> home
document.querySelector('#main-nav .logo').addEventListener('click', (e) => { e.preventDefault(); goToPage('home'); });

// Mobile search overlay listeners
document.getElementById('search-overlay-back').addEventListener('click', closeSearchOverlay);
document.getElementById('search-overlay-clear').addEventListener('click', () => {
    searchOverlayInput.value = '';
    handleMobileSearch();
    searchOverlayInput.focus();
});
searchOverlayInput.addEventListener('input', handleMobileSearch);

document.addEventListener('fullscreenchange', () => backToHomeBtn.style.display = document.fullscreenElement ? 'none' : 'block');

// Profile screen buttons
document.getElementById('manage-profiles-btn').addEventListener('click', () => {
    renderProfileManageScreen();
    showScreen(profileManageScreen);
});
document.getElementById('done-manage-btn').addEventListener('click', () => {
    renderProfileScreen();
    showScreen(profileScreen);
});

// Edit profile buttons
document.getElementById('save-profile-btn').addEventListener('click', () => {
    const profiles = getProfiles();
    const profile = profiles.find(p => p.id === editingProfileId);
    if (!profile) return;
    const newName = document.getElementById('edit-profile-name').value.trim();
    if (!newName) return;
    profile.name = newName;
    profile.avatarIndex = editAvatarIndex;
    profile.isKids = document.getElementById('edit-kids-toggle').checked;
    saveProfiles(profiles);
    renderProfileManageScreen();
    showScreen(profileManageScreen);
});
document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    renderProfileManageScreen();
    showScreen(profileManageScreen);
});
document.getElementById('delete-profile-btn').addEventListener('click', () => {
    let profiles = getProfiles();
    if (profiles.length <= 1) return;
    profiles = profiles.filter(p => p.id !== editingProfileId);
    saveProfiles(profiles);
    if (getActiveProfileId() === editingProfileId) {
        setActiveProfileId(profiles[0].id);
    }
    renderProfileManageScreen();
    showScreen(profileManageScreen);
});

// Edit kids toggle
document.getElementById('edit-kids-toggle').addEventListener('change', () => {
    const isKids = document.getElementById('edit-kids-toggle').checked;
    if (isKids && editAvatarIndex >= KIDS_AVATARS.length) editAvatarIndex = 0;
    rerenderEditAvatarPicker();
});

// Add profile buttons
document.getElementById('create-profile-btn').addEventListener('click', () => {
    const name = document.getElementById('add-profile-name').value.trim();
    if (!name) return;
    const profiles = getProfiles();
    if (profiles.length >= MAX_PROFILES) return;
    const newProfile = {
        id: generateProfileId(),
        name: name,
        avatarIndex: addAvatarIndex,
        isKids: document.getElementById('add-kids-toggle').checked,
        tastes: [],
        myList: [],
    };
    profiles.push(newProfile);
    saveProfiles(profiles);
    renderProfileScreen();
    showScreen(profileScreen);
});
document.getElementById('cancel-add-btn').addEventListener('click', () => {
    renderProfileScreen();
    showScreen(profileScreen);
});

// Add kids toggle
document.getElementById('add-kids-toggle').addEventListener('change', () => {
    const isKids = document.getElementById('add-kids-toggle').checked;
    if (isKids && addAvatarIndex >= KIDS_AVATARS.length) addAvatarIndex = 0;
    rerenderAddAvatarPicker();
});

// Taste picker
let tasteSearchTimeout;
document.getElementById('taste-search-input').addEventListener('input', (e) => {
    clearTimeout(tasteSearchTimeout);
    const query = e.target.value.trim();
    tasteSearchTimeout = setTimeout(() => loadTasteGrid(query), 400);
});
document.getElementById('taste-done-btn').addEventListener('click', () => {
    const profiles = getProfiles();
    const activeId = getActiveProfileId();
    const profile = profiles.find(p => p.id === activeId);
    if (profile) {
        profile.tastes = tasteSelections;
        saveProfiles(profiles);
    }
    enterApp();
});

// Nav profile dropdown
document.getElementById('profile-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('profile-dropdown').classList.toggle('open');
    document.querySelector('.profile-menu-container').classList.toggle('open');
});
document.getElementById('nav-manage-profiles').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('profile-dropdown').classList.remove('open');
    document.querySelector('.profile-menu-container').classList.remove('open');
    stopHeroTrailer();
    renderProfileManageScreen();
    showScreen(profileManageScreen);
});
document.getElementById('nav-switch-profile').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('profile-dropdown').classList.remove('open');
    document.querySelector('.profile-menu-container').classList.remove('open');
    stopHeroTrailer();
    renderProfileScreen();
    showScreen(profileScreen);
});

// Combined click-outside logic
document.addEventListener('click', (e) => {
    const isPlayerSelectorButton = e.target.closest('#player-selector-btn');
    if (isPlayerSelectorButton) {
        playerSelectorContainer.classList.toggle('menu-open');
    } else if (!e.target.closest('.player-selector-container')) {
        playerSelectorContainer.classList.remove('menu-open');
    }

    if (!e.target.closest('.profile-menu-container')) {
        document.getElementById('profile-dropdown').classList.remove('open');
        document.querySelector('.profile-menu-container').classList.remove('open');
    }

    if (!e.target.closest('.search-container')) {
        searchResultsList.style.display = 'none';
    }
    if (!e.target.closest('.poster-card-wrapper') && !e.target.closest('.hover-popup')) {
        clearPopup(false);
    }
});

// Modal specific listeners
detailsModal.querySelector('.modal-close-btn').addEventListener('click', closeDetailsModal);
detailsModal.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeDetailsModal();
});
document.getElementById('modal-mute-btn').addEventListener('click', toggleModalMute);

// Escape key closes the top-most layer
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (searchOverlay.classList.contains('active')) { closeSearchOverlay(); return; }
    if (detailsModal.classList.contains('active')) { closeDetailsModal(); return; }
    if (playerScreen.classList.contains('active')) { showHomeScreen(); return; }
});

playerMenu.addEventListener('click', (e) => {
    const targetLi = e.target.closest('li');
    if (targetLi && targetLi.dataset.api) {
        setPlayerAPI(targetLi.dataset.api);
        playerSelectorContainer.classList.remove('menu-open');
    }
});


// --- Initialization & Observers ---
const heroObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) playHeroTrailerAfterDelay();
        else stopHeroTrailer();
    });
}, { threshold: 0.5 });

const rowObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            populateRow(entry.target);
            observer.unobserve(entry.target);
        }
    });
}, { rootMargin: '0px 0px 200px 0px' });

document.addEventListener('DOMContentLoaded', () => {
    const savedAPI = localStorage.getItem('playerAPI') || 'videasy';
    setPlayerAPI(savedAPI);

    initProfiles();
    renderProfileScreen();
    showScreen(profileScreen);
});
