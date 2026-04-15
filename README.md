# RagaStream 🎵

> A personal, ad-free Indian music streaming app for Android.  
> Streams audio from YouTube via `yt-dlp`. No cloud storage. No ads. Zero infra cost.

---

## Project Structure

```
RagaStream/
├── backend/       # FastAPI REST API (Python)
│   ├── routers/   # Songs, YouTube, Playlists, Liked, History, Admin
│   ├── main.py
│   ├── auth.py
│   ├── db.py
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/      # React Native app (Expo SDK 54)
│   ├── screens/
│   ├── components/
│   ├── store/     # Zustand state
│   ├── services/  # API client, player service
│   ├── hooks/     # React Query hooks
│   └── start.js   # Dev launcher (reads LAN IP from .env)
│
├── .gitignore
└── README.md      ← you are here
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React Native · Expo SDK 54 · TypeScript |
| State | Zustand + React Query |
| Audio | react-native-track-player v4 |
| Backend | FastAPI · Python 3.11 |
| Database | Supabase (PostgreSQL) |
| Streaming | yt-dlp (YouTube audio extraction) |
| Auth | Supabase Auth (JWT) |

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- Python 3.11
- Expo Go app on your Android phone
- PC and phone on the **same Wi-Fi network**

### 1. Clone and set up

```bash
git clone <repo-url>
cd RagaStream
```

### 2. Start the Backend

See [`backend/README.md`](./backend/README.md) for full details.

```bash
cd backend
venv\Scripts\activate        # Windows
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 3. Start the Frontend

See [`frontend/README.md`](./frontend/README.md) for full details.

```bash
cd frontend
# Edit .env: set EXPO_DEV_HOST=<your-pc-wifi-ip>
npm run dev
```

Scan the QR code with Expo Go on your phone.

---

## Finding Your Wi-Fi IP (Windows)

```powershell
ipconfig
# Look for: "Wi-Fi" → "IPv4 Address"
# Example: 192.168.1.5
```

Set that value as `EXPO_DEV_HOST` in `frontend/.env`.