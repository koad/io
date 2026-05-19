#!/usr/bin/env bash

# Define the directories
DIST_DIR="./dist"
PUBLIC_DIR="./src/public"
PRIVATE_DIR="./src/private"

meld $PRIVATE_DIR $DIST_DIR
meld $PUBLIC_DIR $DIST_DIR
