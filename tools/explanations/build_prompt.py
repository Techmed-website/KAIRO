#!/usr/bin/env python3
"""Rebuild content/explanations/PROMPT.md from tools/explain/techmed-method.md (the single source of the
TECHMED method), adding the chat-specific input description and JSON Lines output rules.
Usage: python3 -I tools/explanations/build_prompt.py   (run from the repo root)"""
import re
src = open("content/explanations/PROMPT.md", encoding="utf-8").read()
method = open("tools/explain/techmed-method.md", encoding="utf-8").read().split("# Output rules")[0].strip()
start = src.index("You are KAIRO's TECHMED tutor")
end = src.index("\n\n# Your input")
open("content/explanations/PROMPT.md", "w", encoding="utf-8").write(src[:start] + method + src[end:])
print("PROMPT.md rebuilt")
