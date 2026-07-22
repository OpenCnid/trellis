"""Tests for the outbound content-DLP hook.

These assert what the hook does, never that it makes anything safe. The hook is
defense-in-depth on the residual the data-flow boundary leaves
(REPL_SANDBOX_ARCHITECTURE.md section 3.1 (The exfiltration resolution)), so
there is deliberately no test named "no secret escapes" — this component cannot
make that true and a test claiming it would be a false record.
"""

from __future__ import annotations

import re

import pytest

from repl_sandbox.dlp import (
    ACTION_DENY,
    ACTION_FLAG,
    ACTION_REDACT,
    MAX_FINDINGS_PER_RULE,
    DlpFinding,
    DlpHook,
    DlpRule,
    default_credential_rules,
    findings_to_audit,
    has_denial,
)

OPENAI_SHAPED_KEY = "sk-live-4Xq7ZbT2mN8pR1sV6wY0aC3dE5fG7hJ9kL"
AWS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
GITHUB_TOKEN = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"


# ---------------------------------------------------------------------------
# The empty hook
# ---------------------------------------------------------------------------


def test_hook_with_no_rules_is_a_no_op():
    hook = DlpHook()
    text = f"here is {OPENAI_SHAPED_KEY} in the open"
    assert hook.scan_outbound(text) == []
    assert hook.apply(text) == (text, [])


def test_rules_are_injectable_not_baked_in():
    """A default rule set is offered; it is not installed behind the caller."""
    assert DlpHook().rules == ()
    assert DlpHook.with_default_rules().rules == default_credential_rules()


def test_custom_rule_set_is_honoured_alone():
    only = DlpRule(name="canary", pattern=re.compile(r"CANARY-\d{4}"), action=ACTION_REDACT)
    hook = DlpHook([only])
    text = f"CANARY-1234 and {OPENAI_SHAPED_KEY}"
    rewritten, findings = hook.apply(text)
    assert [f.rule for f in findings] == ["canary"]
    assert "CANARY-1234" not in rewritten
    # A rule set that was not passed in does not fire.
    assert OPENAI_SHAPED_KEY in rewritten


def test_unknown_action_is_rejected_at_construction():
    with pytest.raises(ValueError):
        DlpRule(name="bad", pattern=re.compile("x"), action="quarantine")


def test_non_rule_members_are_rejected():
    with pytest.raises(TypeError):
        DlpHook(["not a rule"])


# ---------------------------------------------------------------------------
# scan vs apply
# ---------------------------------------------------------------------------


def test_scan_outbound_never_modifies_the_text():
    hook = DlpHook.with_default_rules()
    text = f"key={OPENAI_SHAPED_KEY}"
    findings = hook.scan_outbound(text)
    assert findings
    assert text == f"key={OPENAI_SHAPED_KEY}"


def test_scan_of_empty_text_is_empty():
    assert DlpHook.with_default_rules().scan_outbound("") == []


def test_redact_replaces_every_occurrence_with_a_marker():
    hook = DlpHook.with_default_rules()
    text = f"{OPENAI_SHAPED_KEY} and again {OPENAI_SHAPED_KEY}"
    rewritten, findings = hook.apply(text)
    assert OPENAI_SHAPED_KEY not in rewritten
    assert rewritten.count("[redacted:provider_key]") == 2
    assert any(f.rule == "provider_key" and f.action == ACTION_REDACT for f in findings)


def test_flag_action_leaves_the_text_alone():
    hook = DlpHook.with_default_rules()
    text = 'password: hunter2hunter2hunter2'
    rewritten, findings = hook.apply(text)
    assert rewritten == text
    assert [f.action for f in findings] == [ACTION_FLAG]


def test_deny_finding_is_reported_for_the_caller_to_act_on():
    hook = DlpHook.with_default_rules()
    text = "-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n"
    _, findings = hook.apply(text)
    assert has_denial(findings)
    assert any(f.rule == "private_key_block" and f.action == ACTION_DENY for f in findings)


def test_has_denial_is_false_without_a_deny_rule():
    assert not has_denial([DlpFinding(action=ACTION_FLAG, rule="r", detail="d")])


# ---------------------------------------------------------------------------
# The default rule set
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,rule",
    [
        (f"use {OPENAI_SHAPED_KEY} please", "provider_key"),
        (f"id {AWS_KEY_ID} here", "aws_access_key_id"),
        ("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", "aws_secret_access_key"),
        (f"token {GITHUB_TOKEN}", "github_token"),
        ("Authorization: Bearer abcdefghijklmnop.qrstuvwxyz", "bearer_header"),
        ("-----BEGIN PRIVATE KEY-----", "private_key_block"),
        ('api_key: "abcdefghijklmn"', "credential_assignment"),
    ],
)
def test_default_rules_catch_obvious_credential_shapes(text, rule):
    findings = DlpHook.with_default_rules().scan_outbound(text)
    assert rule in {f.rule for f in findings}


def test_ordinary_prose_does_not_fire_any_default_rule():
    hook = DlpHook.with_default_rules()
    text = (
        "Summarise the third paragraph of the attached memo and return the two "
        "figures it cites, then say whether they agree with the table."
    )
    assert hook.scan_outbound(text) == []


# ---------------------------------------------------------------------------
# Findings carry no secret
# ---------------------------------------------------------------------------


def test_findings_never_contain_the_matched_text():
    """Copying the secret into the record of nearly leaking it leaks it."""
    hook = DlpHook.with_default_rules()
    text = f"{OPENAI_SHAPED_KEY} {AWS_KEY_ID} {GITHUB_TOKEN}"
    _, findings = hook.apply(text)
    assert findings
    rendered = repr(findings) + repr(findings_to_audit(findings))
    for secret in (OPENAI_SHAPED_KEY, AWS_KEY_ID, GITHUB_TOKEN):
        assert secret not in rendered


def test_findings_to_audit_is_json_shaped():
    hook = DlpHook.with_default_rules()
    _, findings = hook.apply(f"{OPENAI_SHAPED_KEY}")
    rows = findings_to_audit(findings)
    assert rows and all(set(row) == {"rule", "action", "detail"} for row in rows)


def test_finding_count_is_bounded_per_rule():
    hook = DlpHook.with_default_rules()
    text = " ".join([OPENAI_SHAPED_KEY] * (MAX_FINDINGS_PER_RULE + 10))
    findings = hook.scan_outbound(text)
    provider = [f for f in findings if f.rule == "provider_key"]
    assert len(provider) == 1
    assert provider[0].detail.endswith("+")


def test_redaction_still_covers_every_match_past_the_finding_cap():
    """The finding cap bounds the record, not the rewrite."""
    hook = DlpHook.with_default_rules()
    text = " ".join([OPENAI_SHAPED_KEY] * (MAX_FINDINGS_PER_RULE + 10))
    rewritten, _ = hook.apply(text)
    assert OPENAI_SHAPED_KEY not in rewritten


def test_findings_are_stateless_across_calls():
    hook = DlpHook.with_default_rules()
    assert hook.scan_outbound(OPENAI_SHAPED_KEY)
    assert hook.scan_outbound("nothing to see") == []
