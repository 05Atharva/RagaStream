# RagaStream — Frontend

React Native app built with Expo SDK 54. Streams Indian music from YouTube with a premium dark UI, lock-screen controls, liked songs, playlists, and play history.

---

## Prerequisites

- Node.js ≥ 18
- Expo Go app installed on your Android phone ([Play Store](https://play.google.com/store/apps/details?id=host.exp.exponent))
- PC and phone connected to the **same Wi-Fi network**
- Backend running (see [`../backend/README.md`](../backend/README.md))

---

## First-Time Setup

### 1. Install dependencies

```powershell
cd RagaStream/frontend
npm install
```

### 2. Configure environment variables

```powershell
copy .env.example .env
# Then edit .env
```

Your `.env` should look like this:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key

# Your PC's Wi-Fi IP — run `ipconfig` and find "IPv4 Address" under Wi-Fi
EXPO_PUBLIC_API_URL=http://<your-pc-ip>:8000
EXPO_DEV_HOST=<your-pc-ip>
```

### How to find your Wi-Fi IP (Windows)

```powershell
ipconfig
# Look for "Wi-Fi" section → "IPv4 Address"
# Example: 192.168.1.5
```

### When your IP changes

Just update **two values** in `frontend/.env`:
```env
EXPO_PUBLIC_API_URL=http://<new-ip>:8000
EXPO_DEV_HOST=<new-ip>
```

---

## Running the Frontend (Every Time)

```powershell
cd RagaStream/frontend
npm run dev
```

This runs `start.js` which:
1. Reads `EXPO_DEV_HOST` from your `.env`
2. Starts Expo with `--host <your-ip>` so the QR code shows your real LAN IP
3. Opens Metro Bundler

**Scan the QR code** in the terminal with the **Expo Go** app on your phone.

### Alternative: raw expo command

```powershell
npx expo start --clear --host 10.x.x.x --lan
# Replace 10.x.x.x with your actual Wi-Fi IP
```

---

## Environment Variables Reference

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `EXPO_PUBLIC_API_URL` | Full URL of the FastAPI backend (use LAN IP, not localhost) |
| `EXPO_DEV_HOST` | Your PC's Wi-Fi IP — used by `npm run dev` / `start.js` to set the QR code host |

---

## Project Structure

```
frontend/
├── screens/          # Full screens (Home, Search, Library, NowPlaying, etc.)
├── components/       # Reusable UI (MiniPlayer, AuthGate)
├── store/            # Zustand stores (playerStore, authStore)
├── services/         # API client, Supabase client, playerService, songService
├── hooks/            # React Query hooks (useSongs, useYouTube, usePlaylists, etc.)
├── navigation/       # Stack + Bottom Tab navigators
├── constants/        # Theme tokens (colors, spacing, typography)
├── assets/           # Icons, splash screen
├── start.js          # Dev launcher script
├── app.json          # Expo config
└── .env              # Local environment variables (not committed to git)
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| QR shows `exp://127.0.0.1:8081` | Use `npm run dev` instead of `npx expo start`. Set `EXPO_DEV_HOST` in `.env` |
| App can't reach API (`Network Error`) | Ensure `EXPO_PUBLIC_API_URL` uses your PC's LAN IP (not `localhost`). Backend must be running |
| Port 8081 already in use | Run: `Get-NetTCPConnection -LocalPort 8081 \| Stop-Process -Id {$_.OwningProcess} -Force` |
| `moti` or other package not found | Run `npm install` from the `frontend/` directory |
| Auth fails / token errors | Check Supabase anon key in `.env`. Ensure `SUPABASE_JWT_SECRET` is set in backend `.env` |
| Blank screen on launch | Check Metro bundler for errors. Run `npm run dev` again with backend started first |
