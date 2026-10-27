package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetB2BBalanceAlerts(c *gin.Context) {
	group := c.Query("group")
	if !service.IsB2BGroup(group) {
		common.ApiErrorMsg(c, "请选择 B 端分组")
		return
	}
	rules, err := model.GetB2BBalanceAlerts(group)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	views := make([]service.B2BAlertView, 0, len(rules))
	for _, rule := range rules {
		views = append(views, service.B2BAlertToView(rule))
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": views})
}

func UpdateB2BBalanceAlert(c *gin.Context) {
	var input service.B2BAlertInput
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiErrorMsg(c, "提醒设置格式不正确")
		return
	}
	if _, err := service.ValidateB2BAlertInput(&input, input.Enabled); err != nil {
		common.ApiError(c, err)
		return
	}
	rule := service.NewB2BAlertRule(input, c.GetInt("id"))
	if err := model.SaveB2BBalanceAlert(&rule, input.Revision); err != nil {
		if err == model.ErrBalanceAlertConflict || err == model.ErrBalanceAlertBusy {
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": "提醒设置已变化或正在发送，请稍后刷新重试"})
			return
		}
		common.ApiError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

func TestB2BBalanceAlert(c *gin.Context) {
	var input service.B2BAlertInput
	if err := c.ShouldBindJSON(&input); err != nil {
		common.ApiErrorMsg(c, "提醒设置格式不正确")
		return
	}
	user, err := service.ValidateB2BAlertInput(&input, true)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	allowed, err := service.CheckNotificationLimit(c.GetInt("id"), "b2b_balance_alert_test")
	if err != nil || !allowed {
		c.JSON(http.StatusTooManyRequests, gin.H{"success": false, "message": "测试邮件发送过于频繁，请稍后重试"})
		return
	}
	rule := service.NewB2BAlertRule(input, c.GetInt("id"))
	result := service.SendB2BAlertTest(rule, user)
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
