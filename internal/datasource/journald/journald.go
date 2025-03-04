package journald

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"iter"
	"os"
	"os/exec"
	"sync"
	"time"

	"github.com/ysuzuki-bysystems/seigo/internal/types"
)

type journaldRecord struct {
	Message string `json:"MESSAGE"`

	// https://docs.docker.com/engine/logging/drivers/journald/
	// > A field that flags log integrity. Improve logging of long log lines.
	// `"true"` or else
	ContainerPartialMessage string `json:"CONTAINER_PARTIAL_MESSAGE"`
}

type JournaldConfig struct {
	NoDockerAware bool                `json:"no-docker-aware"`
	Match         []map[string]string `json:"match"`

	// for Test
	JournalctlBin string `json:"-"`
}

func JournaldCollect(cx context.Context, cfg *JournaldConfig, opts *types.CollectOpts) (iter.Seq2[json.RawMessage, error], error) {
	wg := new(sync.WaitGroup)
	var cancel context.CancelFunc
	cx, cancel = context.WithCancel(cx)

	program := "journalctl"
	if cfg.JournalctlBin != "" {
		program = cfg.JournalctlBin
	}

	args := []string{
		"--output=json",
	}
	if opts.Tail {
		args = append(args, "--follow")
	} else {
		args = append(args, fmt.Sprintf("since=%s", opts.Since.Format(time.RFC3339)))
	}
	for _, m := range cfg.Match {
		// TODO sorted
		for key, val := range m {
			args = append(args, fmt.Sprintf("%s=%s", key, val))
		}
	}

	cmd := exec.CommandContext(cx, program, args...)
	cmd.Cancel = func() error {
		return cmd.Process.Signal(os.Interrupt)
	}
	cmd.Stdin = nil
	cmd.Stderr = os.Stderr
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, err
	}

	wg.Add(1)
	context.AfterFunc(cx, func() {
		defer wg.Done()
		_ = stdout.Close()
	})

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, err
	}

	return func(yield func(json.RawMessage, error) bool) {
		defer func() {
			cancel()
			wg.Wait()
			_, _ = cmd.Process.Wait()
		}()

		var buf []byte
		var record journaldRecord
		dec := json.NewDecoder(stdout)
		for {
			if err := dec.Decode(&record); err != nil {
				if errors.Is(err, io.EOF) {
					break
				}
				yield(nil, err)
				return
			}

			if buf == nil {
				buf = []byte(record.Message)
			} else {
				buf = append(buf, []byte(record.Message)...)
			}
			if !cfg.NoDockerAware && record.ContainerPartialMessage == "true" {
				continue
			}

			var raw json.RawMessage
			err := json.Unmarshal(buf, &raw)
			buf = nil
			if err != nil {
				// drop & skip
				continue
			}

			if !yield(raw, nil) {
				return
			}
		}

		if buf == nil {
			return
		}

		var raw json.RawMessage
		if err := json.Unmarshal(buf, &raw); err != nil {
			// drop
			return
		}
		yield(raw, nil)
	}, nil
}
