"""Utility helpers for the repository ingestion fixture."""

RETRY_LIMIT = 3


def normalize(text):
    return " ".join(text.split())


class Accumulator:
    """Collects normalized fragments."""

    def __init__(self):
        self.items = []

    def add(self, fragment):
        self.items.append(normalize(fragment))
        return len(self.items)
