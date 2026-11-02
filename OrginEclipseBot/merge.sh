
#!/usr/bin/env bash

# ==========================================
# Project Folder → combined.txt
# ==========================================

set -e

# Root directory of the project
ROOT_DIR="$(pwd)"

# Output file
OUTPUT_FILE="$ROOT_DIR/combined.txt"

# ==========================================
# Folders to ignore
# Add more folder names here as needed
# ==========================================

IGNORE_DIRS=(
    "node_modules"
)

# ==========================================
# Build the ignore expression for find
# ==========================================

FIND_IGNORE=()

for dir in "${IGNORE_DIRS[@]}"; do
    FIND_IGNORE+=( -name "$dir" -o )
done

# Remove the trailing -o
unset 'FIND_IGNORE[${#FIND_IGNORE[@]}-1]'

# ==========================================
# Remove old combined.txt
# ==========================================

rm -f "$OUTPUT_FILE"

# Create fresh combined.txt
touch "$OUTPUT_FILE"

echo "==========================================" >> "$OUTPUT_FILE"
echo "PROJECT STRUCTURE" >> "$OUTPUT_FILE"
echo "==========================================" >> "$OUTPUT_FILE"
echo "" >> "$OUTPUT_FILE"

# ==========================================
# Generate folder tree
# ==========================================

if command -v tree >/dev/null 2>&1; then

    IGNORE_PATTERN=$(IFS='|'; echo "${IGNORE_DIRS[*]}")

    tree -I "$IGNORE_PATTERN" \
         --noreport \
         "$ROOT_DIR" >> "$OUTPUT_FILE"

else

    echo "tree command not installed. Using find instead." >&2

    find "$ROOT_DIR" \
        \( -type d \( "${FIND_IGNORE[@]}" \) -prune \) \
        -o -print >> "$OUTPUT_FILE"

fi

echo "" >> "$OUTPUT_FILE"

echo "==========================================" >> "$OUTPUT_FILE"
echo "FILE CONTENTS" >> "$OUTPUT_FILE"
echo "==========================================" >> "$OUTPUT_FILE"

# ==========================================
# Combine all text files
# ==========================================

while IFS= read -r -d '' file; do

    # Skip the output file itself
    [[ "$file" == "$OUTPUT_FILE" ]] && continue

    # Skip binary files
    if file --mime "$file" | grep -q "charset=binary"; then
        continue
    fi

    echo "" >> "$OUTPUT_FILE"
    echo "==========================================" >> "$OUTPUT_FILE"
    echo "FILE: ${file#$ROOT_DIR/}" >> "$OUTPUT_FILE"
    echo "==========================================" >> "$OUTPUT_FILE"
    echo "" >> "$OUTPUT_FILE"

    cat "$file" >> "$OUTPUT_FILE"

    echo "" >> "$OUTPUT_FILE"

done < <(
    find "$ROOT_DIR" \
        \( -type d \( "${FIND_IGNORE[@]}" \) -prune \) \
        -o -type f -print0 | sort -z
)

echo "=========================================="
echo "Successfully generated combined.txt"
echo "=========================================="
