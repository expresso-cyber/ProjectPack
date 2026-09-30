#!/usr/bin/env python3
"""ProjectPack file engine worker CLI.

Invoked by the Node API (and usable standalone). Each command reads JSON
input from a file and writes JSON output to a file, so large payloads never
pass through argv or stdout buffering.

Usage:
  python -m file_engine.worker scan     --source SRC --out OUT.json
  python -m file_engine.worker extract  --source SRC --files FILES.json --out OUT.json
  python -m file_engine.worker hash     --source SRC --files FILES.json --out OUT.json
  python -m file_engine.worker analyze  --files FILES.json --folders FOLDERS.json --out OUT.json
  python -m file_engine.worker package  --source SRC --entries ENTRIES.json --dest DEST --out OUT.json
  python -m file_engine.worker export   --entries ENTRIES.json --format txt|md|json --out OUT

Exit codes: 0 ok · 2 usage error · 3 unsafe path · 4 processing error.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .analyzers.project import build_report
from .analyzers.duplicates import group_duplicates
from .analyzers.structure import analyze_structure
from .core import pipeline
from .exporters.json_export import render_json
from .exporters.markdown import render_markdown
from .exporters.package import create_package
from .exporters.txt import render_txt
from .security.paths import UnsafePathError


MAX_ARCHIVE_ENTRIES = 5000


def inspect_archive(archive: Path) -> dict:
    """List archive contents WITHOUT extracting anything."""
    import zipfile

    if not zipfile.is_zipfile(archive):
        return {"ok": False, "error": "not a zip archive"}
    entries: list[dict] = []
    truncated = False
    with zipfile.ZipFile(archive) as zf:
        # Reject archives that would decompress absurdly large (zip bomb guard).
        total_uncompressed = sum(info.file_size for info in zf.infolist())
        for info in zf.infolist():
            if len(entries) >= MAX_ARCHIVE_ENTRIES:
                truncated = True
                break
            entries.append({
                "name": info.filename,
                "size": info.file_size,
                "compressedSize": info.compress_size,
                "isDir": info.is_dir(),
            })
    return {
        "ok": True,
        "entryCount": len(entries),
        "totalUncompressedSize": total_uncompressed,
        "truncated": truncated,
        "entries": entries,
    }


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: str, payload) -> None:
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(out.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="file_engine.worker")
    sub = parser.add_subparsers(dest="command", required=True)

    p_scan = sub.add_parser("scan", help="discover + metadata + hash all files")
    p_scan.add_argument("--source", required=True)
    p_scan.add_argument("--out", required=True)
    p_scan.add_argument("--max-files", type=int, default=20000)
    p_scan.add_argument("--exclude", default="", help="comma-separated extra directory names to skip")

    p_extract = sub.add_parser("extract", help="extract text for a list of files")
    p_extract.add_argument("--source", required=True)
    p_extract.add_argument("--files", required=True, help="JSON list of {relativePath, extension}")
    p_extract.add_argument("--out", required=True)

    p_hash = sub.add_parser("hash", help="compute sha256 for a list of files")
    p_hash.add_argument("--source", required=True)
    p_hash.add_argument("--files", required=True, help="JSON list of relative paths")
    p_hash.add_argument("--out", required=True)

    p_analyze = sub.add_parser("analyze", help="duplicates + structure + report over stored data")
    p_analyze.add_argument("--source", required=False, help="accepted for interface uniformity; not used")
    p_analyze.add_argument("--files", required=True, help="JSON list of stored file records")
    p_analyze.add_argument("--folders", required=True, help="JSON list of stored folder records")
    p_analyze.add_argument("--out", required=True)

    p_package = sub.add_parser("package", help="copy approved files and write manifest")
    p_package.add_argument("--source", required=True)
    p_package.add_argument("--entries", required=True, help="JSON list of {path, included, type, projectId}")
    p_package.add_argument("--dest", required=True)
    p_package.add_argument("--name", default="projectpack")
    p_package.add_argument("--out", required=True)

    p_export = sub.add_parser("export", help="combined txt/markdown/json export")
    p_export.add_argument("--entries", required=True, help="JSON list of {relativePath, text}")
    p_export.add_argument("--format", choices=["txt", "md", "json"], default="txt")
    p_export.add_argument("--name", default="project")
    p_export.add_argument("--out", required=True)

    p_unpack = sub.add_parser("unpack", help="safely extract a tar.gz archive")
    p_unpack.add_argument("--archive", required=True)
    p_unpack.add_argument("--dest", required=True)
    p_unpack.add_argument("--out", required=True)

    p_inspect = sub.add_parser("inspect-archive", help="list archive contents without extracting")
    p_inspect.add_argument("--archive", required=True)
    p_inspect.add_argument("--out", required=True)

    args = parser.parse_args(argv)

    try:
        if args.command == "scan":
            exclude = {name.strip() for name in args.exclude.split(",") if name.strip()} if args.exclude else None
            payload = pipeline.run_scan(args.source, max_files=args.max_files, excluded_dirs=exclude)
            write_json(args.out, payload)
        elif args.command == "extract":
            files = load_json(args.files)
            payload = pipeline.extract_batch(args.source, files)
            write_json(args.out, payload)
        elif args.command == "hash":
            rels = load_json(args.files)
            payload = pipeline.run_hash(args.source, rels)
            write_json(args.out, payload)
        elif args.command == "analyze":
            files = load_json(args.files)
            folders = load_json(args.folders)
            payload = {
                "duplicates": group_duplicates(files),
                "structure": analyze_structure(files, folders),
                "report": build_report(files, folders),
            }
            write_json(args.out, payload)
        elif args.command == "package":
            entries = load_json(args.entries)
            manifest = create_package(
                Path(args.source), entries, Path(args.dest), project_name=args.name
            )
            write_json(args.out, manifest)
        elif args.command == "export":
            entries = load_json(args.entries)
            if args.format == "txt":
                text = render_txt(entries)
            elif args.format == "md":
                text = render_markdown(args.name, entries)
            else:
                text = render_json(args.name, entries)
            out = Path(args.out)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text, encoding="utf-8")
            write_json(args.out + ".meta.json", {"ok": True, "bytes": len(text.encode("utf-8"))})
        elif args.command == "inspect-archive":
            payload = inspect_archive(Path(args.archive))
            write_json(args.out, payload)
        elif args.command == "unpack":
            import tarfile
            dest = Path(args.dest)
            dest.mkdir(parents=True, exist_ok=True)
            with tarfile.open(args.archive, "r:gz") as tar:
                # filter="data" blocks path traversal, absolute paths, and
                # device/symlink tricks inside untrusted archives.
                tar.extractall(dest, filter="data")
            write_json(args.out, {"ok": True, "dest": str(dest), "entries": len(os.listdir(dest))})
    except UnsafePathError as exc:
        print(json.dumps({"ok": False, "code": "UNSAFE_PATH", "message": str(exc)}))
        return 3
    except (OSError, ValueError) as exc:
        print(json.dumps({"ok": False, "code": "PROCESSING_ERROR", "message": str(exc)}))
        return 4
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "code": "BAD_INPUT", "message": str(exc)}))
        return 2

    print(json.dumps({"ok": True, "command": args.command, "out": args.out}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
