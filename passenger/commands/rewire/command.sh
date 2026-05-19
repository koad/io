#!/usr/bin/env bash

# Define the directories
DIST_DIR="./dist"
PUBLIC_DIR="./src/public"
PRIVATE_DIR="./src/private"

# Function to create symlinks if the corresponding file exists in src/public or src/private
create_symlinks() {
    local source_dir=$1
    local target_dir=$2

    # Iterate through the files in the source directory
    for item in "$source_dir"/*; do
        # Get basename of the file or directory
        local base_item=$(basename "$item")
        # Define the target path
        local target_item="$target_dir/$base_item"

        # Check if the file or directory exists in the target directory
        if [ -e "$target_item" ]; then
            # Remove the file or directory from the target
            rm -rf "$target_item"
            # Create a symlink from the target to the source
            ln -s "$PWD/$item" "$target_item"
            echo "Created symlink for $base_item"
        fi
    done
}

# Create symlinks for public directory
echo "Rewiring public directory..."
create_symlinks "$PUBLIC_DIR" "$DIST_DIR"

# Create symlinks for private directory
echo "Rewiring private directory..."
create_symlinks "$PRIVATE_DIR" "$DIST_DIR"

echo "Rewiring complete."
