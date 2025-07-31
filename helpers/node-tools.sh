GREEN='\033[0;32m'
RESET='\033[0m'

nvm_use_project() {
  if [ -f .nvmrc ]; then
    nvm use
    return
  fi

  if [ -f package.json ]; then
    raw_node=$(jq -r '.engines.node // empty' package.json)
    raw_npm=$(jq -r '.engines.npm // empty' package.json)
    raw_yarn=$(jq -r '.engines.yarn // empty' package.json)
    # echo "raw_node: $raw_node"
    # echo "raw_npm: $raw_npm"
    # echo "raw_yarn: $raw_yarn"

    check_tool_version() {
      tool=$1
      raw_version=$2
      current_version=$3
      # echo "tool: $tool"
      # echo "raw_version: $raw_version"
      # echo "current_version: $current_version"

      req_version=$(echo "$raw_version" | sed 's/[^0-9.]*//g')
      # echo "req_version: $req_version"

      if [ -z "$req_version" ]; then return; fi

      if echo "$raw_version" | grep -q '[><=^~]'; then
        if [ "$(printf '%s\n%s' "$req_version" "$current_version" | sort -V | head -n1)" = "$req_version" ]; then
          echo -e "${GREEN}✔${RESET} $tool version $current_version satisfies '$raw_version'"
        else
          echo "⚠️  $tool version $current_version does NOT satisfy '$raw_version'"
        fi
      elif [ "$req_version" != "$current_version" ]; then
        echo "⚠️  $tool version $current_version does NOT match required $req_version"
      else
        echo -e "${GREEN}✔${RESET} $tool version $current_version matches"
      fi
    }

    # Check Node
if [ -n "$raw_node" ]; then
  node_req=$(echo "$raw_node" | sed 's/[^0-9.]*//g')
  current_node=$(node -v 2>/dev/null | sed 's/v//')

  # echo "current_node: $current_node"
  # echo "node_req: $node_req"

  # Check if current node satisfies raw_node range
  # Use sort -V to compare versions, assume '>=', '^', '~', '=' prefixes only
  satisfies=false

  # For ranges like >= or ^, check if current_node >= node_req
  if echo "$raw_node" | grep -q '[><=^~]'; then
    # if current_node >= node_req → satisfies
    low_ver=$(printf '%s\n%s' "$node_req" "$current_node" | sort -V | head -n1)
    if [ "$low_ver" = "$node_req" ]; then
      satisfies=true
    fi
  else
    # Exact version match required
    if [ "$current_node" = "$node_req" ]; then
      satisfies=true
    fi
  fi

  if [ "$satisfies" = true ]; then
    echo -e "${GREEN}✔${RESET} Current Node ($current_node) satisfies requirement '$raw_node'"
  else
    if nvm ls "$node_req" | grep -q "$node_req"; then
      echo "Using installed Node version $node_req"
      nvm use "$node_req"
    else
      echo "⚠️  Node $node_req required (from '$raw_node'), but not installed within nvm"
      # echo "Node version $node_req not installed, installing now..."
      # nvm install "$node_req"
      # nvm use "$node_req"
    fi
  fi
fi


    # Check NPM
    if [ -n "$raw_npm" ]; then
      current_npm=$(npm -v 2>/dev/null)
      check_tool_version "npm" "$raw_npm" "$current_npm"
    fi

    # Check Yarn
    if [ -n "$raw_yarn" ]; then
      if command -v yarn >/dev/null 2>&1; then
        current_yarn=$(yarn -v)
        check_tool_version "yarn" "$raw_yarn" "$current_yarn"
      else
        echo "⚠️  Yarn required but not installed"
      fi
    fi
  fi
}

cd() {
  builtin cd "$@" && nvm_use_project
}
