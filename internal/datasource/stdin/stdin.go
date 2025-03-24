package stdin

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"iter"

	"github.com/ysuzuki-bysystems/seigo/internal/scrollbuffer"
	"github.com/ysuzuki-bysystems/seigo/internal/types"
)

func iterRecords(stdin io.Reader) iter.Seq2[json.RawMessage, error] {
	return func(yield func(json.RawMessage, error) bool) {
		scanner := bufio.NewScanner(stdin)
		for scanner.Scan() {
			line := scanner.Bytes()

			var raw json.RawMessage
			err := json.Unmarshal(line, &raw)
			if err != nil {
				// drop & skip
				continue
			}

			if !yield(raw, nil) {
				return
			}
		}
	}
}

func StdinCollect(cx context.Context, buf *scrollbuffer.ScrollBuffer, opts *types.CollectOpts) (iter.Seq2[json.RawMessage, error], error) {
	r := buf.NewReader(opts.Tail)
	context.AfterFunc(cx, func() {
		_ = r.Close()
	})

	return iterRecords(r), nil
}
