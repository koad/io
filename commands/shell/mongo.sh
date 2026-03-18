#!/usr/bin/env bash

required_vars=("DB_USER_NAME" "DB_USER_PASS" "DB_HOST" "DB_PORT" "DB_NAME")
for var in "${required_vars[@]}"; do
  if [[ -z "${!var}" ]]; then
    echo -e "\e[31mERROR: $var must be set\e[0m" >&2
    exit 1
  fi
done

ENCODED_PASS=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$DB_USER_PASS'))")
MONGO_URL="mongodb://$DB_USER_NAME:$ENCODED_PASS@$DB_HOST:$DB_PORT/$DB_NAME"

echo "Testing connection..."
if ! mongosh "$MONGO_URL" --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
  echo -e "\e[31mERROR: Failed to connect to MongoDB. Please check your credentials and connection details.\e[0m" >&2
  exit 1
fi

echo "Connection successful, doing deep!"

mongosh "$MONGO_URL"
