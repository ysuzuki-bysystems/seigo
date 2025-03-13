package journald_test

import (
	"slices"
	"testing"
	"time"

	"github.com/ysuzuki-bysystems/seigo/internal/datasource/journald"
	"github.com/ysuzuki-bysystems/seigo/internal/types"
)

func TestJournaldCollect(t *testing.T) {
	dummyCfgPath := "./testdata/config.toml" // not exists
	cfg := &journald.JournaldConfig{
		Match: []map[string]string{
			{
				"CONTAINER_NAME": "mycontainer",
			},
		},

		JournalctlCmd: "./journalctl.sh",
	}
	opts := &types.CollectOpts{
		Tail:  false,
		Since: time.Unix(0, 0).UTC(),
	}
	iter, err := journald.JournaldCollect(t.Context(), dummyCfgPath, cfg, opts)
	if err != nil {
		t.Fatal(err)
	}
	recv := []string{}
	for ent, err := range iter {
		if err != nil {
			t.Fatal(err)
		}

		recv = append(recv, string(ent))
	}

	wants := []string{
		`{"arg":"--output=json"}`,
		`{"arg":"--since=1970-01-01T00:00:00Z"}`,
		`{"arg":"CONTAINER_NAME=mycontainer"}`,
		`{"data":"loooooooong-message"}`,
	}

	if !slices.Equal(wants, recv) {
		t.Fatalf("%#v != %#v", wants, recv)
	}
}
