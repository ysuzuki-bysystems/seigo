package main

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/fsnotify/fsnotify"
)

type noTtyWriter struct {
	io io.Writer
}

func (w *noTtyWriter) Write(p []byte) (int, error) {
	return w.io.Write(p)
}

func spawn(cx context.Context, prog string, args ...string) (func(), error) {
	var cancel context.CancelFunc
	cx, cancel = context.WithCancel(cx)

	cmd := exec.CommandContext(cx, prog, args...)
	cmd.Stdin = nil
	cmd.Stdout = &noTtyWriter{io: os.Stdout}
	cmd.Stderr = &noTtyWriter{io: os.Stderr}
	cmd.Cancel = func() error {
		// Assuming it is only called while cmd is alive, pgid should be valid

		// cmd/go: run does not relay signals to child process
		// https://github.com/golang/go/issues/40467
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{
		Setpgid: true,
	}

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, err
	}

	return func() {
		cancel()
		_ = cmd.Wait()
	}, nil
}

func watchFiles(cx context.Context) (chan any, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	context.AfterFunc(cx, func() {
		_ = watcher.Close()
	})

	base := "."
	unit := struct{}{}
	added := new(sync.Map)

	ch := make(chan any, 0)
	go func() {
		debTimer := time.NewTimer(0)
		debTimer.Stop()

		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					continue
				}

				slog.Debug("watcher", "event", event)

				if event.Op.Has(fsnotify.Remove) {
					rel, err := filepath.Rel(base, event.Name)
					if err != nil {
						// TODO log?
						continue
					}
					if _, loaded := added.LoadAndDelete(rel); !loaded {
						continue
					}
					if err := watcher.Remove(event.Name); err != nil {
						slog.Warn("Failed to remove watch", "err", err)
						continue
					}
					slog.Info("-watch", "path", event.Name)
					continue
				}

				info, err := os.Stat(event.Name)
				if err != nil {
					if !errors.Is(err, os.ErrNotExist) {
						slog.Warn("Failed to stat", "err", err)
					}
					continue
				}

				if info.IsDir() {
					rel, err := filepath.Rel(base, event.Name)
					if err != nil {
						// TODO log?
						continue
					}
					if _, loaded := added.LoadOrStore(rel, unit); loaded {
						continue
					}
					if err := watcher.Add(event.Name); err != nil {
						slog.Warn("Failed to add watch", "err", err)
						continue
					}
					slog.Info("watch", "path", event.Name)

				} else {
					if filepath.Ext(event.Name) != ".go" {
						continue
					}
					debTimer.Reset(1 * time.Second)
				}

			case <-debTimer.C:
				ch <- unit

			case <-cx.Done():
				return
			}
		}
	}()

	ignoreDir := map[string]struct{}{
		".git": unit,
		"web":  unit,
	}

	err = filepath.WalkDir(base, func(path string, d fs.DirEntry, err error) error {
		if !d.IsDir() {
			return nil
		}

		rel, err := filepath.Rel(base, path)
		if err != nil {
			return err
		}

		if _, ok := ignoreDir[rel]; ok {
			return fs.SkipDir
		}

		slog.Info("watch", "path", path)
		if err := watcher.Add(path); err != nil {
			slog.Warn("Failed to watch", "err", err)
			return nil
		}
		added.Store(rel, unit)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return ch, nil
}

func main() {
	cx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	stopNpm, err := spawn(cx, "npm", "--prefix", "./web", "-s", "run", "dev")
	if err != nil {
		slog.Error("Failed to run npm", "err", err)
		return
	}
	stopGo, err := spawn(cx, "go", "run", "-tags=dev", ".")
	if err != nil {
		slog.Error("Failed to run go", "err", err)
		return
	}

	watchch, err := watchFiles(cx)
	if err != nil {
		slog.Error("Failed to watch files.", "err", err)
		return
	}

loop:
	for {
		select {
		case <-watchch:
			stopGo()
			stopGo, err = spawn(cx, "go", "run", "-tags=dev", ".")
			if err != nil {
				slog.Error("Failed to run go", "err", err)
				break loop
			}
		case <-cx.Done():
			break loop
		}
	}

	stopNpm()
	if stopGo != nil {
		stopGo()
	}
}
