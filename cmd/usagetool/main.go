// usagetool is the phase-1 offline metering CLI:
//
//	usagetool export    — read-only daily usage export from the logs table
//	usagetool reconcile — offline diff between the site export and a
//	                      desensitized Azure export (no database access)
//
// See docs/metering-audit/02-导出与对账工具设计.md for the full design.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/QuantumNous/new-api/pkg/usagerecon"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "export":
		err = runExport(os.Args[2:])
	case "reconcile":
		err = runReconcile(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `usage:
  usagetool export --db-type sqlite|mysql|postgres --dsn <dsn> \
      --from 2026-08-01 --to 2026-09-01 [--tz UTC] \
      [--channel-map channel_map.yaml] --out site_daily.csv
  usagetool reconcile --site site_daily.csv --azure azure_export.csv \
      --mapping azure_mapping.yaml [--threshold 0.03] --out report_dir`)
}

func runExport(args []string) error {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	dbType := fs.String("db-type", "sqlite", "database type: sqlite, mysql or postgres")
	dsn := fs.String("dsn", "", "database DSN (sqlite file path, mysql/postgres connection string)")
	from := fs.String("from", "", "start date, inclusive (YYYY-MM-DD, in --tz)")
	to := fs.String("to", "", "end date, exclusive (YYYY-MM-DD, in --tz)")
	tz := fs.String("tz", "UTC", "IANA timezone for day boundaries (Azure reconciliation should stay UTC)")
	channelMapPath := fs.String("channel-map", "", "optional channel_map.yaml (channel id -> account/resource/deployment labels)")
	out := fs.String("out", "site_daily.csv", "output CSV path; a .manifest.json is written next to it")
	batch := fs.Int("batch", 5000, "scan batch size")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *dsn == "" || *from == "" || *to == "" {
		fs.Usage()
		return fmt.Errorf("--dsn, --from and --to are required")
	}
	loc, err := time.LoadLocation(*tz)
	if err != nil {
		return fmt.Errorf("invalid --tz %q: %w", *tz, err)
	}
	fromT, err := time.ParseInLocation("2006-01-02", *from, loc)
	if err != nil {
		return fmt.Errorf("invalid --from: %w", err)
	}
	toT, err := time.ParseInLocation("2006-01-02", *to, loc)
	if err != nil {
		return fmt.Errorf("invalid --to: %w", err)
	}
	if !toT.After(fromT) {
		return fmt.Errorf("--to must be after --from")
	}
	channelMap, err := usagerecon.LoadChannelMap(*channelMapPath)
	if err != nil {
		return fmt.Errorf("load channel map: %w", err)
	}

	db, err := usagerecon.OpenDB(*dbType, *dsn)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}

	csvFile, err := os.Create(*out)
	if err != nil {
		return err
	}
	defer csvFile.Close()
	manifestPath := manifestPathFor(*out)
	manifestFile, err := os.Create(manifestPath)
	if err != nil {
		return err
	}
	defer manifestFile.Close()

	manifest, err := usagerecon.RunExport(db, usagerecon.ExportParams{
		DBType:     *dbType,
		DSN:        *dsn,
		From:       fromT,
		To:         toT,
		Location:   loc,
		ChannelMap: channelMap,
		BatchSize:  *batch,
	}, csvFile, manifestFile)
	if err != nil {
		return err
	}
	fmt.Printf("exported %d daily rows from %d log rows -> %s (manifest: %s)\n",
		manifest.RowsExported, manifest.LogsScanned, *out, manifestPath)
	return nil
}

func runReconcile(args []string) error {
	fs := flag.NewFlagSet("reconcile", flag.ExitOnError)
	sitePath := fs.String("site", "", "site daily CSV (canonical format from `usagetool export`)")
	azurePath := fs.String("azure", "", "desensitized Azure export CSV")
	mappingPath := fs.String("mapping", "", "azure_mapping.yaml (column mapping, meter rules)")
	threshold := fs.Float64("threshold", 0.03, "diff-rate alert threshold (0.03 = 3%)")
	outDir := fs.String("out", "reconcile_report", "output directory")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *sitePath == "" || *azurePath == "" || *mappingPath == "" {
		fs.Usage()
		return fmt.Errorf("--site, --azure and --mapping are required")
	}
	mapping, err := usagerecon.LoadAzureMapping(*mappingPath)
	if err != nil {
		return err
	}
	siteFile, err := os.Open(*sitePath)
	if err != nil {
		return err
	}
	defer siteFile.Close()
	site, err := usagerecon.LoadSiteCSV(siteFile, mapping.SiteKey)
	if err != nil {
		return fmt.Errorf("load site csv: %w", err)
	}
	azureFile, err := os.Open(*azurePath)
	if err != nil {
		return err
	}
	defer azureFile.Close()
	azure, skipped, err := usagerecon.LoadAzureCSV(azureFile, mapping)
	if err != nil {
		return fmt.Errorf("load azure csv: %w", err)
	}

	result := usagerecon.Reconcile(site, azure, skipped, *threshold, time.Now().UTC())

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		return err
	}
	reportPath := filepath.Join(*outDir, "reconcile_report.csv")
	reportFile, err := os.Create(reportPath)
	if err != nil {
		return err
	}
	defer reportFile.Close()
	if err := usagerecon.WriteDiffCSV(reportFile, result); err != nil {
		return err
	}
	summaryPath := filepath.Join(*outDir, "reconcile_summary.md")
	summaryFile, err := os.Create(summaryPath)
	if err != nil {
		return err
	}
	defer summaryFile.Close()
	if err := usagerecon.WriteSummaryMarkdown(summaryFile, result); err != nil {
		return err
	}
	fmt.Printf("reconciled %d diff lines (%d over ±%.1f%%) -> %s, %s\n",
		len(result.Rows), result.OverThreshold, *threshold*100, reportPath, summaryPath)
	return nil
}

func manifestPathFor(csvPath string) string {
	ext := filepath.Ext(csvPath)
	return csvPath[:len(csvPath)-len(ext)] + ".manifest.json"
}
