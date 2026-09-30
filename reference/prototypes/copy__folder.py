import shutil

# 1. Define the folder you want to copy
# Note: Use r"path" (raw string) on Windows to avoid backslash '\' SyntaxErrors!
source_folder = r""

# 2. Define the path for the new folder (with its new name)
destination_folder = r""

# 3. Copy the entire folder structure and files
try:
    shutil.copytree(source_folder, destination_folder)
    print(f"Successfully copied folder to: {destination_folder}")
except FileExistsError:
    print("Error: A folder with the new name already exists at that location.")
except FileNotFoundError:
    print("Error: The original source folder could not be found.")


# ==============================================================================
# Alternative: Copying files/folders directly via Terminal Commands
# ==============================================================================

# => 1) CMD:      robocopy "C:\source" "C:\destination" /E /COPYALL
# => 2) CMD:      xcopy "C:\source" "C:\destination\" /E /I /H /Y
# => 3) PS:       cp -Recurse "C:\source" "C:\destination"
# => 4) Git Bash: cp -r /c/source /c/destination


# Summary - What to use where:
# ==> In standard Windows CMD:  Use robocopy or xcopy.
# ==> In Windows PowerShell:     Use cp -Recurse.
# ==> In Linux / Mac / Git Bash: Use cp -r (with forward slashes).
