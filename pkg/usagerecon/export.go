package usagerecon

import (
	"fmt"
	"io"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// ExportParams collects everything the export subcommand needs.
type ExportParams struct {
	DBType     string // sqlite | mysql | postgres
	DSN        string
	From       time.Time // inclusive, already in the export timezone
	To         time.Time // exclusive
	Location   *time.Location
	ChannelMap *ChannelMap
	BatchSize  int
}

// Manifest documents one export run so it can be audited and reproduced.
type Manifest struct {
	ToolVersion  string   `json:"tool_version"`
	GeneratedAt  string   `json:"generated_at"`
	Timezone     string   `json:"timezone"`
	FromUnix     int64    `json:"from_unix"`
	ToUnix       int64    `json:"to_unix"`
	From         string   `json:"from"`
	To           string   `json:"to"`
	LogsScanned  int64    `json:"logs_scanned"`
	MaxLogId     int      `json:"max_log_id"`
	RowsExported int      `json:"rows_exported"`
	Notes        []string `json:"notes"`
}

const ToolVersion = "usagetool/1.1.0"

// OpenDB opens a read-only-usage connection with the same drivers the main
// application uses, without touching the model package.
func OpenDB(dbType, dsn string) (*gorm.DB, error) {
	cfg := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	switch dbType {
	case "sqlite":
		return gorm.Open(sqlite.Open(dsn), cfg)
	case "mysql":
		return gorm.Open(mysql.Open(dsn), cfg)
	case "postgres":
		return gorm.Open(postgres.Open(dsn), cfg)
	default:
		return nil, fmt.Errorf("unsupported db type %q (want sqlite, mysql or postgres)", dbType)
	}
}

// RunExport scans the logs table in id order and writes the canonical CSV to
// csvOut and the manifest JSON to manifestOut.
func RunExport(db *gorm.DB, params ExportParams, csvOut, manifestOut io.Writer) (*Manifest, error) {
	if params.BatchSize <= 0 {
		params.BatchSize = 5000
	}
	loc := params.Location
	if loc == nil {
		loc = time.UTC
	}
	agg := NewAggregator(loc)

	fromUnix := params.From.Unix()
	toUnix := params.To.Unix()
	var scanned int64
	maxId := 0
	lastId := 0
	for {
		var batch []LogRow
		err := db.Table("logs").
			Select("id, created_at, type, model_name, quota, prompt_tokens, completion_tokens, is_stream, channel_id, other").
			Where("created_at >= ? AND created_at < ? AND type IN (?) AND id > ?",
				fromUnix, toUnix, []int{LogTypeConsume, LogTypeError, LogTypeRefund}, lastId).
			Order("id").
			Limit(params.BatchSize).
			Find(&batch).Error
		if err != nil {
			return nil, fmt.Errorf("scan logs: %w", err)
		}
		if len(batch) == 0 {
			break
		}
		for i := range batch {
			agg.Add(&batch[i])
			scanned++
		}
		lastId = batch[len(batch)-1].Id
		if lastId > maxId {
			maxId = lastId
		}
	}

	rows := agg.Rows()
	if err := WriteCanonicalCSV(csvOut, rows, params.ChannelMap); err != nil {
		return nil, fmt.Errorf("write csv: %w", err)
	}

	manifest := &Manifest{
		ToolVersion:  ToolVersion,
		GeneratedAt:  time.Now().UTC().Format(time.RFC3339),
		Timezone:     loc.String(),
		FromUnix:     fromUnix,
		ToUnix:       toUnix,
		From:         params.From.Format("2006-01-02"),
		To:           params.To.Format("2006-01-02"),
		LogsScanned:  scanned,
		MaxLogId:     maxId,
		RowsExported: len(rows),
		Notes: []string{
			"requests_error_logged 依赖生产环境 ERROR_LOG_ENABLED=true；默认 false 时失败请求不落库，该列恒为 0（见 docs/metering-audit/01 §7）",
			"rows_local_estimated / rows_zero_usage 是打标覆盖范围内的下界，存在不打标的本地估算路径（见 docs/metering-audit/01 §6）",
			"quota 为站内原始整数额度；amount_usd = quota / 500000，仅为展示换算",
		},
	}
	data, err := common.Marshal(manifest)
	if err != nil {
		return nil, err
	}
	if _, err := manifestOut.Write(append(data, '\n')); err != nil {
		return nil, err
	}
	return manifest, nil
}
