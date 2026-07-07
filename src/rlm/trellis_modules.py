"""The module registry loader for the Trellis RLM (Session 15).

Design record: docs/architecture/WORKSPACE_AND_MODULES.md §9. A module
is a versioned document-plus-assets artifact under `modules/<name>/`
(manifest `module.json` + a brace-free `addendum` text file) — protocol
text composed into the system prompt, never code fused into the
harness. This first edition supports PROTOCOL MODULES only: manifests
with a non-empty `tools` list are rejected (tool-bearing modules are a
later class with their own gate — §9.3).

Selection is operator-owned (Guardrail 5): `TRELLIS_MODULES` is either
unset — meaning the DEFAULT selection ["spatial-flywheel"], which keeps
the composed prompt byte-identical to the pre-extraction monolith — or
a JSON array of module names registered under `modules/`. An explicit
`[]` composes no module addenda. No inbound payload or model completion
can alter the selection mid-run.

Validation mirrors src/config/modules.ts bound-for-bound (the
mcp_servers twin discipline): name charset, manifest shape, addendum
size cap, and brace-freedom of the addendum file. rlms runs .format()
over the system prompt, so addendum files must contain no literal
braces; the single allowed substitution token `<<TRELLIS_RUBRIC>>` is
replaced at composition time with the escape-doubled rubric text
(_SAFE_RUBRIC in trellis_agent.py), whose braces are format-safe by
construction.
"""

import json
import os
import re

MODULE_NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_-]*$")
MODULES_MAX_PER_RUN = 4
MODULE_ADDENDUM_MAX_BYTES_CAP = 16 * 1024
MODULE_ADDENDUM_MAX_BYTES_DEFAULT = 8 * 1024
MODULE_STATUSES = ("active", "contested", "retired")
KERNEL_COMPAT = 1
RUBRIC_TOKEN = "<<TRELLIS_RUBRIC>>"
DEFAULT_SELECTION = ["spatial-flywheel"]

MODULES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "modules")


def parse_module_selection(raw):
    """None/unset -> the default selection (byte-identical composed
    prompt); a JSON array -> exactly that selection ([] means none).
    Blank strings are rejected rather than guessed at."""
    if raw is None:
        return list(DEFAULT_SELECTION)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"TRELLIS_MODULES is not valid JSON: {e}") from e
    if not isinstance(data, list):
        raise ValueError("Invalid TRELLIS_MODULES: expected a JSON array of module names.")
    if len(data) > MODULES_MAX_PER_RUN:
        raise ValueError(f"Invalid TRELLIS_MODULES: at most {MODULES_MAX_PER_RUN} modules per run.")
    seen = set()
    for name in data:
        if not isinstance(name, str) or not 1 <= len(name) <= 64 or not MODULE_NAME_PATTERN.match(name):
            raise ValueError(
                f"Invalid TRELLIS_MODULES: module name {name!r} must match {MODULE_NAME_PATTERN.pattern} (max 64 chars)."
            )
        if name in seen:
            raise ValueError(f"Invalid TRELLIS_MODULES: duplicate module name {name!r}.")
        seen.add(name)
    return data


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def load_module(name, modules_dir=None):
    """Loads and validates one registered module. Raises with a readable
    message on any defect — a process that cannot know its prompt
    surface must not run."""
    root = MODULES_DIR if modules_dir is None else modules_dir
    manifest_path = os.path.join(root, name, "module.json")
    if not os.path.isfile(manifest_path):
        raise ValueError(f"Module '{name}' is not registered: missing {manifest_path}.")
    with open(manifest_path, "r", encoding="utf-8") as f:
        try:
            manifest = json.load(f)
        except json.JSONDecodeError as e:
            raise ValueError(f"Module '{name}' manifest is not valid JSON: {e}") from e

    _require(isinstance(manifest, dict), f"Module '{name}' manifest must be an object.")
    _require(manifest.get("name") == name,
             f"Module '{name}' manifest name {manifest.get('name')!r} must equal its directory name.")
    version = manifest.get("version")
    _require(isinstance(version, int) and not isinstance(version, bool) and version >= 1,
             f"Module '{name}' version must be a positive integer.")
    purpose = manifest.get("purpose")
    _require(isinstance(purpose, str) and 1 <= len(purpose) <= 512,
             f"Module '{name}' purpose must be a non-empty string (max 512 chars).")
    research = manifest.get("research")
    _require(isinstance(research, dict) and isinstance(research.get("sourceNodeIds"), list)
             and all(isinstance(h, str) and re.match(r"^[0-9a-f]{64}$", h)
                     for h in research["sourceNodeIds"]),
             f"Module '{name}' research.sourceNodeIds must be a list of AST hashes (may be empty).")
    tools = manifest.get("tools")
    _require(isinstance(tools, list) and len(tools) == 0,
             f"Module '{name}' declares tools; tool-bearing modules are not supported by this kernel edition.")
    status = manifest.get("status")
    _require(status in MODULE_STATUSES,
             f"Module '{name}' status must be one of {', '.join(MODULE_STATUSES)}.")
    _require(status == "active",
             f"Module '{name}' has status '{status}' and cannot be composed (only active modules load).")
    _require(manifest.get("kernelCompat") == KERNEL_COMPAT,
             f"Module '{name}' kernelCompat {manifest.get('kernelCompat')!r} does not match this kernel ({KERNEL_COMPAT}).")

    bounds = manifest.get("bounds") or {}
    max_bytes = bounds.get("addendumMaxBytes", MODULE_ADDENDUM_MAX_BYTES_DEFAULT)
    _require(isinstance(max_bytes, int) and not isinstance(max_bytes, bool)
             and 0 < max_bytes <= MODULE_ADDENDUM_MAX_BYTES_CAP,
             f"Module '{name}' bounds.addendumMaxBytes must be a positive integer <= {MODULE_ADDENDUM_MAX_BYTES_CAP}.")

    addendum_rel = manifest.get("addendum")
    _require(isinstance(addendum_rel, str) and addendum_rel
             and "/" not in addendum_rel and "\\" not in addendum_rel and ".." not in addendum_rel,
             f"Module '{name}' addendum must be a bare filename inside the module directory.")
    addendum_path = os.path.join(root, name, addendum_rel)
    _require(os.path.isfile(addendum_path), f"Module '{name}' addendum file {addendum_rel!r} is missing.")
    with open(addendum_path, "r", encoding="utf-8") as f:
        # Universal-newline text mode: the composed prompt is LF-stable
        # regardless of checkout line endings (the Node loader
        # normalizes CRLF identically).
        text = f.read()
    _require(len(text.encode("utf-8")) <= max_bytes,
             f"Module '{name}' addendum exceeds its addendumMaxBytes bound ({max_bytes}).")
    _require("{" not in text and "}" not in text,
             f"Module '{name}' addendum contains literal braces; rlms .format() forbids them "
             f"(use the {RUBRIC_TOKEN} substitution token for rubric text).")

    return {"name": name, "version": version, "purpose": purpose, "addendum_text": text}


def load_modules(selection, modules_dir=None):
    return [load_module(name, modules_dir) for name in selection]


def build_modules_addendum(modules, substitutions=None) -> str:
    """Concatenates the selected modules' addenda in selection order,
    normalizing each to end with exactly one blank line. The only
    permitted substitution is the rubric token; substituted values must
    already be .format()-safe (doubled braces). Empty selection returns
    the empty string so the composed prompt stays byte-identical."""
    parts = []
    for module in modules:
        text = module["addendum_text"]
        for token, value in (substitutions or {}).items():
            text = text.replace(token, value)
        stripped = text.replace("{{", "").replace("}}", "")
        if "{" in stripped or "}" in stripped:
            raise ValueError(
                f"Module '{module['name']}' composed addendum has unescaped braces after substitution."
            )
        parts.append(text.rstrip("\n") + "\n\n")
    return "".join(parts)
