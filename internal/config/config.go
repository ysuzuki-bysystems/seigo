package config

import (
	"encoding/json"
	"errors"
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
	Collection []Collection `toml:"collection"`
}
