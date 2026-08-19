package router

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func writeExecutable(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestClaudeShellInstallerDetectsMacSystemHTTPProxy(t *testing.T) {
	script, err := installScriptsFS.ReadFile("install_scripts/claude.sh")
	if err != nil {
		t.Fatal(err)
	}

	tempDir := t.TempDir()
	fakeBin := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(fakeBin, 0o755); err != nil {
		t.Fatal(err)
	}
	scriptPath := filepath.Join(tempDir, "claude.sh")
	if err := os.WriteFile(scriptPath, script, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(fakeBin, "scutil"), `#!/bin/sh
cat <<'EOF'
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
}
EOF
`)
	writeExecutable(t, filepath.Join(fakeBin, "curl"), `#!/bin/sh
proxy=
body=/dev/null
format=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --proxy) proxy="$2"; shift 2 ;;
    --noproxy) shift 2 ;;
    -o) body="$2"; shift 2 ;;
    -w) format="$2"; shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  *api.anyrouters.com/v1/models)
    if [ "$proxy" = "http://127.0.0.1:7897" ]; then
      [ "$body" = /dev/null ] || printf '{"data":[]}\n' > "$body"
      case "$format" in
        *content_type*) printf '200|application/json' ;;
        *) printf '200' ;;
      esac
      exit 0
    fi
    [ "$body" = /dev/null ] || printf '<!doctype html><title>403</title>403 Forbidden\n' > "$body"
    case "$format" in
      *content_type*) printf '403|text/html' ;;
      *) printf '403' ;;
    esac
    exit 0
    ;;
  *claude.ai/install.sh)
    printf '#!/bin/sh\nexit 0\n' > "$body"
    exit 0
    ;;
esac
exit 1
`)
	writeExecutable(t, filepath.Join(fakeBin, "launchctl"), "#!/bin/sh\nexit 0\n")
	writeExecutable(t, filepath.Join(fakeBin, "claude"), "#!/bin/sh\necho 'Claude Code test'\n")

	command := exec.Command("bash", scriptPath, "sk-test")
	command.Env = append(os.Environ(),
		"HOME="+tempDir,
		"SHELL=/bin/zsh",
		"PATH="+fakeBin+":"+os.Getenv("PATH"),
		"ANYROUTERS_PROXY=",
		"HTTP_PROXY=",
		"HTTPS_PROXY=",
		"http_proxy=",
		"https_proxy=",
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("installer failed: %v\n%s", err, output)
	}

	settings, err := os.ReadFile(filepath.Join(tempDir, ".claude", "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		`"HTTP_PROXY": "http://127.0.0.1:7897"`,
		`"HTTPS_PROXY": "http://127.0.0.1:7897"`,
	} {
		if !bytes.Contains(settings, []byte(expected)) {
			t.Fatalf("settings do not contain %q:\n%s", expected, settings)
		}
	}
}

func TestClaudeShellInstallerLeavesProxyUnsetWhenDirectApiWorks(t *testing.T) {
	script, err := installScriptsFS.ReadFile("install_scripts/claude.sh")
	if err != nil {
		t.Fatal(err)
	}

	tempDir := t.TempDir()
	fakeBin := filepath.Join(tempDir, "bin")
	if err := os.MkdirAll(fakeBin, 0o755); err != nil {
		t.Fatal(err)
	}
	scriptPath := filepath.Join(tempDir, "claude.sh")
	if err := os.WriteFile(scriptPath, script, 0o755); err != nil {
		t.Fatal(err)
	}

	writeExecutable(t, filepath.Join(fakeBin, "scutil"), `#!/bin/sh
cat <<'EOF'
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 8123
  HTTPProxy : 127.0.0.1
}
EOF
`)
	writeExecutable(t, filepath.Join(fakeBin, "curl"), `#!/bin/sh
body=/dev/null
format=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --proxy|--noproxy) shift 2 ;;
    -o) body="$2"; shift 2 ;;
    -w) format="$2"; shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
case "$url" in
  *api.anyrouters.com/v1/models)
    [ "$body" = /dev/null ] || printf '{"data":[]}\n' > "$body"
    case "$format" in
      *content_type*) printf '200|application/json' ;;
      *) printf '200' ;;
    esac
    exit 0
    ;;
  *claude.ai/install.sh)
    printf '#!/bin/sh\nexit 0\n' > "$body"
    exit 0
    ;;
esac
exit 1
`)
	writeExecutable(t, filepath.Join(fakeBin, "launchctl"), "#!/bin/sh\nexit 0\n")
	writeExecutable(t, filepath.Join(fakeBin, "claude"), "#!/bin/sh\necho 'Claude Code test'\n")

	command := exec.Command("bash", scriptPath, "sk-test")
	command.Env = append(os.Environ(),
		"HOME="+tempDir,
		"SHELL=/bin/zsh",
		"PATH="+fakeBin+":"+os.Getenv("PATH"),
		"ANYROUTERS_PROXY=",
		"HTTP_PROXY=",
		"HTTPS_PROXY=",
		"http_proxy=",
		"https_proxy=",
	)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("installer failed: %v\n%s", err, output)
	}
	if bytes.Contains(output, []byte("Detected a working HTTP proxy")) {
		t.Fatalf("direct route unexpectedly selected a proxy:\n%s", output)
	}

	settings, err := os.ReadFile(filepath.Join(tempDir, ".claude", "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(settings, []byte(`"CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY": "1"`)) {
		t.Fatalf("settings do not enable gateway model discovery:\n%s", settings)
	}
	for _, unexpected := range []string{`"HTTP_PROXY"`, `"HTTPS_PROXY"`} {
		if bytes.Contains(settings, []byte(unexpected)) {
			t.Fatalf("direct route unexpectedly wrote %s:\n%s", unexpected, settings)
		}
	}

	for _, profileName := range []string{".zshrc", ".zprofile"} {
		profile, err := os.ReadFile(filepath.Join(tempDir, profileName))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Contains(profile, []byte("export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1")) {
			t.Fatalf("%s does not enable gateway model discovery:\n%s", profileName, profile)
		}
	}
}

func TestCodexHistoryInstallerRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	SetInstallRouter(engine)

	t.Run("PowerShell installer", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/install/codex-history.ps1", nil)
		engine.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		if got := recorder.Header().Get("Content-Type"); got != "text/plain; charset=utf-8" {
			t.Fatalf("Content-Type = %q", got)
		}
		if !strings.Contains(recorder.Body.String(), "codex-provider-sync-lite-v0.3.1.zip") {
			t.Fatal("installer does not reference the pinned source archive")
		}
	})

	t.Run("pinned source archive", func(t *testing.T) {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodGet, "/install/codex-provider-sync-lite-v0.3.1.zip", nil)
		engine.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusOK {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
		}
		if got := recorder.Header().Get("Content-Type"); got != "application/zip" {
			t.Fatalf("Content-Type = %q", got)
		}
		if !bytes.HasPrefix(recorder.Body.Bytes(), []byte("PK")) {
			t.Fatal("response is not a ZIP archive")
		}
	})
}
