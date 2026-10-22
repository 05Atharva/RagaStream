"""
Fit ranking weights from outcomes and (optionally) write recs/weights.json.

Run from backend/:

    venv\\Scripts\\python -m recs.train                         # synthetic world, every surface, dry run
    venv\\Scripts\\python -m recs.train --surface home --write  # write if offline NDCG@10 improves
    venv\\Scripts\\python -m recs.train --live --surface all    # logged events from the real DB (read-only)

Examples and labels (docs/RECOMMENDATIONS.md, Signals):
  positive  complete, like, save, queue
  negative  skip with < 30 s listened (weight 1.0); skip at 30 s to 50% of the song (sample weight 0.4)
  ignored   everything else (start, unlike, late skips, ...)

Where the features come from:
  --live       `listening_events.features` (the jsonb the ranker saw when it served the item, keyed
               by `weights.FEATURES`), rows with a features object whose surface matches. These
               events overlap the offline test period, so the NDCG check is optimistic; it is a
               guard against a bad fit, not a proof of a better one.
  synthetic    there are no served slates, so features are replayed: for every labelled interaction
               in a user's TEST period on a song in the engine's candidate pool (plus the most-played
               catalogue songs), `compute_features` is evaluated against the user's TRAIN profile
               (the profile at the split). Weights are fitted on half of the users and judged on the
               other half, so the NDCG comparison is on users the fit never saw.

Model: L2-regularised logistic regression, batch gradient descent, pure Python on standardised
features. Coefficients map back to raw-feature weights, then: `skip_penalty` and `fatigue` are
clipped to <= 0, `quality` stays at its default (it is a guard, not a preference), constant
features keep their defaults, and the learned weights are rescaled so their total magnitude
matches the defaults (ranking only depends on relative size; radio's flow order uses the scale).

Gate: a surface needs at least 300 labelled examples. `weights.json` is written only with
`--write` AND when offline NDCG@10 beats the current weights; otherwise the reason is printed.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

if __package__ in (None, ""):  # allow `python recs/train.py`
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    __package__ = "recs"

from . import evaluate as ev
from .candidates import Candidate, Plan, assemble
from .features import compute_features
from .weights import DEFAULT_WEIGHTS, FEATURES, SURFACES, WEIGHTS_PATH, _valid, key_for, load_weights

MIN_EXAMPLES = 300
FIXED = ("quality",)                      # never learned
NON_POSITIVE = ("skip_penalty", "fatigue")  # clipped to <= 0
POSITIVE_EVENTS = ("complete", "like", "save", "queue")
MID_SKIP_WEIGHT = 0.4


@dataclass
class Example:
    features: Dict[str, float]
    label: int                    # 1 positive, 0 negative
    weight: float = 1.0
    user: str = ""


# ---------------------------------------------------------------------------
# Labels
# ---------------------------------------------------------------------------

def label_event(event: str, listened: Optional[float], duration: Optional[float]) -> Optional[Tuple[int, float]]:
    """(label, sample weight) for an outcome, or None when it is not a training signal."""
    if event in POSITIVE_EVENTS:
        return 1, 1.0
    if event != "skip":
        return None
    if listened is not None and listened < 30:
        return 0, 1.0
    ratio = listened / duration if (listened is not None and duration) else None
    if ratio is None or ratio < 0.5:
        return 0, MID_SKIP_WEIGHT
    return None                   # skipped in the last half: the song mostly landed


# ---------------------------------------------------------------------------
# Example sources
# ---------------------------------------------------------------------------

def replay_examples(prep: ev.Prepared, surface: str, users: Optional[Sequence[str]] = None) -> List[Example]:
    """Synthetic/offline examples: test-period outcomes featurised against the train profile."""
    out: List[Example] = []
    for uid, case in prep.cases.items():
        if users is not None and uid not in users:
            continue
        pool = ev.pool_for(prep, uid, ev.family_of(surface))
        if pool is None:
            continue
        cands: Dict[str, Candidate] = {}
        for cs in pool.sections:
            cands.update(cs.by_id)
        catalogue = assemble(Plan(walk=False), {}, None, case.profile, catalogue_songs=ev.popular_metas(prep))
        for yt, c in catalogue.by_id.items():
            cands.setdefault(yt, c)
        for e in case.test_events:
            lab = label_event(e.get("event", ""), e.get("listened_sec"), e.get("duration_sec"))
            c = cands.get(e.get("youtube_id", ""))
            if lab is None or c is None:
                continue
            hour = e.get("local_hour")
            feats = compute_features(c, case.profile, hour if isinstance(hour, int) else None)
            out.append(Example(feats, lab[0], lab[1], uid))
    return out


def logged_examples(rows: Sequence[Mapping[str, Any]], surface: str) -> List[Example]:
    """Examples from listening_events rows that carry a `features` object for this surface."""
    out: List[Example] = []
    for r in rows:
        feats = r.get("features")
        if not isinstance(feats, dict) or key_for(str(r.get("surface"))) != surface:
            continue
        lab = label_event(str(r.get("event")), r.get("listened_sec"), r.get("duration_sec"))
        if lab is None:
            continue
        out.append(Example({f: float(feats.get(f) or 0.0) for f in FEATURES}, lab[0], lab[1], str(r.get("user_id", ""))))
    return out


def read_logged_events() -> List[Dict[str, Any]]:
    """Read-only: every event row with features (service-role client; never writes)."""
    from db import get_supabase
    rows: List[Dict[str, Any]] = []
    for page in range(50):
        res = (get_supabase().table("listening_events")
               .select("user_id,youtube_id,event,surface,listened_sec,duration_sec,features")
               .not_.is_("features", "null").range(page * 1000, page * 1000 + 999).execute())
        rows.extend(res.data or [])
        if len(res.data or []) < 1000:
            break
    return rows


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------

def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-30.0, min(30.0, x))))


def fit(examples: Sequence[Example], l2: float = 0.05, iters: int = 400, lr: float = 0.5) -> Dict[str, float]:
    """Raw logistic coefficients (pre-scaling) per feature; constant features come back as 0."""
    n = len(examples)
    total_w = sum(e.weight for e in examples) or 1.0
    mean, std = {}, {}
    for f in FEATURES:
        m = sum(e.weight * e.features.get(f, 0.0) for e in examples) / total_w
        var = sum(e.weight * (e.features.get(f, 0.0) - m) ** 2 for e in examples) / total_w
        mean[f], std[f] = m, math.sqrt(var)
    active = [f for f in FEATURES if std[f] > 1e-6 and f not in FIXED]
    rows = [[(e.features.get(f, 0.0) - mean[f]) / std[f] for f in active] for e in examples]
    w = [0.0] * len(active)
    b = 0.0
    for _ in range(iters):
        gw = [0.0] * len(active)
        gb = 0.0
        for x, e in zip(rows, examples):
            p = _sigmoid(b + sum(wi * xi for wi, xi in zip(w, x)))
            err = (p - e.label) * e.weight
            gb += err
            for j, xi in enumerate(x):
                gw[j] += err * xi
        b -= lr * gb / total_w
        for j in range(len(active)):
            w[j] -= lr * (gw[j] / total_w + l2 * w[j])
    out = {f: 0.0 for f in FEATURES}
    for f, wj in zip(active, w):
        out[f] = wj / std[f]
    return out


def to_weights(coef: Mapping[str, float], examples: Sequence[Example], default: Mapping[str, float]) -> Dict[str, float]:
    """Raw coefficients -> ranker weights: sign guards, fixed quality, scale matched to the defaults."""
    const = {f for f in FEATURES if len({round(e.features.get(f, 0.0), 6) for e in examples}) <= 1}
    learned = [f for f in FEATURES if f not in FIXED and f not in const]
    new: Dict[str, float] = dict(default)
    for f in learned:
        v = coef.get(f, 0.0)
        new[f] = min(0.0, v) if f in NON_POSITIVE else v
    mag_new = sum(abs(new[f]) for f in learned)
    mag_old = sum(abs(default[f]) for f in learned)
    scale = mag_old / mag_new if mag_new > 1e-9 else 1.0
    for f in learned:
        new[f] = round(new[f] * scale, 3)
    return new


# ---------------------------------------------------------------------------
# Gate, compare, write
# ---------------------------------------------------------------------------

def write_weights(path: str, surface: str, weights: Mapping[str, float]) -> None:
    """Merge one surface into weights.json (format: {surface: {feature: weight}}), atomically."""
    entry = _valid(dict(weights))
    if entry is None:
        raise ValueError("weights are not a complete finite feature set")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    data[surface] = entry
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, path)


def train_surface(surface: str, examples: Sequence[Example], prep: ev.Prepared, current: Mapping[str, float],
                  *, write: bool = False, path: str = WEIGHTS_PATH, eval_users: Optional[Sequence[str]] = None,
                  k: int = 10) -> Dict[str, Any]:
    """Fit, compare offline, optionally write. Returns a report dict with a `status`:
    refused (too few examples), written, improved (better, not written: dry run) or not_improved."""
    surface = key_for(surface)
    pos = sum(1 for e in examples if e.label == 1)
    rep: Dict[str, Any] = {"surface": surface, "examples": len(examples), "positives": pos, "old": dict(current)}
    if len(examples) < MIN_EXAMPLES:
        rep.update(status="refused", reason=f"only {len(examples)} labelled examples; need at least {MIN_EXAMPLES}")
        return rep
    if pos == 0 or pos == len(examples):
        rep.update(status="refused", reason="all labels are the same; nothing to learn from")
        return rep
    new = to_weights(fit(examples), examples, current)
    old_nd = ev.evaluate(prep, current, surface, k, eval_users)["engine"]["ndcg"]
    new_nd = ev.evaluate(prep, new, surface, k, eval_users)["engine"]["ndcg"]
    rep.update(new=new, ndcg_old=old_nd, ndcg_new=new_nd)
    if new_nd > old_nd + 1e-9:
        if write:
            write_weights(path, surface, new)
            rep.update(status="written", reason=f"NDCG@{k} {old_nd:.4f} -> {new_nd:.4f}; wrote {path}")
        else:
            rep.update(status="improved", reason=f"NDCG@{k} {old_nd:.4f} -> {new_nd:.4f}; not written (pass --write)")
    else:
        rep.update(status="not_improved", reason=f"NDCG@{k} {old_nd:.4f} -> {new_nd:.4f}: no improvement, weights unchanged")
    return rep


def format_report(rep: Mapping[str, Any]) -> str:
    lines = [f"== {rep['surface']}: {rep['examples']} labelled examples ({rep['positives']} positive) -> {rep['status']}",
             f"   {rep.get('reason', '')}"]
    if "new" in rep:
        lines.append(f"   {'feature':<14}{'current':>9}{'learned':>9}")
        for f in FEATURES:
            lines.append(f"   {f:<14}{rep['old'][f]:>9.3f}{rep['new'][f]:>9.3f}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Optional[Sequence[str]] = None, weights_path: Optional[str] = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m recs.train", description="Fit ranking weights per surface.")
    ap.add_argument("--live", action="store_true", help="use logged events from the real DB (read-only)")
    ap.add_argument("--surface", choices=[*SURFACES, "all"], default="all")
    ap.add_argument("--write", action="store_true", help="write weights.json when offline NDCG@10 improves")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--users", type=int, default=24)
    ap.add_argument("--plays", type=int, default=170)
    ap.add_argument("--path", default=weights_path or WEIGHTS_PATH, help="weights file to write (default recs/weights.json)")
    args = ap.parse_args(argv)
    surf = list(SURFACES) if args.surface == "all" else [args.surface]
    try:
        world = ev.load_world(args.live, args.seed, args.users, args.plays)
        logged = read_logged_events() if args.live else []
    except Exception as exc:
        print(f"Could not load data: {exc}", file=sys.stderr)
        return 2
    prep = ev.prepare(world)
    uids = sorted(prep.cases)
    split_users = not args.live and len(uids) >= 4
    fit_users, eval_users = (uids[0::2], uids[1::2]) if split_users else (None, None)
    current = load_weights(args.path)
    print(f"data: {world.name}; fit on {len(fit_users) if fit_users else 'all'} users, "
          f"evaluate on {len(eval_users) if eval_users else 'all'} users")
    for s in surf:
        examples = logged_examples(logged, s) if args.live else replay_examples(prep, s, fit_users)
        rep = train_surface(s, examples, prep, current[s], write=args.write, path=args.path, eval_users=eval_users)
        print(format_report(rep))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
