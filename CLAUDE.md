# CLAUDE.md

@AGENTS.md

## Notes for Claude Code

- `AGENTS.md` (imported above) is the shared rulebook for every agent. Put project rules there, not here, so other tools see them too.
- For visual explorations (brand, palettes, screen concepts), publish an Artifact page so the user can compare options before code changes. Implement only once a direction is chosen.
- This is a Windows machine: use the Bash tool for POSIX scripts and PowerShell for Windows-specific commands. For multi-line file patches, write a Python script to the scratchpad instead of inline heredocs with nested quotes.
- The user tests on an Android phone through Expo Go. Lock-screen / notification controls and true background playback only exist in an installed build (APK via EAS, see docs/DEPLOY.md); Google sign-in uses the in-app browser and works in both. Say so when a change can only be verified in a native build.
