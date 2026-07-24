package router

import (
	"embed"
	"net/http"

	"github.com/gin-gonic/gin"
)

// One-line installers, served at /install/*.sh and /install/*.ps1. Users run
//   curl -fsSL https://anyrouters.com/install/codex.sh | bash -s -- <KEY>
// (or the PowerShell `irm | iex` form). Piping straight to the interpreter means
// nothing is written to disk as a downloaded file, so there is NO Gatekeeper
// quarantine (macOS) and NO execution-policy block (Windows) — the exact errors
// users kept hitting with downloaded .command / .ps1 files.
//
// The scripts are KEYLESS (key passed at run time: bash $1 / PowerShell
// $env:ANYROUTERS_KEY), so they are safe to cache and serve publicly. They
// migrate only the active routing fields, preserve unrelated Codex settings,
// validate the staged result, and back up before activation. Kept as real files
// (embedded) so shell / PowerShell escaping isn't mangled by Go string literals.

//go:embed install_scripts/codex.sh install_scripts/codex.ps1 install_scripts/codex-config.sh install_scripts/codex-config.ps1 install_scripts/codex-official.sh install_scripts/codex-official.ps1 install_scripts/codex-history.ps1 install_scripts/codex-provider-sync-lite-v0.3.1.zip install_scripts/claude.sh install_scripts/claude.ps1
var installScriptsFS embed.FS

type installRoute struct {
	file        string
	contentType string
}

// SetInstallRouter registers the public one-line installer endpoints. Must be
// called before SetWebRouter so the SPA catch-all does not swallow them.
func SetInstallRouter(router *gin.Engine) {
	routes := map[string]installRoute{
		"/install/codex.sh": {
			file:        "install_scripts/codex.sh",
			contentType: "text/plain; charset=utf-8",
		},
		"/install/codex.ps1": {
			file:        "install_scripts/codex.ps1",
			contentType: "text/plain; charset=utf-8",
		},
		"/install/codex-config.sh": {
			file:        "install_scripts/codex-config.sh",
			contentType: "text/plain; charset=utf-8",
		},
		"/install/codex-config.ps1": {
			file:        "install_scripts/codex-config.ps1",
			contentType: "text/plain; charset=utf-8",
		},
		"/install/codex-official.sh": {
			file:        "install_scripts/codex-official.sh",
			contentType: "text/plain; charset=utf-8",
		},
		"/install/codex-official.ps1": {
			file:        "install_scripts/codex-official.ps1",
			contentType: "text/plain; charset=utf-8",
		},
		"/install/codex-history.ps1": {
			file:        "install_scripts/codex-history.ps1",
			contentType: "text/plain; charset=utf-8",
		},
		"/install/codex-provider-sync-lite-v0.3.1.zip": {
			file:        "install_scripts/codex-provider-sync-lite-v0.3.1.zip",
			contentType: "application/zip",
		},
		"/install/claude.sh": {
			file:        "install_scripts/claude.sh",
			contentType: "text/plain; charset=utf-8",
		},
		"/install/claude.ps1": {
			file:        "install_scripts/claude.ps1",
			contentType: "text/plain; charset=utf-8",
		},
	}
	for path, route := range routes {
		body, err := installScriptsFS.ReadFile(route.file)
		if err != nil {
			continue
		}
		contentType := route.contentType
		router.GET(path, func(c *gin.Context) {
			c.Header("Cache-Control", "public, max-age=300")
			c.Data(http.StatusOK, contentType, body)
		})
	}
}
