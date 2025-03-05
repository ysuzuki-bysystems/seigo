package app

import (
	"errors"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/ysuzuki-bysystems/seigo/internal/config"
	"github.com/ysuzuki-bysystems/seigo/internal/datasource"
	"github.com/ysuzuki-bysystems/seigo/internal/types"
)

type listCollectionsResponseItem struct {
	Name string `json:"name"`
}

type listCollectionsResponse struct {
	Collections []listCollectionsResponseItem `json:"collections"`
}

func handleListCollections(cfg *config.Config) echo.HandlerFunc {
	return func(c echo.Context) error {
		resp := &listCollectionsResponse{
			Collections: make([]listCollectionsResponseItem, 0),
		}

		for _, item := range cfg.Collection {
			resp.Collections = append(resp.Collections, listCollectionsResponseItem{
				Name: item.Name,
			})
		}

		return c.JSON(http.StatusOK, resp)
	}
}

type collectRequest struct {
	Name  string     `param:"name"`
	Since *time.Time `query:"since"`
	Tail  bool       `query:"tail"`
}

func handleCollect(cfg *config.Config) echo.HandlerFunc {
	return func(c echo.Context) error {
		if c.Request().Header.Get("Last-Event-Id") != "" {
			return c.NoContent(http.StatusNoContent)
		}

		cx := c.Request().Context()

		var req collectRequest
		if err := c.Bind(&req); err != nil {
			return err
		}

		opts := new(types.CollectOpts)
		if req.Tail {
			opts.Tail = true
		} else {
			if req.Since == nil {
				opts.Since = time.Now().Add(-1 * time.Hour)
			} else {
				opts.Since = *req.Since
			}
		}

		name := req.Name
		if name == "" {
			name = "default"
		}

		events, err := datasource.Collect(cx, cfg, req.Name, opts)
		if err != nil {
			if errors.Is(err, datasource.ErrCollectionNotFound) {
				return c.String(404, "not found.")
			}

			return c.String(http.StatusBadRequest, "bad request.")
		}

		w := c.Response()
		w.Header().Set(echo.HeaderContentType, "text/event-stream")
		w.Header().Set(echo.HeaderCacheControl, "no-cache")

		first := true
		for raw, err := range events {
			if err != nil {
				return err
			}

			if first {
				first = false
				if _, err := w.Write([]byte("id:-\r\n")); err != nil {
					return err
				}
			}
			if _, err := w.Write([]byte("data:")); err != nil {
				return err
			}
			if _, err := w.Write(raw); err != nil {
				return err
			}
			if _, err := w.Write([]byte("\r\n\r\n")); err != nil {
				return err
			}
			w.Flush()
		}

		if first {
			if _, err := w.Write([]byte("id:-\r\n")); err != nil {
				return err
			}
		}
		if _, err := w.Write([]byte("event:eof\r\ndata:\r\n\r\n")); err != nil {
			return err
		}
		w.Flush()

		return nil
	}
}
