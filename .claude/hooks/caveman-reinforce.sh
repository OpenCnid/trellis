#!/usr/bin/env bash
# caveman — UserPromptSubmit reinforcement hook (Trellis, repo-native).
#
# The SessionStart hook injects the full ruleset ONCE. Over a long session that
# anchor gets buried by context compression and by other instructions injected
# each turn, and the model drifts back to verbose. This hook re-emits a tiny
# reminder every user turn so caveman stays in the model's active attention.
# ~30 tokens/turn — cheaper than the drift it prevents.
#
# Emits Claude Code's UserPromptSubmit additionalContext JSON. Honors an
# in-prompt off switch for the current turn ("stop caveman" / "normal mode").
# Silent-fail: never block prompt submission.

input="$(cat 2>/dev/null)" || exit 0
low="$(printf '%s' "$input" | tr '[:upper:]' '[:lower:]')"

case "$low" in
  *"stop caveman"*|*"normal mode"*|*"disable caveman"*|*"deactivate caveman"*) exit 0 ;;
esac

printf '%s' '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"CAVEMAN MODE ACTIVE (full). Drop articles/filler/pleasantries/hedging. Fragments OK. Trellis domain terms, code, CLI commands, error strings, commit types, doc/session-log tokens: verbatim. Code/commits/PRs/docs/security warnings: write normal."}}'
exit 0
