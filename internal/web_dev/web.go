package webdev

import (
	"io"
	"log/slog"
	"net/http"
	"sync"

	"github.com/labstack/echo/v4"
	"golang.org/x/net/websocket"
)

func staticProxy(client *http.Client, c echo.Context) error {
	url := *c.Request().URL
	url.Scheme = "http"
	url.Host = "localhost:5173"

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

	url := *ws.Request().URL
	url.Scheme = "ws"
	url.Host = "localhost:5173"

	origin := url
	origin.Scheme = "http"

	cfg, err := websocket.NewConfig(url.String(), origin.String())
	cfg.Protocol = ws.Config().Protocol
	if err != nil {
		slog.Error("x NewConfig", err)
		return
	}

	conn, err := websocket.DialConfig(cfg)
	if err != nil {
		slog.Error("x websocket.Dial", err)
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
			slog.Error("x io.Copy(conn, ws)", err)
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()

		// https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1
		defer ws.WriteClose(1000)

		if _, err := io.Copy(ws, conn); err != nil {
			slog.Error("x io.Copy(ws, conn)", err)
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
