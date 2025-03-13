package cmd

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"github.com/ysuzuki-bysystems/seigo/internal/datasource"
	"github.com/ysuzuki-bysystems/seigo/internal/types"
)

var collectCmd = &cobra.Command{
	Use:          "collect [name]",
	Short:        "Collect & Dump in terminal.",
	Args:         cobra.ExactArgs(1),
	RunE:         runCollect,
	SilenceUsage: true,
}

var collectTail bool
var collectSince string

func init() {
	sinceDefault := time.Now().Add(-1 * time.Hour).Format(time.RFC3339)

	collectCmd.Flags().BoolVarP(&collectTail, "follow", "f", false, "Follow output")
	collectCmd.Flags().StringVarP(&collectSince, "since", "S", sinceDefault, "Specific date from")

	rootCmd.AddCommand(collectCmd)
}

func runCollect(cmd *cobra.Command, args []string) error {
	cx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	name := args[0]

	opts := new(types.CollectOpts)
	if collectTail {
		opts.Tail = true
	} else {
		collectSince, err := time.Parse(time.RFC3339, collectSince)
		if err != nil {
			return err
		}
		opts.Since = collectSince
	}

	events, err := datasource.Collect(cx, config, name, opts)
	if err != nil {
		return err
	}

	for event, err := range events {
		if err != nil {
			return err
		}

		fmt.Println(string(event))
	}

	return nil
}
