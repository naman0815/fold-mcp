package api

import (
	"encoding/json"
	"errors"
	"time"

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

// PeriodPerformance compares a scheme's return against its benchmark over one period
// (Fold sends keys "6M", "1Y", "3Y", "5Y", "10Y").
type PeriodPerformance struct {
	SchemeAbsoluteReturn    float64   `json:"scheme_absolute_return"`
	BenchmarkAbsoluteReturn float64   `json:"benchmark_absolute_return"`
	Outperformance          float64   `json:"outperformance"`
	StartDate               time.Time `json:"start_date"`
	EndDate                 time.Time `json:"end_date"`
}

// MutualFundMergedScheme is a scheme (deduplicated across folios) with its historical
// performance-vs-benchmark breakdown attached — this is what powers
// explain_mutual_fund_performance.
type MutualFundMergedScheme struct {
	MutualFundScheme
	Performance map[string]PeriodPerformance `json:"performance"`
}

type MutualFundsResponse struct {
	Data struct {
		TotalCurrentValue     float64                   `json:"total_current_value"`
		Schemes               []MutualFundScheme        `json:"schemes"`
		MergedSchemes         []MutualFundMergedScheme  `json:"merged_schemes"`
		AbsoluteReturns        struct {
			TotalValue         float64 `json:"total_value"`
			TotalGainPercentage float64 `json:"total_gain_percentage"`
		} `json:"absolute_returns"`
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

// NPSAccounts fetches linked National Pension System accounts. Per-account fields are
// unconfirmed (the captured account has none linked), so each account is a raw map.
type NPSAccountsResponse struct {
	Data struct {
		Accounts []map[string]interface{} `json:"accounts"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

func NPSAccounts(uuid string) (NPSAccountsResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v2/users/"+uuid+"/investments/nps/accounts"), nil)
	resp, err := Client.Do(req)
	if err != nil {
		return NPSAccountsResponse{}, err
	}

	log.Debug().Msgf("NPS accounts response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return NPSAccountsResponse{}, errors.New(resp.Status)
	}

	data := NPSAccountsResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

// PPFAccounts fetches linked Public Provident Fund accounts. Per-account fields are
// unconfirmed (the captured account has none linked), so each account is a raw map.
type PPFAccountsResponse struct {
	Data struct {
		Accounts []map[string]interface{} `json:"accounts"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

func PPFAccounts(uuid string) (PPFAccountsResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v3/users/"+uuid+"/ppf/accounts"), nil)
	resp, err := Client.Do(req)
	if err != nil {
		return PPFAccountsResponse{}, err
	}

	log.Debug().Msgf("PPF accounts response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return PPFAccountsResponse{}, errors.New(resp.Status)
	}

	data := PPFAccountsResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

// FixedDepositsResponse's per-deposit fields are unconfirmed (the captured account has
// none), so each deposit is a raw map; the aggregate stats block is confirmed.
type FixedDepositsResponse struct {
	Data struct {
		FixedDeposits []map[string]interface{} `json:"fixed_deposits"`
		Stats         struct {
			TotalPrincipalAmount float64 `json:"total_principal_amount"`
			TotalMaturityAmount  float64 `json:"total_maturity_amount"`
		} `json:"stats"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

// FixedDeposits fetches fixed deposits filtered by status ("ACTIVE" or "ARCHIVED").
func FixedDeposits(uuid string, status string) (FixedDepositsResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v3/users/"+uuid+"/fixed-deposits"), nil)
	q := req.URL.Query()
	q.Set("status", status)
	req.URL.RawQuery = q.Encode()

	resp, err := Client.Do(req)
	if err != nil {
		return FixedDepositsResponse{}, err
	}

	log.Debug().Msgf("Fixed deposits response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return FixedDepositsResponse{}, errors.New(resp.Status)
	}

	data := FixedDepositsResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

type NetWorthGraphPoint struct {
	Date  time.Time `json:"date"`
	Value float64   `json:"value"`
}

type NetWorthGraphResponse struct {
	Data struct {
		GraphData []NetWorthGraphPoint `json:"graph_data"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

// NetWorthGraph fetches day-by-day total net worth (across all linked sources) between
// start and end (both YYYY-MM-DD).
func NetWorthGraph(uuid string, start string, end string) (NetWorthGraphResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v3/users/"+uuid+"/net-worth/graph"), nil)
	q := req.URL.Query()
	q.Set("start", start)
	q.Set("end", end)
	req.URL.RawQuery = q.Encode()

	resp, err := Client.Do(req)
	if err != nil {
		return NetWorthGraphResponse{}, err
	}

	log.Debug().Msgf("Net worth graph response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return NetWorthGraphResponse{}, errors.New(resp.Status)
	}

	data := NetWorthGraphResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}

type MFRefreshSession struct {
	LastRefresh time.Time `json:"last_refresh"`
	NextRefresh time.Time `json:"next_refresh"`
	SessionID   string    `json:"session_id"`
	Status      string    `json:"status"`
}

type MFRefreshStatusResponse struct {
	Data struct {
		RecentSessionStatus MFRefreshSession `json:"recent_session_status"`
		LastSessionStatus   MFRefreshSession `json:"last_session_status"`
		LastNavUpdatedAt    time.Time        `json:"last_nav_updated_at"`
		Disconnected        bool             `json:"disconnected"`
	} `json:"data"`
	Error interface{} `json:"error"`
}

// MFRefreshStatus reports when mutual fund holdings were last pulled from the RTA
// (CAMS/KFintech) and when the account is next eligible to pull again (Fold enforces
// a cooldown here — 14 days on free, 5 days on plus — this only reports eligibility,
// it does not trigger a pull). Note this is separate from NAV pricing, which updates
// daily regardless (see last_nav_updated_at).
func MFRefreshStatus(uuid string) (MFRefreshStatusResponse, error) {
	RefreshOrFail()

	req, _ := APIRequest("GET", Url("/v2/users/"+uuid+"/mfc/refresh/status"), nil)
	resp, err := Client.Do(req)
	if err != nil {
		return MFRefreshStatusResponse{}, err
	}

	log.Debug().Msgf("MF refresh status response status: %+v", resp.StatusCode)
	if resp.StatusCode/100 != 2 {
		return MFRefreshStatusResponse{}, errors.New(resp.Status)
	}

	data := MFRefreshStatusResponse{}
	json.NewDecoder(resp.Body).Decode(&data)
	return data, nil
}
