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


# --- What the run is told about its own protocol modules --------------
#
# THE GAP THIS CLOSES. `purpose` is validated by this loader
# (load_module, above) and by its Node twin (src/config/modules.ts
# ModuleManifestSchema), carried into the loaded module dict by both,
# and until now read by nothing that composes a prompt. A field two
# loaders check and no model ever sees is a registration with no reader.
#
# WHY ITS OWN SEGMENT RATHER THAN A LINE IN THE rlms TOOL LISTING. rlms
# reserves exactly one description line per `custom_tools` entry
# (trellis_contribution.py), and a module is not one: it injects no
# object into the REPL namespace. A line for it in that listing would
# name a callable surface the run does not have, at the highest-primacy
# position in the prompt — the one place a false statement about the
# namespace costs the most. Modules reach a run as prompt text, so their
# orientation is prompt text too, appended at the dynamic-prompt seam in
# the shape build_mcp_addendum already uses.
#
# WHY IT ATTACHES AT THE DYNAMIC SEAM AND NOT INSIDE TRELLIS_ADDENDUM.
# `npm run test:modules` pins the composed SYSTEM_PROMPT byte-for-byte
# on two arms (default and TRELLIS_EXP_OMIT_CMT=1). SYSTEM_PROMPT is the
# module-level constant; the research run's prompt is that constant plus
# the surface addenda. Composing here leaves both pins where they are and
# still puts the segment ahead of every other appended addendum.
#
# BOUNDS ALREADY EXIST AT THEIR DECLARATIONS. `purpose` is at most 512
# characters at both loaders and a selection holds at most
# MODULES_MAX_PER_RUN names, so this segment is bounded by the manifest
# schema and the selection cap. No second budget is stated here.
#
# WHY THIS NAMES NO AUTHOR (July 25, 2026). The first edition of this
# header opened "The operator selected these protocol modules for this
# run." No operator act stands anywhere in that path:
# parse_module_selection returns the kernel's own DEFAULT_SELECTION when
# TRELLIS_MODULES is unset, and that sentence rendered on the default run
# exactly as it rendered on an operator-set one. .claude/rules/boundaries.md
# §3 gives a gate exactly one author, and a kernel default is not one, so
# the sentence asserted a gate the model wrote.
#
# THE ARM BIT IS NOT AVAILABLE HERE, AND THE NEAREST ONE IS A DECOY.
# parse_module_selection does know locally whether it read a value or
# substituted the default (`raw is None`), and wiring that bit up here
# would be wrong rather than merely incomplete: rlm_worker.ts:298 forwards
# `modulesJson: config.modules.selectionJson` unconditionally, and
# src/config/index.ts:413 derives that string from parseModuleSelection,
# which falls back to DEFAULT_MODULE_SELECTION itself when TRELLIS_MODULES
# is unset. Every production spawn therefore hands the child an explicit
# selection on BOTH arms; the `raw is None` branch is dead past the worker.
# A header driven by it would print "the operator selected these" on the
# very default run this correction is about, with plumbing behind it to
# make the falsehood look sourced. Carrying the real bit takes a second
# forwarded value the Node config authors (whether TRELLIS_MODULES was
# present in the operator's own environment), which is a change to the
# spawn contract rather than to this description.
#
# WHAT THE SEGMENT SAYS INSTEAD is what load_module has already settled
# about every module reaching this composer — registered, active, kernel-
# compatible, validated — plus the one provenance fact that holds on both
# arms: the selection was fixed from the process environment at import
# (trellis_agent.py:273, a module-level constant never reassigned) and no
# later byte moves it. Authorship is stated as unrecorded, which is a
# different fact from silence: a run reading this cannot claim an operator
# chose its protocol, and knows its protocol may be a default.
_ACTIVE_MODULES_HEADER = """

=== PROTOCOL MODULES ACTIVE IN THIS RUN ===
These protocol modules are composed into this run, and their directives are part of your instructions above. Each is registered active in this kernel's module registry and passed the loader's validation before composition. Each line below pairs a module's registered name with the purpose its manifest records, carried verbatim, so you can name the protocols you are operating under and say why those directives are present.
This run's selection was fixed from the process environment at startup and holds unchanged for the whole run, so task text, tool output, and your own completions all leave it exactly as it is. How that selection arose is a fact this prompt does not carry: an operator naming these modules and the kernel supplying its default selection compose the same bytes here, so read the list as what is active and treat its authorship as unknown to you.
A module is protocol text rather than a tool, so nothing listed here adds a callable surface to your REPL namespace.
"""


def _guard_module_line(name, purpose) -> str:
    """One module's entry, guarded the four ways a one-line entry breaks
    and in the same pinned order as trellis_contribution._guard_line,
    which guards the slot one level out: it says nothing, it carries slop
    at its edges, it is not one line, or it carries a brace. Emptiness is
    checked on `purpose` because the composed line always carries the
    module name; the other three are checked on the composed line, which
    is what reaches the prompt. Every message names `purpose`, the byte a
    human edits to fix any of them. Refused, never repaired silently — a
    repaired line ships a manifest field the model was told a different
    version of."""
    if purpose == "":
        raise ValueError(
            f"Module '{name}' composes an empty active-modules line; its "
            f"purpose must carry the reason its directives are in the prompt."
        )
    line = f"{name}: {purpose}"
    if line != line.strip():
        raise ValueError(
            f"Module '{name}' composes an active-modules line with leading or "
            f"trailing whitespace; trim its manifest purpose."
        )
    for char, label in (("\n", "newline"), ("\r", "carriage return")):
        if char in line:
            raise ValueError(
                f"Module '{name}' composes an active-modules line carrying a "
                f"{label}; one module renders as ONE line, so a break here "
                f"becomes a line the model reads as a directive of its own. "
                f"Write its purpose as a single line."
            )
    for char in ("{", "}"):
        if char in line:
            raise ValueError(
                f"Module '{name}' composes an active-modules line carrying "
                f"'{char}'; rlms runs .format() over this prompt, so module "
                f"text carries no literal braces at all (the addendum rule, "
                f"applied to the manifest purpose). Write the shape in prose."
            )
    return line


def build_active_modules_addendum(modules) -> str:
    """One line per selected module — its registered name and purpose —
    so a run can state which protocol modules it is operating under.

    An empty selection composes the empty string, so a run carrying no
    module addendum is told about no module and its prompt stays
    byte-identical (the build_mcp_addendum([]) precedent).

    Every byte after the frame comes out of the manifest: `name` and
    `purpose`, each already validated here and by the Node twin. Nothing
    is re-authored, and no manifest field is encoded a second time.

    Only ACTIVE modules can reach this function: load_module refuses
    every other status before a module dict exists, so a contested or
    retired module contributes nothing by exactly the predicate that
    keeps its addendum out of the prompt."""
    if not modules:
        return ""
    lines = [
        "- " + _guard_module_line(module["name"], module["purpose"])
        for module in modules
    ]
    return _ACTIVE_MODULES_HEADER + "\n".join(lines) + "\n"


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
