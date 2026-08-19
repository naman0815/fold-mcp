package api

import (
	"encoding/json"
	"errors"

	"github.com/rs/zerolog/log"
)

type MutualFundScheme struct {
	UUID             string  `json:"uuid"`
	ISIN             string  `json:"isin"`
	Name             string  `json:"name"`
	AMC              string  `json:"amc"`
	Units            float64 `json:"units"`
	Value            float64 `json:"value"`
	Returns          float64 `json:"returns"`
	Invested         float64 `json:"invested"`
	GainLoss         float64 `json:"gain_loss"`
	XIRR             float64 `json:"xirr"`
	AssetCategory    string  `json:"asset_category"`
	AssetSubCategory string  `json:"asset_sub_category"`
	PlanName         string  `json:"plan_name"`
	OptionName       string  `json:"option_name"`
	RiskProfile      string  `json:"risk_profile"`
	BenchmarkName    string  `json:"benchmark_name"`
}

type MutualFundsResponse struct {
	Data struct {
		TotalCurrentValue     float64            `json:"total_current_value"`
		Schemes               []MutualFundScheme `json:"schemes"`
		XIRR                  float64            `json:"xirr"`
		BenchmarkXIRR         float64            `json:"benchmark_xirr"`
		LifetimeXIRR          float64            `json:"lifetime_xirr"`
		LifetimeBenchmarkXIRR float64            `json:"lifetime_benchmark_xirr"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

// MutualFunds fetches per-scheme mutual fund holdings (units, value, XIRR, returns).
func MutualFunds(uuid string) (MutualFundsResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v2/users/"+uuid+"/investments/mutual-funds/schemes"), nil)
	q := req.URL.Query()
	q.Set("include_zero_units", "true")
	q.Set("include_scheme_performance", "true")
	req.URL.RawQuery = q.Encode()

	resp, err := Client.Do(req)
	if err != nil {
		return MutualFundsResponse{}, err
	}

	log.Debug().Msgf("Mutual funds response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return MutualFundsResponse{}, errors.New(resp.Status)
	}

	data := MutualFundsResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

type DematHolding struct {
	ISINID          string  `json:"isin_id"`
	Units           float64 `json:"units"`
	LastTradedPrice float64 `json:"last_traded_price"`
	Value           float64 `json:"value"`
	Currency        string  `json:"currency"`
}

type DematHoldingsResponse struct {
	Data struct {
		Holdings []DematHolding `json:"holdings"`
		After    interface{}    `json:"after"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

// DematHoldings fetches stock holdings (by ISIN) from the linked demat account.
func DematHoldings(uuid string) (DematHoldingsResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v2/users/"+uuid+"/investments/demat/holdings/aggregated"), nil)
	q := req.URL.Query()
	q.Set("limit", "50")
	q.Set("sort_by", "value")
	q.Set("sort_order", "DESC")
	req.URL.RawQuery = q.Encode()

	resp, err := Client.Do(req)
	if err != nil {
		return DematHoldingsResponse{}, err
	}

	log.Debug().Msgf("Demat holdings response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return DematHoldingsResponse{}, errors.New(resp.Status)
	}

	data := DematHoldingsResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

type ISINDetails struct {
	ISIN         string `json:"isin"`
	Name         string `json:"name"`
	Symbol       string `json:"symbol"`
	Exchange     string `json:"exchange"`
	InstrumentType string `json:"instrument_type"`
}

type ISINDetailsResponse struct {
	Data  ISINDetails `json:"data"`
	Error interface{} `json:"error"`
}

// ISINDetail resolves a demat holding's isin_id into a human-readable stock name/symbol.
func ISINDetail(isinID string) (ISINDetailsResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v1/investments/ISINs/"+isinID), nil)
	resp, err := Client.Do(req)
	if err != nil {
		return ISINDetailsResponse{}, err
	}

	log.Debug().Msgf("ISIN detail response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return ISINDetailsResponse{}, errors.New(resp.Status)
	}

	data := ISINDetailsResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

type EPFAccountResponse struct {
	Data struct {
		Account struct {
			UUID   string `json:"uuid"`
			UAN    string `json:"uan"`
			Name   string `json:"name"`
		} `json:"account"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

// EPFAccount fetches the linked EPF account (UAN, name) and its internal uuid,
// which is required to fetch passbooks/transactions/employers below.
func EPFAccount(uuid string) (EPFAccountResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v2/users/"+uuid+"/epf/account"), nil)
	resp, err := Client.Do(req)
	if err != nil {
		return EPFAccountResponse{}, err
	}

	log.Debug().Msgf("EPF account response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return EPFAccountResponse{}, errors.New(resp.Status)
	}

	data := EPFAccountResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

type EPFPassbookYear struct {
	UUID                        string  `json:"uuid"`
	EmployerID                  string  `json:"employer_id"`
	Year                        int     `json:"year"`
	OpeningBalanceEmployeeShare float64 `json:"opening_balance_employee_share"`
	OpeningBalanceEmployerShare float64 `json:"opening_balance_employer_share"`
	ClosingBalanceEmployeeShare float64 `json:"closing_balance_employee_share"`
	ClosingBalanceEmployerShare float64 `json:"closing_balance_employer_share"`
	ClosingBalancePensionShare  float64 `json:"closing_balance_pension_share"`
	ClosingBalanceAsOf          string  `json:"closing_balance_as_of"`
	TotalContributionsEmployee  float64 `json:"total_contributions_employee_share"`
	TotalContributionsEmployer  float64 `json:"total_contributions_employer_share"`
	InterestEmployeeShare       float64 `json:"interest_employee_share"`
	InterestEmployerShare       float64 `json:"interest_employer_share"`
	InterestRate                float64 `json:"interest_rate"`
}

type EPFPassbooksResponse struct {
	Data struct {
		Passbooks []EPFPassbookYear `json:"passbooks"`
		Summary   struct {
			TotalBalance         float64 `json:"total_balance"`
			TotalEmployerShare   float64 `json:"total_employer_share"`
			TotalEmployeeShare   float64 `json:"total_employee_share"`
			TotalPensionShare    float64 `json:"total_pension_share"`
			TotalInterest        float64 `json:"total_interest"`
			TotalWithdrawals     float64 `json:"total_withdrawals"`
			CurrentInterestRate  float64 `json:"current_interest_rate"`
			CurrentInterestYear  int     `json:"current_interest_rate_year"`
		} `json:"summary"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

// EPFPassbooks fetches year-wise EPF contributions/interest and the overall balance summary.
func EPFPassbooks(uuid string, epfUUID string) (EPFPassbooksResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v2/users/"+uuid+"/epf/"+epfUUID+"/passbooks"), nil)
	resp, err := Client.Do(req)
	if err != nil {
		return EPFPassbooksResponse{}, err
	}

	log.Debug().Msgf("EPF passbooks response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return EPFPassbooksResponse{}, errors.New(resp.Status)
	}

	data := EPFPassbooksResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

type InvestmentsAggregationResponse struct {
	Data struct {
		DematHoldings struct {
			TotalValue    float64 `json:"total_value"`
			TotalShares   float64 `json:"total_shares"`
			TotalHoldings int     `json:"total_holdings"`
			ETFValue      float64 `json:"etf_value"`
			EquityValue   float64 `json:"equity_value"`
		} `json:"demat_holdings"`
		PortfolioNetWorth float64 `json:"portfolio_net_worth"`
		MutualFundStats   struct {
			TotalCurrentValue float64 `json:"total_current_value"`
		} `json:"mutual_fund_stats"`
		NPSStats struct {
			TotalValue float64 `json:"total_value"`
		} `json:"nps_stats"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

// InvestmentsAggregation fetches the one-shot summary Fold shows on its investments
// home screen: demat total, mutual fund total, FD stats, and NPS stats.
func InvestmentsAggregation(uuid string) (InvestmentsAggregationResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v2/users/"+uuid+"/investments/aggregation"), nil)
	resp, err := Client.Do(req)
	if err != nil {
		return InvestmentsAggregationResponse{}, err
	}

	log.Debug().Msgf("Investments aggregation response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return InvestmentsAggregationResponse{}, errors.New(resp.Status)
	}

	data := InvestmentsAggregationResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}
