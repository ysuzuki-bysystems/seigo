package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"

	"github.com/spf13/cobra"
	"github.com/ysuzuki-bysystems/seigo/internal/app"
	config_ "github.com/ysuzuki-bysystems/seigo/internal/config"
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

	flags := rootCmd.PersistentFlags()
	flags.StringVarP(&listenAddr, "listen-addr", "l", defaultListenAddr, "Listen Address.")
	flags.Uint16VarP(&listenPort, "port", "p", defaultListenPort, "Listen Port.")
	flags.StringVarP(&configPath, "config", "C", defaultConfigPath, "Config file path.")

	wg := &sync.WaitGroup{}

	cobra.OnInitialize(func() {
		rootcx = context.Background()

		var err error
		config, err = config_.ReadConfig(configPath)
		cobra.CheckErr(err)
	})

	cobra.OnFinalize(func() {
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
