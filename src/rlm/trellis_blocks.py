"""Session 24 (CODE_MEDIATED_TEXT.md, the localization fix): the shared,
dependency-free AST block walk.

This module is stdlib-only ON PURPOSE. The Python-to-TypeScript block
parity test (src/core/ast/block_parity.test.ts) spawns it inside plain
`npm test`, which in CI runs BEFORE the Python runtime (psycopg2, neo4j,
rlms) is installed — so nothing here may import beyond the standard
library. trellis_tools.py imports it for the real database accessors.

Both functions are ports of the TypeScript authority in
src/core/ast/traverse.ts (`collectExtractionBlocks` / `nodeText`) over a
node's stored `data` JSONB, and the parity test pins the two
implementations block-for-block, byte-for-byte against real parser
output. Change them together or not at all.
"""

import json

# Markdown block types that form one extraction unit each (traverse.ts
# MARKDOWN_BLOCK_TYPES): the walk stops at the first block it meets, so
# a listItem swallows its inner paragraphs (and any nested list) into a
# single unit, and inline leaves (text, strong, emphasis, inlineCode)
# are never emitted on their own.
MARKDOWN_BLOCK_TYPES = frozenset({"paragraph", "heading", "listItem", "code"})

# Code-aware block types (traverse.ts CODE_BLOCK_TYPES, Session 8).
# code_class is deliberately absent — it is a container whose methods
# and header/attribute chunks are the units, so class bytes are never
# collected twice.
CODE_BLOCK_TYPES = frozenset({
    "code_function",
    "code_method",
    "code_chunk",
    "opaque_text",
})


def node_text(node) -> str:
    """Reconstructs a node's text from its stored `data` (the exact
    behavior of traverse.ts nodeText): direct content when present, else
    the concatenation of its children's text in document order. Markdown
    block nodes (paragraph/heading/listItem) carry no direct content —
    their text lives in child nodes — so `data->>'content'` reads NULL
    for them; this recovers it."""
    if isinstance(node, str):
        try:
            node = json.loads(node)
        except (json.JSONDecodeError, ValueError):
            return node
    if not isinstance(node, dict):
        return ""
    content = node.get("content")
    if content is not None:
        return content
    return "".join(node_text(child) for child in (node.get("children") or []))


def collect_block_nodes(node, acc=None) -> list:
    """The extraction-block walk (the exact behavior of traverse.ts
    collectExtractionBlocks): top-most markdown/code block nodes are the
    units; containers (root, list, blockquote, code_class) are traversed
    through; childless nodes WITH content (PDF elements, html blocks)
    are units as-is; childless nodes without content (thematicBreak,
    break, image) are skipped."""
    if acc is None:
        acc = []
    if isinstance(node, str):
        try:
            node = json.loads(node)
        except (json.JSONDecodeError, ValueError):
            return acc
    if not isinstance(node, dict):
        return acc
    node_type = node.get("type")
    if node_type in MARKDOWN_BLOCK_TYPES or node_type in CODE_BLOCK_TYPES:
        acc.append(node)
        return acc
    children = node.get("children") or []
    if children:
        for child in children:
            collect_block_nodes(child, acc)
        return acc
    # TS checks `node.content !== undefined`: key presence, not
    # truthiness (a JSON round trip cannot carry undefined).
    if "content" in node:
        acc.append(node)
    return acc


def blocks_from_root(root_node) -> list:
    """A document's extraction blocks IN DOCUMENT ORDER, each as a plain
    dict with keys id, type, and text — the value shape
    TrellisPostgres.get_ast_blocks serializes. Block ids are the
    already-stored AST hashes (the same citable ids get_ast_texts
    exposes); nothing new becomes identity here."""
    return [
        {"id": block.get("id"), "type": block.get("type"), "text": node_text(block)}
        for block in collect_block_nodes(root_node)
    ]
