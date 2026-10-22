"""One error type for everything the user can fix by changing what they pasted."""


class ImportFailure(Exception):
    """A plain-language message that is safe to show to the user (becomes a 422 detail)."""

    def __init__(self, detail: str):
        super().__init__(detail)
        self.detail = detail


PASTE_INSTEAD = "Or paste the song list instead."
NOT_PUBLIC = (
    "This link isn't a public playlist. Open it in the app, make it public, or paste the song list instead."
)
NO_TRACKS = "We couldn't find a song list on that page. Paste the song list instead."
