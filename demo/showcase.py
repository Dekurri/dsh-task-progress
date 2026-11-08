#!/usr/bin/env python3
"""Feature showcase for dsh-task-progress.

Cycles through every progress format the card understands, in one run:

1. tqdm progress bar        -> percentage, fraction, rate (it/s), ETA
2. epoch + step training log-> step fraction + epoch context, loss line
3. pip install stages       -> indeterminate bar + stage label, no numbers
4. bare percentage          -> percentage without a fraction
5. ANSI-colored lines       -> escape codes stripped before parsing

Run it as a background task in DSH and watch the card above the composer.

    python3 demo/showcase.py            # ~30s
    python3 demo/showcase.py --seconds 6  # faster, per phase
"""

from __future__ import annotations

import argparse
import sys
import time

RESET = "\033[0m"
BLUE = "\033[34m"
GREEN = "\033[32m"


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def phase_tqdm(seconds: float) -> None:
    total = 100
    step = max(seconds / total, 0.01)
    for index in range(1, total + 1):
        pct = index
        bar = "#" * int(index / 2.5)
        pad = " " * (40 - len(bar))
        rate = 2.0 + index / 100.0
        eta = int((total - index) / rate)
        elapsed = int(index / rate)
        print(
            f"\r{pct:3d}%|{bar}{pad}| {index}/{total} "
            f"[{elapsed // 60:02d}:{elapsed % 60:02d}<00:{eta:02d}, {rate:.1f}it/s]",
            end="",
            flush=True,
        )
        _sleep(step)
    print()


def phase_epoch(seconds: float) -> None:
    epochs, steps = 3, 40
    step = max(seconds / (epochs * steps), 0.001)
    index = 0
    for epoch in range(1, epochs + 1):
        for step_index in range(1, steps + 1):
            index += 1
            loss = 2.5 * (0.62**epoch) + 0.01 * (steps - step_index) / steps
            print(
                f"{GREEN}Epoch {epoch}/{epochs}{RESET} | step {step_index}/{steps} "
                f"| loss {loss:.4f} | elapsed {int(index * step)}s",
                flush=True,
            )
            _sleep(step)


def phase_pip(seconds: float) -> None:
    lines = [
        f"{BLUE}Resolving dependencies...{RESET}",
        "Collecting torch>=2.1.0",
        "  Downloading torch-2.1.0-cp311-cp311-win_amd64.whl (245.3 MB)",
        "Collecting numpy>=1.24.0",
        "  Downloading numpy-1.26.4-cp311-cp311-win_amd64.whl (15.9 MB)",
        "Building wheel for tokenizers (pyproject.toml)",
        "Preparing metadata (setup.py)",
        "Installing collected packages: numpy, tokenizers, torch",
    ]
    per_line = max(seconds / len(lines), 0.05)
    for line in lines:
        print(line, flush=True)
        _sleep(per_line)


def phase_percent(seconds: float) -> None:
    for pct in range(10, 101, 10):
        print(f"Building wheel for torch ({pct}%)")
        _sleep(max(seconds / 10, 0.02))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=8.0, help="duration of each phase (default 8)")
    args = parser.parse_args()
    if args.seconds <= 0:
        parser.error("--seconds must be positive")

    print(f"showcase start: 5 phases x {args.seconds:g}s", flush=True)
    phase_tqdm(args.seconds)
    phase_epoch(args.seconds)
    phase_pip(args.seconds)
    phase_percent(args.seconds)
    print("showcase finished", flush=True)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
