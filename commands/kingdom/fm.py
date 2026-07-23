#!/usr/bin/env python3
"""Frontmatter parser for /kingdom/ goal.md and project.md files.
No external dependencies — pure Python stdlib.

Usage:
  fm.py get <file> <field>          — print field value
  fm.py set <file> <field> <value>  — replace field value
  fm.py add-list <file> <field> <value>   — append to YAML list field
  fm.py remove-list <file> <field> <value> — remove from YAML list field
  fm.py show <file>                 — print frontmatter + body
  fm.py show-acl <file>             — print ACL info
"""

import re
import sys


def parse_fm(content):
    """Split content into (frontmatter_text, body_text)."""
    parts = content.split('---', 2)
    if len(parts) < 3:
        return '', content
    return parts[1], parts[2]


def get_field(fm_text, field):
    """Get a field value from frontmatter text.
    Handles: key: value, key: [list], key:\n  - item\n  - item
    Returns the value string, or empty string if not found.
    """
    lines = fm_text.split('\n')

    # Try inline format: key: value
    for line in lines:
        m = re.match(r'^' + re.escape(field) + r':\s*(.+?)\s*$', line)
        if m:
            val = m.group(1).strip()
            if val.startswith('[') and val.endswith(']'):
                # Inline list: [item1, item2]
                items = []
                for item in val[1:-1].split(','):
                    item = item.strip().strip("'").strip('"')
                    if item:
                        items.append(item)
                return ' '.join(items)
            return val

    # Try multiline list format
    in_field = False
    values = []
    for line in lines:
        if re.match(r'^' + re.escape(field) + r':\s*$', line):
            in_field = True
            continue
        if in_field:
            m = re.match(r'^\s{2}-\s+(.+?)\s*$', line)
            if m:
                val = m.group(1).strip()
                # Strip trailing comment
                if '#' in val:
                    val = val[:val.index('#')].strip()
                values.append(val)
                continue
            # Also try top-level dash
            m = re.match(r'^-\s+(.+?)\s*$', line)
            if m:
                val = m.group(1).strip()
                values.append(val)
                continue
            break

    return ' '.join(values) if values else ''


def set_field(fm_text, field, value):
    """Replace a field value in frontmatter text. Returns new frontmatter text."""
    lines = fm_text.split('\n')
    new_lines = []
    replaced = False
    for line in lines:
        if re.match(r'^' + re.escape(field) + r':\s', line):
            new_lines.append(f'{field}: {value}')
            replaced = True
        else:
            new_lines.append(line)
    if not replaced:
        new_lines.insert(1, f'{field}: {value}')
    return '\n'.join(new_lines)


def add_to_list(fm_text, field, value):
    """Add a value to a YAML list field. Handles inline [] and multiline - formats."""
    lines = fm_text.split('\n')

    # Check if field exists and what format
    field_idx = -1
    field_line = None
    for i, line in enumerate(lines):
        if re.match(r'^' + re.escape(field) + r':\s', line):
            field_idx = i
            field_line = line
            break
        if re.match(r'^' + re.escape(field) + r':\s*$', line):
            field_idx = i
            field_line = line
            break

    if field_line is None:
        # Field doesn't exist — add it as multiline list
        lines.insert(1, f'{field}:\n  - {value}')
        return '\n'.join(lines)

    # Check if inline list: field: [item1, item2]
    m = re.match(r'^' + re.escape(field) + r':\s*\[(.*?)\]\s*$', field_line)
    if m:
        items_str = m.group(1)
        items = [x.strip().strip("'").strip('"') for x in items_str.split(',') if x.strip()]
        if value not in items:
            items.append(value)
        new_list = ', '.join(f'"{x}"' if ' ' in x else x for x in items)
        lines[field_idx] = f'{field}: [{new_list}]'
        return '\n'.join(lines)

    # Check if value already exists in multiline list
    for i in range(field_idx + 1, len(lines)):
        m2 = re.match(r'^\s{2}-\s+(.+?)\s*$', lines[i])
        if m2:
            existing = m2.group(1).strip()
            if existing == value or existing == value:
                return fm_text  # Already exists
        else:
            break

    # Add to multiline list — insert after the field line
    indent = 2
    lines.insert(field_idx + 1, f"{' ' * indent}- {value}")
    return '\n'.join(lines)


def remove_from_list(fm_text, field, value):
    """Remove a value from a YAML list field."""
    lines = fm_text.split('\n')
    new_lines = []
    in_field = False

    for line in lines:
        if re.match(r'^' + re.escape(field) + r':\s', line):
            # Inline list
            m = re.match(r'^' + re.escape(field) + r':\s*\[(.*?)\]\s*$', line)
            if m:
                items_str = m.group(1)
                items = [x.strip().strip("'").strip('"') for x in items_str.split(',') if x.strip()]
                items = [x for x in items if x != value]
                new_list = ', '.join(f'"{x}"' if ' ' in x else x for x in items)
                new_lines.append(f'{field}: [{new_list}]')
                continue
            in_field = True
            new_lines.append(line)
            continue

        if in_field:
            m = re.match(r'^\s{2}-\s+(.+?)\s*$', line)
            if m:
                existing = m.group(1).strip()
                if existing != value:
                    new_lines.append(line)
                continue
            in_field = False

        new_lines.append(line)

    return '\n'.join(new_lines)


# --- CLI ---
def main():
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == 'get':
        filepath = sys.argv[2]
        field = sys.argv[3]
        with open(filepath) as f:
            content = f.read()
        fm_text, _ = parse_fm(content)
        if not fm_text:
            sys.exit(1)
        val = get_field(fm_text, field)
        if val:
            print(val)
        else:
            sys.exit(1)

    elif cmd == 'set':
        filepath = sys.argv[2]
        field = sys.argv[3]
        value = sys.argv[4]
        with open(filepath) as f:
            content = f.read()
        fm_text, body = parse_fm(content)
        if not fm_text:
            print("No frontmatter found", file=sys.stderr)
            sys.exit(1)
        new_fm = set_field(fm_text, field, value)
        new_content = f"---\n{new_fm}---{body}"
        with open(filepath, 'w') as f:
            f.write(new_content)

    elif cmd == 'add-list':
        filepath = sys.argv[2]
        field = sys.argv[3]
        value = sys.argv[4]
        with open(filepath) as f:
            content = f.read()
        fm_text, body = parse_fm(content)
        if not fm_text:
            print("No frontmatter found", file=sys.stderr)
            sys.exit(1)
        new_fm = add_to_list(fm_text, field, value)
        new_content = f"---\n{new_fm}\n---{body}"
        with open(filepath, 'w') as f:
            f.write(new_content)

    elif cmd == 'remove-list':
        filepath = sys.argv[2]
        field = sys.argv[3]
        value = sys.argv[4]
        with open(filepath) as f:
            content = f.read()
        fm_text, body = parse_fm(content)
        new_fm = remove_from_list(fm_text, field, value)
        new_content = f"---\n{new_fm}\n---{body}"
        with open(filepath, 'w') as f:
            f.write(new_content)

    elif cmd == 'show':
        filepath = sys.argv[2]
        with open(filepath) as f:
            content = f.read()
        fm_text, body = parse_fm(content)
        if fm_text:
            print("Frontmatter:")
            for line in fm_text.strip().split('\n'):
                print(f"  {line}")
        if body.strip():
            print("\nBody:")
            print(body.strip())

    elif cmd == 'show-acl':
        filepath = sys.argv[2]
        with open(filepath) as f:
            content = f.read()
        fm_text, _ = parse_fm(content)
        if fm_text:
            participants = get_field(fm_text, 'participants')
            contributors = get_field(fm_text, 'contributors')
            contrib_list = contributors.split() if contributors else []
            print(f"  Participants: {participants}")
            print(f"  Contributors: {' '.join(contrib_list)}")
            print(f"  Count: {len(contrib_list)}")

    else:
        print(f"Unknown command: {cmd}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
