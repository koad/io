package main

// WebSub hub for koad:io sovereign atom feed distribution.
// Wraps tystuyfzand/websub-server (Go, ISC license) with BoltDB embedded storage.
//
// Build:
//   go mod download
//   CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o websub-hub ./cmd/hub
//
// Deploy binary to /usr/local/bin/websub-hub on zero.koad.sh.

import (
	"log"
	"net/http"
	"os"
	"path/filepath"

	bolt "go.etcd.io/bbolt"
	"meow.tf/websub"
)

func main() {
	dbPath := envOr("WEBSUB_DB_PATH", "/var/lib/websub/subs.db")
	listenAddr := envOr("WEBSUB_LISTEN", "127.0.0.1:8080")

	// Ensure the data directory exists.
	if err := os.MkdirAll(filepath.Dir(dbPath), 0750); err != nil {
		log.Fatalf("websub-hub: cannot create data dir: %v", err)
	}

	db, err := bolt.Open(dbPath, 0600, nil)
	if err != nil {
		log.Fatalf("websub-hub: cannot open BoltDB at %s: %v", dbPath, err)
	}
	defer db.Close()

	store := websub.NewBoltStore(db)

	// WithWorkers sets the number of concurrent delivery goroutines.
	// 4 is sufficient for ~20 entity feeds at ~1,000 subscribers.
	hub := websub.NewHub(store, websub.WithWorkers(4))

	log.Printf("websub-hub: listening on %s, db=%s", listenAddr, dbPath)
	if err := http.ListenAndServe(listenAddr, hub); err != nil {
		log.Fatalf("websub-hub: server error: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
