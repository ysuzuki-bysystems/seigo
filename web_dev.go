//go:build dev

package main

import (
	"github.com/labstack/echo/v4"
	"localhost/seigo/internal/web_dev"
)

func static() echo.HandlerFunc {
	return webdev.Static()
}
