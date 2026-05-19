#!/usr/bin/env bash

echo "Checking and removing previous meteor bundles"
if [ -d "bundles" ]; then
  rm -rf bundles
  echo "Removed bundles"
else
  echo "No bundles directory found, skipping"
fi

echo "Checking and removing previous extension client builds"
if [ -d "builds" ]; then
  rm -rf builds
  echo "Removed builds"
else
  echo "No builds directory found, skipping"
fi

echo "Checking and removing previous distribution bundle"
if [ -d "dist" ]; then
  rm -rf dist
  echo "Removed dist"
else
  echo "No dist directory found, skipping"
fi

echo "done cleaning"
