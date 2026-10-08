package controller

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func GetUserMonthlyUsage(c *gin.Context) {
	// Defense in depth: the route also uses AdminAuth. This is a read-only
	// report with the same admin visibility as the existing consumption logs.
	if c.GetInt("role") < common.RoleAdminUser {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "Admin access required"})
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid user ID"})
		return
	}
	now := time.Now()
	year, err := strconv.Atoi(c.Query("year"))
	if err != nil || year < 2000 || year > now.In(model.UsageMonthLocation).Year() {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid usage year"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	report, err := model.GetUserMonthlyUsage(ctx, id, year, now)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "User not found"})
		return
	}
	if err != nil {
		common.SysError("monthly user usage: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Unable to load monthly usage"})
		return
	}
	c.Header("Cache-Control", "no-store")
	common.ApiSuccess(c, report)
}
