package cmd

import (
	"encoding/json"
	"fmt"
	"runtime"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/wantguns/unfold/api"
)

var InvestmentsCmd = &cobra.Command{
	Use:   "investments",
	Short: "Prints a summary of your mutual funds, stocks (demat), EPF, NPS, PPF, and fixed deposits",
	Run:   investmentsCmdHandler,
}

func init() {
	InvestmentsCmd.Flags().Bool("json", false, "Print machine-readable JSON instead of plaintext (used by fold-mcp)")
}

// investmentsJSON is the single combined payload fold-mcp's `investments --json` bridge
// parses. Everything the 12 MCP tools need lives in here so a single CLI invocation is
// enough — no per-tool subcommand/exec round trip.
type investmentsJSON struct {
	Summary struct {
		MutualFundsTotal float64 `json:"mutual_funds_total"`
		StocksTotal      float64 `json:"stocks_total"`
		EPFTotal         float64 `json:"epf_total"`
		NPSTotal         float64 `json:"nps_total"`
		FixedDeposits    float64 `json:"fixed_deposits_total"`
		PortfolioNetWorth float64 `json:"portfolio_net_worth"`
	} `json:"summary"`
	MutualFunds       *api.MutualFundsResponse       `json:"mutual_funds,omitempty"`
	Stocks            []stockHoldingWithDetail       `json:"stocks,omitempty"`
	EPF               *epfCombined                   `json:"epf,omitempty"`
	NPS               *api.NPSAccountsResponse       `json:"nps,omitempty"`
	PPF               *api.PPFAccountsResponse       `json:"ppf,omitempty"`
	FixedDepositsActive   *api.FixedDepositsResponse `json:"fixed_deposits_active,omitempty"`
	FixedDepositsArchived *api.FixedDepositsResponse `json:"fixed_deposits_archived,omitempty"`
	NetWorth30d       *api.NetWorthGraphResponse     `json:"net_worth_30d,omitempty"`
	MFRefreshStatus   *api.MFRefreshStatusResponse   `json:"mf_refresh_status,omitempty"`
	Errors            []string                       `json:"errors,omitempty"`
}

type stockHoldingWithDetail struct {
	api.DematHolding
	Name     string `json:"name,omitempty"`
	Symbol   string `json:"symbol,omitempty"`
	Exchange string `json:"exchange,omitempty"`
}

type epfCombined struct {
	Account   api.EPFAccountResponse   `json:"account"`
	Passbooks *api.EPFPassbooksResponse `json:"passbooks,omitempty"`
}

func investmentsCmdHandler(cmd *cobra.Command, args []string) {
	uuid := viper.GetString("fold_user.uuid")
	asJSON, _ := cmd.Flags().GetBool("json")

	out := investmentsJSON{}

	agg, err := api.InvestmentsAggregation(uuid)
	if err != nil {
		log.Error().Err(err).Msg("Fetch investments aggregation: ")
		runtime.Goexit()
	}
	out.Summary.MutualFundsTotal = agg.Data.MutualFundStats.TotalCurrentValue
	out.Summary.StocksTotal = agg.Data.DematHoldings.TotalValue
	out.Summary.NPSTotal = agg.Data.NPSStats.TotalValue
	out.Summary.PortfolioNetWorth = agg.Data.PortfolioNetWorth

	epfAccount, err := api.EPFAccount(uuid)
	if err != nil {
		out.Errors = append(out.Errors, "epf account: "+err.Error())
	} else {
		combined := epfCombined{Account: epfAccount}
		if epfAccount.Data.Account.UUID != "" {
			passbooks, err := api.EPFPassbooks(uuid, epfAccount.Data.Account.UUID)
			if err != nil {
				out.Errors = append(out.Errors, "epf passbooks: "+err.Error())
			} else {
				combined.Passbooks = &passbooks
				out.Summary.EPFTotal = passbooks.Data.Summary.TotalBalance
			}
		}
		out.EPF = &combined
	}

	mf, err := api.MutualFunds(uuid)
	if err != nil {
		out.Errors = append(out.Errors, "mutual funds: "+err.Error())
	} else {
		out.MutualFunds = &mf
	}

	demat, err := api.DematHoldings(uuid)
	if err != nil {
		out.Errors = append(out.Errors, "demat holdings: "+err.Error())
	} else {
		for _, h := range demat.Data.Holdings {
			detail := stockHoldingWithDetail{DematHolding: h}
			if isin, err := api.ISINDetail(h.ISINID); err == nil {
				detail.Name = isin.Data.Name
				detail.Symbol = isin.Data.Symbol
				detail.Exchange = isin.Data.Exchange
			}
			out.Stocks = append(out.Stocks, detail)
		}
	}

	if nps, err := api.NPSAccounts(uuid); err != nil {
		out.Errors = append(out.Errors, "nps: "+err.Error())
	} else {
		out.NPS = &nps
	}

	if ppf, err := api.PPFAccounts(uuid); err != nil {
		out.Errors = append(out.Errors, "ppf: "+err.Error())
	} else {
		out.PPF = &ppf
	}

	if fdActive, err := api.FixedDeposits(uuid, "ACTIVE"); err != nil {
		out.Errors = append(out.Errors, "fixed deposits (active): "+err.Error())
	} else {
		out.FixedDepositsActive = &fdActive
		out.Summary.FixedDeposits = fdActive.Data.Stats.TotalMaturityAmount
	}

	if fdArchived, err := api.FixedDeposits(uuid, "ARCHIVED"); err != nil {
		out.Errors = append(out.Errors, "fixed deposits (archived): "+err.Error())
	} else {
		out.FixedDepositsArchived = &fdArchived
	}

	end := time.Now()
	start := end.AddDate(0, -1, 0)
	if nw, err := api.NetWorthGraph(uuid, start.Format(time.DateOnly), end.Format(time.DateOnly)); err != nil {
		out.Errors = append(out.Errors, "net worth graph: "+err.Error())
	} else {
		out.NetWorth30d = &nw
	}

	if refresh, err := api.MFRefreshStatus(uuid); err != nil {
		out.Errors = append(out.Errors, "mf refresh status: "+err.Error())
	} else {
		out.MFRefreshStatus = &refresh
	}

	if asJSON {
		b, _ := json.Marshal(out)
		fmt.Println(string(b))
		return
	}

	fmt.Println("Mutual funds (current value):", out.Summary.MutualFundsTotal)
	fmt.Println("Stocks / demat (current value):", out.Summary.StocksTotal)
	fmt.Println("EPF balance:", out.Summary.EPFTotal)
	fmt.Println("Fixed deposits (maturity value):", out.Summary.FixedDeposits)

	fmt.Println()
	if out.MutualFunds != nil {
		fmt.Printf("Mutual fund schemes (%d):\n", len(out.MutualFunds.Data.Schemes))
		for _, s := range out.MutualFunds.Data.Schemes {
			fmt.Printf("  %-45s %12.2f  (%s)\n", s.Name, s.Value, s.AMC)
		}
	}

	fmt.Println()
	fmt.Printf("Stock holdings (%d):\n", len(out.Stocks))
	for _, h := range out.Stocks {
		label := h.Name
		if label == "" {
			label = h.ISINID
		}
		fmt.Printf("  %-40s units=%-10.2f value=%.2f\n", label, h.Units, h.Value)
	}

	if len(out.Errors) > 0 {
		fmt.Println()
		fmt.Println("Warnings:")
		for _, e := range out.Errors {
			fmt.Println("  " + e)
		}
	}
}
