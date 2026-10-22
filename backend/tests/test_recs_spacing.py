"""Channel spacing must hold even when one label channel holds most of the chosen picks
(found live: 9 of 15 autoplay picks were T-Series)."""
import unittest

from recs.rerank import space_channels


def channel(item: str) -> str:
    return item.split(":")[0]


def worst_run(items, window=3):
    return max(max(sum(channel(x) == channel(y) for y in items[i:i + window]) for x in items[i:i + window])
               for i in range(len(items)))


class SpacingTests(unittest.TestCase):
    def test_reorders_when_possible(self):
        out = space_channels(["A:1", "A:2", "B:1", "C:1", "D:1"], channel)
        self.assertEqual(len(out), 5)
        self.assertEqual(worst_run(out), 1)

    def test_crowded_list_borrows_from_reserve_and_keeps_length(self):
        chosen = [f"T:{i}" for i in range(9)] + ["B:1", "C:1", "D:1", "E:1", "F:1", "G:1"]
        reserve = ["H:1", "I:1", "J:1", "K:1", "T:99"]
        out = space_channels(chosen, channel, reserve=reserve)
        self.assertEqual(len(out), 15)
        self.assertEqual(worst_run(out), 1)
        self.assertEqual(out[0], "T:0")                      # best pick still leads
        self.assertEqual(len(set(out)), 15)                  # nothing duplicated

    def test_unavoidable_without_reserve_keeps_everything(self):
        chosen = ["T:1", "T:2", "T:3", "B:1"]
        out = space_channels(chosen, channel)
        self.assertEqual(sorted(out), sorted(chosen))


if __name__ == "__main__":
    unittest.main()
