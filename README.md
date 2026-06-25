# SMovies

A Netflix-style movie & TV streaming front-end built with vanilla HTML, CSS, and JavaScript. It uses the [TMDB API](https://www.themoviedb.org/) for metadata and embeds third-party players for playback.

## Features

- Netflix-style UI — hero banner with auto-playing trailers, content rows, hover previews, and a details modal
- Multiple **profiles** (including Kids profiles), avatars, and a first-run taste picker
- **My List** and **Continue Watching** with real watch-progress tracking and resume
- Search and genre/network browsing
- Switchable players — Videasy, VidKing, VidSrc, Anyembed, VidLink
- Fully **responsive** — works on desktop and mobile (bottom nav, full-screen search, mobile hero)
- All user data (profiles, list, progress) is saved locally in the browser via `localStorage`

## Running locally

Serve over HTTP (not `file://`) so the trailers and progress tracking work:

    python -m http.server 8000

Then open <http://localhost:8000>.

> **Note:** the embedded video players require an **HTTPS (secure) context**, so playback works on a hosted HTTPS site (e.g. GitHub Pages) but not over plain `http://` on mobile.

## Tech

- Vanilla HTML / CSS / JavaScript — no build step, no dependencies
- TMDB API for metadata
