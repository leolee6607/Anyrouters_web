package channel

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func newProxyTestContext(t *testing.T) *gin.Context {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	req, err := http.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	c.Request = req
	return c
}

// doRequest must route channel traffic through the configured proxy — the
// invariant the VM fixed-egress design depends on.
func TestDoRequestUsesChannelProxy(t *testing.T) {
	var proxiedURL string
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxiedURL = r.URL.String()
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer proxyServer.Close()

	c := newProxyTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	info.ChannelSetting.Proxy = proxyServer.URL

	req, err := http.NewRequest(http.MethodPost, "http://upstream.internal.test/openai/deployments/dep-a/chat/completions", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	resp, apiErr := doRequest(c, req, info)
	if apiErr != nil {
		t.Fatalf("doRequest failed: %v", apiErr)
	}
	defer resp.Body.Close()
	if !strings.Contains(proxiedURL, "upstream.internal.test") {
		t.Fatalf("request did not traverse channel proxy, proxy saw %q", proxiedURL)
	}
}

// A dead proxy must surface as a proxy error, distinguishable from upstream
// failures, and must not leak the proxy URL or credentials to the client.
func TestDoRequestProxyConnectErrorClassification(t *testing.T) {
	c := newProxyTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	// 127.0.0.1:9 (discard port) — nothing listens there.
	info.ChannelSetting.Proxy = "http://user:secretpw@127.0.0.1:9"

	req, err := http.NewRequest(http.MethodPost, "http://upstream.internal.test/v1/chat/completions", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	_, doErr := doRequest(c, req, info)
	if doErr == nil {
		t.Fatal("expected error from dead proxy")
	}
	msg := doErr.Error()
	if strings.Contains(msg, "secretpw") {
		t.Fatalf("proxy credential leaked into error: %s", msg)
	}
	if !strings.Contains(msg, "proxy") {
		t.Fatalf("proxy connect failure not classified as proxy error: %s", msg)
	}
}

// An invalid proxy configuration must fail with a hidden message rather than
// echoing the raw URL (which may carry credentials).
func TestDoRequestInvalidProxyConfigHidden(t *testing.T) {
	c := newProxyTestContext(t)
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}}
	info.ChannelSetting.Proxy = "ftp://user:secretpw@127.0.0.1:21"

	req, err := http.NewRequest(http.MethodPost, "http://upstream.internal.test/v1/chat/completions", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	_, doErr := doRequest(c, req, info)
	if doErr == nil {
		t.Fatal("expected error from invalid proxy scheme")
	}
	if strings.Contains(doErr.Error(), "secretpw") {
		t.Fatalf("credential leaked: %s", doErr.Error())
	}
}

func TestIsProxyConnectError(t *testing.T) {
	if !isProxyConnectError(errors.New("proxyconnect tcp: dial tcp 127.0.0.1:9: connect: connection refused")) {
		t.Error("http proxy dial failure not detected")
	}
	if !isProxyConnectError(errors.New("socks connect tcp 127.0.0.1:1080->host:443: dial tcp: connection refused")) {
		t.Error("socks dial failure not detected")
	}
	if isProxyConnectError(errors.New("dial tcp upstream:443: i/o timeout")) {
		t.Error("plain upstream failure misclassified as proxy error")
	}
	if isProxyConnectError(nil) {
		t.Error("nil must not be a proxy error")
	}
}
