package scrollbuffer

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"sync"

	"github.com/edsrzf/mmap-go"
)

var ErrClosed = errors.New("closed")

var ErrDiscarded = errors.New("discarded")

// Lock token
type token struct {
	cond *sync.Cond
}

func lock(cond *sync.Cond) *token {
	cond.L.Lock()
	return &token{cond: cond}
}

func unlock(t *token) {
	t.cond.L.Unlock()
}

func (t *token) broadcast() {
	t.cond.Broadcast()
}

func (t *token) wait() {
	t.cond.Wait()
}

type entryState int

const (
	idle entryState = iota
	writing
	// This entry is filled. Next entry must be exists.
	filled
	// This entry is discarded. Do not read / write.
	discarded
)

type entry struct {
	// Below... Needs lock. Notification must be given if any of the values are changed.

	// Entry data (Writer: RW / Reader: R)
	//
	// [to read... | to write...]
	//             ^ pos
	data []byte
	// Written position (Writer: RW / Reader: R)
	pos int
	// Entry state. (Writer: RW / Reader: R)
	state entryState
	// Next entry. If null, not allocated yet. (Writer: RW / Reader: R)
	next *entry
	// Number of Readers being read. (Writer: R / Reader: RW)
	ref int
}

// EOF marker
var eofEntry *entry = &entry{}

func (e *entry) use(token *token) {
	if e == eofEntry {
		panic("It must not call for eof.")
	}
	if e.state == discarded {
		panic("Do not use discarded.")
	}

	defer token.broadcast()

	e.ref += 1
}

func (e *entry) unuse(token *token) {
	if e == eofEntry {
		panic("It must not call for eof.")
	}
	if e.state == discarded {
		panic("Do not use discarded.")
	}

	defer token.broadcast()

	e.ref -= 1
}

func (e *entry) waitForFree(token *token) {
	for e.ref != 0 && e.state != discarded {
		token.wait()
	}
}

type ScrollBuffer struct {
	// Unix-like systems can remove open files, but not Windows. It is necessary to retain the name of the file to remove.
	fname string
	mem   mmap.MMap
	cond  *sync.Cond

	head *entry
	tail *entry
}

func New(dir string, entrySize, numOfEntries int) (*ScrollBuffer, error) {
	if entrySize == 0 {
		panic("must entrySize > 0")
	}
	if numOfEntries < 2 {
		panic("must numOfEntries > 1")
	}

	fp, err := os.CreateTemp(dir, "")
	if err != nil {
		return nil, fmt.Errorf("failed to create file: %w", err)
	}

	if err := fp.Truncate(int64(entrySize) * int64(numOfEntries)); err != nil {
		suppressed := make([]error, 0)
		if err := fp.Close(); err != nil {
			suppressed = append(suppressed, err)
		}
		if err := os.Remove(fp.Name()); err != nil {
			suppressed = append(suppressed, err)
		}

		if len(suppressed) > 0 {
			return nil, fmt.Errorf("failed to mmap: %w (suppressed: %w)", err, errors.Join(suppressed...))
		}
		return nil, fmt.Errorf("failed to mmap: %w", err)
	}

	mem, err := mmap.Map(fp, mmap.RDWR, 0)
	if err != nil {
		suppressed := make([]error, 0)
		if err := fp.Close(); err != nil {
			suppressed = append(suppressed, err)
		}
		if err := os.Remove(fp.Name()); err != nil {
			suppressed = append(suppressed, err)
		}

		if len(suppressed) > 0 {
			return nil, fmt.Errorf("failed to mmap: %w (suppressed: %w)", err, errors.Join(suppressed...))
		}
		return nil, fmt.Errorf("failed to mmap: %w", err)
	}

	fname := fp.Name()

	// https://man.archlinux.org/man/mmap.2.en
	// > After the mmap() call has returned, the file descriptor, fd, can be closed immediately without invalidating the mapping.
	//
	// https://learn.microsoft.com/en-us/windows/win32/api/memoryapi/nf-memoryapi-unmapviewoffile
	// > Although an application may close the file handle used to create a file mapping object, the system holds the corresponding file open until the last view of the file is unmapped. Files for which the last view has not yet been unmapped are held open with no sharing restrictions.
	if err := fp.Close(); err != nil {
		suppressed := make([]error, 0)
		if err := os.Remove(fp.Name()); err != nil {
			suppressed = append(suppressed, err)
		}

		if len(suppressed) > 0 {
			return nil, fmt.Errorf("failed to close: %w (suppressed: %w)", err, errors.Join(suppressed...))
		}
		return nil, fmt.Errorf("failed to close: %w", err)
	}

	var head *entry
	var tail *entry
	for i := range numOfEntries {
		ent := &entry{
			data: mem[entrySize*i : entrySize*(i+1)],
		}

		if head == nil {
			head = ent
			tail = ent
			continue
		}
		tail.next = ent
		tail = ent
	}

	buf := &ScrollBuffer{
		fname: fname,
		mem:   mem,
		cond:  sync.NewCond(&sync.Mutex{}),

		head: head,
		tail: head,
	}
	return buf, nil
}

func (s *ScrollBuffer) evict(token *token, head, tail *entry) ([]byte, bool) {
	if s.head != head || s.tail != tail {
		return nil, false
	}

	if head == eofEntry {
		panic("do not evict eof.")
	}

	head.waitForFree(token) // May be unlock

	if s.head != head || s.tail != tail {
		// Updated by others while waiting.
		return nil, false
	}

	head.state = discarded
	s.head = head.next

	return head.data, true
}

func (s *ScrollBuffer) discardAll(token *token) {
	if s.tail != eofEntry {
		panic("must call after close.")
	}

	for s.head != eofEntry {
		s.head.state = discarded
		s.head = s.head.next
	}

	token.broadcast()
}

func (s *ScrollBuffer) write(token *token, b []byte) (int, error) {
	for {
		tail := s.tail

		if tail == eofEntry {
			return 0, ErrClosed
		}

		switch tail.state {
		case idle:
			// nop
		case writing:
			// nop
		case filled:
			panic("unexpected: filled")
		case discarded:
			// tail.state never discarded
			panic("unexpected: discarded")
		}

		data := tail.data[tail.pos:]
		if len(data) > 0 {
			n := copy(data, b)
			tail.pos += n
			tail.state = writing
			token.broadcast()
			return n, nil
		}

		// BEFORE
		// [A, B, C]
		//  ^ Tail
		//
		// AFTER
		// [A, B, C]
		//     ^ Tail
		if tail.next != nil {
			tail.state = filled
			s.tail = tail.next
			continue
		}

		// BEFORE
		// [A, B, C]
		//  ^        Head
		//        ^  Tail
		//
		// AFTER
		// [B, C, A]
		//  ^        Head
		//     ^     Tail

		head := s.head
		// tail is not an eof, but head should not be an eof
		data, ok := s.evict(token, head, tail)
		if !ok {
			continue
		}

		tail.next = &entry{
			data: data,
		}
	}
}

func (s *ScrollBuffer) close(token *token) error {
	tail := s.tail
	if tail == eofEntry {
		return nil
	}

	tail.next = eofEntry
	tail.state = filled
	s.tail = tail.next
	token.broadcast()

	return nil
}

func (s *ScrollBuffer) shutdown(cx context.Context, token *token) error {
	if s.mem == nil || s.fname == "" {
		// Already shutdown
		return nil
	}

	if s.tail != eofEntry {
		if err := s.close(token); err != nil {
			return fmt.Errorf("failed to close: %w", err)
		}
	}

	cancel := context.AfterFunc(cx, func() {
		token := lock(s.cond)
		defer unlock(token)

		s.discardAll(token)
	})

	for s.head != eofEntry {
		s.evict(token, s.head, s.tail)
	}

	cancel()

	errs := make([]error, 0)

	if err := s.mem.Unmap(); err != nil {
		errs = append(errs, fmt.Errorf("failed to unmap: %w", err))
	}
	s.mem = nil

	if err := os.Remove(s.fname); err != nil {
		errs = append(errs, fmt.Errorf("failed to remove %s: %w", s.fname, err))
	}
	s.fname = ""

	if len(errs) > 0 {
		return errors.Join(errs...)
	}

	return nil
}

func (s *ScrollBuffer) Shutdown(cx context.Context) error {
	token := lock(s.cond)
	defer unlock(token)

	if err := s.shutdown(cx, token); err != nil {
		return fmt.Errorf("ScrollBuffer.Shutdown: %w", err)
	}

	return nil
}

type Writer struct {
	buf *ScrollBuffer
}

func (s *ScrollBuffer) NewWriter() *Writer {
	return &Writer{
		buf: s,
	}
}

func (w *Writer) Write(b []byte) (int, error) {
	token := lock(w.buf.cond)
	defer unlock(token)

	pos := 0

	for len(b) > pos {
		n, err := w.buf.write(token, b[pos:])
		if err != nil {
			return 0, fmt.Errorf("Writer.Write: %w", err)
		}
		pos += n
	}

	return pos, nil
}

func (w *Writer) Close() error {
	token := lock(w.buf.cond)
	defer unlock(token)

	if err := w.buf.close(token); err != nil {
		return fmt.Errorf("Writer.Close: %w", err)
	}

	return nil
}

type Reader struct {
	follow bool

	cond     *sync.Cond
	entry    *entry
	pos      int
	canceled bool
}

func (s *ScrollBuffer) NewReader(follow bool) *Reader {
	token := lock(s.cond)
	defer unlock(token)

	var entry *entry
	if follow {
		entry = s.tail
	} else {
		entry = s.head
	}

	if entry != eofEntry {
		entry.use(token)
	}

	return &Reader{
		follow: follow,

		cond:  s.cond,
		entry: entry,
		pos:   0,
	}
}

func (r *Reader) Read(b []byte) (int, error) {
	token := lock(r.cond)
	defer unlock(token)

	for {
		if r.canceled {
			return 0, ErrClosed
		}

		if r.entry.state == discarded {
			return 0, ErrDiscarded
		}

		if r.entry == eofEntry {
			return 0, io.EOF
		}

		src := r.entry.data[r.pos:r.entry.pos]
		if len(src) > 0 {
			n := copy(b, src)
			r.pos += n
			return n, nil
		}

		if r.entry.state == filled {
			r.entry.unuse(token)
			r.entry = r.entry.next
			if r.entry != eofEntry {
				r.entry.use(token)
			}
			r.pos = 0
			continue
		}

		if !r.follow {
			r.entry.unuse(token)
			r.entry = eofEntry
			continue
		}

		token.wait()
	}
}

func (r *Reader) Close() error {
	if r.entry == eofEntry {
		return nil // Already reached EOF.
	}

	token := lock(r.cond)
	defer unlock(token)

	r.entry.unuse(token)
	r.canceled = true

	return nil
}
