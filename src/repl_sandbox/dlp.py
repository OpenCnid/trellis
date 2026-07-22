"""Outbound content-DLP hook for the host LM handler.

**This module is defense-in-depth. It is NOT the boundary, and it must never be
named as an enforcing surface for the exfiltration invariant.** The boundary is
a data-flow property: the guest holds opaque handles, not secret-bearing
payloads, so the corpus is never in the guest to be leaked
(REPL_SANDBOX_ARCHITECTURE.md section 3.1 (The exfiltration resolution);
REPL_SANDBOX_SPEC.md section 6 (Security invariants)). What this hook does is
reduce the *rate* at which an injected instruction succeeds in moving the narrow
residual — the bytes a sink already, deliberately, materialised — and feed the
audit log so an attempt is visible. Strip this module out entirely and bulk
exfiltration is still structurally impossible; that is the test of whether a
control is the boundary or is under it. Content inspection over model-controlled
natural language is an unsolved problem
(REPL_SANDBOX_THREAT_MODEL.md section 8, residual R1), so nothing here is
described as making exfiltration impossible.

Consequences of that standing, in code:

* a finding is a *finding*, never a proof of safety — an empty finding list means
  "no rule matched", not "this text is clean";
* the rules are injectable rather than hard-coded, because a fixed rule set baked
  into the handler would be a default instance where a frame belongs. The default
  set below covers obvious credential shapes and is offered, not imposed;
* a finding never carries the matched text. Copying a secret into the audit log
  to record that a secret was nearly sent is a self-inflicted disclosure, so
  findings carry the rule name, a count, and an offset only.

Rule bodies are deliberately simple, bounded regexes: no nested quantifiers, no
unbounded backtracking, because this scanner runs on attacker-influenced text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence

#: Record the match and let the text through unchanged.
ACTION_FLAG = "flag"
#: Replace each match with a marker before the text is dispatched.
ACTION_REDACT = "redact"
#: Refuse the call. The caller raises `DeniedError`; nothing is dispatched.
ACTION_DENY = "deny"

ACTIONS: tuple[str, ...] = (ACTION_FLAG, ACTION_REDACT, ACTION_DENY)

#: Ceiling on findings recorded per rule per scan. A hostile prompt can contain
#: a million matches; the audit record only needs to know the rule fired.
MAX_FINDINGS_PER_RULE = 32


@dataclass(frozen=True)
class DlpFinding:
    """One rule hit. Carries no matched text — see the module docstring."""

    action: str
    rule: str
    detail: str


@dataclass(frozen=True)
class DlpRule:
    """A named pattern and what to do when it matches.

    `pattern` is a compiled regex so the caller owns the flags, and so an
    expensive pattern is compiled once at construction rather than per call.
    """

    name: str
    pattern: re.Pattern[str]
    action: str = ACTION_FLAG

    def __post_init__(self) -> None:
        if self.action not in ACTIONS:
            raise ValueError(f"unknown DLP action {self.action!r}; expected one of {ACTIONS}")

    def marker(self) -> str:
        """The replacement text substituted for a redacted match."""
        return f"[redacted:{self.name}]"


def _rule(name: str, pattern: str, action: str, flags: int = 0) -> DlpRule:
    return DlpRule(name=name, pattern=re.compile(pattern, flags), action=action)


def default_credential_rules() -> tuple[DlpRule, ...]:
    """Obvious credential shapes.

    Offered as a starting set for the host driver to pass in, not installed by
    default: `DlpHook()` with no rules is a no-op, which keeps "the hook is
    present" and "the hook has an opinion" separate states.

    These catch literal, well-known token formats. They do not catch a secret an
    attacker has base64'd, spelled out, or paraphrased, and they are not meant
    to — see the module docstring.
    """
    return (
        # Provider-style bearer keys: `sk-...`, including `sk-ant-...`.
        _rule("provider_key", r"\bsk-[A-Za-z0-9_-]{16,256}\b", ACTION_REDACT),
        # AWS long-term and session access-key ids.
        _rule("aws_access_key_id", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", ACTION_REDACT),
        _rule(
            "aws_secret_access_key",
            r"\baws_secret_access_key\b[ \t]*[=:][ \t]*[A-Za-z0-9/+=]{20,64}",
            ACTION_REDACT,
            re.IGNORECASE,
        ),
        _rule("github_token", r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b", ACTION_REDACT),
        _rule(
            "bearer_header",
            r"\bauthorization[ \t]*:[ \t]*bearer[ \t]+[A-Za-z0-9._-]{16,512}",
            ACTION_REDACT,
            re.IGNORECASE,
        ),
        # A private key is never legitimate outbound prompt content.
        _rule(
            "private_key_block",
            r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----",
            ACTION_DENY,
        ),
        # Weakest rule, so it only flags: a credential-shaped assignment.
        _rule(
            "credential_assignment",
            r"\b(?:api[_-]?key|secret[_-]?key|password|passwd|access[_-]?token)\b"
            r"[ \t]*[=:][ \t]*[\"']?[A-Za-z0-9._-]{12,256}",
            ACTION_FLAG,
            re.IGNORECASE,
        ),
    )


class DlpHook:
    """Scans and rewrites outbound text against an injectable rule set.

    Stateless across calls: two prompts never influence each other's findings,
    so the hook is safe to share between threads serving different sessions.
    """

    def __init__(self, rules: Sequence[DlpRule] = ()) -> None:
        self._rules: tuple[DlpRule, ...] = tuple(rules)
        for rule in self._rules:
            if not isinstance(rule, DlpRule):
                raise TypeError(f"DLP rules must be DlpRule, got {type(rule).__name__}")

    @classmethod
    def with_default_rules(cls) -> "DlpHook":
        """A hook carrying `default_credential_rules()`."""
        return cls(default_credential_rules())

    @property
    def rules(self) -> tuple[DlpRule, ...]:
        return self._rules

    def scan_outbound(self, text: str) -> list[DlpFinding]:
        """Report what matches. Never modifies `text`."""
        findings: list[DlpFinding] = []
        if not text:
            return findings
        for rule in self._rules:
            count = 0
            first_offset: int | None = None
            for match in rule.pattern.finditer(text):
                count += 1
                if first_offset is None:
                    first_offset = match.start()
                if count >= MAX_FINDINGS_PER_RULE:
                    break
            if count:
                findings.append(
                    DlpFinding(
                        action=rule.action,
                        rule=rule.name,
                        # Offsets and counts only. The matched bytes stay out of
                        # every downstream record.
                        detail=f"{count} match(es) at offset {first_offset}"
                        + ("+" if count >= MAX_FINDINGS_PER_RULE else ""),
                    )
                )
        return findings

    def apply(self, text: str) -> tuple[str, list[DlpFinding]]:
        """Return `(rewritten_text, findings)`.

        Redact rules substitute their marker; flag and deny rules leave the text
        alone. Acting on a deny finding is the caller's job — this hook has no
        way to refuse an RPC, and pretending otherwise would put policy in two
        places. The LM handler raises `DeniedError` when any returned finding
        has `action == "deny"`.
        """
        findings = self.scan_outbound(text)
        if not findings:
            return text, findings
        redacted = text
        fired = {f.rule for f in findings}
        for rule in self._rules:
            if rule.action == ACTION_REDACT and rule.name in fired:
                redacted = rule.pattern.sub(rule.marker(), redacted)
        # A deny finding still returns the redacted text; the caller refuses the
        # call and discards it.
        return redacted, findings


def has_denial(findings: Sequence[DlpFinding]) -> bool:
    """True when any finding demands the call be refused."""
    return any(f.action == ACTION_DENY for f in findings)


def findings_to_audit(findings: Sequence[DlpFinding]) -> list[dict]:
    """JSON-safe rendering for the audit log. Carries no matched text."""
    return [{"rule": f.rule, "action": f.action, "detail": f.detail} for f in findings]
