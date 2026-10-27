package service

import (
	"errors"
	"fmt"
	"html"
	"net/mail"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"gorm.io/gorm"
)

const MaxB2BAlertRecipients = 10
const balanceAlertEmailTimeout = 15 * time.Second

var balanceAlertOnce sync.Once

type B2BAlertInput struct {
	Group          string   `json:"group"`
	UserID         int      `json:"user_id"`
	Enabled        bool     `json:"enabled"`
	ThresholdQuota int64    `json:"threshold_quota"`
	Recipients     []string `json:"recipients"`
	Revision       int64    `json:"revision"`
}

type B2BAlertView struct {
	model.B2BBalanceAlert
	Recipients []string `json:"recipients"`
}

func B2BAlertToView(rule model.B2BBalanceAlert) B2BAlertView {
	recipients := []string{}
	_ = common.UnmarshalJsonStr(rule.RecipientsJSON, &recipients)
	return B2BAlertView{B2BBalanceAlert: rule, Recipients: recipients}
}

func ValidateB2BAlertInput(input *B2BAlertInput, requireRecipients bool) (*model.User, error) {
	if !IsB2BGroup(input.Group) || len(input.Group) > 64 || input.UserID <= 0 || input.Revision < 0 {
		return nil, errors.New("请选择有效的 B 端分组和客户")
	}
	if input.ThresholdQuota <= 0 || input.ThresholdQuota > 500_000_000_000_000 {
		return nil, errors.New("提醒阈值须大于 0，且不能超过 10 亿美元")
	}
	if len(input.Recipients) > MaxB2BAlertRecipients {
		return nil, errors.New("最多可填写 10 个收件邮箱")
	}
	unique := make(map[string]bool)
	recipients := []string{}
	for _, raw := range input.Recipients {
		address := strings.TrimSpace(raw)
		parsed, err := mail.ParseAddress(address)
		if err != nil || parsed.Address != address || strings.ContainsAny(address, "\r\n;,") || len(address) > 254 {
			return nil, errors.New("请填写有效的邮箱地址，每个邮箱单独填写")
		}
		key := strings.ToLower(address)
		if !unique[key] {
			recipients = append(recipients, address)
			unique[key] = true
		}
	}
	if requireRecipients && len(recipients) == 0 {
		return nil, errors.New("请至少填写一个收件邮箱")
	}
	sort.Strings(recipients)
	input.Recipients = recipients
	user, err := model.GetUserById(input.UserID, false)
	if err != nil {
		return nil, errors.New("客户不存在，请刷新列表")
	}
	if user.Group != input.Group || user.Role != common.RoleCommonUser {
		return nil, errors.New("请选择当前分组内的普通客户账号")
	}
	return user, nil
}

func NewB2BAlertRule(input B2BAlertInput, adminID int) model.B2BBalanceAlert {
	recipients, _ := common.Marshal(input.Recipients)
	return model.B2BBalanceAlert{UserID: input.UserID, GroupName: input.Group, Enabled: input.Enabled, ThresholdQuota: input.ThresholdQuota, RecipientsJSON: string(recipients), UpdatedBy: adminID}
}

type balanceAlertSender func(subject, recipient, body string) error

func sendB2BAlertEmail(subject, recipient, body string) error {
	return common.SendEmailWithTimeout(subject, recipient, body, balanceAlertEmailTimeout)
}

func balanceAlertMessage(rule model.B2BBalanceAlert, user *model.User, test bool) (string, string) {
	groupName := rule.GroupName
	var option model.Option
	if model.DB.Where(&model.Option{Key: "B2BGroupLabels"}).First(&option).Error == nil {
		labels := map[string]string{}
		if common.UnmarshalJsonStr(option.Value, &labels) == nil && labels[rule.GroupName] != "" {
			groupName = labels[rule.GroupName] + " (" + rule.GroupName + ")"
		}
	}
	title := fmt.Sprintf("AnyRouters 余额提醒 · AR%06d", user.Id)
	intro := "该客户的账户余额已低于提醒阈值，请核对用量并安排续额。"
	if test {
		title = "[测试] " + title
		intro = "这是测试邮件，用于确认提醒能否收到，不表示余额已低于阈值。测试不会开启提醒或调整额度。"
	}
	body := fmt.Sprintf("<p>%s</p><p>客户：AR%06d · %s<br>分组：%s<br>当前余额：$%.2f<br>提醒阈值：$%.2f<br>累计用量：$%.2f</p><p>上述金额为该账户所有 API Key 的合计；累计用量不是本月账单。</p><p><a href=\"%s\">查看 B 端客户</a></p>", intro, user.Id, html.EscapeString(user.DisplayName), html.EscapeString(groupName), float64(user.Quota)/common.QuotaPerUnit, float64(rule.ThresholdQuota)/common.QuotaPerUnit, float64(user.UsedQuota)/common.QuotaPerUnit, html.EscapeString(PaymentReturnURL("/btob")))
	return title, body
}

type B2BAlertTestResult struct {
	Sent   []string `json:"sent"`
	Failed []string `json:"failed"`
}

func SendB2BAlertTest(rule model.B2BBalanceAlert, user *model.User) B2BAlertTestResult {
	return sendB2BAlertTestWith(rule, user, sendB2BAlertEmail)
}

func sendB2BAlertTestWith(rule model.B2BBalanceAlert, user *model.User, send balanceAlertSender) B2BAlertTestResult {
	result := B2BAlertTestResult{Sent: []string{}, Failed: []string{}}
	title, body := balanceAlertMessage(rule, user, true)
	recipients := B2BAlertToView(rule).Recipients
	accepted := make([]bool, len(recipients))
	var wg sync.WaitGroup
	slots := make(chan struct{}, 3)
	for index, address := range recipients {
		wg.Add(1)
		go func(index int, address string) {
			defer wg.Done()
			slots <- struct{}{}
			defer func() { <-slots }()
			accepted[index] = send(title, address, body) == nil
		}(index, address)
	}
	wg.Wait()
	for index, address := range recipients {
		if accepted[index] {
			result.Sent = append(result.Sent, address)
		} else {
			result.Failed = append(result.Failed, address)
		}
	}
	return result
}

func StartB2BBalanceAlertTask() {
	balanceAlertOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		go func() {
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			for range ticker.C {
				if err := runB2BBalanceAlerts(time.Now().Unix(), sendB2BAlertEmail); err != nil {
					common.SysError("B2B balance reminder check failed: " + err.Error())
				}
			}
		}()
	})
}

func runB2BBalanceAlerts(now int64, send balanceAlertSender) error {
	afterID := 0
	started := time.Now()
	for {
		rules, err := model.ListDueB2BBalanceAlerts(afterID, now)
		if err != nil {
			return err
		}
		for _, rule := range rules {
			afterID = rule.UserID
			if err := checkB2BBalanceAlert(rule, now+int64(time.Since(started).Seconds()), send); err != nil {
				common.SysError(fmt.Sprintf("B2B balance reminder failed for user %d: %v", rule.UserID, err))
			}
		}
		if len(rules) < 200 {
			return nil
		}
	}
}

func checkB2BBalanceAlert(rule model.B2BBalanceAlert, now int64, send balanceAlertSender) error {
	claimed, err := model.ClaimB2BBalanceAlert(&rule, now)
	if err != nil || !claimed {
		return err
	}
	finish := map[string]interface{}{"lease_token": "", "lease_until": 0, "last_checked_at": now, "next_attempt_at": rule.NextAttemptAt}
	defer func() {
		if err := model.UpdateClaimedB2BBalanceAlert(&rule, finish); err != nil {
			common.SysError(fmt.Sprintf("B2B reminder state save failed for user %d: %v", rule.UserID, err))
		}
	}()
	user, err := model.GetUserById(rule.UserID, false)
	if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && (user.Group != rule.GroupName || user.Role != common.RoleCommonUser)) {
		finish["enabled"] = false
		return nil
	}
	if err != nil {
		return err
	}
	finish["last_balance_quota"] = user.Quota
	if user.Status != common.UserStatusEnabled {
		return nil
	}
	if int64(user.Quota) >= rule.ThresholdQuota {
		finish["delivered_json"] = "[]"
		finish["delivery_failed"] = false
		finish["next_attempt_at"] = 0
		return nil
	}
	if rule.NextAttemptAt > now {
		return nil
	}
	delivered := []string{}
	if rule.DeliveredJSON != "" {
		if err := common.UnmarshalJsonStr(rule.DeliveredJSON, &delivered); err != nil {
			return err
		}
	}
	recipients := B2BAlertToView(rule).Recipients
	if len(recipients) == 0 {
		return errors.New("enabled reminder has no recipients")
	}
	sent := make(map[string]bool)
	for _, address := range delivered {
		sent[address] = true
	}
	title, body := balanceAlertMessage(rule, user, false)
	failed := false
	startedSending := time.Now()
	for _, address := range recipients {
		if sent[address] {
			continue
		}
		if err := model.RenewB2BBalanceAlertLease(&rule, now+int64(time.Since(startedSending).Seconds())); err != nil {
			return err
		}
		if err := send(title, address, body); err != nil {
			failed = true
			continue
		}
		delivered = append(delivered, address)
		data, err := common.Marshal(delivered)
		if err != nil {
			return err
		}
		// Persist each accepted SMTP delivery immediately, before the next recipient.
		if err := model.UpdateClaimedB2BBalanceAlert(&rule, map[string]interface{}{"delivered_json": string(data), "last_notified_at": now}); err != nil {
			return err
		}
	}
	finish["next_attempt_at"] = 0
	finish["delivery_failed"] = failed
	if failed {
		finish["next_attempt_at"] = now + 300
	}
	return nil
}
