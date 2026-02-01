module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const symbolRaw = (req.query.symbol || '').toString().trim();
  const symbol = symbolRaw.toUpperCase();

  res.status(200).json({
    ok: true,
    symbol,
    note: 'metrics route alive'
  });
};
