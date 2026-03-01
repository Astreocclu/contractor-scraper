import { useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, BriefcaseBusiness, Loader2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useFaithCompanies, useFaithPortfolio, useFaithStats } from '@/hooks/useFaith'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectOption } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'

const OPTIONAL_TOGGLES = [
  { key: 'alcohol', label: 'Alcohol' },
  { key: 'contraception', label: 'Contraception' },
  { key: 'lgbtq_corporate_activism', label: 'LGBTQ Activism' },
  { key: 'tobacco', label: 'Tobacco' },
  { key: 'cannabis', label: 'Cannabis' },
  { key: 'defense', label: 'Defense' },
]

function toPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`
}

function parseTickers(input) {
  return Array.from(
    new Set(
      String(input || '')
        .split(/[\s,]+/)
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean)
    )
  )
}

function buildDefaultToggles(profile) {
  if (profile === 'protestant_strict') {
    return {
      alcohol: true,
      contraception: true,
      lgbtq_corporate_activism: true,
      tobacco: true,
      cannabis: true,
      defense: false,
    }
  }

  if (profile === 'catholic_permissive') {
    return {
      alcohol: false,
      contraception: false,
      lgbtq_corporate_activism: true,
      tobacco: true,
      cannabis: true,
      defense: false,
    }
  }

  return {
    alcohol: false,
    contraception: false,
    lgbtq_corporate_activism: false,
    tobacco: false,
    cannabis: false,
    defense: false,
  }
}

export function FaithPortfolio() {
  const [profile, setProfile] = useState('consensus')
  const [riskTolerance, setRiskTolerance] = useState('moderate')
  const [minAlignmentScore, setMinAlignmentScore] = useState('70')
  const [maxHoldings, setMaxHoldings] = useState('20')
  const [tickerInput, setTickerInput] = useState('')
  const [toggles, setToggles] = useState(buildDefaultToggles('consensus'))

  const portfolioMutation = useFaithPortfolio()
  const portfolio = portfolioMutation.data

  const { data: faithStats, isLoading: statsLoading } = useFaithStats()

  const companyParams = useMemo(() => {
    const params = {
      limit: 500,
      profile,
    }

    Object.entries(toggles).forEach(([key, value]) => {
      params[key] = value ? 'true' : 'false'
    })

    return params
  }, [profile, toggles])

  const { data: companiesData } = useFaithCompanies(companyParams, {
    enabled: !!portfolio,
  })

  const companies = companiesData?.results || []

  const selectedTickers = useMemo(() => {
    const set = new Set()
    const holdings = portfolio?.holdings || []
    holdings.forEach((holding) => set.add(holding.ticker))
    return set
  }, [portfolio])

  const minScoreNum = Number(minAlignmentScore) || 70
  const maxHoldingsNum = Number(maxHoldings) || 20

  const exclusions = useMemo(() => {
    if (!portfolio || !companies.length) return []

    const minSelectedScore = portfolio.holdings.length
      ? Math.min(...portfolio.holdings.map((holding) => Number(holding.alignment_score || 0)))
      : 0

    const sectorDiff = {}
    ;(portfolio.sector_summary || []).forEach((row) => {
      sectorDiff[row.sector] = Number(row.difference || 0)
    })

    const pickReason = (company) => {
      const score = Number(
        company?.faith_screen?.scenario?.alignment_score ?? company?.faith_screen?.alignment_score ?? 0
      )

      if (score < minScoreNum) {
        return `Faith score ${score} below threshold ${minScoreNum}`
      }

      if ((portfolio.holdings || []).length >= maxHoldingsNum && score < minSelectedScore) {
        return 'Lower quality-adjusted rank than selected holdings'
      }

      const sector = company.sector || 'Unknown'
      if ((sectorDiff[sector] || 0) > 0.02) {
        return 'Sector already above benchmark target in this run'
      }

      return 'Excluded by diversification and max-weight constraints'
    }

    return companies
      .filter((company) => !selectedTickers.has(company.ticker))
      .map((company) => ({
        ticker: company.ticker,
        name: company.name,
        sector: company.sector || 'Unknown',
        score: Number(company?.faith_screen?.scenario?.alignment_score ?? company?.faith_screen?.alignment_score ?? 0),
        reason: pickReason(company),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
  }, [companies, portfolio, selectedTickers, minScoreNum, maxHoldingsNum])

  const sectorChartData = useMemo(() => {
    if (!portfolio?.sector_summary) return []
    return portfolio.sector_summary.map((row) => ({
      sector: row.sector,
      benchmark: Number(row.benchmark_weight || 0),
      portfolio: Number(row.portfolio_weight || 0),
    }))
  }, [portfolio])

  const handleProfileChange = (event) => {
    const next = event.target.value
    setProfile(next)
    setToggles(buildDefaultToggles(next))
  }

  const handleToggle = (key, checked) => {
    setToggles((prev) => ({ ...prev, [key]: checked }))
  }

  const handleGenerate = async () => {
    const payload = {
      profile,
      risk_tolerance: riskTolerance,
      min_alignment_score: minScoreNum,
      max_holdings: maxHoldingsNum,
      overrides: toggles,
    }

    const tickers = parseTickers(tickerInput)
    if (tickers.length) {
      payload.tickers = tickers
    }

    await portfolioMutation.mutateAsync(payload)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Faith Portfolio Builder</h1>
          <p className="text-muted-foreground">
            Generate sector-aware BRI portfolios with explicit screening rationale.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <ShieldCheck className="h-3.5 w-3.5" />
              Scored Companies
            </div>
            {statsLoading ? <Skeleton className="h-8 w-24 mt-2" /> : <div className="text-2xl font-bold">{faithStats?.total_scored_companies || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <BarChart3 className="h-3.5 w-3.5" />
              Avg Alignment
            </div>
            {statsLoading ? <Skeleton className="h-8 w-24 mt-2" /> : <div className="text-2xl font-bold">{Number(faithStats?.avg_alignment_score || 0).toFixed(1)}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <BriefcaseBusiness className="h-3.5 w-3.5" />
              LDA Coverage
            </div>
            {statsLoading ? <Skeleton className="h-8 w-24 mt-2" /> : <div className="text-2xl font-bold">{faithStats?.signal_coverage?.lda_companies || 0}</div>}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              FEC Coverage
            </div>
            {statsLoading ? <Skeleton className="h-8 w-24 mt-2" /> : <div className="text-2xl font-bold">{faithStats?.signal_coverage?.fec_companies || 0}</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Portfolio Inputs</CardTitle>
          <CardDescription>Set screening profile and optimizer constraints.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-muted-foreground">Faith Profile</label>
              <Select value={profile} onChange={handleProfileChange}>
                <SelectOption value="consensus">Consensus</SelectOption>
                <SelectOption value="protestant_strict">Protestant Strict</SelectOption>
                <SelectOption value="catholic_permissive">Catholic Permissive</SelectOption>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-muted-foreground">Risk Tolerance</label>
              <Select value={riskTolerance} onChange={(event) => setRiskTolerance(event.target.value)}>
                <SelectOption value="conservative">Conservative</SelectOption>
                <SelectOption value="moderate">Moderate</SelectOption>
                <SelectOption value="aggressive">Aggressive</SelectOption>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-muted-foreground">Min Alignment</label>
              <Input value={minAlignmentScore} onChange={(event) => setMinAlignmentScore(event.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase text-muted-foreground">Max Holdings</label>
              <Input value={maxHoldings} onChange={(event) => setMaxHoldings(event.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase text-muted-foreground">Optional Tickers (comma or space separated)</label>
            <Input
              value={tickerInput}
              onChange={(event) => setTickerInput(event.target.value)}
              placeholder="AAPL, MSFT, NVDA"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium uppercase text-muted-foreground">Denominational Toggles</label>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {OPTIONAL_TOGGLES.map((toggle) => (
                <label key={toggle.key} className="flex items-center gap-2 rounded border px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!toggles[toggle.key]}
                    onChange={(event) => handleToggle(toggle.key, event.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>{toggle.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleGenerate} disabled={portfolioMutation.isPending} className="gap-2">
              {portfolioMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
              Generate Portfolio
            </Button>
            {portfolioMutation.isError && (
              <div className="text-sm text-red-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Failed to generate portfolio. Check backend logs.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {portfolio && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs uppercase text-muted-foreground">Selected Holdings</p>
                <p className="text-2xl font-bold">{portfolio.summary?.selected_count || 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs uppercase text-muted-foreground">Weighted Alignment</p>
                <p className="text-2xl font-bold">{Number(portfolio.summary?.weighted_alignment_score || 0).toFixed(2)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs uppercase text-muted-foreground">Tracking Error Proxy</p>
                <p className="text-2xl font-bold">{Number(portfolio.summary?.tracking_error_proxy || 0).toFixed(4)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs uppercase text-muted-foreground">Eligible Universe</p>
                <p className="text-2xl font-bold">{portfolio.summary?.eligible_count || 0}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-7">
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle className="text-lg">Sector Neutrality</CardTitle>
                <CardDescription>Portfolio vs benchmark sector weights.</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={sectorChartData} margin={{ left: 6, right: 6 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="sector" tick={{ fontSize: 11 }} interval={0} angle={-15} height={70} textAnchor="end" />
                    <YAxis tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} />
                    <Tooltip
                      formatter={(value) => toPercent(value)}
                      contentStyle={{
                        backgroundColor: 'hsl(var(--popover))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="benchmark" fill="#64748b" name="Benchmark" />
                    <Bar dataKey="portfolio" fill="#22c55e" name="Portfolio" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="lg:col-span-3">
              <CardHeader>
                <CardTitle className="text-lg">Run Settings</CardTitle>
                <CardDescription>Actual parameters used by optimizer.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Profile</span><Badge variant="outline">{portfolio.profile}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Risk</span><Badge variant="outline">{portfolio.risk_tolerance}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Min Score</span><span>{portfolio.settings?.min_alignment_score}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Max Holdings</span><span>{portfolio.settings?.max_holdings}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Max Weight</span><span>{toPercent(portfolio.settings?.max_weight_effective || 0)}</span></div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Why Selected</CardTitle>
              <CardDescription>Final holdings with optimizer rationale.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">Ticker</th>
                    <th className="text-left py-2">Company</th>
                    <th className="text-left py-2">Sector</th>
                    <th className="text-right py-2">Weight</th>
                    <th className="text-right py-2">Faith Score</th>
                    <th className="text-left py-2">Rationale</th>
                  </tr>
                </thead>
                <tbody>
                  {(portfolio.holdings || []).map((holding) => (
                    <tr key={holding.ticker} className="border-b border-border/40">
                      <td className="py-2 font-semibold">{holding.ticker}</td>
                      <td className="py-2">{holding.name}</td>
                      <td className="py-2">{holding.sector}</td>
                      <td className="py-2 text-right font-mono">{toPercent(holding.weight)}</td>
                      <td className="py-2 text-right">{holding.alignment_score}</td>
                      <td className="py-2 text-muted-foreground">{holding.rationale}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Why Excluded</CardTitle>
              <CardDescription>Top non-selected candidates and exclusion reasons for this run.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2">Ticker</th>
                    <th className="text-left py-2">Company</th>
                    <th className="text-left py-2">Sector</th>
                    <th className="text-right py-2">Faith Score</th>
                    <th className="text-left py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {exclusions.length === 0 && (
                    <tr>
                      <td className="py-3 text-muted-foreground" colSpan={5}>
                        No exclusions available for current dataset.
                      </td>
                    </tr>
                  )}
                  {exclusions.map((item) => (
                    <tr key={item.ticker} className="border-b border-border/40">
                      <td className="py-2 font-semibold">{item.ticker}</td>
                      <td className="py-2">{item.name}</td>
                      <td className="py-2">{item.sector}</td>
                      <td className="py-2 text-right">{item.score}</td>
                      <td className="py-2 text-muted-foreground">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
