.PHONY: build-for-codeql dev

build-for-codeql:
	# make stub
	mkdir -p ./web/dist
	touch ./web/dist/index.html
	go build ./...

dev:
	go run ./tools/dev
