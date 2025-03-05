package config

import (
	"encoding/json"
	"errors"
	"os"

	"github.com/BurntSushi/toml"
)

type Collection struct {
	Name string
	Type string

	Opts json.RawMessage
}

func (e *Collection) UnmarshalTOML(raw any) error {
	data, ok := raw.(map[string]any)
	if !ok {
		return errors.New("Unexpected type.")
	}

	e.Name, _ = data["name"].(string)
	if e.Name == "" {
		return errors.New("Required: `name`")
	}
	e.Type, _ = data["type"].(string)
	if e.Type == "" {
		return errors.New("Required: `type`")
	}

	var err error
	e.Opts, err = json.Marshal(raw)
	if err != nil {
		return err
	}

	return nil
}

type Config struct {
	Collection []*Collection `toml:"collection"`
}

func ReadConfig(path string) (*Config, error) {
	fp, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer fp.Close()

	var result Config
	if _, err := toml.NewDecoder(fp).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}
