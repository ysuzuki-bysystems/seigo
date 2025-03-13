//go:build !no_journald

package datasource

import (
	"context"
	"encoding/json"
	"iter"

	"github.com/ysuzuki-bysystems/seigo/internal/datasource/journald"
	"github.com/ysuzuki-bysystems/seigo/internal/types"
)

type journaldDatasource struct{}

func (d *journaldDatasource) collect(cx context.Context, env *datasourceEnv, opts *types.CollectOpts) (iter.Seq2[json.RawMessage, error], error) {
	var cfg journald.JournaldConfig
	if err := env.unmarshalConfig(&cfg); err != nil {
		return nil, err
	}

	return journald.JournaldCollect(cx, env.path, &cfg, opts)
}

func init() {
	registerDatasource("journald", new(journaldDatasource))
}
