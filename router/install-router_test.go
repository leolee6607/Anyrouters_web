package router

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

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
