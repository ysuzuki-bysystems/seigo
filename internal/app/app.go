package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/ysuzuki-bysystems/seigo/internal/config"
	"github.com/ysuzuki-bysystems/seigo/internal/web"
)

func Serve(cx context.Context, cfg *config.Config, addr string) error {
	wg := &sync.WaitGroup{}
	defer wg.Wait()

	e := echo.New()
	e.HideBanner = true

	e.Server.BaseContext = func(l net.Listener) context.Context {
		return cx
	}

	e.Use(middleware.Logger())
	e.Use(middleware.Recover())

	g := e.Group("/api")

	g.GET("/collections", handleListCollections(cfg))
	g.GET("/collections/:name", handleCollect(cfg))

	e.GET("*", web.Static())

	wg.Add(1)
	context.AfterFunc(cx, func() {
		defer wg.Done()

		if err := e.Shutdown(context.Background()); err != nil {
			e.Logger.Warn(err)
		}
	})

	if err := e.Start(addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("Failed to serve. %w", err)
	}

	return nil
}
