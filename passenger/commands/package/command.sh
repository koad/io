#!/usr/bin/env bash

# Use environment variables with defaults for source and output directories, and base name
SOURCE_DIR="${SOURCE_DIR:-./dist}"
OUTPUT_DIR="${OUTPUT_DIR:-./}"
BASE_NAME="${BASE_NAME:-passenger-augments}"

# Ensure the output directory exists
mkdir -p "$OUTPUT_DIR"

# Generate a timestamp
CURRENT_DATETIME=$(date +"%Y-%m-%d-%H-%M")

# Construct the zip file name
ZIP_FILE="$OUTPUT_DIR/$BASE_NAME-$CURRENT_DATETIME.zip"
echo "Saving to file: $ZIP_FILE"

# Zip the directory
if zip -r "$ZIP_FILE" "$SOURCE_DIR" > /dev/null; then
  echo "Successfully created zip: $ZIP_FILE"
  # Check file size and print it in megabytes
  FILE_SIZE_MB=$(du -m "$ZIP_FILE" | cut -f1)
  echo "Zip file size: $FILE_SIZE_MB MB"
else
  echo "Error creating zip file."
  exit 1
fi
