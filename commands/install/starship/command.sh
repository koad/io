#!/usr/bin/env bash

# Starship Installation Script
# Reference: https://book.koad.sh/cheatsheets/starship-cross-shell-prompt

# Step 1: Download and run the Starship installer
# Note: curl -fsSL ensures a silent and secure download.
echo "Downloading and installing Starship..."
curl -fsSL https://starship.rs/install.sh | sh

# Step 2: Create a configuration directory for Starship
# ~/.config is the typical location for Starship's configuration file.
echo "Creating configuration directory at ~/.config..."
mkdir -p ~/.config

# Step 3: Download a preconfigured starship.toml
# This Gist contains a custom Starship prompt configuration.
echo "Downloading starship.toml..."
cd ~/.config/
wget https://gist.githubusercontent.com/koad/733ca120bc7f0ca44ebd2e96d658b177/raw/starship.toml

# Step 4: Add Starship initialization to .bashrc
# Appending the Starship initialization command to .bashrc ensures it runs in every new terminal session.
echo "Adding Starship initialization to .bashrc..."
echo 'eval "$(starship init bash)"' >> ~/.bashrc

# Step 5: Reload .bashrc to apply changes immediately
echo "Reload .bashrc to make Starship available in the current session."
echo "> source ~/.bashrc"

echo
echo "Starship installation complete!"
