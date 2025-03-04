//go:build dev

package main

import (
	"github.com/labstack/echo/v4"
	"github.com/ysuzuki-bysystems/seigo/internal/web/dev"
)

func Static() echo.HandlerFunc {
	return dev.Static()
}
