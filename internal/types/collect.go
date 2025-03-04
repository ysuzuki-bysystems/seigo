package types

import "time"

type CollectOpts struct {
	Tail  bool
	Since time.Time
}
