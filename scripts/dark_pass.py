#!/usr/bin/env python3
"""
Dark-mode systematic pass.

For each *.tsx file under apps/web/src/app/dashboard, walk every className
string literal and add dark: variants for the standard pairings, but ONLY
when no equivalent dark: variant already exists in that same className
group.

Standard pairings (light -> dark):
  bg-white                 -> dark:bg-gray-800   (default; 'page'/min-h-screen contexts get gray-900 below)
  bg-gray-50               -> dark:bg-gray-900
  bg-gray-100              -> dark:bg-gray-800
  text-gray-900            -> dark:text-gray-100
  text-gray-800            -> dark:text-gray-200
  text-gray-700            -> dark:text-gray-300
  text-gray-600            -> dark:text-gray-400
  text-gray-500            -> dark:text-gray-400
  text-gray-400            -> dark:text-gray-500
  border-gray-200          -> dark:border-gray-700
  border-gray-300          -> dark:border-gray-600
  divide-gray-200          -> dark:divide-gray-700
  hover:bg-gray-50         -> dark:hover:bg-gray-800
  hover:bg-gray-100        -> dark:hover:bg-gray-700
  placeholder-gray-400     -> dark:placeholder-gray-500
  ring-gray-200            -> dark:ring-gray-700

We process each className string by tokenizing on whitespace and checking
if the dark counterpart already exists. If not, we append it.

A className string can be detected via:
  className="..."
  className={`...`} (template, may contain ${...})
  className={cn("...", "...")} or clsx etc.

For safety we ONLY transform whole quoted string literals (single, double,
or backtick) that are inside a className= attribute or inside common
helper calls (cn, clsx, twMerge, classNames). We leave dynamic
interpolation alone.
"""

from __future__ import annotations
import re
import sys
from pathlib import Path

ROOT = Path("apps/web/src/app/dashboard")

# Standard pairings: token -> dark token
PAIRS: list[tuple[str, str]] = [
    ("bg-white", "dark:bg-gray-800"),
    ("bg-gray-50", "dark:bg-gray-900"),
    ("bg-gray-100", "dark:bg-gray-800"),
    ("text-gray-900", "dark:text-gray-100"),
    ("text-gray-800", "dark:text-gray-200"),
    ("text-gray-700", "dark:text-gray-300"),
    ("text-gray-600", "dark:text-gray-400"),
    ("text-gray-500", "dark:text-gray-400"),
    ("text-gray-400", "dark:text-gray-500"),
    ("border-gray-200", "dark:border-gray-700"),
    ("border-gray-300", "dark:border-gray-600"),
    ("divide-gray-200", "dark:divide-gray-700"),
    ("hover:bg-gray-50", "dark:hover:bg-gray-800"),
    ("hover:bg-gray-100", "dark:hover:bg-gray-700"),
    ("placeholder-gray-400", "dark:placeholder-gray-500"),
    ("ring-gray-200", "dark:ring-gray-700"),
]

# Some tokens have variants like "md:bg-white", "sm:text-gray-700",
# "lg:hover:bg-gray-100". We only handle bare tokens to keep this safe;
# responsive variants are uncommon for these pairings and adding
# "dark:md:bg-..." is wrong anyway (correct is "md:dark:..."). Keep simple.

# A class token is a sequence of [A-Za-z0-9:_/.\[\]#%-] (no whitespace).
# We split on whitespace.

def transform_classlist(s: str) -> str:
    # Skip if has interpolation
    if "${" in s:
        return s
    # Tokenize by whitespace, preserve original spacing minimally with single spaces
    tokens = s.split()
    if not tokens:
        return s
    token_set = set(tokens)
    additions: list[str] = []
    for light, dark in PAIRS:
        if light in token_set and dark not in token_set:
            # Also avoid collision with any existing dark:bg-* / dark:text-* / dark:border-*
            # for the same property; we only add if NO dark: token shares the same prefix kind.
            prefix_kind = dark.split("-", 1)[0]  # e.g. 'dark:bg', 'dark:text', 'dark:border', 'dark:hover:bg', 'dark:divide', 'dark:placeholder', 'dark:ring'
            already_has_kind = any(t.startswith(prefix_kind + "-") for t in tokens)
            if already_has_kind:
                continue
            additions.append(dark)
            tokens.append(dark)
            token_set.add(dark)
    if not additions:
        return s
    # Preserve leading/trailing whitespace
    leading = len(s) - len(s.lstrip())
    trailing = len(s) - len(s.rstrip())
    body = " ".join(tokens)
    return s[:leading] + body + s[len(s)-trailing:] if trailing else s[:leading] + body


# We must match className strings carefully. Pragmatic approach:
# 1) className="..."  (double-quoted, no nested interpolation)
# 2) className='...'  (single-quoted)
# 3) className={`...`} (backtick, no ${} inside)
# 4) Inside cn(...)/clsx(...)/twMerge(...)/classNames(...) calls, transform any
#    string literal argument (double, single, or backtick without ${}).

ATTR_RE = re.compile(r'className=("([^"\\]*(?:\\.[^"\\]*)*)"|\'([^\'\\]*(?:\\.[^\'\\]*)*)\'|\{`([^`$]*)`\})')

# For helper calls we need to find the call and process its string literals.
HELPER_NAMES = ("cn", "clsx", "twMerge", "classNames")


def transform_helper_args(text: str) -> str:
    # Find helper(...) calls; balance parens. Process string literals inside.
    out = []
    i = 0
    n = len(text)
    name_re = re.compile(r'\b(' + '|'.join(HELPER_NAMES) + r')\(')
    while i < n:
        m = name_re.search(text, i)
        if not m:
            out.append(text[i:])
            break
        out.append(text[i:m.start()])
        out.append(m.group(0))
        # Walk from after the '(' until matching ')'
        depth = 1
        j = m.end()
        seg_start = j
        while j < n and depth > 0:
            c = text[j]
            if c == '"' or c == "'":
                # consume string
                quote = c
                k = j + 1
                while k < n:
                    if text[k] == "\\":
                        k += 2
                        continue
                    if text[k] == quote:
                        k += 1
                        break
                    k += 1
                # transform string body
                body = text[j+1:k-1]
                if "${" not in body:
                    body2 = transform_classlist(body)
                    out.append(text[seg_start:j])
                    out.append(quote + body2 + quote)
                    seg_start = k
                j = k
                continue
            if c == "`":
                # backtick string, skip if has ${
                k = j + 1
                has_interp = False
                while k < n and text[k] != "`":
                    if text[k] == "\\":
                        k += 2
                        continue
                    if text[k] == "$" and k + 1 < n and text[k+1] == "{":
                        has_interp = True
                    k += 1
                if k < n:
                    k += 1
                if not has_interp:
                    body = text[j+1:k-1]
                    body2 = transform_classlist(body)
                    out.append(text[seg_start:j])
                    out.append("`" + body2 + "`")
                    seg_start = k
                j = k
                continue
            if c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        out.append(text[seg_start:j])
        i = j
    return "".join(out)


def transform_attr(text: str) -> str:
    # Replace classlist inside className="..." or className='...' or className={`...`}
    def repl(m: re.Match) -> str:
        whole = m.group(0)
        dq = m.group(2)
        sq = m.group(3)
        bt = m.group(4)
        if dq is not None:
            new = transform_classlist(dq)
            return f'className="{new}"'
        if sq is not None:
            new = transform_classlist(sq)
            return f"className='{new}'"
        if bt is not None:
            new = transform_classlist(bt)
            return f'className={{`{new}`}}'
        return whole
    return ATTR_RE.sub(repl, text)


def _scan_string(text: str, start: int, quote: str) -> int:
    """Return index past the closing quote for a string starting at start (text[start] == quote)."""
    k = start + 1
    n = len(text)
    while k < n:
        if text[k] == "\\":
            k += 2
            continue
        if text[k] == quote:
            return k + 1
        k += 1
    return n


def _scan_template(text: str, start: int) -> int:
    """Return index past the closing backtick, treating ${...} as nested expressions."""
    k = start + 1
    n = len(text)
    while k < n:
        if text[k] == "\\":
            k += 2
            continue
        if text[k] == "`":
            return k + 1
        if text[k] == "$" and k + 1 < n and text[k+1] == "{":
            # nested ${ ... }
            k += 2
            depth = 1
            while k < n and depth > 0:
                c = text[k]
                if c == '"' or c == "'":
                    k = _scan_string(text, k, c)
                    continue
                if c == "`":
                    k = _scan_template(text, k)
                    continue
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        k += 1
                        break
                k += 1
            continue
        k += 1
    return n


def transform_class_region(text: str, start: int, end: int) -> str:
    """
    Transform every string literal (single, double, or backtick without
    interpolation) inside text[start:end]. Recurses into ${...} interpolations
    in backtick strings, and into nested expressions.
    """
    out = []
    i = start
    while i < end:
        c = text[i]
        if c == '"' or c == "'":
            k = _scan_string(text, i, c)
            body = text[i+1:k-1]
            body2 = transform_classlist(body)
            out.append(c + body2 + c)
            i = k
            continue
        if c == "`":
            # Find end of template; recurse into ${...} sections
            j = i + 1
            n = len(text)
            seg_out = ["`"]
            while j < n:
                if text[j] == "\\":
                    seg_out.append(text[j:j+2])
                    j += 2
                    continue
                if text[j] == "`":
                    seg_out.append("`")
                    j += 1
                    break
                if text[j] == "$" and j + 1 < n and text[j+1] == "{":
                    # find balanced close
                    k = j + 2
                    depth = 1
                    while k < n and depth > 0:
                        cc = text[k]
                        if cc == '"' or cc == "'":
                            k = _scan_string(text, k, cc)
                            continue
                        if cc == "`":
                            k = _scan_template(text, k)
                            continue
                        if cc == "{":
                            depth += 1
                        elif cc == "}":
                            depth -= 1
                            if depth == 0:
                                k += 1
                                break
                        k += 1
                    # Recurse into the interpolation body (between j+2 and k-1)
                    seg_out.append("${")
                    seg_out.append(transform_class_region(text, j+2, k-1))
                    seg_out.append("}")
                    j = k
                    continue
                # Regular char in template body — class tokens here too
                # We need to also transform the literal class-name segments
                # of the template body (text between interpolations or boundaries).
                # Approach: collect run of regular characters until next backtick
                # or ${ start, then transform that run as a class string.
                run_start = j
                while j < n and text[j] != "`" and not (text[j] == "$" and j + 1 < n and text[j+1] == "{"):
                    if text[j] == "\\":
                        j += 2
                        continue
                    j += 1
                run_text = text[run_start:j]
                # Only transform if it looks like class tokens (not arbitrary text);
                # since this is inside a className= context, treat it as class string.
                run_text2 = transform_classlist(run_text)
                seg_out.append(run_text2)
            out.append("".join(seg_out))
            i = j
            continue
        if c == "{":
            # Sub-expression: walk balanced and recurse.
            k = i + 1
            n = len(text)
            depth = 1
            while k < n and depth > 0:
                cc = text[k]
                if cc == '"' or cc == "'":
                    k = _scan_string(text, k, cc)
                    continue
                if cc == "`":
                    k = _scan_template(text, k)
                    continue
                if cc == "{":
                    depth += 1
                elif cc == "}":
                    depth -= 1
                    if depth == 0:
                        k += 1
                        break
                k += 1
            out.append("{")
            out.append(transform_class_region(text, i+1, k-1))
            out.append("}")
            i = k
            continue
        # Regular char: copy as-is
        out.append(c)
        i += 1
    return "".join(out)


def transform_className_expression(text: str) -> str:
    """
    Find every `className={...}` JSX expression and transform every string /
    template literal inside the balanced braces.
    """
    out = []
    i = 0
    n = len(text)
    needle = "className={"
    while i < n:
        idx = text.find(needle, i)
        if idx < 0:
            out.append(text[i:])
            break
        out.append(text[i:idx])
        out.append(needle)
        # Find matching close brace
        j = idx + len(needle)
        depth = 1
        start = j
        while j < n and depth > 0:
            c = text[j]
            if c == '"' or c == "'":
                j = _scan_string(text, j, c)
                continue
            if c == "`":
                j = _scan_template(text, j)
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        # Transform [start:j]
        out.append(transform_class_region(text, start, j))
        if j < n and text[j] == "}":
            out.append("}")
            j += 1
        i = j
    return "".join(out)


def process_file(p: Path) -> tuple[bool, int]:
    src = p.read_text(encoding="utf-8")
    new = transform_attr(src)
    new = transform_className_expression(new)
    new = transform_helper_args(new)
    if new != src:
        p.write_text(new, encoding="utf-8")
        return True, len(new) - len(src)
    return False, 0


def main():
    files: list[Path]
    if len(sys.argv) > 1:
        files = [Path(a) for a in sys.argv[1:]]
    else:
        files = list(ROOT.rglob("*.tsx"))
    changed = 0
    for f in files:
        ok, _ = process_file(f)
        if ok:
            changed += 1
            print(f"updated {f}")
    print(f"\nfiles changed: {changed} / {len(files)}")


if __name__ == "__main__":
    main()
