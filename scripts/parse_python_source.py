"""Segments one Python source file into extraction-block spans.

Reads the complete source from stdin (UTF-8 bytes) and writes one JSON
object to stdout:

    {"segments": [{"kind": "...", "text": "...", "children": [...]}]}

or, on failure, {"error": "syntax" | "decode", "message": "..."}.

Kinds: "function" (top-level def/async def including decorators),
"class" (top-level class; carries "children" of "method"/"chunk"
segments), "method" (def inside a top-level class), and "chunk"
(everything between blocks: imports, statements, comments, whitespace,
class headers/attributes).

The contract the TypeScript boundary (source_parser.ts) re-verifies:
concatenating segment texts (children texts for classes) reproduces the
input byte-for-byte. Only the standard-library ast module is used, so
segmentation is deterministic for a given interpreter. Line/column
positions are an ephemeral slicing mechanism only — nothing positional
is emitted, keeping AST identity purely content-addressed.
"""

import ast
import json
import sys


def line_starts(source_bytes):
    starts = [0]
    for index, byte in enumerate(source_bytes):
        if byte == 0x0A:  # \n
            starts.append(index + 1)
    return starts


def absolute_offset(starts, lineno, col_offset):
    # ast line numbers are 1-based; col_offset is a UTF-8 byte offset
    # within the line, matching our byte-oriented slicing.
    return starts[lineno - 1] + col_offset


def block_span(starts, node):
    """[start, end) byte span of a def/class, including its decorators.

    Decorator expressions point past the '@', so the span starts at the
    beginning of the first decorator's line. Definitions themselves also
    start at their line start (their col_offset is the indentation
    column), which keeps indentation bytes inside the block.
    """
    first = node.decorator_list[0] if getattr(node, "decorator_list", None) else node
    start = starts[first.lineno - 1]
    end = absolute_offset(starts, node.end_lineno, node.end_col_offset)
    return start, end


def segment_range(source_bytes, starts, body, lower, upper, block_kinds):
    """Splits [lower, upper) into block segments and gap chunks."""
    segments = []
    cursor = lower
    for node in body:
        kind = block_kinds.get(type(node).__name__)
        if kind is None:
            continue
        start, end = block_span(starts, node)
        if start < cursor:
            # Overlapping spans would corrupt coverage; treat the whole
            # construct as part of the preceding chunk instead.
            continue
        if start > cursor:
            segments.append(
                {"kind": "chunk", "text": source_bytes[cursor:start].decode("utf-8")}
            )
        segment = {"kind": kind, "text": source_bytes[start:end].decode("utf-8")}
        if kind == "class":
            segment["children"] = segment_range(
                source_bytes,
                starts,
                node.body,
                start,
                end,
                {"FunctionDef": "method", "AsyncFunctionDef": "method"},
            )
        segments.append(segment)
        cursor = end
    if cursor < upper:
        segments.append(
            {"kind": "chunk", "text": source_bytes[cursor:upper].decode("utf-8")}
        )
    return segments


def main():
    source_bytes = sys.stdin.buffer.read()
    try:
        source_text = source_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        json.dump({"error": "decode", "message": str(error)}, sys.stdout)
        return
    try:
        module = ast.parse(source_text)
    except (SyntaxError, ValueError) as error:
        json.dump({"error": "syntax", "message": str(error)}, sys.stdout)
        return

    starts = line_starts(source_bytes)
    segments = segment_range(
        source_bytes,
        starts,
        module.body,
        0,
        len(source_bytes),
        {
            "FunctionDef": "function",
            "AsyncFunctionDef": "function",
            "ClassDef": "class",
        },
    )
    json.dump({"segments": segments}, sys.stdout)


if __name__ == "__main__":
    main()
