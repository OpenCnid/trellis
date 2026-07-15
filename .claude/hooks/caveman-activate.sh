#!/usr/bin/env bash
# caveman — SessionStart auto-init hook (Trellis, repo-native).
#
# THIS is the "auto-init" the user kept missing. Claude Code injects a
# SessionStart hook's stdout into the session as hidden system context, so
# printing the caveman ruleset here makes the mode active from message one —
# no /caveman needed.
#
# Design: dependency-free bash, single source of truth. Reads the tailored
# ruleset from ../skills/caveman/SKILL.md (strips YAML frontmatter) so editing
# the skill is the only thing needed to change behavior — no duplicated copy.
#
# Silent-fail on every error: a SessionStart hook must never block a session.

MODE="${CAVEMAN_MODE:-full}"
[ "$MODE" = "off" ] && exit 0

# Resolve SKILL.md relative to this script — robust to cwd and to whether
# CLAUDE_PROJECT_DIR is set.
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)" || exit 0
skill="$here/../skills/caveman/SKILL.md"
[ -f "$skill" ] || exit 0

# Everything after the second '---' (i.e. the body, frontmatter stripped).
body="$(awk 'f{print} /^---[[:space:]]*$/{c++; if(c==2) f=1}' "$skill" 2>/dev/null)"
[ -n "$body" ] || exit 0

printf 'CAVEMAN MODE ACTIVE — level: %s\n\n%s\n' "$MODE" "$body"
exit 0
