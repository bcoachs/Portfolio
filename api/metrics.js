module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const yahooFinance = require('yahoo-finance2');

    res.status(200).json({
      ok: true,
      note: 'require succeeded',
      keys: Object.keys(yahooFinance)
    });
  } catch (error) {
    res.status(200).json({
      ok: false,
      note: 'require failed',
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
