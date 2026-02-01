const yahooFinance = require('yahoo-finance2').default;

const CACHE_TTL_DAYS = 7;
const cache = globalThis.__METRICS_CACHE__ || (globalThis.__METRICS_CACHE__ = {});

const daysBetween = (fromDate, toDate) => {
    if (!fromDate || !toDate) {
        return Infinity;
    }
    const start = new Date(fromDate).getTime();
    const end = new Date(toDate).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) {
        return Infinity;
    }
    const diffMs = Math.abs(end - start);
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
};

const safeNumber = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const wrapField = (value, asOf, source, extras = {}) => ({
    value: safeNumber(value),
    asOf,
    source,
    ...extras
});

const getFundamentals = async (symbol) =>
    yahooFinance.quoteSummary(symbol, {
        modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData']
    });

const getDailyQuote = async (symbol) => yahooFinance.quote(symbol);

const buildPayload = ({
    symbol,
    companyName,
    fundamentals,
    fundamentalsFetchedAtISO,
    usedCache,
    quote,
    fetchedAtISO
}) => {
    const summaryDetail = fundamentals?.summaryDetail || {};
    const stats = fundamentals?.defaultKeyStatistics || {};
    const financialData = fundamentals?.financialData || {};

    const totalDebt = safeNumber(financialData.totalDebt);
    const ebitda = safeNumber(financialData.ebitda);

    const debtToEbitda =
        totalDebt !== null && ebitda !== null && ebitda !== 0 ? totalDebt / ebitda : null;

    const fundamentalsAsOf = fundamentalsFetchedAtISO?.slice(0, 10) || fetchedAtISO.slice(0, 10);
    const dailyAsOf = fetchedAtISO.slice(0, 10);
    const source = 'yahoo-finance2';

    return {
        symbol,
        companyName,
        fetchedAt: fetchedAtISO,
        source,
        data: {
            dividendYield: wrapField(summaryDetail.dividendYield, fundamentalsAsOf, source),
            epsPayout: wrapField(summaryDetail.payoutRatio ?? stats.payoutRatio, fundamentalsAsOf, source),
            fcfPayout: wrapField(financialData.payoutRatio, fundamentalsAsOf, source),
            debtToEbitda: wrapField(debtToEbitda, fundamentalsAsOf, source),
            interestCoverage: wrapField(financialData.interestCoverage, fundamentalsAsOf, source),
            roic: wrapField(
                financialData.returnOnInvestmentCapital ?? stats.returnOnAssets,
                fundamentalsAsOf,
                source
            ),
            dividendGrowth: wrapField(null, fundamentalsAsOf, source),
            price: wrapField(quote?.regularMarketPrice, dailyAsOf, source, {
                currency: quote?.currency ?? null
            })
        },
        cache: {
            fundamentalsUsedFromCache: usedCache,
            fundamentalsFetchedAt: fundamentalsFetchedAtISO
        }
    };
};

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.method !== 'GET') {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: { message: 'Nur GET ist erlaubt.', code: 'method_not_allowed' } }));
        return;
    }

    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    if (!symbol) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: 'Symbol ist erforderlich.', code: 'missing_symbol' } }));
        return;
    }

    try {
        const nowISO = new Date().toISOString();
        const cached = cache[symbol];
        const cacheAgeDays = cached?.fundamentalsFetchedAtISO
            ? daysBetween(cached.fundamentalsFetchedAtISO, nowISO)
            : Infinity;
        const needsRefresh = !cached || cacheAgeDays >= CACHE_TTL_DAYS;

        const fundamentals = needsRefresh ? await getFundamentals(symbol) : cached.fundamentals;
        const fundamentalsFetchedAtISO = needsRefresh
            ? nowISO
            : cached?.fundamentalsFetchedAtISO || nowISO;

        cache[symbol] = {
            fundamentals,
            fundamentalsFetchedAtISO
        };

        const quote = await getDailyQuote(symbol);
        const companyName =
            fundamentals?.price?.longName ||
            fundamentals?.price?.shortName ||
            quote?.longName ||
            quote?.shortName ||
            symbol;

        const payload = buildPayload({
            symbol,
            companyName,
            fundamentals,
            fundamentalsFetchedAtISO,
            usedCache: !needsRefresh,
            quote,
            fetchedAtISO: nowISO
        });

        res.statusCode = 200;
        res.end(JSON.stringify(payload));
    } catch (error) {
        res.statusCode = 502;
        res.end(
            JSON.stringify({
                error: {
                    message: 'Fehler beim Abruf der Kennzahlen.',
                    provider: 'yahoo-finance2',
                    details: error?.message || 'Unbekannter Fehler'
                }
            })
        );
    }
};
