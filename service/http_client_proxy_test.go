package service

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gorilla/websocket"
)

func TestNewProxyHttpClientSchemes(t *testing.T) {
	// empty proxy returns the shared direct client
	direct, err := NewProxyHttpClient("")
	if err != nil || direct == nil {
		t.Fatalf("empty proxy: client=%v err=%v", direct, err)
	}

	httpClient, err := NewProxyHttpClient("http://127.0.0.1:17890")
	if err != nil {
		t.Fatalf("http proxy: %v", err)
	}
	transport, ok := httpClient.Transport.(*http.Transport)
	if !ok || transport.Proxy == nil {
		t.Fatal("http proxy client must carry a Transport.Proxy")
	}

	socksClient, err := NewProxyHttpClient("socks5://user:pass@127.0.0.1:17891")
	if err != nil {
		t.Fatalf("socks5 proxy: %v", err)
	}
	socksTransport, ok := socksClient.Transport.(*http.Transport)
	if !ok || socksTransport.DialContext == nil {
		t.Fatal("socks5 proxy client must carry a Transport.DialContext")
	}

	if _, err := NewProxyHttpClient("ftp://127.0.0.1:21"); err == nil {
		t.Fatal("unsupported scheme must fail")
	}

	// same URL returns the cached client instance
	again, err := NewProxyHttpClient("http://127.0.0.1:17890")
	if err != nil {
		t.Fatal(err)
	}
	if again != httpClient {
		t.Fatal("proxy clients must be cached per URL")
	}
}

// TestProxyHttpClientRoutesThroughProxy verifies requests actually traverse
// the configured HTTP proxy, including a streaming (SSE-shaped) body — the
// scenario the VM fixed-egress rollout depends on.
func TestProxyHttpClientRoutesThroughProxy(t *testing.T) {
	var sawProxyRequest bool
	var proxiedURL string
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A plain-HTTP request through an HTTP proxy arrives with an
		// absolute-form URL; the proxy itself answers as the upstream here.
		sawProxyRequest = true
		proxiedURL = r.URL.String()
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"usage\":{\"prompt_tokens\":1}}\n\ndata: [DONE]\n\n"))
	}))
	defer proxyServer.Close()

	client, err := NewProxyHttpClient(proxyServer.URL)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := client.Get("http://upstream.internal.test/v1/chat/completions")
	if err != nil {
		t.Fatalf("request through proxy failed: %v", err)
	}
	defer resp.Body.Close()
	if !sawProxyRequest {
		t.Fatal("request did not traverse the proxy")
	}
	if !strings.Contains(proxiedURL, "upstream.internal.test") {
		t.Fatalf("proxy saw %q, want absolute upstream URL", proxiedURL)
	}
	buf := make([]byte, 128)
	n, _ := resp.Body.Read(buf)
	if !strings.Contains(string(buf[:n]), "usage") {
		t.Fatalf("streaming body not relayed, got %q", string(buf[:n]))
	}
}

func TestNewWssDialer(t *testing.T) {
	direct, err := NewWssDialer("")
	if err != nil || direct != websocket.DefaultDialer {
		t.Fatalf("empty proxy must return DefaultDialer, got %v err=%v", direct, err)
	}

	httpDialer, err := NewWssDialer("http://127.0.0.1:17890")
	if err != nil {
		t.Fatal(err)
	}
	if httpDialer.Proxy == nil {
		t.Fatal("http proxy wss dialer must set Proxy")
	}

	socksDialer, err := NewWssDialer("socks5://user:pass@127.0.0.1:17891")
	if err != nil {
		t.Fatal(err)
	}
	if socksDialer.NetDialContext == nil {
		t.Fatal("socks5 wss dialer must set NetDialContext")
	}

	if _, err := NewWssDialer("ftp://127.0.0.1:21"); err == nil {
		t.Fatal("unsupported scheme must fail")
	}
}
