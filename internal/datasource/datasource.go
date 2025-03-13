package datasource

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"sync"

	"github.com/ysuzuki-bysystems/seigo/internal/config"
	"github.com/ysuzuki-bysystems/seigo/internal/types"
)

type datasourceEnv struct {
	cfg  json.RawMessage
	path string
}

func (d *datasourceEnv) unmarshalConfig(dst any) error {
	return json.Unmarshal(d.cfg, dst)
}

type datasource interface {
	collect(context.Context, *datasourceEnv, *types.CollectOpts) (iter.Seq2[json.RawMessage, error], error)
}

var datasources sync.Map

func registerDatasource(typ string, src datasource) {
	_, loaded := datasources.LoadOrStore(typ, src)

	if !loaded {
		return
	}

	panic(fmt.Sprintf("Already registered: %s", typ))
}

var ErrCollectionNotFound = errors.New("collection not found.")

func Collect(cx context.Context, cfg *config.Config, name string, opts *types.CollectOpts) (iter.Seq2[json.RawMessage, error], error) {
	var collection *config.Collection
	for _, item := range cfg.Collection {
		if item.Name != name {
			continue
		}

		collection = item
		break
	}

	if collection == nil {
		return nil, ErrCollectionNotFound
	}

	v, found := datasources.Load(collection.Type)
	if !found {
		return nil, fmt.Errorf("Unknown Datasource: %s", collection.Type)
	}

	ds := v.(datasource)

	env := &datasourceEnv{
		cfg:  collection.Opts,
		path: cfg.Path,
	}

	return ds.collect(cx, env, opts)
}
