# RagaStream — User Stories

This is the source of truth for **who RagaStream is for and what they are trying to do**. Every screen, component and animation should trace back to a story here. If a design decision can't point to a story, question whether it's needed.

## The feeling we're designing for

RagaStream should leave people feeling that **they made something**: a playlist that's theirs, a taste that's recognised, a library that grows with them. Three feelings guide every screen:

| Feeling | What it means in the product |
|---|---|
| **Effortless** | Music starts in two taps from anywhere, one-handed, even on a bad network. |
| **Crafted** | Building a playlist feels like arranging, not form-filling. Every action responds instantly and visibly. |
| **Recognised** | The app notices what you love (On Repeat, mixes, milestones) and celebrates it quietly. Never nags. |

---

## Personas

### Aditi — the commuter
24, product analyst in Pune. Listens on the local train and in the office with earphones in.
- **Context**: one hand on a rail, patchy 4G, 20-minute bursts.
- **Wants**: to resume what she was playing instantly; to skip with a thumb; for music not to stop when the network blips.
- **Frustrations**: tiny targets, things that need two hands, spinners with no explanation.

### Rohan — the builder
31, runs a small design studio. Makes playlists for road trips, dinners and friends' weddings.
- **Context**: sits down on a Sunday to curate; shares links on WhatsApp.
- **Wants**: to search, add and reorder fast; to see a playlist take shape; good recommendations to finish a playlist.
- **Frustrations**: duplicates, losing his place, apps that hide the "add" action three menus deep.

### Meera — the morning listener
52, school teacher in Varanasi. Bhajans and Raag Bhairav at dawn, ghazals at night.
- **Context**: phone propped in the kitchen, often in bright daylight; uses large system text.
- **Wants**: big clear controls, a light theme that's readable in sunlight, a sleep timer at night.
- **Frustrations**: low contrast, jargon, gestures with no visible alternative.

### Kabir — the night explorer
19, engineering student. Discovers through radio, sings along to lyrics, loves slowed edits.
- **Context**: late night, headphones, dark theme, long sessions.
- **Wants**: endless discovery from one song, synced lyrics, speed control, a stats screen to show friends.
- **Frustrations**: music stopping when a playlist ends; recommendations that repeat.

---

## Journeys and stories

Each story has acceptance criteria (what must be true) and the **moment** it should create.

### J1 · First launch

**US-01 · Sign in without friction**
As a new user, I want to sign in with Google or email in under 30 seconds, so I can start listening right away.
- One primary action per step (Figma: progressive disclosure); errors say what went wrong and how to fix it.
- Password field has a show/hide toggle; the keyboard type matches the field.
- Google sign-in opens in the in-app browser (Supabase OAuth with PKCE), so it works in Expo Go and in builds alike; closing the browser is a silent no-op, and a failure says what happened and what to do.
- New accounts wait for owner approval. Until then a clear screen says "You're on the list", shows the email they'll hear from, offers "Check again", and opens the app by itself once approved. A declined account sees "This account isn't approved" with Sign out. If the server can't be reached, the screen says so with Retry.
- The owner approves from the app. When someone signs up, the owner gets an email; Settings → Requests (visible only to the owner, with a count badge) lists who is waiting with Approve and Decline. Approve is immediate; Decline asks first. Recent decisions can be changed. The waiting person's screen opens the app by itself within about 30 seconds of approval.
- Signing out (or an expired session) stops the music and empties the queue.
- *Moment*: the logo animation resolves into the Home screen. The brand's first impression.

**US-02 · An app that's useful on day one**
As a new user with no history, I want Home to already have something good to play, so the app doesn't feel empty.
- Home shows Featured and genre shortcuts before any history exists; every empty state names what will appear and how to fill it.
- Recommendation rows never leave Home empty or broken: with no history, Featured stays high on the page, and if the recommendation engine is unavailable Home shows its usual rows with no error banner.

**US-23 · A welcome that knows me**
As a new user, I want the app to greet me by name and show me where to start, so I feel recognised from the first minute.
- Shown once per account, the first time an approved user reaches the app. "Seen" is stored per user id, so a second account on the same phone still gets it.
- A full-screen moment over Home in the auth screens' look: the Meend stroke draws once, then "Welcome to RagaStream, Atharva" (first name from the sign-in profile, else the email before the @, capitalised), one warm line, and three quiet points (import, radio that learns, lyrics that follow along).
- One Kesar button, "Import a playlist", opens the import flow; the ghost "Start listening" dismisses. Either button, or the back button, ends it for that account for good.
- The words rise in after the stroke draws; with reduce-motion they fade. Never blocks playback.
- *Moment*: the app already knows your name.

### J2 · The daily "press play"

**US-03 · Resume in one tap**
As Aditi, I want what I last played to be the first thing I see, so I can resume with my thumb.
- "Pick up where you left off" sits in the top third of Home, and "Your trail" lists the playlists, channels and radios you were in; the mini player persists across tabs.
- Tapping a card starts playback within one tap; a loading state appears on the card itself, not a full-screen spinner.

**US-04 · Skip without looking**
As Aditi, I want to skip by swiping the mini player or artwork, so I can do it one-handed on a train.
- Swipe left = next, right = previous, with haptic confirmation; visible buttons exist for the same actions (Meera).
- Previous restarts the song after 3 seconds, matching every music app people already know.

**US-05 · Music doesn't die on a bad network**
As Aditi, I want playback to recover when a stream drops, so a tunnel doesn't end my song.
- Stream expiry triggers a silent reconnect with a small "Reconnecting" indicator; offline shows a clear full screen with Retry.

### J3 · Discovery

**US-06 · Endless music from one song**
As Kabir, I want to start a radio from any song, so I can discover similar music without searching.
- "Go to song radio" is in every song menu; Autoplay continues when any list ends (toggle in Settings).
- Home's "Made for you" mixes start an endless radio from a seed song in one tap, with a spinner on the mix itself.

**US-07 · Search that understands me**
As any user, I want results as I type, with my recent searches remembered, so finding music is fast.
- Results after 2 characters with a 300ms debounce; filters for Songs and Channels; a Top result card.
- No-results state suggests a fix (spelling) and alternatives.

**US-08 · Browse by mood and tradition**
As Meera, I want to browse by genre (Devotional, Classical, Ghazals), so I can find music for the moment.
- Genre chips filter Home in place; nothing navigates away unexpectedly.

**US-21 · Recommendations that learn from me**
As Kabir, I want what I skip, finish and like to shape what the app suggests, and to see a plain reason, so Home feels like it knows me without being noisy.
- Skips, completions, likes and saves steer autoplay, radio and Home; two quick skips change the next picks right away.
- Home stays calm: "Made for you" (up to 3 mixes) replaces "Your mixes", exactly one discovery row rotates daily, and the hour set is one compact card.
- The reason shows once, in the row's subtitle ("Because you played Kun Faya Kun", "New to you"), not on every card.
- If recommendations can't load, Home looks as it did before; nothing breaks and no error appears.
- *Moment*: opening Home and finding a mix that sounds like you.

### J4 · Building (the achievement loop)

**US-09 · Save in one place**
As Rohan, I want a single "Save to" sheet with Liked Songs and all my playlists, ticked where the song already is, so I never add duplicates.
- Ticks reflect current membership; Done applies all changes; create a new playlist inline without leaving the sheet.

**US-10 · Arrange my playlist by hand**
As Rohan, I want to drag songs into order, sort, and search inside a playlist, so it feels like I'm crafting it.
- Long-press-drag reorders with haptics; sort by title, channel, date added, duration; swipe left to remove.
- ＋ on the playlist opens an "Add songs" sheet over it (never navigates away); Done closes it and re-ticking a song in the sheet undoes the add.
- *Moment*: the playlist cover becomes a 4-image mosaic the moment the 4th song is added.

**US-11 · Help me finish a playlist**
As Rohan, I want recommendations at the bottom of my playlist, so I can grow it with one tap per song.
- Recommended songs are based on what's in the playlist and your taste; ＋ adds instantly with confirmation; Refresh gives new picks.
- The Add songs sheet searches YouTube as you type and offers Suggested (the same picks) and Liked Songs; each row adds with one tap (ticked at once, tap again to undo), songs already in the playlist start ticked, and the header counts "3 added".
- One toast on close ("Added 3 songs to Road trip"), none per song; loading, empty, error and offline states are designed; adds from Suggested are logged as playlist_recs saves so the engine learns.

**US-12 · Share what I made**
As Rohan, I want to share a song to WhatsApp in two taps, so friends can hear it.
- Share opens the native share sheet with title, channel and link.

**US-13 · Milestones that feel earned** *(new: Riyaz milestones)*
As any user, I want the app to notice when I've built something, so I feel ownership of my library.
- Celebrate: first playlist created, a playlist reaching 10 / 25 / 50 songs, 50 / 100 liked songs, first song played 10 times.
- One small celebration per milestone (an animation and a line of copy), shown once, dismissible, never blocking playback.
- *Moment*: the signature brand animation at full strength. This is the one place motion exaggerates (12 principles: exaggeration, used sparingly).

**US-22 · Bring my playlists**
As Rohan, I want to import a playlist from Spotify, YouTube, YouTube Music or Apple Music (or paste a song list), so my library is here from day one.
- Entry points: the welcome, a Library header action, and the empty Library.
- Paste a link (a "Paste" button reads the clipboard only when tapped) or any text: a non-link switches to a "Paste your song list" box, one song per line. Source chips show which apps work.
- "Find songs" previews before anything is saved: cover, name, owner, "48 songs", the first 5 songs and "and 43 more", a quiet note when only part of the playlist could be read, and an editable name.
- "Import 48 songs" starts a server job. A Meend line fills as songs match ("Matching 23 of 48") while a live list ticks each song to matched or "Not found". Cancel asks first.
- The job keeps running if I leave the screen; a toast says when the playlist is ready.
- Done: "Road trip is ready", "45 of 48 songs found", "Open playlist"; songs not found are listed, each with Search, which opens Add songs for that playlist with "title artist" typed in.
- Unreadable links show the server's own explanation with Retry; offline is stated plainly; loading, empty and error states are designed.
- *Moment*: a playlist you spent years on appearing in seconds.

### J5 · Listening deeply

**US-14 · Sing along**
As Kabir, I want synced lyrics that follow the song and let me jump to a line, so I can sing along.
- Lyrics card under the player; full-screen view auto-scrolls; tapping a line seeks there; honest copy when lyrics don't exist.

**US-15 · Shape the sound**
As Kabir, I want slowed and sped-up playback, so I can listen to the edits I like.
- Speed options persist until changed; the active speed shows in the player.

**US-16 · Know my taste**
As Kabir, I want to see my top songs and channels for 4 weeks, 6 months and all time, so I can show my friends.
- Stats screen with range switch; songs playable from the list.

### J6 · Winding down

**US-17 · Fall asleep to music**
As Meera, I want a sleep timer including "end of this track", so music stops gently at night.
- Timer survives leaving the Now Playing screen; the remaining time shows in the player.

**US-18 · Comfortable in any light**
As Meera, I want a light theme for daytime and a dark theme for night, following my phone's setting by default, so the app is always readable.
- Light, Dark and System options; both themes meet WCAG AA contrast (4.5:1 body text, 3:1 large text and icons).
- Respects the system font scale and "reduce motion" setting.

### J7 · Control and privacy

**US-19 · Listen privately**
As any user, I want a private session that doesn't record history, so what I play now doesn't change my recommendations or stats.

**US-20 · Teach it what I don't like**
As Kabir, I want to hide a song from radio and autoplay, so recommendations stop repeating it.
- Long-pressing any recommended song (Home included) offers "Hide from recommendations" and "Don't recommend {channel}"; hidden items leave Home right away.

---

## Screen inventory: one primary job each

Figma's hierarchy principle: every screen has one primary action, made the most prominent thing on it.

| Screen | Primary job | Primary action | Stories |
|---|---|---|---|
| Splash / Sign in | Get in | Continue with Google | US-01 |
| Home | Start listening now | Tap a Jump back in card | US-02, 03, 08, 13 |
| Search | Find a specific song | Tap a result | US-07 |
| Library | Return to what I've built | Open a playlist | US-09, 10 |
| Playlist | Play or shape a collection | Big play button | US-10, 11, 12 |
| Liked Songs | Play favourites | Big play button | US-09 |
| Channel | Explore an artist | Play popular | US-06 |
| Now Playing | Control the current song | Play / pause | US-04, 14, 15, 17 |
| Queue | See and change what's next | Reorder / remove | US-04 |
| Stats | See my taste | Switch range | US-16 |
| Settings | Adjust the app | Toggle a setting | US-18, 19, 20 |

## UX principles applied (Figma UI design principles)

1. **Hierarchy**: one hero element per screen; the type scale does the work, not colour alone.
2. **Progressive disclosure**: secondary actions live in the song menu and sheets, not on every row.
3. **Consistency**: one song row, one menu, one Save sheet, one motion vocabulary everywhere.
4. **Contrast**: the brand action colour is reserved for the primary action on each screen.
5. **Accessibility**: AA contrast in both themes, 44×44pt minimum touch targets, every gesture has a visible alternative, screen-reader labels on icon buttons, reduce-motion respected.
6. **Proximity**: transport controls grouped; destructive actions separated and coloured.
7. **Alignment**: one 4pt-based spacing grid and a 16pt screen gutter on every screen.
