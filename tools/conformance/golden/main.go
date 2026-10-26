// Command golden writes the Go SDK fixtures the TypeScript domain package is tested
// against: OLPC bytes, keyids, signatures and one repo state per publisher operation.
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/secure-systems-lab/go-securesystemslib/cjson"
	"github.com/v1b3coder/keryx/sdk/feed"
	"github.com/v1b3coder/keryx/sdk/keys"
	"github.com/v1b3coder/keryx/sdk/publisher"
	"github.com/v1b3coder/keryx/sdk/repo"
)

func seed(name string) []byte {
	sum := sha256.Sum256([]byte("keryx-golden/" + name))
	return sum[:]
}

type memStore struct{ keys []*keys.Key }

func (s *memStore) List(context.Context) ([]keys.Info, error) {
	out := []keys.Info{}
	for _, k := range s.keys {
		out = append(out, keys.Info{Name: k.Name, Role: k.Role, KeyID: k.KeyID()})
	}
	return out, nil
}

func (s *memStore) Get(_ context.Context, keyid string) (*keys.Key, error) {
	for _, k := range s.keys {
		if k.KeyID() == keyid {
			return k, nil
		}
	}
	return nil, &keys.ErrMissingKey{KeyID: keyid}
}

func (s *memStore) Find(_ context.Context, role keys.Role, name string) (*keys.Key, error) {
	for _, k := range s.keys {
		if k.Role == role && (name == "" || k.Name == name) {
			return k, nil
		}
	}
	return nil, &keys.ErrMissingKey{Role: string(role)}
}

func (s *memStore) Add(_ context.Context, k *keys.Key) error { s.keys = append(s.keys, k); return nil }
func (s *memStore) Remove(context.Context, string) error  { return nil }

func key(role keys.Role, name string) *keys.Key {
	k, err := keys.FromSeed(role, name, seed(name))
	must(err)
	return k
}

func must(err error) {
	if err != nil {
		panic(err)
	}
}

var canonicalInputs = []string{
	`{"b":1,"a":[true,false,null],"c":{"z":"\"quoted\" \\ back","y":-42}}`,
	`{"é":1,"z":2,"A":3,"😀":4,"￿":5,"aa":6,"a":7}`,
	`"line\nbreak\ttab <b>&amp;</b>   \u0001 é /"`,
	`{"a":{},"b":[],"c":"","d":0}`,
	`9007199254740991`,
}

func writeCanonical(out string, names []string) {
	type canonicalCase struct {
		Input     string `json:"input"`
		Canonical string `json:"canonical"`
	}
	type keyCase struct {
		Name   string `json:"name"`
		Seed   string `json:"seed"`
		Public string `json:"public"`
		KeyID  string `json:"keyid"`
		Sig    string `json:"sig"`
	}
	fixture := struct {
		Message   string          `json:"message"`
		Canonical []canonicalCase `json:"canonical"`
		Keys      []keyCase       `json:"keys"`
	}{Message: "keryx golden message"}
	for _, input := range canonicalInputs {
		value, err := feed.Decode([]byte(`{"v":` + input + `}`))
		must(err)
		canonical, err := cjson.EncodeCanonical(value["v"])
		must(err)
		fixture.Canonical = append(fixture.Canonical, canonicalCase{Input: input, Canonical: string(canonical)})
	}
	for _, name := range names {
		k := key(keys.RoleAuthor, name)
		fixture.Keys = append(fixture.Keys, keyCase{
			Name: name, Seed: hex.EncodeToString(seed(name)), Public: hex.EncodeToString(k.Public()),
			KeyID: k.KeyID(), Sig: hex.EncodeToString(ed25519.Sign(k.Private(), []byte(fixture.Message))),
		})
	}
	data, err := json.MarshalIndent(fixture, "", "  ")
	must(err)
	must(os.WriteFile(filepath.Join(out, "canonical.json"), append(data, '\n'), 0o644))
}

func item(id, title string, signers ...*keys.Key) map[string]any {
	obj := map[string]any{
		"id":             id,
		"title":          title,
		"content_html":   "<p>Hello & welcome to <b>ACME</b> </p>",
		"image":          "data:image/png;base64,iVBORw0KGgo=",
		"date_published": "2026-10-26T12:00:00Z",
		"tags":           []any{"news", "ünïcode"},
		"language":       "en",
		"attachments": []any{map[string]any{
			"name": "Price list", "url": "https://acme.example/prices.pdf?a=1&b=2",
			"mime_type": "application/pdf", "size_in_bytes": json.Number("12345"),
			"sha256": hex.EncodeToString(make([]byte, 32)),
		}},
	}
	for _, k := range signers {
		must(feed.SignItem(obj, k))
	}
	return obj
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: golden <fixtures dir>")
		os.Exit(2)
	}
	out := os.Args[1]
	must(os.RemoveAll(out))
	must(os.MkdirAll(out, 0o755))
	writeCanonical(out, []string{"master", "ops", "offers", "alice", "bob"})

	master := key(keys.RoleMaster, "master")
	ops := key(keys.RoleOps, "ops")
	offers := key(keys.RoleChannel, "offers")
	alice := key(keys.RoleAuthor, "alice")
	bob := key(keys.RoleAuthor, "bob")
	store := &memStore{keys: []*keys.Key{master, ops, offers, alice, bob}}

	work := filepath.Join(out, "work")
	p := publisher.New(repo.NewDirRepo(filepath.Join(work, "base")), repo.NewDirRepo(filepath.Join(work, "anchor")), store)
	t0 := time.Date(2026, 10, 26, 12, 0, 0, 0, time.UTC)
	ctx := context.Background()
	step := 0
	run := func(name string, op func() error) {
		step++
		now := t0.Add(time.Duration(step-1) * time.Hour)
		p.Now = func() time.Time { return now }
		must(op())
		must(os.CopyFS(filepath.Join(out, "steps", fmt.Sprintf("%02d-%s", step, name)), os.DirFS(work)))
	}
	ignore := func(_ publisher.Result, err error) error { return err }

	run("init", func() error {
		return ignore(p.Init(ctx, publisher.InitParams{
			RepoBase:    "https://repo.keryx-kit.test/acme/",
			CompanyName: "ACME <Shop> & Co.",
			Logo:        "data:image/png;base64,iVBORw0KGgo=",
		}))
	})
	run("channel-add", func() error {
		return ignore(p.ChannelAdd(ctx, publisher.ChannelSpec{
			Name: "offers", DisplayName: "Offers & deals", Description: "Weekly <b>deals</b>",
			KeyID: offers.KeyID(), Authors: []string{alice.KeyID()},
		}))
	})
	run("publish", func() error {
		return ignore(p.Publish(ctx, publisher.PublishParams{Channel: "offers", Item: item("welcome", "Welcome <to> ACME & co", alice)}))
	})
	run("author-add", func() error { return ignore(p.AuthorAdd(ctx, "offers", bob.KeyID())) })
	run("publish-cosigned", func() error {
		return ignore(p.Publish(ctx, publisher.PublishParams{Channel: "offers", Item: item("second", "Second 😀", alice, bob)}))
	})
	run("channel-set", func() error { return ignore(p.ChannelSet(ctx, "offers", "Offers", "")) })
	run("company-logo", func() error {
		return ignore(p.CompanySet(ctx, "", "https://acme.example/logo.png", hex.EncodeToString(make([]byte, 32))))
	})
	run("unpublish", func() error { return ignore(p.Unpublish(ctx, "offers", "second")) })
	run("refresh-timestamp", func() error { return ignore(p.RefreshTimestamp(ctx)) })
	run("author-revoke", func() error { return ignore(p.AuthorRevoke(ctx, "offers", alice.KeyID())) })
	must(os.RemoveAll(work))
}
