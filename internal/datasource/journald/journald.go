package journald

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"iter"
	"os"
	"os/exec"
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
		args = append(args, fmt.Sprintf("--since=%s", opts.Since.Format(time.RFC3339)))
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
		return nil, err
	}

	if err := cmd.Start(); err != nil {
		return nil, err
	}

	return func(yield func(json.RawMessage, error) bool) {
		defer func() {
			_, _ = cmd.Process.Wait()
		}()

		var buf []byte
		var record journaldRecord
		dec := json.NewDecoder(bufio.NewReader(stdout))
		for {
			if err := dec.Decode(&record); err != nil {
				if errors.Is(err, io.EOF) {
					break
				}
				fmt.Printf("%#v\n", err)
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
