#!/usr/bin/env python3
"""Validate BUGS.md: required fields per bug and referenced evidence files.

Checks, for each `## BUG-NNN: <title>` section in BUGS.md:
- required bullet fields: Status, Severity, Description, Reproduction,
  Root cause, Evidence
- every `bugs/evidence/<file>` referenced exists relative to the repo root
- the Discarded hypotheses and Out of scope sections exist

Exit code 0 when all checks pass, 1 otherwise.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORT = ROOT / "BUGS.md"

REQUIRED_FIELDS = ("Status", "Severity", "Description", "Reproduction", "Root cause", "Evidence")
EVIDENCE_PATH_RE = re.compile(r"bugs/evidence/[\w.\-]+\.txt")
BUG_HEADING_RE = re.compile(r"^## BUG-(\d+): (.+)$", re.MULTILINE)


def main() -> int:
    if not REPORT.exists():
        print(f"FAIL: {REPORT} does not exist")
        return 1

    text = REPORT.read_text(encoding="utf-8")
    errors: list[str] = []
    bugs = BUG_HEADING_RE.findall(text)
    if not bugs:
        errors.append("no '## BUG-NNN:' sections found")

    for number, title in bugs:
        section_match = re.search(
            rf"^## BUG-{number}: .*?(?=^## |\Z)", text, re.MULTILINE | re.DOTALL
        )
        if section_match is None:
            errors.append(f"BUG-{number}: section body not found")
            continue
        section = section_match.group(0)
        for field in REQUIRED_FIELDS:
            if f"- **{field}:**" not in section:
                errors.append(f"BUG-{number}: missing field '{field}'")
        referenced = sorted(set(EVIDENCE_PATH_RE.findall(section)))
        if not referenced:
            errors.append(f"BUG-{number}: no bugs/evidence/ file referenced")
        for path in referenced:
            if not (ROOT / path).exists():
                errors.append(f"BUG-{number}: evidence file not found: {path}")
        print(f"BUG-{number}: {title.strip()}")
        print(f"  fields ok: {all(f'- **{f}:**' in section for f in REQUIRED_FIELDS)}")
        print(f"  evidence: {', '.join(referenced) if referenced else 'NONE'}")

    for required_section in ("Discarded hypotheses", "Out of scope"):
        if f"## {required_section}" not in text:
            errors.append(f"missing required section '## {required_section}'")

    if errors:
        print("\nFAIL:")
        for error in errors:
            print(f"  - {error}")
        return 1
    print(f"\nPASS: {len(bugs)} bugs validated, all fields and evidence files present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
