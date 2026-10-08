package model

import (
	"context"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUserMonthlyUsageIsolationAndBoundaries(t *testing.T) {
	originalDB, originalLog := DB, LOG_DB
	t.Cleanup(func() { DB, LOG_DB = originalDB, originalLog })
	var err error
	DB, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	LOG_DB, err = gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	for _, db := range []*gorm.DB{DB, LOG_DB} {
		sqlDB, e := db.DB()
		require.NoError(t, e)
		sqlDB.SetMaxOpenConns(1)
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	require.NoError(t, DB.AutoMigrate(&User{}, &Channel{}))
	require.NoError(t, LOG_DB.AutoMigrate(&Log{}))
	require.NoError(t, DB.Create(&User{Id: 31, Username: "monthly-fixture", DisplayName: "Test User"}).Error)
	require.NoError(t, DB.Create(&Channel{Id: 3, Name: "Azure fixture"}).Error)
	instant := func(s string) int64 { tm, e := time.Parse(time.RFC3339, s); require.NoError(t, e); return tm.Unix() }
	rows := []Log{
		{UserId: 31, CreatedAt: instant("2026-08-31T15:59:59Z"), Type: LogTypeConsume, ChannelId: 3, Quota: 1},
		{UserId: 31, CreatedAt: instant("2026-08-31T16:00:00Z"), Type: LogTypeConsume, ChannelId: 3, Quota: 1500000000},
		{UserId: 31, CreatedAt: instant("2026-09-30T15:59:59Z"), Type: LogTypeConsume, ChannelId: 3, Quota: 1500000000},
		{UserId: 31, CreatedAt: instant("2026-09-30T16:00:00Z"), Type: LogTypeRefund, ChannelId: 3, Quota: 250000},
		{UserId: 31, CreatedAt: instant("2026-09-05T00:00:00Z"), Type: LogTypeConsume, ChannelId: 999, Quota: 2},
		{UserId: 32, CreatedAt: instant("2026-09-05T00:00:00Z"), Type: LogTypeConsume, ChannelId: 3, Quota: 2000000},
		{UserId: 31, CreatedAt: instant("2026-09-05T00:00:00Z"), Type: LogTypeError, ChannelId: 3, Quota: 900000},
		{UserId: 31, CreatedAt: instant("2026-09-05T00:00:00Z"), Type: LogTypeTopup, Quota: 900000},
		{UserId: 31, CreatedAt: instant("2026-10-09T00:00:00Z"), Type: LogTypeConsume, ChannelId: 3, Quota: 500000},
	}
	require.NoError(t, LOG_DB.Create(&rows).Error)
	now := time.Unix(instant("2026-10-08T03:00:00Z"), 0)
	report, err := GetUserMonthlyUsage(context.Background(), 31, 2026, now)
	require.NoError(t, err)
	require.Equal(t, 31, report.UserID)
	require.Len(t, report.Months, 10)
	require.Equal(t, "0", report.Months[0].NetUSD)
	require.Empty(t, report.Months[0].Channels)
	require.Equal(t, "0.000002", report.Months[7].NetUSD)
	sept := report.Months[8]
	require.Equal(t, "6000.000004", sept.ConsumeUSD)
	require.EqualValues(t, 3, sept.ConsumeRecords)
	require.Len(t, sept.Channels, 2)
	require.Equal(t, "Azure fixture", sept.Channels[0].ChannelName)
	require.Equal(t, 999, sept.Channels[1].ChannelID)
	require.Empty(t, sept.Channels[1].ChannelName)
	require.Equal(t, "-0.5", report.Months[9].NetUSD)
	require.True(t, report.Months[9].InProgress)
	require.Equal(t, "5999.500006", report.Total.NetUSD)
	require.EqualValues(t, 4, report.Total.ConsumeRecords)
	for _, year := range []int{1999, 2027} {
		_, err = GetUserMonthlyUsage(context.Background(), 31, year, now)
		require.Error(t, err)
	}
	_, err = GetUserMonthlyUsage(context.Background(), 999, 2026, now)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.NoError(t, LOG_DB.Create(&Log{UserId: 31, CreatedAt: instant("2026-09-05T00:00:00Z"), Type: LogTypeConsume, Quota: -1}).Error)
	_, err = GetUserMonthlyUsage(context.Background(), 31, 2026, now)
	require.Error(t, err)
}
