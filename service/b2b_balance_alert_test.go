package service

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupB2BAlertTest(t *testing.T) (*model.User, model.B2BBalanceAlert) {
	t.Helper()
	oldDB := model.DB
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:alert-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Option{}, &model.B2BBalanceAlert{}))
	model.DB = db
	t.Cleanup(func() { model.DB = oldDB; sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	user := &model.User{Id: 59, Username: "customer59", DisplayName: "Customer <59>", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "b2b_59", Quota: 99 * 500000, UsedQuota: 901 * 500000}
	require.NoError(t, db.Create(user).Error)
	input := B2BAlertInput{Group: user.Group, UserID: user.Id, Enabled: true, ThresholdQuota: 100 * 500000, Recipients: []string{"a@example.com", "b@example.com"}}
	rule := NewB2BAlertRule(input, 1)
	require.NoError(t, model.SaveB2BBalanceAlert(&rule, 0))
	return user, rule
}

func currentAlert(t *testing.T) model.B2BBalanceAlert {
	t.Helper()
	var rule model.B2BBalanceAlert
	require.NoError(t, model.DB.First(&rule, "user_id = ?", 59).Error)
	return rule
}

func TestB2BBalanceAlertRetryDedupAndRearm(t *testing.T) {
	user, _ := setupB2BAlertTest(t)
	now := time.Now().Unix()
	calls := map[string]int{}
	failB := true
	send := func(subject, recipient, body string) error {
		calls[recipient]++
		require.Contains(t, subject, "AR000059")
		require.Contains(t, body, "Customer &lt;59&gt;")
		require.Contains(t, body, "$99.00")
		if recipient == "b@example.com" && failB {
			return errors.New("SMTP unavailable")
		}
		return nil
	}
	require.NoError(t, runB2BBalanceAlerts(now, send))
	require.Equal(t, map[string]int{"a@example.com": 1, "b@example.com": 1}, calls)
	require.True(t, currentAlert(t).DeliveryFailed)
	require.NoError(t, runB2BBalanceAlerts(now+60, send))
	require.Equal(t, 1, calls["b@example.com"])
	failB = false
	require.NoError(t, runB2BBalanceAlerts(now+301, send))
	require.Equal(t, map[string]int{"a@example.com": 1, "b@example.com": 2}, calls)
	require.False(t, currentAlert(t).DeliveryFailed)
	require.NoError(t, runB2BBalanceAlerts(now+400, send))
	require.Equal(t, 1, calls["a@example.com"])
	require.Equal(t, 2, calls["b@example.com"])
	// A replenished balance re-arms the persisted reminder.
	require.NoError(t, model.DB.Model(user).Update("quota", 100*500000).Error)
	require.NoError(t, runB2BBalanceAlerts(now+500, send))
	require.Equal(t, "[]", currentAlert(t).DeliveredJSON)
	require.NoError(t, model.DB.Model(user).Update("quota", 99*500000).Error)
	require.NoError(t, runB2BBalanceAlerts(now+600, send))
	require.Equal(t, map[string]int{"a@example.com": 2, "b@example.com": 3}, calls)
}

func TestB2BBalanceAlertLeaseAndConfigConcurrency(t *testing.T) {
	_, rule := setupB2BAlertTest(t)
	now := time.Now().Unix()
	claimed, err := model.ClaimB2BBalanceAlert(&rule, now)
	require.NoError(t, err)
	require.True(t, claimed)
	duplicate := currentAlert(t)
	claimed, err = model.ClaimB2BBalanceAlert(&duplicate, now)
	require.NoError(t, err)
	require.False(t, claimed)
	edited := currentAlert(t)
	edited.Enabled = false
	require.ErrorIs(t, model.SaveB2BBalanceAlert(&edited, 1), model.ErrBalanceAlertBusy)
	require.NoError(t, model.UpdateClaimedB2BBalanceAlert(&rule, map[string]interface{}{"lease_until": 0, "lease_token": ""}))
	require.NoError(t, model.SaveB2BBalanceAlert(&edited, 1))
	require.ErrorIs(t, model.SaveB2BBalanceAlert(&edited, 1), model.ErrBalanceAlertConflict)
	called := false
	require.NoError(t, runB2BBalanceAlerts(now+60, func(_, _, _ string) error { called = true; return nil }))
	require.False(t, called)
}

func TestB2BBalanceAlertStaleWorkerDoesNotRepeatDelivery(t *testing.T) {
	_, stale := setupB2BAlertTest(t)
	now := time.Now().Unix()
	calls := 0
	send := func(_, _, _ string) error { calls++; return nil }
	require.NoError(t, checkB2BBalanceAlert(stale, now, send))
	require.Equal(t, 2, calls)
	// Both replicas can read the same snapshot before either starts sending.
	// Acquiring the released lease must also reload the persisted successes.
	require.NoError(t, checkB2BBalanceAlert(stale, now+1, send))
	require.Equal(t, 2, calls)
}

func TestB2BBalanceAlertStopsAfterCustomerMoves(t *testing.T) {
	user, _ := setupB2BAlertTest(t)
	require.NoError(t, model.DB.Model(user).Update("group", "b2b_other").Error)
	called := false
	require.NoError(t, runB2BBalanceAlerts(time.Now().Unix(), func(_, _, _ string) error { called = true; return nil }))
	require.False(t, called)
	require.False(t, currentAlert(t).Enabled)
	// The new group can load the old revision and explicitly configure a new rule.
	rules, err := model.GetB2BBalanceAlerts("b2b_other")
	require.NoError(t, err)
	require.Len(t, rules, 1)
}

func TestB2BBalanceAlertBoundaryAndDisabledCustomer(t *testing.T) {
	user, _ := setupB2BAlertTest(t)
	now := time.Now().Unix()
	calls := 0
	send := func(_, _, _ string) error { calls++; return nil }
	require.NoError(t, model.DB.Model(user).Update("quota", 100*500000).Error)
	require.NoError(t, runB2BBalanceAlerts(now, send))
	require.Zero(t, calls)
	require.NoError(t, model.DB.Model(user).Updates(map[string]interface{}{"quota": 0, "status": common.UserStatusDisabled}).Error)
	require.NoError(t, runB2BBalanceAlerts(now+60, send))
	require.Zero(t, calls)
}

func TestB2BBalanceAlertValidation(t *testing.T) {
	setupB2BAlertTest(t)
	valid := B2BAlertInput{Group: "b2b_59", UserID: 59, ThresholdQuota: 50000000, Recipients: []string{" a@example.com ", "a@example.com"}}
	_, err := ValidateB2BAlertInput(&valid, true)
	require.NoError(t, err)
	require.Equal(t, []string{"a@example.com"}, valid.Recipients)
	tests := []struct {
		name   string
		change func(*B2BAlertInput)
	}{
		{"C end group", func(v *B2BAlertInput) { v.Group = "default" }},
		{"wrong group", func(v *B2BAlertInput) { v.Group = "b2b_other" }},
		{"zero threshold", func(v *B2BAlertInput) { v.ThresholdQuota = 0 }},
		{"huge threshold", func(v *B2BAlertInput) { v.ThresholdQuota = 1 << 62 }},
		{"empty recipients", func(v *B2BAlertInput) { v.Recipients = nil }},
		{"header injection", func(v *B2BAlertInput) { v.Recipients = []string{"a@example.com\r\nBcc: b@example.com"} }},
		{"address display name", func(v *B2BAlertInput) { v.Recipients = []string{"Admin <a@example.com>"} }},
		{"many recipients", func(v *B2BAlertInput) { v.Recipients = make([]string, 11) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := valid
			test.change(&input)
			_, err := ValidateB2BAlertInput(&input, true)
			require.Error(t, err)
		})
	}
	disabled := valid
	disabled.Recipients = nil
	_, err = ValidateB2BAlertInput(&disabled, false)
	require.NoError(t, err)
}

func TestB2BBalanceAlertTestEmailDoesNotChangeRuleOrBalance(t *testing.T) {
	user, rule := setupB2BAlertTest(t)
	before := currentAlert(t)
	sent := []string{}
	var mu sync.Mutex
	result := sendB2BAlertTestWith(rule, user, func(subject, recipient, body string) error {
		require.True(t, strings.HasPrefix(subject, "[测试]"))
		require.Contains(t, body, "不表示余额已低于阈值")
		mu.Lock()
		sent = append(sent, recipient)
		mu.Unlock()
		if strings.HasPrefix(recipient, "b@") {
			return errors.New("test failure")
		}
		return nil
	})
	require.Len(t, sent, 2)
	require.Equal(t, []string{"a@example.com"}, result.Sent)
	require.Equal(t, []string{"b@example.com"}, result.Failed)
	require.Equal(t, before, currentAlert(t))
	after, err := model.GetUserById(59, false)
	require.NoError(t, err)
	require.Equal(t, user.Quota, after.Quota)
	require.Equal(t, user.UsedQuota, after.UsedQuota)
}

func TestB2BBalanceAlertRecoveryDuringEmailBackoff(t *testing.T) {
	user, _ := setupB2BAlertTest(t)
	now := time.Now().Unix()
	require.NoError(t, runB2BBalanceAlerts(now, func(_, _, _ string) error { return errors.New("temporary error") }))
	require.True(t, currentAlert(t).DeliveryFailed)
	require.NoError(t, model.DB.Model(user).Update("quota", 1000*500000).Error)
	require.NoError(t, runB2BBalanceAlerts(now+60, func(_, _, _ string) error { t.Fatal("must not send after balance recovery"); return nil }))
	require.False(t, currentAlert(t).DeliveryFailed)
	require.Zero(t, currentAlert(t).NextAttemptAt)
}

func TestB2BBalanceAlertExpiredLeaseCannotSend(t *testing.T) {
	_, rule := setupB2BAlertTest(t)
	now := time.Now().Unix()
	claimed, err := model.ClaimB2BBalanceAlert(&rule, now)
	require.NoError(t, err)
	require.True(t, claimed)
	require.ErrorIs(t, model.RenewB2BBalanceAlertLease(&rule, now+301), model.ErrBalanceAlertConflict)
}
