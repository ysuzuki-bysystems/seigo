//go:build !dev

//go:generate npm --prefix web run build
package main

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/labstack/echo/v4"
)

//go:embed web/dist
var uiFs embed.FS

func static() echo.HandlerFunc {
	fsys, err := fs.Sub(uiFs, "web/dist")
	if err != nil {
		panic(err)
	}

	return echo.WrapHandler(http.FileServerFS(fsys))
}
