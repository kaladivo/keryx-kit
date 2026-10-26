// Command conformance verifies repo states written by the TypeScript domain package
// with the Keryx Go SDK: the `pub validate --strict` path, and a go-tuf client that
// updates across every step (keeping its trusted metadata) and downloads every item.
package main

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/theupdateframework/go-tuf/v2/metadata"
	"github.com/theupdateframework/go-tuf/v2/metadata/config"
	"github.com/theupdateframework/go-tuf/v2/metadata/updater"
	"github.com/v1b3coder/keryx/sdk/feed"
	"github.com/v1b3coder/keryx/sdk/publisher"
	"github.com/v1b3coder/keryx/sdk/repo"
)

const (
	metadataURL = "https://repo.test/metadata/"
	targetsURL  = "https://repo.test/targets/"
)

var rootFile = regexp.MustCompile(`^(\d+\.)?root\.json$`)

type scenario struct {
	Steps []struct {
		Dir string    `json:"dir"`
		Now time.Time `json:"now"`
	} `json:"steps"`
}

// dirFetcher serves root metadata from the anchor and everything else from the repo
// base, the fetch routing spec/repository.md §1 requires of clients.
type dirFetcher struct{ anchor, base string }

func (f dirFetcher) DownloadFile(url string, maxLength int64, _ time.Duration) ([]byte, error) {
	var path string
	switch {
	case strings.HasPrefix(url, metadataURL):
		name := strings.TrimPrefix(url, metadataURL)
		dir := f.base
		if rootFile.MatchString(name) {
			dir = f.anchor
		}
		path = filepath.Join(dir, name)
	case strings.HasPrefix(url, targetsURL):
		path = filepath.Join(f.base, filepath.FromSlash(strings.TrimPrefix(url, targetsURL)))
	default:
		return nil, fmt.Errorf("unexpected URL %s", url)
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, &metadata.ErrDownloadHTTP{StatusCode: 404, URL: url}
	}
	if err != nil {
		return nil, err
	}
	if maxLength > 0 && int64(len(data)) > maxLength {
		return nil, &metadata.ErrDownloadLengthMismatch{Msg: url + " exceeds its length limit"}
	}
	return data, nil
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: conformance <scenario dir>")
		os.Exit(2)
	}
	if err := run(os.Args[1]); err != nil {
		fmt.Fprintln(os.Stderr, "conformance FAILED:", err)
		os.Exit(1)
	}
}

func run(dir string) error {
	raw, err := os.ReadFile(filepath.Join(dir, "scenario.json"))
	if err != nil {
		return err
	}
	var sc scenario
	if err := json.Unmarshal(raw, &sc); err != nil {
		return err
	}
	if len(sc.Steps) == 0 {
		return fmt.Errorf("scenario has no steps")
	}
	client, err := os.MkdirTemp("", "keryx-conformance-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(client)
	previous := map[string]bool{}
	for _, step := range sc.Steps {
		anchor := filepath.Join(dir, step.Dir, "anchor")
		base := filepath.Join(dir, step.Dir, "base")
		if err := checkLayout(base); err != nil {
			return fmt.Errorf("%s: %w", step.Dir, err)
		}
		if err := sdkValidate(anchor, base, step.Now); err != nil {
			return fmt.Errorf("%s: pub validate --strict: %w", step.Dir, err)
		}
		items, err := clientUpdate(client, anchor, base, step.Now, previous)
		if err != nil {
			return fmt.Errorf("%s: go-tuf client: %w", step.Dir, err)
		}
		previous = items
		fmt.Printf("ok %-32s %d items verified\n", step.Dir, len(items))
	}
	fmt.Printf("conformance ok: %d repo states\n", len(sc.Steps))
	return nil
}

// checkLayout enforces "no root metadata in the repo base" (spec/repository.md §1).
func checkLayout(base string) error {
	return filepath.WalkDir(base, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() && rootFile.MatchString(d.Name()) {
			return fmt.Errorf("root metadata %s in the repo base", path)
		}
		return nil
	})
}

func sdkValidate(anchor, base string, now time.Time) error {
	p := publisher.New(repo.NewDirRepo(base), repo.NewDirRepo(anchor), nil)
	p.Now = func() time.Time { return now }
	_, err := p.ValidateStrict(context.Background())
	return err
}

// clientUpdate refreshes a go-tuf client that keeps its trusted metadata across steps,
// downloads every channel item, verifies its signatures against the trusted authors
// role and checks that items gone from the index no longer resolve.
func clientUpdate(client, anchor, base string, now time.Time, previous map[string]bool) (map[string]bool, error) {
	metaDir := filepath.Join(client, "metadata")
	rootBytes, err := os.ReadFile(filepath.Join(metaDir, "root.json"))
	if errors.Is(err, fs.ErrNotExist) {
		rootBytes, err = os.ReadFile(filepath.Join(anchor, "1.root.json"))
	}
	if err != nil {
		return nil, err
	}
	cfg, err := config.New(metadataURL, rootBytes)
	if err != nil {
		return nil, err
	}
	cfg.LocalMetadataDir = metaDir
	cfg.LocalTargetsDir, err = os.MkdirTemp(client, "targets-")
	if err != nil {
		return nil, err
	}
	cfg.RemoteTargetsURL = targetsURL
	cfg.Fetcher = dirFetcher{anchor: anchor, base: base}
	up, err := updater.New(cfg)
	if err != nil {
		return nil, err
	}
	up.UnsafeSetRefTime(now)
	if err := up.Refresh(); err != nil {
		return nil, fmt.Errorf("refresh: %w", err)
	}
	delegations := up.GetTrustedMetadataSet().Targets[metadata.TARGETS].Signed.Delegations
	seen := map[string]bool{}
	for _, role := range delegations.Roles {
		channel, ok := strings.CutPrefix(role.Name, "channels.")
		if !ok || strings.HasSuffix(channel, ".authors") {
			continue
		}
		// resolving any path in the namespace loads the channel role through go-tuf
		if _, err := up.GetTargetInfo("channels/" + channel + "/.probe.json"); err == nil {
			return nil, fmt.Errorf("%s: probe path resolved", role.Name)
		}
		index := up.GetTrustedMetadataSet().Targets[role.Name]
		if index == nil {
			return nil, fmt.Errorf("%s: role metadata not loaded", role.Name)
		}
		authors, threshold, err := authorKeys(delegations, role.Name+".authors")
		if err != nil {
			return nil, err
		}
		paths := make([]string, 0, len(index.Signed.Targets))
		for path := range index.Signed.Targets {
			paths = append(paths, path)
		}
		sort.Strings(paths)
		for _, path := range paths {
			if err := downloadItem(up, path, authors, threshold); err != nil {
				return nil, err
			}
			seen[path] = true
		}
	}
	for path := range previous {
		if !seen[path] {
			if _, err := up.GetTargetInfo(path); err == nil {
				return nil, fmt.Errorf("unpublished %s still resolves", path)
			}
		}
	}
	return seen, nil
}

func downloadItem(up *updater.Updater, path string, authors map[string]ed25519.PublicKey, threshold int) error {
	info, err := up.GetTargetInfo(path)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	_, data, err := up.DownloadTarget(info, "", "")
	if err != nil {
		return fmt.Errorf("%s: download: %w", path, err)
	}
	item, err := feed.Decode(data)
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	if want := strings.TrimSuffix(filepath.Base(path), ".json"); feed.IDOf(item) != want {
		return fmt.Errorf("%s: id %q does not match the path", path, feed.IDOf(item))
	}
	if err := feed.VerifyItem(item, authors, threshold, nil, 0); err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return nil
}

func authorKeys(dlg *metadata.Delegations, roleName string) (map[string]ed25519.PublicKey, int, error) {
	for _, role := range dlg.Roles {
		if role.Name != roleName {
			continue
		}
		out := map[string]ed25519.PublicKey{}
		for _, keyid := range role.KeyIDs {
			pub, err := dlg.Keys[keyid].ToPublicKey()
			if err != nil {
				return nil, 0, err
			}
			out[keyid] = pub.(ed25519.PublicKey)
		}
		return out, role.Threshold, nil
	}
	return nil, 0, fmt.Errorf("%s: authors role missing (channels must be authored)", roleName)
}
