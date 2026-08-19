// Formatting + synthesis layer for the 12 investment-related MCP tools. Both branches
// (main and local-mcp) share this file verbatim — only how InvestmentsData is fetched
// differs per branch (see accounts.ts::getInvestments on main, the direct CLI exec on
// local-mcp).

// Mirrors the JSON shape `unfold_patched investments --json` prints (see
// unfold_cli/cmd/investments.go). Loosely typed on purpose — the CLI is the source of
// truth for field shapes, this just needs enough structure for the formatting below.
export interface InvestmentsData {
  summary: {
    mutual_funds_total: number;
    stocks_total: number;
    epf_total: number;
    nps_total: number;
    fixed_deposits_total: number;
    portfolio_net_worth: number;
  };
  mutual_funds?: any;
  stocks?: any[];
  epf?: any;
  nps?: any;
  ppf?: any;
  fixed_deposits_active?: any;
  fixed_deposits_archived?: any;
  net_worth_30d?: any;
  mf_refresh_status?: any;
  errors?: string[];
}

function fmtINR(n: number | undefined | null): string {
  const v = n ?? 0;
  const sign = v < 0 ? "-" : "";
  return sign + "₹" + Math.abs(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function pct(n: number | undefined | null): string {
  const v = n ?? 0;
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export const INVESTMENT_TOOL_NAMES = new Set([
  "get_investments_summary",
  "get_mutual_funds",
  "get_stock_holdings",
  "get_epf_balance",
  "get_epf_history",
  "get_nps_accounts",
  "get_ppf_accounts",
  "get_fixed_deposits",
  "get_net_worth",
  "get_mutual_fund_refresh_status",
  "explain_mutual_fund_performance",
  "explain_portfolio_health",
]);

export function buildInvestmentsToolResult(name: string, args: Record<string, any> | undefined, data: InvestmentsData) {
  switch (name) {
    case "get_investments_summary": {
      const s = data.summary;
      const trackedTotal = (s.mutual_funds_total || 0) + (s.stocks_total || 0) + (s.epf_total || 0)
        + (s.nps_total || 0) + (s.fixed_deposits_total || 0);
      const lines = [
        `Investments summary:`,
        `- Mutual Funds:    ${fmtINR(s.mutual_funds_total)}`,
        `- Stocks (Demat):  ${fmtINR(s.stocks_total)}`,
        `- EPF:             ${fmtINR(s.epf_total)}`,
        `- NPS:             ${fmtINR(s.nps_total)}`,
        `- Fixed Deposits:  ${fmtINR(s.fixed_deposits_total)}`,
        `- Total tracked:   ${fmtINR(trackedTotal)}`,
      ];
      if (data.errors?.length) lines.push("", "Some sources failed to load: " + data.errors.join("; "));
      return textResult(lines.join("\n"));
    }

    case "get_mutual_funds": {
      const schemes = data.mutual_funds?.data?.schemes ?? [];
      if (!schemes.length) return textResult("No mutual fund holdings found.");
      const sorted = [...schemes].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      const lines = [`Mutual fund holdings (${sorted.length} schemes, total ${fmtINR(data.mutual_funds?.data?.total_current_value)}):`];
      for (const s of sorted) {
        lines.push(
          `- ${s.name} (${s.amc})\n` +
          `    Value: ${fmtINR(s.value)} | Invested: ${fmtINR(s.invested)} | Gain/Loss: ${fmtINR(s.gain_loss)} (${pct(s.returns)}) | XIRR: ${pct(s.xirr)}`
        );
      }
      const xirr = data.mutual_funds?.data?.xirr;
      const benchXirr = data.mutual_funds?.data?.benchmark_xirr;
      if (xirr !== undefined) {
        lines.push("", `Overall portfolio XIRR: ${pct(xirr)} vs benchmark ${pct(benchXirr)}`);
      }
      return textResult(lines.join("\n"));
    }

    case "get_stock_holdings": {
      const stocks = data.stocks ?? [];
      if (!stocks.length) return textResult("No stock (demat) holdings found.");
      const sorted = [...stocks].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
      const total = sorted.reduce((sum, h) => sum + (h.value ?? 0), 0);
      const lines = [`Stock holdings (${sorted.length}, total ${fmtINR(total)}):`];
      for (const h of sorted) {
        const label = h.name || h.isin_id;
        lines.push(`- ${label}${h.symbol ? ` (${h.symbol})` : ""}: ${h.units} units @ ${fmtINR(h.last_traded_price)} = ${fmtINR(h.value)}`);
      }
      return textResult(lines.join("\n"));
    }

    case "get_epf_balance": {
      const account = data.epf?.account?.data?.account;
      if (!account?.uuid) return textResult("No EPF account linked.");
      const summary = data.epf?.passbooks?.data?.summary;
      const lines = [
        `EPF account (UAN: ${account.uan}):`,
        `- Total balance:    ${fmtINR(summary?.total_balance)}`,
        `- Employee share:   ${fmtINR(summary?.total_employee_share)}`,
        `- Employer share:   ${fmtINR(summary?.total_employer_share)}`,
        `- Pension share:    ${fmtINR(summary?.total_pension_share)}`,
        `- Interest earned:  ${fmtINR(summary?.total_interest)}`,
        `- Current interest rate: ${summary?.current_interest_rate ?? "?"}%`,
      ];
      return textResult(lines.join("\n"));
    }

    case "get_epf_history": {
      const passbooks = data.epf?.passbooks?.data?.passbooks ?? [];
      if (!passbooks.length) return textResult("No EPF passbook history available.");
      const sorted = [...passbooks].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      const lines = ["EPF year-wise history:"];
      for (const p of sorted) {
        const closing = (p.closing_balance_employee_share ?? 0) + (p.closing_balance_employer_share ?? 0) + (p.closing_balance_pension_share ?? 0);
        const contributed = (p.total_contributions_employee_share ?? 0) + (p.total_contributions_employer_share ?? 0);
        const interest = (p.interest_employee_share ?? 0) + (p.interest_employer_share ?? 0);
        lines.push(`- FY${p.year}: closing balance ${fmtINR(closing)} | contributed ${fmtINR(contributed)} | interest earned ${fmtINR(interest)} (rate ${p.interest_rate}%)`);
      }
      return textResult(lines.join("\n"));
    }

    case "get_nps_accounts": {
      const nps = data.nps?.data?.accounts ?? [];
      if (!nps.length) return textResult("No NPS accounts linked.");
      return textResult(`NPS accounts (${nps.length}):\n` + nps.map((a: any) => JSON.stringify(a)).join("\n"));
    }

    case "get_ppf_accounts": {
      const ppf = data.ppf?.data?.accounts ?? [];
      if (!ppf.length) return textResult("No PPF accounts linked.");
      return textResult(`PPF accounts (${ppf.length}):\n` + ppf.map((a: any) => JSON.stringify(a)).join("\n"));
    }

    case "get_fixed_deposits": {
      const active = data.fixed_deposits_active?.data?.fixed_deposits ?? [];
      const archived = data.fixed_deposits_archived?.data?.fixed_deposits ?? [];
      const activeStats = data.fixed_deposits_active?.data?.stats;
      if (!active.length && !archived.length) return textResult("No fixed deposits found.");
      const lines: string[] = [];
      if (active.length) {
        lines.push(`Active fixed deposits (${active.length}, maturity total ${fmtINR(activeStats?.total_maturity_amount)}):`);
        active.forEach((fd: any) => lines.push(`- ${JSON.stringify(fd)}`));
      }
      if (archived.length) {
        lines.push(`Archived/matured fixed deposits (${archived.length}):`);
        archived.forEach((fd: any) => lines.push(`- ${JSON.stringify(fd)}`));
      }
      return textResult(lines.join("\n"));
    }

    case "get_net_worth": {
      const points = data.net_worth_30d?.data?.graph_data ?? [];
      if (!points.length) return textResult("No net worth history available.");
      const first = points[0];
      const last = points[points.length - 1];
      const change = (last.value ?? 0) - (first.value ?? 0);
      const changePct = first.value ? (change / first.value) * 100 : 0;
      const lines = [
        `Net worth: ${fmtINR(last.value)} (as of ${String(last.date).slice(0, 10)})`,
        `Change over last 30 days: ${fmtINR(change)} (${pct(changePct)})`,
      ];
      return textResult(lines.join("\n"));
    }

    case "get_mutual_fund_refresh_status": {
      const status = data.mf_refresh_status?.data;
      if (!status) return textResult("Refresh status unavailable.");
      const rawNext = status.recent_session_status?.next_refresh;
      const next = rawNext ? new Date(rawNext) : null;
      const hasValidNext = next !== null && !isNaN(next.getTime()) && next.getTime() > 0;
      const eligible = hasValidNext ? next!.getTime() <= Date.now() : null;
      const lines = [
        `Mutual fund holdings were last pulled from your RTA (CAMS/KFintech) on ${String(status.recent_session_status?.last_refresh).slice(0, 10)}.`,
        eligible === null
          ? `Refresh eligibility unclear (no valid next-refresh date reported by Fold).`
          : eligible
            ? `You're eligible to pull again now.`
            : `Next eligible pull: ${String(rawNext).slice(0, 10)} (Fold enforces this cooldown — 14 days on free, 5 on Plus).`,
        ``,
        `Note: this is only about pulling in new transactions (new purchases/redemptions). NAV pricing on your existing units updates automatically every day` +
          (status.last_nav_updated_at ? ` — last updated ${String(status.last_nav_updated_at).slice(0, 10)}.` : "."),
      ];
      return textResult(lines.join("\n"));
    }

    case "explain_mutual_fund_performance": {
      const merged = data.mutual_funds?.data?.merged_schemes ?? [];
      if (!merged.length) return textResult("No mutual fund performance data available.");
      const period: string = (args?.period as string) || "1Y";

      type Row = { name: string; amc: string; out: number; schemeReturn: number; benchReturn: number };
      const rows: Row[] = [];
      for (const s of merged) {
        const perf = s.performance?.[period];
        if (!perf) continue;
        rows.push({
          name: s.name, amc: s.amc,
          out: perf.outperformance, schemeReturn: perf.scheme_absolute_return, benchReturn: perf.benchmark_absolute_return,
        });
      }
      if (!rows.length) return textResult(`No ${period} performance data available for your schemes.`);
      rows.sort((a, b) => b.out - a.out);

      const lines = [`Mutual fund performance vs. benchmark (${period}):`, ""];
      for (const r of rows) {
        const verdict = r.out > 1 ? "beating its benchmark" : r.out < -1 ? "lagging its benchmark" : "roughly tracking its benchmark";
        lines.push(`- ${r.name} (${r.amc}): ${verdict} — your fund returned ${pct(r.schemeReturn)}, its benchmark returned ${pct(r.benchReturn)} (${r.out >= 0 ? "+" : ""}${r.out.toFixed(2)}pp)`);
      }
      lines.push("", `Best performer: ${rows[0].name} (${rows[0].out >= 0 ? "+" : ""}${rows[0].out.toFixed(2)}pp vs benchmark)`);
      lines.push(`Worst performer: ${rows[rows.length - 1].name} (${rows[rows.length - 1].out >= 0 ? "+" : ""}${rows[rows.length - 1].out.toFixed(2)}pp vs benchmark)`);
      return textResult(lines.join("\n"));
    }

    case "explain_portfolio_health": {
      const schemes = data.mutual_funds?.data?.schemes ?? [];
      const stocks = data.stocks ?? [];
      const lines: string[] = [];

      const mfTotal = schemes.reduce((sum: number, s: any) => sum + (s.value ?? 0), 0);
      if (schemes.length) {
        const byAmc = new Map<string, number>();
        const byCategory = new Map<string, number>();
        for (const s of schemes) {
          byAmc.set(s.amc, (byAmc.get(s.amc) ?? 0) + (s.value ?? 0));
          byCategory.set(s.asset_sub_category || s.asset_category || "Other", (byCategory.get(s.asset_sub_category || s.asset_category || "Other") ?? 0) + (s.value ?? 0));
        }
        const topAmc = [...byAmc.entries()].sort((a, b) => b[1] - a[1]);
        const topAmcShare = mfTotal ? (topAmc[0][1] / mfTotal) * 100 : 0;

        lines.push("Mutual fund portfolio health:");
        lines.push(`- Spread across ${byAmc.size} AMC(s), ${schemes.length} scheme(s), total ${fmtINR(mfTotal)}`);
        if (topAmcShare > 50) {
          lines.push(`- ⚠ Concentration risk: ${topAmc[0][0]} makes up ${topAmcShare.toFixed(0)}% of your mutual fund money — consider whether that much overlap in one AMC is intentional.`);
        } else {
          lines.push(`- Reasonably spread across AMCs (largest is ${topAmc[0][0]} at ${topAmcShare.toFixed(0)}%).`);
        }
        lines.push("- Category mix: " + [...byCategory.entries()].sort((a, b) => b[1] - a[1])
          .map(([cat, val]) => `${cat} ${mfTotal ? ((val / mfTotal) * 100).toFixed(0) : 0}%`).join(", "));

        const xirr = data.mutual_funds?.data?.xirr;
        const benchXirr = data.mutual_funds?.data?.benchmark_xirr;
        if (xirr !== undefined && benchXirr !== undefined) {
          const verdict = xirr > benchXirr + 1 ? "your funds are collectively beating their benchmarks — going well"
            : xirr < benchXirr - 1 ? "your funds are collectively lagging their benchmarks — worth a look"
            : "your funds are roughly tracking their benchmarks";
          lines.push(`- Overall: ${verdict} (portfolio XIRR ${pct(xirr)} vs benchmark ${pct(benchXirr)}).`);
        }
      } else {
        lines.push("No mutual fund holdings to assess.");
      }

      if (stocks.length) {
        const stockTotal = stocks.reduce((sum: number, h: any) => sum + (h.value ?? 0), 0);
        const top = [...stocks].sort((a: any, b: any) => (b.value ?? 0) - (a.value ?? 0))[0];
        const topShare = stockTotal ? ((top.value ?? 0) / stockTotal) * 100 : 0;
        lines.push("", "Stock portfolio health:");
        lines.push(`- ${stocks.length} stock(s), total ${fmtINR(stockTotal)}`);
        if (topShare > 50) {
          lines.push(`- ⚠ ${top.name || top.isin_id} alone is ${topShare.toFixed(0)}% of your stock holdings — concentrated in a single stock.`);
        }
      }

      return textResult(lines.join("\n"));
    }

    default:
      throw new Error(`Unknown investments tool: ${name}`);
  }
}
