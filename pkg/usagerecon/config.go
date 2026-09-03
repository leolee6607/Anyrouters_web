package usagerecon

import (
	"fmt"
	"os"
	"regexp"

	"gopkg.in/yaml.v3"
)

// AzureMapping describes how to read an operator-provided Azure export.
// Column names are never hardcoded: EA / MCA / legacy PAYG / FOCUS exports all
// use different headers, so everything is driven by this document.
type AzureMapping struct {
	// Format is "wide" (one row already carries token columns, e.g. a shaped
	// Azure Monitor export) or "meter_long" (one meter per row, e.g. a Cost
	// Management CSV, where MeterName decides the token direction).
	Format string `yaml:"format"`

	DateColumn  string   `yaml:"date_column"`
	DateFormats []string `yaml:"date_formats"`

	// KeyColumn joins against the site side (deployment recommended: Azure
	// Monitor token metrics only carry ModelDeploymentName, not ModelName).
	KeyColumn string `yaml:"key_column"`
	// SiteKey names the canonical CSV column used as the site-side join key:
	// "deployment" (default), "model_upstream" or "azure_resource".
	SiteKey string `yaml:"site_key"`

	Columns struct {
		InputTokens     string `yaml:"input_tokens"`
		OutputTokens    string `yaml:"output_tokens"`
		CacheReadTokens string `yaml:"cache_read_tokens"`
		Requests        string `yaml:"requests"`
		Quantity        string `yaml:"quantity"`
		MeterName       string `yaml:"meter_name"`
		Cost            string `yaml:"cost"`
		ChargeType      string `yaml:"charge_type"`
	} `yaml:"columns"`

	// UnitScale converts one unit of Quantity into tokens (Cost meters are
	// commonly billed per 1M tokens; older ones per 1K).
	UnitScale float64 `yaml:"unit_scale"`

	MeterRules []MeterRule `yaml:"meter_rules"`
}

// MeterRule classifies a meter row into a token direction.
type MeterRule struct {
	Match     string `yaml:"match"`
	Direction string `yaml:"direction"` // input | output | cache_read
	compiled  *regexp.Regexp
}

func (m *AzureMapping) Validate() error {
	switch m.Format {
	case "wide", "meter_long":
	default:
		return fmt.Errorf("mapping: format must be \"wide\" or \"meter_long\", got %q", m.Format)
	}
	if m.DateColumn == "" {
		return fmt.Errorf("mapping: date_column is required")
	}
	if m.KeyColumn == "" {
		return fmt.Errorf("mapping: key_column is required")
	}
	if len(m.DateFormats) == 0 {
		m.DateFormats = []string{"2006-01-02", "01/02/2006", "2006-01-02T15:04:05Z"}
	}
	if m.SiteKey == "" {
		m.SiteKey = "deployment"
	}
	switch m.SiteKey {
	case "deployment", "model_upstream", "azure_resource":
	default:
		return fmt.Errorf("mapping: site_key must be deployment, model_upstream or azure_resource")
	}
	if m.UnitScale == 0 {
		m.UnitScale = 1
	}
	if m.Format == "meter_long" {
		if m.Columns.Quantity == "" || m.Columns.MeterName == "" {
			return fmt.Errorf("mapping: meter_long format requires columns.quantity and columns.meter_name")
		}
		if len(m.MeterRules) == 0 {
			return fmt.Errorf("mapping: meter_long format requires meter_rules")
		}
		for i := range m.MeterRules {
			rule := &m.MeterRules[i]
			re, err := regexp.Compile(rule.Match)
			if err != nil {
				return fmt.Errorf("mapping: meter_rules[%d].match: %w", i, err)
			}
			switch rule.Direction {
			case "input", "output", "cache_read":
			default:
				return fmt.Errorf("mapping: meter_rules[%d].direction must be input, output or cache_read", i)
			}
			rule.compiled = re
		}
	}
	return nil
}

func LoadAzureMapping(path string) (*AzureMapping, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m AzureMapping
	if err := yaml.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	if err := m.Validate(); err != nil {
		return nil, err
	}
	return &m, nil
}

func LoadChannelMap(path string) (*ChannelMap, error) {
	if path == "" {
		return &ChannelMap{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var m ChannelMap
	if err := yaml.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return &m, nil
}
