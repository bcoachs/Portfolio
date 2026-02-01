const yahooFinance = require('yahoo-finance2').default;

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    if (req.method !== 'GET') {
      return res.status(405).json({
        error: { code: 'method_not_allowed', message: 'Nur GET ist erlaubt.' }
      });
    }

    const symbolRaw = (req.query.symbol || '').toString().trim();
    const symbol = symbolRaw.toUpperCase();

    if (!symbol) {
      return res.status(400).json({
        error: { code: 'missing_symbol', message: "Query param 'symbol' is required." }
      });
    }

    const nowISO = new Date().toISOString();
    const asOf = nowISO.slice(0, 10);

    const quote = await yahooFinance.quote(symbol);

    const companyName = quote.longName || quote.shortName || quote.displayName || symbol;

    const dividendYield =
      quote.trailingAnnualDividendYield !== undefined &&
      quote.trailingAnnualDividendYield !== null
        ? quote.trailingAnnualDividendYield
        : null;

    return res.status(200).json({
      symbol,
      companyName,
      fetchedAt: nowISO,
      source: 'yahoo-finance2',
      data: {
        price: {
          value: quote.regularMarketPrice ?? null,
          currency: quote.currency ?? null,
          asOf,
          source: 'yahoo-finance2'
        },
        dividendYield: { value: dividendYield, asOf, source: 'yahoo-finance2' }
      }
    });
  } catch (err) {
    return res.status(502).json({
      error: {
        code: 'provider_failed',
        message: 'Provider call failed (yahoo-finance2.quote).',
        provider: 'yahoo-finance2',
        details: String(err && err.message ? err.message : err)
      }
    });
  }
};
