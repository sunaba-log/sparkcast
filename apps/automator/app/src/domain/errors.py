"""Errors that must stop publication when the configured review cannot finish."""


class ReviewIncompleteError(RuntimeError):
    """The enabled review could not establish whether publication may proceed."""
