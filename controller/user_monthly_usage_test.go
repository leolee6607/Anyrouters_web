package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestUserMonthlyUsageRejectsUnauthorizedAndMalformed(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		name string
		role int
		path string
		want int
	}{
		{"anonymous", 0, "/31?year=2026", 403},
		{"ordinary user", 1, "/31?year=2026", 403},
		{"invalid user", 10, "/abc?year=2026", 400},
		{"zero user", 100, "/0?year=2026", 400},
		{"missing year", 100, "/31", 400},
		{"invalid year", 100, "/31?year=abc", 400},
		{"future year", 100, "/31?year=9999", 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			router := gin.New()
			router.Use(func(c *gin.Context) { c.Set("role", tc.role) })
			router.GET("/:id", GetUserMonthlyUsage)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
			require.Equal(t, tc.want, w.Code)
			require.NotContains(t, w.Body.String(), "consume_usd")
		})
	}
}
