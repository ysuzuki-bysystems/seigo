package main

import (
	"os"

	"github.com/ysuzuki-bysystems/seigo/cmd"
)

func main() {
	if err := cmd.Execute(); err != nil {
		os.Exit(-1)
	}
}
