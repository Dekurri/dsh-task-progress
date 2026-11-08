#!/usr/bin/env python3
"""Emit progress output for a few seconds, so the DSH task-progress card has something to show.

Run it from the DSH agent with the bash / ops_bash tool (any long-running tool call
appears in the card), for example:

    python demo/progress_demo.py --mode tqdm --seconds 20
    python demo/progress_demo.py --mode epoch --seconds 20
    python demo/progress_demo.py --mode pip --seconds 12

Modes:
  tqdm   tqdm-style bar with percent / fraction / rate / remaining
  epoch  training log with "Epoch k/n" and "step i/j"
  pip    pip-like stage lines (resolving / collecting / downloading / installing)
"""

from __future__ import annotations

import argparse
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def tqdm_demo(seconds: float) -> None:
    total = 120
    step_seconds = max(seconds / total, 0.05)
    start = time.monotonic()
    for i in range(1, total + 1):
        elapsed = time.monotonic() - start
        percent = int(i * 100 / total)
        bar = "#" * (i * 30 // total)
        if elapsed >= 0.5:
            rate = i / elapsed
            remaining = int((total - i) / rate) if rate > 0 else 0
            tail = f"{rate:.1f}it/s"
        else:
            remaining = 0
            tail = "?it/s"
        elapsed_m, elapsed_s = divmod(int(elapsed), 60)
        remain_m, remain_s = divmod(remaining, 60)
        print(
            f"{percent:3d}%|{bar:<30}| {i}/{total} "
            f"[{elapsed_m:02d}:{elapsed_s:02d}<{remain_m:02d}:{remain_s:02d}, {tail}]",
            end="\r",
            flush=True,
        )
        time.sleep(step_seconds)
    print(flush=True)


def epoch_demo(seconds: float) -> None:
    epochs = 5
    steps_per_epoch = 40
    total_steps = epochs * steps_per_epoch
    step_seconds = max(seconds / total_steps, 0.02)
    start = time.monotonic()
    for epoch in range(1, epochs + 1):
        for step in range(1, steps_per_epoch + 1):
            global_step = (epoch - 1) * steps_per_epoch + step
            loss = 2.5 - 2.4 * global_step / total_steps
            elapsed = time.monotonic() - start
            print(
                f"Epoch {epoch}/{epochs} | step {step}/{steps_per_epoch} | loss {loss:.4f} | "
                f"elapsed {int(elapsed)}s",
                flush=True,
            )
            time.sleep(step_seconds)


def pip_demo(seconds: float) -> None:
    stages = [
        "Resolving dependencies...",
        "Collecting transformers>=4.40",
        "  Downloading transformers-4.46.3-py3-none-any.whl (10.2 MB)",
        "  Downloading transformers-4.46.3-py3-none-any.whl (45%)",
        "  Downloading transformers-4.46.3-py3-none-any.whl (100%)",
        "Collecting tokenizers>=0.20",
        "  Building wheel for tokenizers (pyproject.toml) ...",
        "Preparing metadata (pyproject.toml) ...",
        "Installing collected packages: tokenizers, transformers",
        "Successfully installed tokenizers-0.20.3 transformers-4.46.3",
    ]
    pause = max(seconds / len(stages), 0.05)
    for line in stages:
        print(line, flush=True)
        time.sleep(pause)


def main() -> int:
    parser = argparse.ArgumentParser(description="Emit fake progress output for the DSH task-progress card.")
    parser.add_argument("--mode", choices=("tqdm", "epoch", "pip"), default="tqdm")
    parser.add_argument("--seconds", type=float, default=20.0, help="rough total runtime in seconds")
    args = parser.parse_args()
    if args.mode == "tqdm":
        tqdm_demo(args.seconds)
    elif args.mode == "epoch":
        epoch_demo(args.seconds)
    else:
        pip_demo(args.seconds)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
