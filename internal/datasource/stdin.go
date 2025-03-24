package datasource

import (
	"context"
	"encoding/json"
	"fmt"
	"iter"

	"github.com/ysuzuki-bysystems/seigo/internal/datasource/stdin"
	"github.com/ysuzuki-bysystems/seigo/internal/scrollbuffer"
	"github.com/ysuzuki-bysystems/seigo/internal/types"
)

var ContextStdinBufKey = &struct{}{}

type stdinDatasource struct{}

func (d *stdinDatasource) collect(cx context.Context, env *datasourceEnv, opts *types.CollectOpts) (iter.Seq2[json.RawMessage, error], error) {
	buf, ok := cx.Value(ContextStdinBufKey).(*scrollbuffer.ScrollBuffer)
	if !ok {
		return nil, fmt.Errorf("use --stdin flag")
	}

	return stdin.StdinCollect(cx, buf, opts)
}

func init() {
	registerDatasource("stdin", new(stdinDatasource))
}
