package main

import (
	"encoding/base64"
	"fmt"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	"os"
)

type Row struct {
	ID     int     `json:"id"`
	Model  string  `json:"model"`
	Input  float64 `json:"input"`
	Output float64 `json:"output"`
	Quota  int     `json:"quota"`
	Fields struct {
		Expression string  `json:"expr_b64"`
		Group      float64 `json:"group_ratio"`
		Cached     float64 `json:"cache_tokens"`
		Write      float64 `json:"cache_creation_tokens"`
		Tier       string  `json:"matched_tier"`
	} `json:"fields"`
}

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: go run recompute.go /private/site-rows.json")
		os.Exit(2)
	}
	data, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	var rows []Row
	if err = common.Unmarshal(data, &rows); err != nil {
		panic(err)
	}
	checked, exact := 0, 0
	var differences []map[string]interface{}
	for _, r := range rows {
		switch r.Model {
		case "gpt-5.6-sol", "gpt-6-astra", "gpt-5.6-luna", "codex-auto-review", "gpt-5.6-terra", "gpt-5.5":
		default:
			continue
		}
		raw, e := base64.StdEncoding.DecodeString(r.Fields.Expression)
		if e != nil {
			panic(e)
		}
		expression := string(raw)
		vars := billingexpr.UsedVars(expression)
		prompt := r.Input
		if vars["cr"] {
			prompt -= r.Fields.Cached
		}
		if vars["cc"] {
			prompt -= r.Fields.Write
		}
		if prompt < 0 {
			prompt = 0
		}
		snapshot := billingexpr.BillingSnapshot{BillingMode: "tiered_expr", ModelName: r.Model, ExprString: expression, ExprHash: billingexpr.ExprHashString(expression), GroupRatio: r.Fields.Group, EstimatedTier: r.Fields.Tier, QuotaPerUnit: 500000, ExprVersion: 1}
		result, e := billingexpr.ComputeTieredQuota(&snapshot, billingexpr.TokenParams{P: prompt, C: r.Output, Len: r.Input, CR: r.Fields.Cached, CC: r.Fields.Write})
		if e != nil {
			panic(e)
		}
		checked++
		if result.ActualQuotaAfterGroup == r.Quota && result.MatchedTier == r.Fields.Tier {
			exact++
		} else {
			differences = append(differences, map[string]interface{}{"id": r.ID, "model": r.Model, "quota": r.Quota, "recomputed": result.ActualQuotaAfterGroup, "tier": result.MatchedTier})
		}
	}
	out, e := common.Marshal(map[string]interface{}{"checked": checked, "exact": exact, "differences": differences})
	if e != nil {
		panic(e)
	}
	fmt.Println(string(out))
}
