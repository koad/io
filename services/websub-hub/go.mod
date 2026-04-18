module koad.io/services/websub-hub

go 1.21

// Run `go mod tidy` after cloning to resolve exact versions.
// This pulls meow.tf/websub (tystuyfzand/websub-server) and go.etcd.io/bbolt.
require (
	go.etcd.io/bbolt v1.3.10
	meow.tf/websub v0.0.0-20241001000000-000000000000
)
