#!/usr/bin/env bash
# SPDX-License-Identifier: 0BSD

# Extract dominant hue and saturation from a .png file and set as outfit
# Usage: <entity> outfit extract [path-to-image]
# Defaults to avatar.png in the entity dir

source "$HOME/.koad-io/commands/assert/datadir/command.sh"

IMAGE="${1:-$DATADIR/avatar.png}"

if [[ ! -f "$IMAGE" ]]; then
  echo "Image not found: $IMAGE"
  exit 64
fi

# Extract dominant H/S using python3 with only stdlib
# Full PNG decoder with filter reconstruction — no Pillow required
RESULT=$(python3 -c "
import struct, zlib, sys, colorsys

def read_png(path):
    with open(path, 'rb') as f:
        sig = f.read(8)
        if sig != b'\x89PNG\r\n\x1a\n':
            print('Not a valid PNG', file=sys.stderr); sys.exit(1)
        width = height = bit_depth = color_type = 0
        idat_chunks = []
        while True:
            raw = f.read(8)
            if len(raw) < 8: break
            length, chunk_type = struct.unpack('>I4s', raw)
            data = f.read(length)
            f.read(4)
            if chunk_type == b'IHDR':
                width, height, bit_depth, color_type = struct.unpack('>IIBB', data[:10])
            elif chunk_type == b'IDAT':
                idat_chunks.append(data)
            elif chunk_type == b'IEND':
                break
    if color_type not in (2, 6) or bit_depth != 8:
        print('Only 8-bit RGB/RGBA PNG supported', file=sys.stderr); sys.exit(1)
    raw = zlib.decompress(b''.join(idat_chunks))
    channels = 3 if color_type == 2 else 4
    bpp = channels
    stride = width * channels
    # Reconstruct filtered rows
    prev_row = bytearray(stride)
    pixels = []
    pos = 0
    for y in range(height):
        filt = raw[pos]; pos += 1
        row_raw = bytearray(raw[pos:pos+stride]); pos += stride
        row = bytearray(stride)
        for i in range(stride):
            a = row[i - bpp] if i >= bpp else 0
            b = prev_row[i]
            c = prev_row[i - bpp] if i >= bpp else 0
            if filt == 0: row[i] = row_raw[i]
            elif filt == 1: row[i] = (row_raw[i] + a) & 0xFF
            elif filt == 2: row[i] = (row_raw[i] + b) & 0xFF
            elif filt == 3: row[i] = (row_raw[i] + (a + b) // 2) & 0xFF
            elif filt == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                row[i] = (row_raw[i] + pr) & 0xFF
        for x in range(width):
            o = x * channels
            pixels.append((row[o], row[o+1], row[o+2]))
        prev_row = row
    return pixels

pixels = read_png('$IMAGE')
step = max(1, len(pixels) // 2000)
sample = pixels[::step]
hues = []; sats = []
for r, g, b in sample:
    h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
    if s > 0.05 and v > 0.05:
        hues.append(h * 360); sats.append(s * 100)
if not hues:
    print('0 0')
else:
    hues.sort(); sats.sort()
    mid = len(hues) // 2
    print(f'{int(hues[mid])} {int(sats[mid])}')
")

if [[ -z "$RESULT" ]]; then
  echo "Failed to extract colors from $IMAGE"
  exit 1
fi

HUE=$(echo "$RESULT" | awk '{print $1}')
SAT=$(echo "$RESULT" | awk '{print $2}')

echo "Extracted from $(basename "$IMAGE"): h=$HUE s=$SAT"

# Apply via the set commands
source "$HOME/.koad-io/commands/outfit/set/hue/command.sh" "$HUE"
source "$HOME/.koad-io/commands/outfit/set/saturation/command.sh" "$SAT"

echo "Outfit updated from $(basename "$IMAGE")"
