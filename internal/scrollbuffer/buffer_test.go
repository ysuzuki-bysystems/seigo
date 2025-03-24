package scrollbuffer_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/ysuzuki-bysystems/seigo/internal/scrollbuffer"
)

func TestScrollBufferFollowing(t *testing.T) {
	buf, err := scrollbuffer.New(t.TempDir(), 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer buf.Shutdown(context.Background())

	sig1 := make(chan struct{})
	sig2 := make(chan struct{})
	rchan := make(chan any)

	go func() {
		w := buf.NewWriter()

		defer w.Close()

		<-sig1

		_, err := w.Write([]byte("Hello, World!"))
		if err != nil {
			rchan <- err
		}

		sig2 <- struct{}{}
		<-sig2
	}()

	go func() {
		r := buf.NewReader(true)
		defer r.Close()

		sig1 <- struct{}{}

		b, err := io.ReadAll(r)
		if err != nil {
			rchan <- err
		}
		if string(b) != "Hello, World!" {
			rchan <- fmt.Errorf("%s != \"Hello, World!\"", string(b))
		}
		rchan <- true
	}()

	go func() {
		<-sig2
		r := buf.NewReader(true)
		defer r.Close()
		sig2 <- struct{}{}

		b, err := io.ReadAll(r)
		if err != nil {
			rchan <- err
		}
		if string(b) != "!" {
			rchan <- fmt.Errorf("%s != \"d!\"", string(b))
		}
		rchan <- true
	}()

	for range 2 {
		r := <-rchan
		if r != true {
			t.Fatal(r)
		}
	}
}

func TestScrollBufferNoFollow(t *testing.T) {
	buf, err := scrollbuffer.New(t.TempDir(), 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer buf.Shutdown(context.Background())

	w := buf.NewWriter()
	if _, err = w.Write([]byte("Hello, World!")); err != nil {
		t.Fatal(err)
	}

	r := buf.NewReader(false)

	b, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}

	if string(b) != "d!" {
		t.Fatal(string(b))
	}
}

func TestScrollBufferDiscard(t *testing.T) {
	buf, err := scrollbuffer.New(t.TempDir(), 1, 2)
	if err != nil {
		t.Fatal(err)
	}

	r := buf.NewReader(false) // leak
	w := buf.NewWriter()

	cx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel() // no effect
	if err := buf.Shutdown(cx); err != nil {
		t.Fatal(err)
	}

	if _, err := r.Read([]byte{0}); !errors.Is(err, scrollbuffer.ErrDiscarded) {
		t.Fatal(err)
	}

	if _, err := w.Write([]byte{0}); !errors.Is(err, scrollbuffer.ErrClosed) {
		t.Fatal(err)
	}
}

func TestScrollBufferParallel(t *testing.T) {
	buf, err := scrollbuffer.New(t.TempDir(), 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer buf.Shutdown(context.Background())

	n := 4
	rchan := make(chan error, n)
	for g := range n {
		g := g
		go func() {
			r := buf.NewReader(true)
			defer r.Close()

			last := -1
			buf := make([]byte, 128)
			c := 0
			for {
				c++
				n, err := r.Read(buf)
				if err != nil {
					if errors.Is(err, io.EOF) {
						rchan <- nil
						return
					}
					rchan <- err
					return
				}
				for _, v := range buf[:n] {
					if last != -1 {
						if (last+1)&0xFF != int(v) {
							rchan <- fmt.Errorf("%d(%d): %d != %d (%v)", g, c, (last+1)&0xFF, int(v), buf[:n])
							return
						}
					}

					last = int(v)
				}
			}
		}()
	}

	w := buf.NewWriter()

	last := -1
	b := make([]byte, 128)
	for i := range 1024 {
		b := b[:i%len(b)]
		for i := range b {
			b[i] = byte(last & 0xFF)
			last += 1
		}
		if _, err := w.Write(b); err != nil {
			t.Fatal(err)
		}
	}
	w.Close()

	errs := make([]error, 0)
	for range n {
		if err := <-rchan; err != nil {
			errs = append(errs, err)
		}
	}
	if len(errs) > 0 {
		t.Fatal(errs)
	}
}

func TestScrollBufferCloseReader(t *testing.T) {
	buf, err := scrollbuffer.New(t.TempDir(), 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer buf.Shutdown(context.Background())

	r := buf.NewReader(true)
	go func() {
		defer r.Close()

		time.Sleep(100 * time.Millisecond)
	}()
	if _, err := r.Read([]byte{0}); !errors.Is(err, scrollbuffer.ErrClosed) {
		t.Fatal(err)
	}
}

func TestScrollBufferWriteAfterClose(t *testing.T) {
	buf, err := scrollbuffer.New(t.TempDir(), 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer buf.Shutdown(context.Background())

	w := buf.NewWriter()
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	if _, err := w.Write([]byte{0}); !errors.Is(err, scrollbuffer.ErrClosed) {
		t.Fatal(err)
	}
}

func TestScrollBufferReadAfterShutdown(t *testing.T) {
	buf, err := scrollbuffer.New(t.TempDir(), 1, 2)
	if err != nil {
		t.Fatal(err)
	}

	if err := buf.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}

	r := buf.NewReader(false)
	if _, err := r.Read([]byte{0}); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
}

func TestScrollBufferParallelWrite(t *testing.T) {
	buf, err := scrollbuffer.New(t.TempDir(), 1, 2)
	if err != nil {
		t.Fatal(err)
	}
	defer buf.Shutdown(context.Background())

	r := buf.NewReader(true) // For blocking write
	go func() {
		time.Sleep(100 * time.Millisecond) // Sufficient time before write is blocked
		_ = r.Close()
	}()

	rchan := make(chan error, 2)
	for range 2 {
		go func() {
			w := buf.NewWriter()
			defer w.Close()

			b := []byte{1, 2}
			if _, err := w.Write(b); err != nil {
				rchan <- err
				return
			}
			rchan <- nil
		}()
	}

	for range 2 {
		if err := <-rchan; err != nil && !errors.Is(err, scrollbuffer.ErrClosed) {
			t.Fatal(err)
		}
	}
}
