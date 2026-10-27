package model

import (
	"errors"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// One independently configured reminder per customer. No wallet or token
// balances are changed by this table or its worker.
type B2BBalanceAlert struct {
	UserID         int    `json:"user_id" gorm:"primaryKey;autoIncrement:false"`
	GroupName      string `json:"group" gorm:"size:64;not null;index"`
	Enabled        bool   `json:"enabled" gorm:"not null;default:false"`
	ThresholdQuota int64  `json:"threshold_quota" gorm:"not null"`
	RecipientsJSON string `json:"-" gorm:"type:text;not null"`
	Revision       int64  `json:"revision" gorm:"not null;default:1"`
	UpdatedAt      int64  `json:"updated_at" gorm:"autoUpdateTime:false"`
	UpdatedBy      int    `json:"updated_by"`
	// DeliveredJSON survives restarts and tracks each recipient separately, so a
	// failed recipient can be retried without re-sending to successful recipients.
	DeliveredJSON    string `json:"-" gorm:"type:text"`
	LastCheckedAt    int64  `json:"last_checked_at"`
	LastNotifiedAt   int64  `json:"last_notified_at"`
	LastBalanceQuota int64  `json:"last_balance_quota"`
	DeliveryFailed   bool   `json:"delivery_failed" gorm:"not null;default:false"`
	NextAttemptAt    int64  `json:"-"`
	LeaseUntil       int64  `json:"-" gorm:"not null;default:0"`
	LeaseToken       string `json:"-" gorm:"size:40"`
}

var ErrBalanceAlertBusy = errors.New("reminder is currently sending; please try again shortly")
var ErrBalanceAlertConflict = errors.New("reminder was changed; refresh and try again")

func GetB2BBalanceAlerts(group string) ([]B2BBalanceAlert, error) {
	rules := make([]B2BBalanceAlert, 0)
	err := DB.Where("user_id IN (?)", DB.Model(&User{}).Select("id").Where(map[string]interface{}{"group": group})).Order("user_id").Find(&rules).Error
	return rules, err
}

// Optimistic versioning prevents one open admin form from overwriting another.
// Active sends own a short, bounded lease, also used across application replicas.
func SaveB2BBalanceAlert(rule *B2BBalanceAlert, expectedRevision int64) error {
	now := time.Now().Unix()
	return DB.Transaction(func(tx *gorm.DB) error {
		var old B2BBalanceAlert
		err := tx.First(&old, "user_id = ?", rule.UserID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if expectedRevision != 0 {
				return ErrBalanceAlertConflict
			}
			rule.Revision, rule.UpdatedAt = 1, now
			rule.DeliveredJSON = "[]"
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(rule)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				return ErrBalanceAlertConflict
			}
			return nil
		}
		if err != nil {
			return err
		}
		if old.Revision != expectedRevision {
			return ErrBalanceAlertConflict
		}
		if old.LeaseUntil > now {
			return ErrBalanceAlertBusy
		}
		changes := map[string]interface{}{
			"group_name": rule.GroupName, "enabled": rule.Enabled,
			"threshold_quota": rule.ThresholdQuota, "recipients_json": rule.RecipientsJSON,
			"revision": old.Revision + 1, "updated_at": now, "updated_by": rule.UpdatedBy,
			"next_attempt_at": 0,
		}
		if old.GroupName != rule.GroupName || old.ThresholdQuota != rule.ThresholdQuota || old.RecipientsJSON != rule.RecipientsJSON {
			changes["delivered_json"] = "[]"
			changes["delivery_failed"] = false
		}
		result := tx.Model(&B2BBalanceAlert{}).Where("user_id = ? AND revision = ? AND lease_until <= ?", rule.UserID, old.Revision, now).Updates(changes)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrBalanceAlertConflict
		}
		return nil
	})
}

func ListDueB2BBalanceAlerts(afterID int, now int64) ([]B2BBalanceAlert, error) {
	var rules []B2BBalanceAlert
	err := DB.Where("enabled = ? AND user_id > ? AND lease_until <= ?", true, afterID, now).Order("user_id").Limit(200).Find(&rules).Error
	return rules, err
}

func ClaimB2BBalanceAlert(rule *B2BBalanceAlert, now int64) (bool, error) {
	token := common.GetRandomString(32)
	result := DB.Model(&B2BBalanceAlert{}).Where("user_id = ? AND revision = ? AND enabled = ? AND lease_until <= ?", rule.UserID, rule.Revision, true, now).Updates(map[string]interface{}{"lease_token": token, "lease_until": now + 300})
	if result.Error != nil || result.RowsAffected == 0 {
		return false, result.Error
	}
	// A second worker may have read this rule before another worker completed
	// and released it. Refresh the delivery state only after claiming the lease.
	var current B2BBalanceAlert
	if err := DB.Where("user_id = ? AND lease_token = ?", rule.UserID, token).First(&current).Error; err != nil {
		return false, err
	}
	*rule = current
	return true, nil
}

func UpdateClaimedB2BBalanceAlert(rule *B2BBalanceAlert, values map[string]interface{}) error {
	result := DB.Model(&B2BBalanceAlert{}).Where("user_id = ? AND revision = ? AND lease_token = ?", rule.UserID, rule.Revision, rule.LeaseToken).Updates(values)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrBalanceAlertConflict
	}
	return nil
}

// Refresh before each network send. A worker that stalled past its lease must
// stop instead of racing the replica that is recovering the abandoned work.
func RenewB2BBalanceAlertLease(rule *B2BBalanceAlert, now int64) error {
	token := common.GetRandomString(32)
	result := DB.Model(&B2BBalanceAlert{}).Where("user_id = ? AND revision = ? AND enabled = ? AND lease_token = ? AND lease_until > ?", rule.UserID, rule.Revision, true, rule.LeaseToken, now).Updates(map[string]interface{}{"lease_until": now + 300, "lease_token": token})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrBalanceAlertConflict
	}
	rule.LeaseToken = token
	return nil
}
