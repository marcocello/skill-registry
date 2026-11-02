"""Black-box production-boundary proof for Google OIDC and reviewed publishing."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[4]


def main() -> None:
    subprocess.run(
        [sys.executable, "docs/features/google-oidc-registry-access/proof/runtime.py"],
        cwd=REPO_ROOT,
        check=True,
        timeout=330,
    )


if __name__ == "__main__":
    main()
