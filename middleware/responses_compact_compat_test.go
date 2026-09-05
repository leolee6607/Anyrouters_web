package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// Exercise the actual distributor without changing its authorization contract.
// Adding compact capacity must not grant access to another model or group.
func TestCompactExplicitChannelAndTokenPermissions(t *testing.T) {
	oldGinMode := gin.Mode()
	gin.SetMode(gin.TestMode)
	t.Cleanup(func() { gin.SetMode(oldGinMode) })
	require.NoError(t, i18n.Init())
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldPath, oldMaster := common.SQLitePath, common.IsMasterNode
	oldMemory, oldRedis := common.MemoryCacheEnabled, common.RedisEnabled
	oldSQLite, oldMySQL, oldPostgreSQL := common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SQLitePath, common.IsMasterNode = oldPath, oldMaster
		common.MemoryCacheEnabled, common.RedisEnabled = oldMemory, oldRedis
		common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL = oldSQLite, oldMySQL, oldPostgreSQL
	})
	t.Setenv("SQL_DSN", "")
	common.SQLitePath = t.TempDir() + "/compact.db"
	common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL = true, false, false
	common.IsMasterNode, common.MemoryCacheEnabled, common.RedisEnabled = false, false, false
	require.NoError(t, model.InitDB())
	db, err := model.DB.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}, &model.Ability{}))

	const base, legacy, group = "gpt-6-astra", "gpt-5.6-sol", "compact-test-group"
	alias := ratio_setting.WithCompactModelSuffix(base)
	channel := &model.Channel{Id: 901, Type: constant.ChannelTypeAzure, Key: "fixture-not-a-live-key", Name: "fixture", Status: common.ChannelStatusEnabled, Models: base + "," + legacy, Group: group}
	require.NoError(t, model.DB.Create(channel).Error)
	for _, name := range []string{base, legacy} {
		require.NoError(t, model.DB.Create(&model.Ability{Group: group, Model: name, ChannelId: channel.Id, Enabled: true}).Error)
	}
	run := func(path, name, useGroup string, limits map[string]bool) (int, string) {
		router := gin.New()
		router.Use(func(c *gin.Context) {
			common.SetContextKey(c, constant.ContextKeyTokenModelLimitEnabled, limits != nil)
			common.SetContextKey(c, constant.ContextKeyTokenModelLimit, limits)
			common.SetContextKey(c, constant.ContextKeyUsingGroup, useGroup)
			common.SetContextKey(c, constant.ContextKeyUserGroup, useGroup)
		})
		router.Use(Distribute())
		router.POST(path, func(c *gin.Context) { c.Status(http.StatusNoContent) })
		body, err := common.Marshal(map[string]any{"model": name, "input": "test"})
		require.NoError(t, err)
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(string(body)))
		req.Header.Set("Content-Type", "application/json")
		result := httptest.NewRecorder()
		router.ServeHTTP(result, req)
		return result.Code, result.Body.String()
	}
	status, body := run("/v1/responses/compact", base, group, map[string]bool{base: true, alias: true})
	require.Equal(t, http.StatusServiceUnavailable, status, body)

	// The proposed change is an explicit channel/ability addition, not a global
	// suffix fallback or a cross-account retry rule.
	require.NoError(t, model.DB.Model(channel).Update("models", channel.Models+","+alias).Error)
	require.NoError(t, model.DB.Create(&model.Ability{Group: group, Model: alias, ChannelId: channel.Id, Enabled: true}).Error)
	for _, tc := range []struct {
		name, path, requestModel, useGroup string
		limits                             map[string]bool
		want                               int
	}{
		{"base permission alone remains restricted", "/v1/responses/compact", base, group, map[string]bool{base: true}, 403},
		{"explicit compact permission works", "/v1/responses/compact", base, group, map[string]bool{base: true, alias: true}, 204},
		{"unrestricted model token works", "/v1/responses/compact", base, group, nil, 204},
		{"normal GPT6 request unchanged", "/v1/responses", base, group, map[string]bool{base: true}, 204},
		{"legacy normal request unchanged", "/v1/responses", legacy, group, map[string]bool{legacy: true}, 204},
		{"other model stays forbidden", "/v1/responses/compact", legacy, group, map[string]bool{base: true, alias: true}, 403},
		{"compact only cannot call normal model", "/v1/responses", base, group, map[string]bool{alias: true}, 403},
		{"other group gets no channel", "/v1/responses/compact", base, "unrelated-group", map[string]bool{alias: true}, 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, body := run(tc.path, tc.requestModel, tc.useGroup, tc.limits)
			require.Equal(t, tc.want, status, body)
		})
	}
}
