package config_test

import (
	"testing"

	"github.com/BurntSushi/toml"
	"github.com/ysuzuki-bysystems/seigo/internal/config"
)

func TestParseJournald(t *testing.T) {
	text := `[[collection]]
type = 'journald'
name = "default"
docker-aware = true
[[collection.match]]
CONTAINER_NAME = 'fuzz'
`

	var data config.Config
	if _, err := toml.Decode(text, &data); err != nil {
		t.Fatal(err)
	}

	if len(data.Collection) != 1 {
		t.Fatalf("len(data.Collection) != 1")
	}

	c := data.Collection[0]
	if c.Type != "journald" {
		t.Fatalf("%s", c.Type)
	}
	if c.Name != "default" {
		t.Fatalf("%s", c.Name)
	}

	// https://pkg.go.dev/encoding/json#Marshal
	// > The map keys are sorted and used as JSON object keys by applying the following rules, subject to the UTF-8 coercion described for string values above:
	wants := `{"docker-aware":true,"match":[{"CONTAINER_NAME":"fuzz"}],"name":"default","type":"journald"}`
	if string(c.Opts) != wants {
		t.Fatalf("%s != %s", c.Opts, wants)
	}
}
