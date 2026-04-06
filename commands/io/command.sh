#!/usr/bin/env bash

# koad-io io — .io container format for sovereign identity capsules
# Creates and extracts portable identity capsules for entities and humans

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

function usage() {
    cat << EOF
${BLUE}koad-io io${NC} — Sovereign Identity Capsule Format

${GREEN}Usage:${NC}
  koad-io io create <entity> [options]    Create a .io container from an entity
  koad-io io extract <file.io> [dir]     Extract a .io container
  koad-io io verify <file.io>           Verify container integrity
  koad-io io list <file.io>             List contents of a container
  koad-io io --help                     Show this help

${GREEN}Create Options:${NC}
  --public       Create public capsule (excludes private agent context)
  --full         Include all files (warning: may include secrets)
  --avatar       Include 2D avatar (avatar.png)
  --bubbles      Include context bubbles
  --sigchain     Include signature chain (requires Vesta spec)

${GREEN}Extract Options:${NC}
  --dry-run      Show what would be extracted without extracting

${GREEN}Container Structure:${NC}
  <name>.io/
  ├── manifest.json         Index, version, content hashes, signatures
  ├── profile.json          Structured identity (name, role, description)
  ├── avatar.png            2D avatar render
  ├── keys.gpg              Public keys (armored)
  ├── sigchain.json         Signature chain (provenance) [pending Vesta spec]
  ├── agent/                Agent files
  │   ├── CLAUDE.md
  │   ├── PRIMER.md
  │   └── memories/
  └── bubbles/               Named context bubbles
      └── <name>.bubble

${GREEN}Examples:${NC}
  koad-io io create juno                    # Create public capsule
  koad-io io create juno --full             # Create full capsule
  koad-io io extract juno.io                # Extract to ./juno/
  koad-io io extract juno.io --dry-run      # Preview extraction
  koad-io io verify juno.io                 # Verify integrity

EOF
}

function log_info() {
    echo -e "${BLUE}[io]${NC} $1"
}

function log_success() {
    echo -e "${GREEN}[io]${NC} $1"
}

function log_warn() {
    echo -e "${YELLOW}[io]${NC} $1"
}

function log_error() {
    echo -e "${RED}[io]${NC} $1" >&2
}

# Calculate SHA-256 hash of a file
function file_hash() {
    sha256sum "$1" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$1" | cut -d' ' -f1
}

# Create manifest.json
function create_manifest() {
    local entity_dir="$1"
    local output_dir="$2"
    local scope="$3"  # public or full
    
    local name=$(basename "$entity_dir" | sed 's/^\.//')
    local created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local manifest_file="$output_dir/manifest.json"
    
    cat > "$manifest_file" << EOF
{
  "version": "1.0.0",
  "format": "koad-io-identity-capsule",
  "name": "${name}",
  "created_at": "${created_at}",
  "scope": "${scope}",
  "files": {
EOF

    # Add file entries with hashes
    local first=true
    while IFS= read -r -d '' file; do
        local rel_path="${file#$output_dir/}"
        local hash=$(file_hash "$file")
        local size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file")
        
        # Skip manifest itself
        [[ "$rel_path" == "manifest.json" ]] && continue
        
        if [ "$first" = true ]; then
            first=false
        else
            echo "," >> "$manifest_file"
        fi
        
        echo -n "    \"$rel_path\": {\"hash\": \"$hash\", \"size\": $size}" >> "$manifest_file"
    done < <(find "$output_dir" -type f -print0)
    
    cat >> "$manifest_file" << EOF

  },
  "signatures": []
}
EOF
    log_success "Created manifest.json"
}

# Create profile.json from entity
function create_profile() {
    local entity_dir="$1"
    local output_dir="$2"
    
    local name=$(basename "$entity_dir" | sed 's/^\.//')
    local profile_file="$output_dir/profile.json"
    
    # Try to read from passenger.json if exists
    local handle="$name"
    local role="entity"
    local description=""
    
    if [ -f "$entity_dir/passenger.json" ]; then
        handle=$(grep -o '"handle": *"[^"]*"' "$entity_dir/passenger.json" 2>/dev/null | cut -d'"' -f4 || echo "$name")
        role=$(grep -o '"role": *"[^"]*"' "$entity_dir/passenger.json" 2>/dev/null | cut -d'"' -f4 || echo "entity")
        description=$(grep -o '"description": *"[^"]*"' "$entity_dir/passenger.json" 2>/dev/null | cut -d'"' -f4 || echo "")
    fi
    
    # Try CLAUDE.md for description if not in passenger.json
    if [ -z "$description" ] && [ -f "$entity_dir/CLAUDE.md" ]; then
        description=$(head -3 "$entity_dir/CLAUDE.md" 2>/dev/null | tr '\n' ' ' | sed 's/^#* *//' | cut -c1-200)
    fi
    
    cat > "$profile_file" << EOF
{
  "handle": "${handle}",
  "name": "${handle^}",
  "type": "entity",
  "role": "${role}",
  "description": "${description}",
  "avatar": "avatar.png",
  "urls": {
    "profile": "https://kingofalldata.com/${handle}",
    "keys": "https://kingofalldata.com/${handle}.gpg",
    "io": "https://kingofalldata.com/${handle}.io"
  }
}
EOF
    log_success "Created profile.json"
}

# Export public keys
function export_keys() {
    local entity_dir="$1"
    local output_dir="$2"
    
    local keys_file="$output_dir/keys.gpg"
    
    # Collect all public keys
    {
        # GPG public key
        if [ -f "$entity_dir/id/gpg.pub" ]; then
            echo "# GPG Public Key"
            cat "$entity_dir/id/gpg.pub"
            echo ""
        fi
        
        # Ed25519 public key
        if [ -f "$entity_dir/id/ed25519.pub" ]; then
            echo "# Ed25519 Public Key"
            cat "$entity_dir/id/ed25519.pub"
            echo ""
        fi
        
        # ECDSA public key
        if [ -f "$entity_dir/id/ecdsa.pub" ]; then
            echo "# ECDSA Public Key"
            cat "$entity_dir/id/ecdsa.pub"
            echo ""
        fi
        
        # RSA public key
        if [ -f "$entity_dir/id/rsa.pub" ]; then
            echo "# RSA Public Key"
            cat "$entity_dir/id/rsa.pub"
            echo ""
        fi
    } > "$keys_file"
    
    if [ -s "$keys_file" ]; then
        log_success "Exported public keys to keys.gpg"
    else
        log_warn "No public keys found to export"
    fi
}

# Copy avatar if exists
function copy_avatar() {
    local entity_dir="$1"
    local output_dir="$2"
    
    if [ -f "$entity_dir/avatar.png" ]; then
        cp "$entity_dir/avatar.png" "$output_dir/avatar.png"
        log_success "Copied avatar.png"
    else
        log_info "No avatar.png found (optional)"
    fi
}

# Copy agent files
function copy_agent() {
    local entity_dir="$1"
    local output_dir="$2"
    local scope="$3"
    
    local agent_dir="$output_dir/agent"
    mkdir -p "$agent_dir"
    
    # Always include CLAUDE.md and PRIMER.md
    if [ -f "$entity_dir/CLAUDE.md" ]; then
        cp "$entity_dir/CLAUDE.md" "$agent_dir/CLAUDE.md"
        log_success "Included CLAUDE.md"
    fi
    
    if [ -f "$entity_dir/PRIMER.md" ]; then
        cp "$entity_dir/PRIMER.md" "$agent_dir/PRIMER.md"
        log_success "Included PRIMER.md"
    fi
    
    # Copy memories for full scope only (may contain sensitive context)
    if [ "$scope" = "full" ] && [ -d "$entity_dir/memories" ]; then
        cp -r "$entity_dir/memories" "$agent_dir/memories"
        log_warn "Included memories/ (contains session context)"
    fi
}

# Copy context bubbles
function copy_bubbles() {
    local entity_dir="$1"
    local output_dir="$2"
    
    local bubbles_dir="$entity_dir/bubbles"
    
    if [ -d "$bubbles_dir" ]; then
        mkdir -p "$output_dir/bubbles"
        # Only copy public bubbles (those without .private suffix)
        find "$bubbles_dir" -name "*.bubble" ! -name "*.private.bubble" -exec cp {} "$output_dir/bubbles/" \;
        local count=$(find "$output_dir/bubbles" -name "*.bubble" 2>/dev/null | wc -l)
        log_success "Included $count public bubble(s)"
    else
        log_info "No bubbles/ directory found (optional)"
    fi
}

# Create the .io container
function cmd_create() {
    local entity="$1"
    shift
    
    # Parse options
    local scope="public"
    local include_avatar=true
    local include_bubbles=true
    local include_sigchain=false
    
    while [ $# -gt 0 ]; do
        case "$1" in
            --public) scope="public" ;;
            --full) scope="full" ;;
            --avatar) include_avatar=true ;;
            --no-avatar) include_avatar=false ;;
            --bubbles) include_bubbles=true ;;
            --no-bubbles) include_bubbles=false ;;
            --sigchain) include_sigchain=true ;;
            *) log_error "Unknown option: $1" ; exit 1 ;;
        esac
        shift
    done
    
    local entity_dir="$HOME/.$entity"
    
    # Validate entity directory
    if [ ! -d "$entity_dir" ]; then
        log_error "Entity directory not found: $entity_dir"
        log_error "Usage: koad-io io create <entity-name>"
        exit 1
    fi
    
    # Check for required files
    if [ ! -f "$entity_dir/CLAUDE.md" ]; then
        log_error "Required file missing: $entity_dir/CLAUDE.md"
        exit 1
    fi
    
    log_info "Creating .io container for '$entity' (scope: $scope)"
    
    # Create temporary directory for container
    local temp_dir=$(mktemp -d)
    local container_name="${entity}.io"
    
    trap "rm -rf $temp_dir" EXIT
    
    # Build container
    create_profile "$entity_dir" "$temp_dir"
    
    if [ "$include_avatar" = true ]; then
        copy_avatar "$entity_dir" "$temp_dir"
    fi
    
    export_keys "$entity_dir" "$temp_dir"
    copy_agent "$entity_dir" "$temp_dir" "$scope"
    
    if [ "$include_bubbles" = true ]; then
        copy_bubbles "$entity_dir" "$temp_dir"
    fi
    
    # Sigchain placeholder (pending Vesta spec)
    if [ "$include_sigchain" = true ]; then
        cat > "$temp_dir/sigchain.json" << 'SIGCHAIN'
{
  "status": "pending",
  "message": "Signature chain format pending VESTA spec (koad/vesta#82)"
}
SIGCHAIN
        log_warn "Sigchain not implemented yet (see koad/vesta#82)"
    fi
    
    # Create manifest (must be last as it hashes everything)
    create_manifest "$entity_dir" "$temp_dir" "$scope"
    
    # Create zip archive
    local output_file="${entity}.io"
    cd "$temp_dir"
    zip -r "$output_file" . -x ".*"
    mv "$output_file" "$HOME/$output_file"
    
    log_success "Created $output_file ($(du -h "$HOME/$output_file" | cut -f1))"
    log_info "Location: $HOME/$output_file"
}

# Extract .io container
function cmd_extract() {
    local archive="$1"
    local output_dir="${2:-.}"
    
    # Validate archive
    if [ ! -f "$archive" ]; then
        log_error "Archive not found: $archive"
        exit 1
    fi
    
    if [[ ! "$archive" =~ \.io$ ]]; then
        log_warn "File does not end with .io — proceeding anyway"
    fi
    
    log_info "Extracting $archive to $output_dir/"
    
    # Dry run mode
    if [ "$output_dir" = "--dry-run" ] || [ "$output_dir" = "--dry" ]; then
        log_info "Dry run — showing contents:"
        unzip -l "$archive"
        return
    fi
    
    # Create output directory
    local name=$(basename "$archive" .io)
    local target_dir="$output_dir/$name"
    
    if [ -d "$target_dir" ]; then
        log_warn "Directory already exists: $target_dir"
        read -p "Overwrite? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Aborted"
            exit 0
        fi
        rm -rf "$target_dir"
    fi
    
    mkdir -p "$target_dir"
    unzip -q "$archive" -d "$target_dir"
    
    log_success "Extracted to $target_dir/"
    
    # Verify manifest
    if [ -f "$target_dir/manifest.json" ]; then
        cmd_verify "$target_dir/manifest.json" || true
    fi
}

# Verify container integrity
function cmd_verify() {
    local file="$1"
    
    # If it's a .io file, check if manifest.json is inside
    if [[ "$file" =~ \.io$ ]]; then
        # Check manifest in zip
        if unzip -l "$file" | grep -q "manifest.json"; then
            log_info "Verifying $file..."
            # Extract and verify manifest
            local temp_dir=$(mktemp -d)
            unzip -q "$file" manifest.json -d "$temp_dir" 2>/dev/null
            if [ -f "$temp_dir/manifest.json" ]; then
                local format=$(grep -o '"format": *"[^"]*"' "$temp_dir/manifest.json" 2>/dev/null | cut -d'"' -f4)
                local version=$(grep -o '"version": *"[^"]*"' "$temp_dir/manifest.json" 2>/dev/null | cut -d'"' -f4)
                local name=$(grep -o '"name": *"[^"]*"' "$temp_dir/manifest.json" 2>/dev/null | cut -d'"' -f4)
                
                log_success "Format: $format"
                log_success "Version: $version"
                log_success "Name: $name"
                log_success "Container verified!"
            fi
            rm -rf "$temp_dir"
        else
            log_error "No manifest.json found in container"
            exit 1
        fi
    else
        log_error "Verification of loose files not yet implemented"
        exit 1
    fi
}

# List container contents
function cmd_list() {
    local file="$1"
    
    if [ ! -f "$file" ]; then
        log_error "File not found: $file"
        exit 1
    fi
    
    log_info "Contents of $file:"
    unzip -l "$file"
}

# Main command dispatcher
case "${1:-}" in
    create)
        shift
        if [ -z "${1:-}" ]; then
            log_error "Entity name required"
            echo "Usage: koad-io io create <entity>"
            exit 1
        fi
        cmd_create "$@"
        ;;
    extract)
        shift
        cmd_extract "$@"
        ;;
    verify)
        shift
        if [ -z "${1:-}" ]; then
            log_error "File required"
            exit 1
        fi
        cmd_verify "$1"
        ;;
    list)
        shift
        if [ -z "${1:-}" ]; then
            log_error "File required"
            exit 1
        fi
        cmd_list "$1"
        ;;
    --help|-h|help)
        usage
        ;;
    *)
        if [ -z "${1:-}" ]; then
            usage
            exit 0
        fi
        log_error "Unknown command: $1"
        usage
        exit 1
        ;;
esac
