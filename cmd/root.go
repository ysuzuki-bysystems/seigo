package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"github.com/spf13/cobra"
	"github.com/ysuzuki-bysystems/seigo/internal/app"
	"github.com/ysuzuki-bysystems/seigo/internal/config"
)

var rootCmd = &cobra.Command{
	Use:           "seigo",
	Short:         "Seigo 🐟",
	RunE:          runRoot,
	SilenceErrors: true,
}

var listenAddr string
var listenPort uint16
var configPath string

func init() {
	defaultConfigPath, found := os.LookupEnv("SEIGO_CONFIG")
	if !found {
		configHome, err := os.UserConfigDir()
		cobra.CheckErr(err)
		defaultConfigPath = filepath.Join(configHome, "seigo", "config.toml")
	}

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
}

func runRoot(cmd *cobra.Command, args []string) error {
	cfg, err := config.ReadConfig(configPath)
	if err != nil {
		return err
	}

	addr := fmt.Sprintf("%s:%d", listenAddr, listenPort)
	return app.Serve(cfg, addr)
}

func Execute() error {
	return rootCmd.Execute()
}
