package cmd

import (
	"fmt"
	"runtime"

	"github.com/rs/zerolog/log"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"

	"github.com/wantguns/unfold/api"
)

var InvestmentsCmd = &cobra.Command{
	Use:   "investments",
	Short: "Prints a summary of your mutual funds, stocks (demat), and EPF balance",
	Run:   investmentsCmdHandler,
}

func investmentsCmdHandler(cmd *cobra.Command, args []string) {
	uuid := viper.GetString("fold_user.uuid")

	agg, err := api.InvestmentsAggregation(uuid)
	if err != nil {
		log.Error().Err(err).Msg("Fetch investments aggregation: ")
		runtime.Goexit()
	}

	fmt.Println("Mutual funds (current value):", agg.Data.MutualFundStats.TotalCurrentValue)
	fmt.Println("Stocks / demat (current value):", agg.Data.DematHoldings.TotalValue)

	epfAccount, err := api.EPFAccount(uuid)
	if err != nil {
		log.Error().Err(err).Msg("Fetch EPF account: ")
		runtime.Goexit()
	}

	if epfAccount.Data.Account.UUID != "" {
		passbooks, err := api.EPFPassbooks(uuid, epfAccount.Data.Account.UUID)
		if err != nil {
			log.Error().Err(err).Msg("Fetch EPF passbooks: ")
			runtime.Goexit()
		}
		fmt.Println("EPF balance:", passbooks.Data.Summary.TotalBalance)
	} else {
		fmt.Println("EPF: no linked account")
	}

	fmt.Println()

	mf, err := api.MutualFunds(uuid)
	if err == nil {
		fmt.Printf("Mutual fund schemes (%d):\n", len(mf.Data.Schemes))
		for _, s := range mf.Data.Schemes {
			fmt.Printf("  %-45s %12.2f  (%s)\n", s.Name, s.Value, s.AMC)
		}
	} else {
		log.Warn().Err(err).Msg("Fetch mutual fund schemes: ")
	}

	fmt.Println()

	demat, err := api.DematHoldings(uuid)
	if err == nil {
		fmt.Printf("Stock holdings (%d):\n", len(demat.Data.Holdings))
		for _, h := range demat.Data.Holdings {
			fmt.Printf("  %-40s units=%-10.2f value=%.2f\n", h.ISINID, h.Units, h.Value)
		}
	} else {
		log.Warn().Err(err).Msg("Fetch demat holdings: ")
	}
}
