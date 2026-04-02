.PHONY: init run-back run-front test-back test-front typecheck-front

init:
	go mod tidy
	cd frontend && npm install

run-back:
	go run cmd/server/main.go

run-front:
	cd frontend && npm run dev

test-back:
	GOCACHE=/tmp/go-build GOMODCACHE=/tmp/go-mod GOTMPDIR=/tmp go test ./...

typecheck-front:
	cd frontend && npm run typecheck

test-front:
	cd frontend && npm run test
