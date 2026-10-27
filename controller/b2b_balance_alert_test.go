package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestB2BBalanceAlertAdminAPI(t *testing.T) {
	old := model.DB
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:alert-api-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.B2BBalanceAlert{}))
	model.DB = db
	t.Cleanup(func() { model.DB = old; sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	require.NoError(t, db.Create(&model.User{Id: 1, Username: "admin", AffCode: "admin", Role: common.RoleAdminUser, Status: common.UserStatusEnabled}).Error)
	require.NoError(t, db.Create(&model.User{Id: 59, Username: "customer", AffCode: "customer", Role: common.RoleCommonUser, Group: "b2b_59", Status: common.UserStatusEnabled}).Error)
	// Exercise the real admin gate with local, in-memory test sessions.
	engine := gin.New()
	engine.Use(sessions.Sessions("test-session", cookie.NewStore([]byte("01234567890123456789012345678901"))))
	engine.Use(func(c *gin.Context) {
		var id, role int
		switch c.GetHeader("X-Test-Actor") {
		case "admin":
			id, role = 1, common.RoleAdminUser
		case "customer":
			id, role = 59, common.RoleCommonUser
		default:
			return
		}
		session := sessions.Default(c)
		session.Set("id", id)
		session.Set("username", "test")
		session.Set("role", role)
		session.Set("status", common.UserStatusEnabled)
		c.Request.Header.Set("New-Api-User", fmt.Sprint(id))
	})
	routes := engine.Group("/btob", middleware.AdminAuth())
	routes.GET("/balance-alerts", GetB2BBalanceAlerts)
	routes.PUT("/balance-alerts", UpdateB2BBalanceAlert)
	request := func(actor, method, url, body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(method, url, bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Test-Actor", actor)
		engine.ServeHTTP(recorder, req)
		return recorder
	}
	require.Equal(t, http.StatusUnauthorized, request("", http.MethodGet, "/btob/balance-alerts?group=b2b_59", "").Code)
	unauthorized := request("customer", http.MethodPut, "/btob/balance-alerts", `{"group":"b2b_59","user_id":59,"enabled":true,"threshold_quota":50000000,"recipients":["team@example.com"]}`)
	require.Contains(t, unauthorized.Body.String(), `"success":false`)
	var count int64
	require.NoError(t, db.Model(&model.B2BBalanceAlert{}).Count(&count).Error)
	require.Zero(t, count)
	body := `{"group":"b2b_59","user_id":59,"enabled":false,"threshold_quota":60250000,"recipients":["team@example.com","ops@example.com"],"revision":0}`
	response := request("admin", http.MethodPut, "/btob/balance-alerts", body)
	require.Equal(t, http.StatusOK, response.Code)
	require.Contains(t, response.Body.String(), `"success":true`)
	response = request("admin", http.MethodGet, "/btob/balance-alerts?group=b2b_59", "")
	require.Contains(t, response.Body.String(), `"threshold_quota":60250000`)
	require.Contains(t, response.Body.String(), "ops@example.com")
	require.NotContains(t, response.Body.String(), "lease_token")
	require.Equal(t, http.StatusConflict, request("admin", http.MethodPut, "/btob/balance-alerts", body).Code)
	invalid := request("admin", http.MethodPut, "/btob/balance-alerts", `{"group":"b2b_other","user_id":59,"enabled":true,"threshold_quota":50000000,"recipients":["team@example.com"],"revision":1}`)
	require.Contains(t, invalid.Body.String(), `"success":false`)
}
