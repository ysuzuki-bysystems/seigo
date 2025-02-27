package webdev

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	neturl "net/url"
	"sync"

	"github.com/labstack/echo/v4"
	"golang.org/x/net/websocket"
)

var upstream = "http://localhost:5173/"

var upstreamUrl *neturl.URL

func init() {
	var err error
	upstreamUrl, err = neturl.Parse(upstream)
	if err != nil {
		panic(err)
	}
}

func staticProxy(client *http.Client, c echo.Context) error {
	url := *upstreamUrl
	url.Path = c.Request().URL.Path
	url.RawQuery = c.Request().URL.RawQuery

	req, err := http.NewRequest(c.Request().Method, url.String(), nil)
	if err != nil {
		return err
	}
	for key, vals := range c.Request().Header {
		for _, val := range vals {
			req.Header.Add(key, val)
		}
	}

	res, err := client.Do(req)
	if err != nil {
		return err
	}
	contentType := res.Header.Get("Content-Type")
	return c.Stream(res.StatusCode, contentType, res.Body)
}

func staticWebsocketHandler(ws *websocket.Conn) {
	defer ws.Close()

	url := *upstreamUrl
	url.Scheme = "ws"
	url.Path = ws.Request().URL.Path
	url.RawQuery = ws.Request().URL.RawQuery

	origin := *upstreamUrl

	cfg, err := websocket.NewConfig(url.String(), origin.String())
	if err != nil {
		slog.Error("x NewConfig", "err", err)
		return
	}
	cfg.Protocol = ws.Config().Protocol

	conn, err := websocket.DialConfig(cfg)
	if err != nil {
		slog.Error("x websocket.Dial", "err", err)
		return
	}
	defer conn.Close()

	wg := new(sync.WaitGroup)

	wg.Add(1)
	go func() {
		defer wg.Done()

		// https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1
		defer conn.WriteClose(1000)

		if _, err := io.Copy(conn, ws); err != nil {
			slog.Error("x io.Copy(conn, ws)", "err", err)
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()

		// https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1
		defer ws.WriteClose(1000)

		if _, err := io.Copy(ws, conn); err != nil {
			slog.Error("x io.Copy(ws, conn)", "err", err)
		}
	}()

	wg.Wait()
}

func staticWebsocket(c echo.Context) error {
	websocket.Handler(staticWebsocketHandler).ServeHTTP(c.Response(), c.Request())
	return nil
}

func Static() echo.HandlerFunc {
	client := http.DefaultClient

	return func(c echo.Context) error {
		if c.Request().Header.Get("Upgrade") == "websocket" {
			return staticWebsocket(c)
		} else {
			return staticProxy(client, c)
		}
	}
}
