//go:build !dev

//go:generate npm --prefix ../../web run build -- --outDir ../internal/web/dist --emptyOutDir
package web

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/labstack/echo/v4"
)

//go:embed dist
var uiFs embed.FS

func Static() echo.HandlerFunc {
	fsys, err := fs.Sub(uiFs, "dist")
	if err != nil {
		panic(err)
	}

	return echo.WrapHandler(http.FileServerFS(fsys))
}
