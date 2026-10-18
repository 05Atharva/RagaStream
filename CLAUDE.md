# CLAUDE.md

@AGENTS.md

## Notes for Claude Code

- `AGENTS.md` (imported above) is the shared rulebook for every agent. Put project rules there, not here, so other tools see them too.
- For visual explorations (brand, palettes, screen concepts), publish an Artifact page so the user can compare options before code changes. Implement only once a direction is chosen.
- This is a Windows machine: use the Bash tool for POSIX scripts and PowerShell for Windows-specific commands. For multi-line file patches, write a Python script to the scratchpad instead of inline heredocs with nested quotes.
- The user tests on an Android phone through Expo Go. Native-only features (react-native-track-player, Google Sign-In) are inactive there. Say so when a change can only be verified in a native build.
