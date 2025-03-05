package app

import (
	"errors"
	"fmt"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/ysuzuki-bysystems/seigo/internal/config"
	"github.com/ysuzuki-bysystems/seigo/internal/web"
)

func Serve(cfg *config.Config, addr string) error {
	e := echo.New()
	e.HideBanner = true

	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	g := e.Group("/api")

	g.GET("/collections", handleListCollections(cfg))
	g.GET("/collections/:name", handleCollect(cfg))

	e.GET("*", web.Static())

	if err := e.Start(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("Failed to serve. %w", err)
	}

	return nil
}
