package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/ysuzuki-bysystems/seigo/internal/app"
	config_ "github.com/ysuzuki-bysystems/seigo/internal/config"
	"github.com/ysuzuki-bysystems/seigo/internal/datasource"
	"github.com/ysuzuki-bysystems/seigo/internal/scrollbuffer"
)

var rootCmd = &cobra.Command{
	Use:          "seigo",
	Short:        "Seigo 🐟",
	RunE:         runRoot,
	SilenceUsage: true,
}

var listenAddr string
var listenPort uint16
var config *config_.Config
var rootcx context.Context

func initStdin(cx context.Context, wg *sync.WaitGroup) (*scrollbuffer.ScrollBuffer, error) {
	tmpdir := filepath.Join(os.TempDir(), "seigo")
	if err := os.MkdirAll(tmpdir, 0o777); err != nil {
		return nil, err
	}

	buf, err := scrollbuffer.New(tmpdir, 8192, 10)
	if err != nil {
		return nil, err
	}

	go func() {
		w := buf.NewWriter()
		defer w.Close()

		errchan := make(chan error, 1)
		go func() {
			defer close(errchan)

			r := io.TeeReader(os.Stdin, w)

			if _, err := io.Copy(os.Stdout, r); err != nil {
				if !errors.Is(err, scrollbuffer.ErrClosed) {
					errchan <- err
				}
			}
		}()

		select {
		case <-cx.Done():
		case err := <-errchan:
			if err != nil && !errors.Is(err, scrollbuffer.ErrClosed) {
				slog.Warn("failed to copy stdin", "error", err)
			}
		}
	}()

	wg.Add(1)
	context.AfterFunc(cx, func() {
		defer wg.Done()

		cx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		if err := buf.Shutdown(cx); err != nil {
			slog.Warn("failed to Shutdown", "error", err)
		}
	})

	return buf, nil
}

func init() {
	defaultConfigPath, found := os.LookupEnv("SEIGO_CONFIG")
	if !found {
		configHome, err := os.UserConfigDir()
		cobra.CheckErr(err)
		defaultConfigPath = filepath.Join(configHome, "seigo", "config.toml")
	}
	var configPath string

	defaultListenAddr, found := os.LookupEnv("SEIGO_LISTEN_ADDR")
	if !found {
		defaultListenAddr = "localhost"
	}

	var defaultListenPort uint16 = 8080
	if v, found := os.LookupEnv("PORT"); found {
		n, err := strconv.ParseUint(v, 10, 16)
		if err == nil {
			defaultListenPort = uint16(n)
		}
	} else {
		defaultListenPort = 8080
	}

	var stdin bool

	flags := rootCmd.PersistentFlags()
	flags.StringVarP(&listenAddr, "listen-addr", "l", defaultListenAddr, "Listen Address.")
	flags.Uint16VarP(&listenPort, "port", "p", defaultListenPort, "Listen Port.")
	flags.StringVarP(&configPath, "config", "C", defaultConfigPath, "Config file path.")
	flags.BoolVarP(&stdin, "stdin", "s", false, "Read logs from stdin mode. If this flag is specified, --config is ignored.")

	wg := &sync.WaitGroup{}
	var cancel context.CancelFunc

	cobra.OnInitialize(func() {
		rootcx, cancel = context.WithCancel(context.Background())

		if stdin {
			buf, err := initStdin(rootcx, wg)
			cobra.CheckErr(err)

			rootcx = context.WithValue(rootcx, datasource.ContextStdinBufKey, buf)
			config = &config_.Config{
				Path: "", // empty
				Collection: []*config_.Collection{
					{
						Name: "default",
						Type: "stdin",
					},
				},
			}

			return
		}

		var err error
		config, err = config_.ReadConfig(configPath)
		cobra.CheckErr(err)
	})

	cobra.OnFinalize(func() {
		cancel()
		wg.Wait()
	})
}

func runRoot(cmd *cobra.Command, args []string) error {
	cx, cancel := signal.NotifyContext(rootcx, os.Interrupt, syscall.SIGTERM)
	defer cancel()

	addr := fmt.Sprintf("%s:%d", listenAddr, listenPort)
	return app.Serve(cx, config, addr)
}

func Execute() error {
	return rootCmd.Execute()
}
