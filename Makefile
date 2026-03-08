.PHONY: init run-back run-front

init:
	go mod tidy
	cd frontend && npm install

run-back:
	go run cmd/server/main.go

run-front:
	cd frontend && npm run dev
