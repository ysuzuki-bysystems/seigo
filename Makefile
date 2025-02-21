.PHONY: FORCE
FORCE:

ui-dist/: FORCE
	(cd ui && npm run build -- --outDir ../ui-dist --emptyOutDir)
