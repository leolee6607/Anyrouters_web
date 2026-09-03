package common

import (
	"strings"
	"testing"
)

// Proxy URLs can embed credentials; whatever else an error message contains,
// the username/password must never survive masking — including when the URL
// is unparseable (the exact case that produces url.Parse error messages).
func TestMaskSensitiveInfoProxyCredentials(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		secrets []string
	}{
		{
			"socks5 with credentials",
			`new proxy http client failed: parse "socks5://proxyuser:Secr3tPass@10.0.0.5:1080": ok`,
			[]string{"proxyuser", "Secr3tPass"},
		},
		{
			"unparseable url keeps raw string but credentials still masked",
			`parse "socks5://admin:P%ssw0rd@vm.example.com:1080": invalid URL escape "%ss"`,
			[]string{"admin", "P%ssw0rd"},
		},
		{
			"http url with userinfo",
			`proxyconnect tcp: dial http://user1:pw1@203.0.113.7:3128 refused`,
			[]string{"user1", "pw1"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			out := MaskSensitiveInfo(tt.in)
			for _, secret := range tt.secrets {
				if strings.Contains(out, secret) {
					t.Errorf("masked output still contains %q:\n%s", secret, out)
				}
			}
		})
	}
}

func TestMaskSensitiveInfoCoversSocksScheme(t *testing.T) {
	out := MaskSensitiveInfo("dial socks5://vm-proxy.internal:1080 failed")
	if strings.Contains(out, "vm-proxy.internal") {
		t.Errorf("socks5 host not masked: %s", out)
	}
}
