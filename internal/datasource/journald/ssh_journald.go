package journald

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"iter"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"time"

	"github.com/ysuzuki-bysystems/seigo/internal/types"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
	"golang.org/x/crypto/ssh/knownhosts"
)

func dropQuote(text string) string {
	return strings.ReplaceAll(text, "\"", "")
}

func resolvePath(cfgPath, target string) string {
	if strings.HasPrefix(target, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			target = filepath.Join(home, target[2:])
		}
	}

	if filepath.IsAbs(target) {
		return target
	}

	dir := filepath.Dir(cfgPath)
	return filepath.Join(dir, target)
}

type SshJournaldConfig struct {
	JournaldConfig
	Hostname             string   `json:"hostname"`
	Port                 uint16   `json:"port"`
	Username             string   `json:"username"`
	IdentityFile         string   `json:"identity-file"`
	IdentityAgent        string   `json:"identity-agent"`
	GlobalKnownHostsFile string   `json:"global-known-hosts-file"`
	UserKnownHostsFile   string   `json:"user-known-hosts-file"`
	HostKeyAlgorithms    []string `json:"hostkey-algorithms"`
}

func newHostkeyCallback(cfg *SshJournaldConfig) (ssh.HostKeyCallback, error) {
	fns := make([]ssh.HostKeyCallback, 0)

	global := cfg.GlobalKnownHostsFile
	if global == "" {
		global = "/etc/ssh/ssh_known_hosts"
	}

	if fn, err := knownhosts.New(global); err == nil {
		fns = append(fns, fn)
	}

	users := cfg.UserKnownHostsFile
	if users == "" {
		if home, err := os.UserHomeDir(); err != nil {
			return nil, err
		} else {
			users = filepath.Join(home, "./.ssh/known_hosts")
		}
	}

	if fn, err := knownhosts.New(users); err == nil {
		fns = append(fns, fn)
	}

	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		errs := make([]error, 0)

		for _, fn := range fns {
			err := fn(hostname, remote, key)
			if err != nil {
				errs = append(errs, err)
				continue
			}

			return nil
		}

		return errors.Join(errs...)
	}, nil
}

func agentAuthMethod(cx context.Context, cfg *SshJournaldConfig) func() ([]ssh.Signer, error) {
	agentPath := cfg.IdentityAgent
	if agentPath == "" {
		if val, ok := os.LookupEnv("SSH_AUTH_SOCK"); ok {
			agentPath = val
		}
	}

	if agentPath == "" {
		return nil
	}

	conn, err := net.Dial("unix", agentPath)
	if err != nil {
		return nil
	}

	context.AfterFunc(cx, func() {
		conn.Close()
	})
	agent := agent.NewClient(conn)
	return agent.Signers
}

func identityFileAuthMethod(cfgPath string, cfg *SshJournaldConfig) func() ([]ssh.Signer, error) {
	identity := cfg.IdentityFile

	if identity == "" {
		return nil
	}

	data, err := os.ReadFile(resolvePath(cfgPath, identity))
	if err != nil {
		return nil
	}

	key, err := ssh.ParsePrivateKey(data)
	if err != nil {
		return nil
	}

	return func() ([]ssh.Signer, error) {
		return []ssh.Signer{key}, nil
	}
}

func authMethods(cx context.Context, cfgPath string, cfg *SshJournaldConfig) []ssh.AuthMethod {
	signersfns := make([]func() ([]ssh.Signer, error), 0)

	if fn := agentAuthMethod(cx, cfg); fn != nil {
		signersfns = append(signersfns, fn)
	}

	if fn := identityFileAuthMethod(cfgPath, cfg); fn != nil {
		signersfns = append(signersfns, fn)
	}

	publicKeyAuth := ssh.PublicKeysCallback(func() (signers []ssh.Signer, err error) {
		results := make([]ssh.Signer, 0)
		errs := make([]error, 0)

		for _, fn := range signersfns {
			r, err := fn()
			if err != nil {
				errs = append(errs, err)
				continue
			}

			results = append(results, r...)
		}

		if len(results) > 0 {
			return results, nil
		}
		if len(errs) == 1 {
			return nil, errs[0]
		}
		if len(errs) > 0 {
			return nil, errors.Join(errs...)
		}

		return []ssh.Signer{}, nil
	})

	return []ssh.AuthMethod{publicKeyAuth}
}

func SshJournaldCollect(cx context.Context, cfgPath string, cfg *SshJournaldConfig, opts *types.CollectOpts) (iter.Seq2[json.RawMessage, error], error) {
	program := journalctl
	if cfg.JournalctlCmd != "" {
		program = cfg.JournalctlCmd
	}

	cmd := fmt.Sprintf("\"%s\" \"--output=json\"", dropQuote(program))
	if opts.Tail {
		cmd = fmt.Sprintf("%s \"--follow\"", cmd)
	} else {
		cmd = fmt.Sprintf("%s \"--since=%s\"", cmd, dropQuote(opts.Since.Format(time.RFC3339)))
	}
	for _, m := range cfg.Match {
		for key, val := range m {
			cmd = fmt.Sprintf("%s \"%s=%s\"", cmd, dropQuote(key), dropQuote(val))
		}
	}

	hostname := cfg.Hostname
	if hostname == "" {
		return nil, errors.New("empty hostname")
	}
	port := cfg.Port
	if port == 0 {
		port = 22
	}
	addr := fmt.Sprintf("%s:%d", hostname, port)

	hostkeyCallback, err := newHostkeyCallback(cfg)
	if err != nil {
		return nil, err
	}

	username := cfg.Username
	if username == "" {
		if u, err := user.Current(); err == nil {
			username = u.Username
		}
	}

	var hostkeyAlgorithms []string
	if cfg.HostKeyAlgorithms != nil {
		hostkeyAlgorithms = cfg.HostKeyAlgorithms
	}

	clientConfig := &ssh.ClientConfig{
		User:              username,
		Auth:              authMethods(cx, cfgPath, cfg),
		HostKeyCallback:   hostkeyCallback,
		HostKeyAlgorithms: hostkeyAlgorithms,
	}

	client, err := ssh.Dial("tcp", addr, clientConfig)
	if err != nil {
		return nil, err
	}
	context.AfterFunc(cx, func() {
		_ = client.Close()
	})

	session, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return nil, err
	}

	session.Stdin = nil
	session.Stderr = os.Stderr
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}

	if err := session.Start(cmd); err != nil {
		_ = session.Close()
		_ = client.Close()
		return nil, err
	}

	onDone := func() {
		_ = session.Close()
		_ = client.Close()
		_ = client.Wait()
	}
	return iterRecords(&cfg.JournaldConfig, stdout, onDone), nil
}
