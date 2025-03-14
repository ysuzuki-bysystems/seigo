package journald_test

import (
	"context"
	"crypto"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ysuzuki-bysystems/seigo/internal/datasource/journald"
	"github.com/ysuzuki-bysystems/seigo/internal/types"
	"golang.org/x/crypto/ssh"
	_ "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
)

func newServer(cx context.Context, addrChan chan *net.TCPAddr, serverPrivateKey crypto.PrivateKey, publicKey crypto.PublicKey) error {
	pubkeyEqual, ok := publicKey.(interface{ Equal(crypto.PublicKey) bool })
	if !ok {
		return errors.New("Unexpected key type.")
	}

	cfg := &ssh.ServerConfig{
		PublicKeyCallback: func(conn ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			if conn.User() != "bob" {
				return nil, errors.New("Unknown user")
			}

			cryptoKey, ok := key.(ssh.CryptoPublicKey)
			if !ok {
				return nil, errors.New("Unknown public key")
			}

			if !pubkeyEqual.Equal(cryptoKey.CryptoPublicKey()) {
				return nil, errors.New("Unknown public key")
			}

			return &ssh.Permissions{}, nil
		},
	}
	signer, err := ssh.NewSignerFromKey(serverPrivateKey)
	if err != nil {
		return err
	}
	cfg.AddHostKey(signer)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	context.AfterFunc(cx, func() {
		_ = listener.Close()
	})
	addr, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return errors.New("!tcp ??")
	}

	addrChan <- addr

	for {
		nconn, err := listener.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return nil
			}

			return err
		}

		serve := func() error {
			defer nconn.Close()

			conn, chans, reqs, err := ssh.NewServerConn(nconn, cfg)
			if err != nil {
				return err
			}
			defer conn.Close()

			go func() {
				ssh.DiscardRequests(reqs)
			}()

			// only accept single channel
			newChannel := <-chans
			if newChannel.ChannelType() != "session" {
				newChannel.Reject(ssh.UnknownChannelType, "unknown")
				return nil
			}
			channel, reqs, err := newChannel.Accept()
			if err != nil {
				return err
			}
			defer channel.Close()

			req := <-reqs
			if req.Type != "exec" {
				return errors.New("!exec")
			}
			if err := req.Reply(true, nil); err != nil {
				return err
			}
			// https://datatracker.ietf.org/doc/html/rfc4254#section-6.5
			var command struct {
				Command string
			}
			if err := ssh.Unmarshal(req.Payload, &command); err != nil {
				return err
			}
			go func() {
				ssh.DiscardRequests(reqs)
			}()

			enc := json.NewEncoder(channel)

			data := struct {
				Data string `json:"data"`
			}{
				Data: command.Command,
			}

			d, err := json.Marshal(data)
			if err != nil {
				return err
			}

			row := struct {
				Message string `json:"MESSAGE"`
			}{
				Message: string(d),
			}

			if err := enc.Encode(row); err != nil {
				return err
			}

			exitdata := ssh.Marshal(struct {
				Status uint32
			}{
				// TODO error handling
				Status: 0,
			})
			if _, err := channel.SendRequest("exit-status", false, exitdata); err != nil {
				return err
			}

			return nil
		}

		go func() {
			if err := serve(); err != nil {
				fmt.Println(err)
			}
		}()
	}
}

type testAgent struct {
	signer ssh.Signer
}

// Add implements agent.Agent.
func (t *testAgent) Add(key agent.AddedKey) error {
	panic("unimplemented")
}

// List implements agent.Agent.
func (t *testAgent) List() ([]*agent.Key, error) {
	key := &agent.Key{
		Format: t.signer.PublicKey().Type(),
		Blob:   t.signer.PublicKey().Marshal(),
	}

	return []*agent.Key{key}, nil
}

// Lock implements agent.Agent.
func (t *testAgent) Lock(passphrase []byte) error {
	panic("unimplemented")
}

// Remove implements agent.Agent.
func (t *testAgent) Remove(key ssh.PublicKey) error {
	panic("unimplemented")
}

// RemoveAll implements agent.Agent.
func (t *testAgent) RemoveAll() error {
	panic("unimplemented")
}

// Sign implements agent.Agent.
func (t *testAgent) Sign(key ssh.PublicKey, data []byte) (*ssh.Signature, error) {
	return t.signer.Sign(rand.Reader, data)
}

// Signers implements agent.Agent.
func (t *testAgent) Signers() ([]ssh.Signer, error) {
	panic("unimplemented")
}

// Unlock implements agent.Agent.
func (t *testAgent) Unlock(passphrase []byte) error {
	panic("unimplemented")
}

func startAgent(cx context.Context, path string, key crypto.PrivateKey, readychan chan any) error {
	signer, err := ssh.NewSignerFromKey(key)
	if err != nil {
		return err
	}

	a := &testAgent{
		signer: signer,
	}

	listener, err := net.Listen("unix", path)
	if err != nil {
		return err
	}
	context.AfterFunc(cx, func() {
		_ = listener.Close()
	})

	readychan <- struct{}{}

	for {
		conn, err := listener.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return nil
			}

			return err
		}

		serve := func() error {
			defer conn.Close()

			if err := agent.ServeAgent(a, conn); err != nil {
				if errors.Is(err, io.EOF) {
					return nil
				}

				return err
			}

			return nil
		}
		go func() {
			if err := serve(); err != nil {
				fmt.Println(err)
			}
		}()
	}
}

func TestSshJournaldCollect(t *testing.T) {
	cx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	t.Setenv("SSH_AUTH_SOCK", "")

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	serverPublicKey, serverPrivateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	addrChan := make(chan *net.TCPAddr)
	go func() {
		if err := newServer(cx, addrChan, serverPrivateKey, publicKey); err != nil {
			cancel()
			fmt.Printf("%s\n", err)
		}
	}()

	var addr *net.TCPAddr
	select {
	case addr = <-addrChan:
	case <-cx.Done():
		t.Fatal()
	}

	tmpdir := t.TempDir()
	kh := filepath.Join(tmpdir, "known_hosts")
	sshServerPublicKey, err := ssh.NewPublicKey(serverPublicKey)
	if err != nil {
		t.Fatal(err)
	}
	khdata := knownhosts.Line([]string{addr.String()}, sshServerPublicKey)
	if err := os.WriteFile(kh, []byte(khdata), 0o600); err != nil {
		t.Fatal(err)
	}

	ident := filepath.Join(tmpdir, "identity")
	pemData, err := ssh.MarshalPrivateKey(privateKey, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(ident, pem.EncodeToMemory(pemData), 0o600); err != nil {
		t.Fatal(err)
	}

	port := addr.Port
	if port < 0 || port > 0xFFFF {
		panic(port)
	}

	t.Run("auth file", func(t *testing.T) {
		cfgPath := "."
		cfg := &journald.SshJournaldConfig{
			Hostname:           addr.IP.String(),
			Port:               uint16(port),
			Username:           "bob",
			IdentityFile:       ident,
			UserKnownHostsFile: kh,
		}
		opts := &types.CollectOpts{
			Since: time.Time{},
		}

		iter, err := journald.SshJournaldCollect(cx, cfgPath, cfg, opts)
		if err != nil {
			t.Fatal(err)
		}

		n := 0
		for item, err := range iter {
			if err != nil {
				t.Fatal(err)
			}

			wants := `{"data":"\"journalctl\" \"--output=json\" \"--since=0001-01-01T00:00:00Z\""}`
			if string(item) != wants {
				t.Fatalf("%s != %s", item, wants)
			}
			n++
		}
		if n != 1 {
			t.Fatalf("%d != 1", n)
		}
	})

	t.Run("auth agent", func(t *testing.T) {
		readychan := make(chan any)
		agentPath := filepath.Join(tmpdir, "agent")
		go func() {
			if err := startAgent(t.Context(), agentPath, privateKey, readychan); err != nil {
				cancel()
				fmt.Println(err)
			}
		}()

		select {
		case <-readychan:
		case <-cx.Done():
			t.Fatal()
		}

		cfgPath := "."
		cfg := &journald.SshJournaldConfig{
			Hostname:           addr.IP.String(),
			Port:               uint16(port),
			Username:           "bob",
			IdentityAgent:      agentPath,
			UserKnownHostsFile: kh,
		}
		opts := &types.CollectOpts{
			Since: time.Time{},
		}

		iter, err := journald.SshJournaldCollect(cx, cfgPath, cfg, opts)
		if err != nil {
			t.Fatal(err)
		}

		n := 0
		for item, err := range iter {
			if err != nil {
				t.Fatal(err)
			}

			wants := `{"data":"\"journalctl\" \"--output=json\" \"--since=0001-01-01T00:00:00Z\""}`
			if string(item) != wants {
				t.Fatalf("%s != %s", item, wants)
			}
			n++
		}
		if n != 1 {
			t.Fatalf("%d != 1", n)
		}
	})

	t.Run("auth bad agent before file", func(t *testing.T) {
		_, badKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}

		readychan := make(chan any)
		agentPath := filepath.Join(tmpdir, "badagent")
		go func() {
			if err := startAgent(t.Context(), agentPath, badKey, readychan); err != nil {
				cancel()
				fmt.Println(err)
			}
		}()

		select {
		case <-readychan:
		case <-cx.Done():
			t.Fatal()
		}

		cfgPath := "."
		cfg := &journald.SshJournaldConfig{
			Hostname:           addr.IP.String(),
			Port:               uint16(port),
			Username:           "bob",
			IdentityAgent:      agentPath,
			IdentityFile:       ident,
			UserKnownHostsFile: kh,
		}
		opts := &types.CollectOpts{
			Since: time.Time{},
		}

		iter, err := journald.SshJournaldCollect(cx, cfgPath, cfg, opts)
		if err != nil {
			t.Fatal(err)
		}

		n := 0
		for item, err := range iter {
			if err != nil {
				t.Fatal(err)
			}

			wants := `{"data":"\"journalctl\" \"--output=json\" \"--since=0001-01-01T00:00:00Z\""}`
			if string(item) != wants {
				t.Fatalf("%s != %s", item, wants)
			}
			n++
		}
		if n != 1 {
			t.Fatalf("%d != 1", n)
		}
	})
}
