from pathlib import Path

# Main folder containing your 5 folders
source_folder = Path(r"")
# File where all contents will be combined
output_file = Path(r"")


# Find all Python files recursively
python_files = sorted(source_folder.rglob("*.py"))

with output_file.open("w", encoding="utf-8") as output:

    for index, file_path in enumerate(python_files, start=1):

        # Get file content
        content = file_path.read_text(encoding="utf-8")

        # Relative path makes it easier to identify where the file came from
        relative_path = file_path.relative_to(source_folder)

        # Add separator and file information
        output.write(
            f"\n{'=' * 60}\n"
            f"FILE {index}\n"
            f"PATH: {relative_path}\n"
            f"{'=' * 60}\n\n"
        )

        # Add the actual file content
        output.write(content)

        # Make sure files don't run together
        output.write("\n\n")

print(f"Done! {len(python_files)} Python files combined.")
print(f"Output: {output_file}")
