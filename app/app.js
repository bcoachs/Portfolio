/**
 * JavaScript für das Dividendenportfolio-Tool.
 * Diese Datei lädt eine CSV-Datei, wertet die Rollen aus und zeigt eine Zusammenfassung an.
 */

const REQUIRED_PORTFOLIO_COLUMNS = [
    'Ticker',
    'Name',
    'Rolle',
    'Stueck',
    'Einstandskurs',
    'Marktwert',
    'Waehrung',
    'Dividendenrendite',
    'Dividendenwachstum',
    'ROIC',
    'Payout_FCF',
    'NetDebt_EBITDA',
    'Interest_Coverage'
];

const REQUIRED_GERMAN_COLUMNS = ['ID', 'Name', 'Anteil (in %)', 'Wert'];

const RULES_PATH = 'default_rules.json';

const METRIC_LABELS = {
    dividendYield: 'Dividendenrendite',
    dividendGrowth: 'Dividendenwachstum (5J CAGR)',
    fcfPayoutRatio: 'FCF-Payout-Ratio',
    epsPayoutRatio: 'EPS-Payout-Ratio',
    netDebtToEbitda: 'Net Debt / EBITDA',
    interestCoverage: 'Zinsdeckungsgrad',
    roic: 'ROIC'
};

let cachedRules = null;

/**
 * Erstellt (falls nötig) das CSV-Uploadfeld und registriert den Listener.
 */
const setupCsvUpload = () => {
    let fileInput = document.getElementById('csvFileInput');

    if (!fileInput) {
        const uploadContainer = document.getElementById('upload');
        fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.id = 'csvFileInput';
        fileInput.accept = '.csv';
        uploadContainer?.appendChild(fileInput);
    }

    fileInput.addEventListener('change', handleCsvUpload);
};

const setupSingleReview = () => {
    const input = document.getElementById('singleReviewInput');
    const button = document.getElementById('singleReviewButton');
    if (!input || !button) {
        return;
    }

    const runEvaluation = async () => {
        const value = input.value.trim();
        if (!value) {
            updateSingleReviewStatus('Bitte geben Sie ein Ticker-Symbol oder eine ISIN ein.', 'fail');
            renderSingleReviewResults(null, null);
            return;
        }

        updateSingleReviewStatus('Kennzahlen werden geladen...', 'neutral');
        renderSingleReviewResults();

        const [metricsResponse, rules] = await Promise.all([fetchMetrics(value), loadRules()]);
        if (!rules) {
            updateSingleReviewStatus('Regelwerk konnte nicht geladen werden.', 'fail');
            return;
        }

        if (metricsResponse.errorMessage) {
            updateSingleReviewStatus(metricsResponse.errorMessage, 'fail');
            renderSingleReviewResults(metricsResponse);
            return;
        }

        const evaluation = evaluateStock(metricsResponse.metrics, rules);
        renderSingleReviewResults({
            ...metricsResponse,
            evaluation
        });
        const statusMessage = evaluation.role
            ? `Empfohlene Rolle: ${evaluation.role}`
            : 'Keine passende Rolle gefunden.';
        updateSingleReviewStatus(statusMessage, evaluation.role ? 'success' : 'fail');
    };

    button.addEventListener('click', runEvaluation);
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            runEvaluation();
        }
    });
};

const updateSingleReviewStatus = (message, status) => {
    const statusElement = document.getElementById('single-review-status');
    if (!statusElement) {
        return;
    }
    statusElement.textContent = message;
    statusElement.classList.remove('success', 'fail', 'neutral');
    if (status) {
        statusElement.classList.add(status);
    }
};

const renderSingleReviewResults = (data = {}) => {
    const resultsElement = document.getElementById('single-review-results');
    if (!resultsElement) {
        return;
    }

    const { metrics, evaluation, companyName, symbol, errorMessage } = data;
    const nameLabel = companyName || symbol;
    const nameMarkup = nameLabel ? `<div class="single-review-company">${nameLabel}</div>` : '';
    const symbolMarkup =
        symbol && companyName && symbol !== companyName
            ? `<div class="single-review-symbol">Symbol: ${symbol}</div>`
            : '';
    const errorMarkup = errorMessage ? `<div class="single-review-error">${errorMessage}</div>` : '';

    if (!metrics || !evaluation) {
        resultsElement.innerHTML = `${nameMarkup}${symbolMarkup}${errorMarkup}`;
        return;
    }

    const metricRows = Object.entries(METRIC_LABELS)
        .map(([key, label]) => {
            const value = metrics[key];
            const formatted = formatMetricValue(key, value);
            const status = evaluation.kpiStatuses[key] || 'neutral';
            return `
                <tr>
                    <td>${label}</td>
                    <td>${formatted}</td>
                    <td><span class="status-chip ${status}">${statusLabel(status)}</span></td>
                </tr>
            `;
        })
        .join('');

    const roleText = evaluation.role ? evaluation.role : 'Nicht geeignet';
    const roleStatus = evaluation.role ? 'success' : 'fail';

    resultsElement.innerHTML = `
        ${nameMarkup}
        ${symbolMarkup}
        <div>
            <strong>Rollen-Check:</strong>
            <span class="status-chip ${roleStatus}">${roleText}</span>
        </div>
        <table class="kpi-table">
            <thead>
                <tr>
                    <th>KPI</th>
                    <th>Wert</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                ${metricRows}
            </tbody>
        </table>
    `;
};

const statusLabel = (status) => {
    switch (status) {
        case 'success':
            return 'OK';
        case 'fail':
            return 'Rot';
        default:
            return 'k. A.';
    }
};

const formatMetricValue = (key, value) => {
    if (value === null || Number.isNaN(value)) {
        return 'n/a';
    }
    if (key === 'dividendYield' || key === 'dividendGrowth' || key === 'fcfPayoutRatio' || key === 'epsPayoutRatio' || key === 'roic') {
        return `${(value * 100).toFixed(2)} %`;
    }
    return value.toFixed(2);
};

const loadRules = async () => {
    if (cachedRules) {
        return cachedRules;
    }
    try {
        const response = await fetch(RULES_PATH);
        if (!response.ok) {
            return null;
        }
        cachedRules = await response.json();
        return cachedRules;
    } catch (error) {
        console.error('Fehler beim Laden der Regeln', error);
        return null;
    }
};

const fetchMetrics = async (value) => {
    const metrics = {
        dividendYield: null,
        dividendGrowth: null,
        fcfPayoutRatio: null,
        epsPayoutRatio: null,
        netDebtToEbitda: null,
        interestCoverage: null,
        roic: null
    };

    const searchResult = await resolveSymbol(value);
    if (searchResult.errorMessage && !searchResult.symbol) {
        return {
            metrics,
            companyName: searchResult.companyName ?? value,
            symbol: searchResult.symbol,
            errorMessage: searchResult.errorMessage
        };
    }

    const symbolToUse = searchResult.symbol || value;
    const modules = [
        'summaryDetail',
        'defaultKeyStatistics',
        'financialData',
        'cashflowStatementHistory',
        'price'
    ].join(',');

    try {
        const response = await fetch(
            `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(
                symbolToUse
            )}?modules=${modules}`
        );
        if (!response.ok) {
            return {
                metrics,
                companyName: searchResult.companyName ?? value,
                symbol: symbolToUse,
                errorMessage: 'Kennzahlen konnten nicht geladen werden (API-Fehler oder Rate-Limit).'
            };
        }
        const payload = await response.json();
        const result = payload?.quoteSummary?.result?.[0];
        if (!result) {
            return {
                metrics,
                companyName: searchResult.companyName ?? value,
                symbol: symbolToUse,
                errorMessage: 'Kennzahlen nicht gefunden. Bitte Ticker/ISIN prüfen.'
            };
        }

        const summary = result.summaryDetail || {};
        const stats = result.defaultKeyStatistics || {};
        const financial = result.financialData || {};
        const cashflowHistory = result.cashflowStatementHistory?.cashflowStatements || [];
        const price = result.price || {};

        metrics.dividendYield = toNumber(summary.dividendYield?.raw ?? stats.trailingAnnualDividendYield?.raw);
        metrics.dividendGrowth = calculateDividendCagr(cashflowHistory);
        metrics.fcfPayoutRatio = calculateFcfPayout(summary, stats, financial);
        metrics.epsPayoutRatio = calculateEpsPayout(summary, stats);
        metrics.netDebtToEbitda = safeDivide(financial.netDebt?.raw, financial.ebitda?.raw);
        metrics.interestCoverage = calculateInterestCoverage(financial);
        metrics.roic = toNumber(financial.returnOnInvestedCapital?.raw ?? financial.roic?.raw);

        return {
            metrics,
            companyName:
                price.longName || price.shortName || searchResult.companyName || price.symbol || symbolToUse,
            symbol: price.symbol || symbolToUse,
            errorMessage: null
        };
    } catch (error) {
        console.error('Fehler beim Abruf der Kennzahlen', error);
        return {
            metrics,
            companyName: searchResult.companyName ?? value,
            symbol: symbolToUse,
            errorMessage: 'Kennzahlen konnten nicht geladen werden (Netzwerkfehler).'
        };
    }
};

const resolveSymbol = async (value) => {
    try {
        const response = await fetch(
            `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(value)}&quotesCount=1`
        );
        if (!response.ok) {
            return { symbol: value, companyName: null, errorMessage: null };
        }
        const payload = await response.json();
        const quote = payload?.quotes?.[0];
        if (!quote?.symbol) {
            return {
                symbol: null,
                companyName: null,
                errorMessage: 'Kein passendes Symbol gefunden. Bitte Ticker/ISIN prüfen.'
            };
        }
        return { symbol: quote.symbol, companyName: quote.shortname || quote.longname || null, errorMessage: null };
    } catch (error) {
        console.error('Fehler bei der Symbolsuche', error);
        return { symbol: value, companyName: null, errorMessage: null };
    }
};

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const safeDivide = (numerator, denominator) => {
    const num = toNumber(numerator);
    const den = toNumber(denominator);
    if (num === null || den === null || den === 0) {
        return null;
    }
    return num / den;
};

const calculateDividendCagr = (cashflowHistory) => {
    if (!cashflowHistory?.length) {
        return null;
    }
    const dividends = cashflowHistory
        .map((entry) => Math.abs(Number(entry.dividendsPaid?.raw)))
        .filter((value) => Number.isFinite(value) && value > 0)
        .slice(0, 6);
    if (dividends.length < 2) {
        return null;
    }
    const latest = dividends[0];
    const earliest = dividends[dividends.length - 1];
    const years = dividends.length - 1;
    if (!latest || !earliest || years <= 0) {
        return null;
    }
    return Math.pow(latest / earliest, 1 / years) - 1;
};

const calculateFcfPayout = (summary, stats, financial) => {
    const dividendRate = toNumber(summary.dividendRate?.raw ?? stats.trailingAnnualDividendRate?.raw);
    const shares = toNumber(stats.sharesOutstanding?.raw);
    const freeCashflow = toNumber(financial.freeCashflow?.raw);
    if (dividendRate === null || shares === null || freeCashflow === null) {
        return null;
    }
    const totalDividends = dividendRate * shares;
    return safeDivide(totalDividends, freeCashflow);
};

const calculateEpsPayout = (summary, stats) => {
    const dividendRate = toNumber(summary.dividendRate?.raw ?? stats.trailingAnnualDividendRate?.raw);
    const eps = toNumber(stats.trailingEps?.raw);
    if (dividendRate === null || eps === null) {
        return null;
    }
    return safeDivide(dividendRate, eps);
};

const calculateInterestCoverage = (financial) => {
    const ebitda = toNumber(financial.ebitda?.raw);
    const interestExpense = toNumber(financial.interestExpense?.raw);
    if (ebitda === null || interestExpense === null || interestExpense === 0) {
        return null;
    }
    return ebitda / Math.abs(interestExpense);
};

const evaluateStock = (metrics, rules) => {
    const kpiThresholds = rules.kpi_thresholds || {};
    const coreKpiStatuses = {
        fcfPayoutRatio: compareMax(metrics.fcfPayoutRatio, kpiThresholds.fcf_payout_max),
        epsPayoutRatio: compareMax(metrics.epsPayoutRatio, kpiThresholds.eps_payout_max),
        netDebtToEbitda: compareMax(metrics.netDebtToEbitda, kpiThresholds.debt_to_ebitda_max),
        interestCoverage: compareMin(metrics.interestCoverage, kpiThresholds.interest_coverage_min),
        roic: compareMin(metrics.roic, kpiThresholds.roic_min)
    };
    const kpiStatuses = {
        ...coreKpiStatuses,
        dividendYield: 'neutral',
        dividendGrowth: 'neutral'
    };

    const roleEntries = Object.entries(rules.roles || {});
    let matchedRole = null;

    for (const [roleName, roleRules] of roleEntries) {
        const dividendYieldOk = isWithinRange(
            metrics.dividendYield,
            roleRules.dividend_yield_min,
            roleRules.dividend_yield_max
        );
        const dividendGrowthOk = isWithinRange(
            metrics.dividendGrowth,
            roleRules.dividend_growth_min,
            roleRules.dividend_growth_max
        );
        const kpiOk = Object.values(coreKpiStatuses).every((status) => status !== 'fail');
        if (dividendYieldOk && dividendGrowthOk && kpiOk) {
            matchedRole = roleName;
            kpiStatuses.dividendYield = 'success';
            kpiStatuses.dividendGrowth = 'success';
            break;
        }

        kpiStatuses.dividendYield = dividendYieldOk ? 'success' : 'fail';
        kpiStatuses.dividendGrowth = dividendGrowthOk ? 'success' : 'fail';
    }

    if (!matchedRole) {
        kpiStatuses.dividendYield =
            kpiStatuses.dividendYield === 'neutral' ? compareRange(metrics.dividendYield) : kpiStatuses.dividendYield;
        kpiStatuses.dividendGrowth =
            kpiStatuses.dividendGrowth === 'neutral' ? compareRange(metrics.dividendGrowth) : kpiStatuses.dividendGrowth;
    }

    return { role: matchedRole, kpiStatuses };
};

const isWithinRange = (value, min, max) => {
    if (value === null) {
        return false;
    }
    if (min !== null && min !== undefined && value < min) {
        return false;
    }
    if (max !== null && max !== undefined && value > max) {
        return false;
    }
    return true;
};

const compareMax = (value, max) => {
    if (value === null || max === null || max === undefined) {
        return 'neutral';
    }
    return value <= max ? 'success' : 'fail';
};

const compareMin = (value, min) => {
    if (value === null || min === null || min === undefined) {
        return 'neutral';
    }
    return value >= min ? 'success' : 'fail';
};

const compareRange = (value) => {
    if (value === null) {
        return 'neutral';
    }
    return 'success';
};

/**
 * Liest eine CSV-Datei via FileReader ein und verarbeitet die Daten.
 * @param {Event} event - Change-Event vom Datei-Input.
 */
const handleCsvUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const csvText = reader.result;
        const records = parseCsv(csvText);
        renderSummary(records);
    };
    reader.readAsText(file);
};

/**
 * Parst CSV-Daten entweder mit PapaParse oder via einfachem Split.
 * @param {string} csvText - CSV-Inhalt als Text.
 * @returns {Array<Object>} Array von Datensätzen.
 */
const detectDelimiter = (csvText) => {
    const firstLine = csvText.trim().split(/\r?\n/)[0] || '';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    return semicolonCount > commaCount ? ';' : ',';
};

const parseCsv = (csvText) => {
    const delimiter = detectDelimiter(csvText);
    if (window.Papa) {
        const parsed = window.Papa.parse(csvText, {
            header: true,
            skipEmptyLines: true,
            delimiter
        });
        return parsed.data;
    }

    const lines = csvText.trim().split(/\r?\n/);
    const headers = lines.shift().split(delimiter).map((header) => header.trim());

    return lines.map((line) => {
        const values = line.split(delimiter).map((value) => value.trim());
        return headers.reduce((acc, header, index) => {
            acc[header] = values[index] ?? '';
            return acc;
        }, {});
    });
};

/**
 * Validiert die CSV-Spalten und erstellt eine Zusammenfassung der Rollen.
 * @param {Array<Object>} records - Array von CSV-Datensätzen.
 */
const renderSummary = (records) => {
    const summaryElement = document.getElementById('summary');
    if (!summaryElement) {
        return;
    }

    if (!records.length) {
        summaryElement.textContent = 'Die CSV-Datei enthält keine Daten.';
        return;
    }

    const hasGermanFormat = REQUIRED_GERMAN_COLUMNS.every((column) => column in records[0]);
    const hasPortfolioFormat = REQUIRED_PORTFOLIO_COLUMNS.every((column) => column in records[0]);
    if (!hasGermanFormat && !hasPortfolioFormat) {
        const missingColumns = REQUIRED_PORTFOLIO_COLUMNS.filter((column) => !(column in records[0]));
        summaryElement.innerHTML = `<p class="error">Fehlende Spalten: ${missingColumns.join(', ')}</p>`;
        return;
    }

    if (hasGermanFormat) {
        const normalized = records
            .map((record) => {
                const percentRaw = String(record['Anteil (in %)'] ?? '').replace(',', '.');
                const percentValue = Number(percentRaw);
                const decimalShare = Number.isNaN(percentValue) ? 0 : percentValue / 100;
                const valueRaw = String(record.Wert ?? '').replace(',', '.');
                const value = Number(valueRaw) || 0;

                return {
                    id: record.ID ?? '',
                    name: record.Name ?? '',
                    percent: decimalShare,
                    percentLabel: Number.isNaN(percentValue) ? '0.00' : percentValue.toFixed(2),
                    value
                };
            })
            .filter((record) => record.id || record.name);

        const sorted = normalized
            .sort((a, b) => {
                if (a.percent === b.percent) {
                    return b.value - a.value;
                }
                return b.percent - a.percent;
            })
            .slice(0, 100);

        summaryElement.innerHTML = `
            <table class="summary-table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Name</th>
                        <th>Anteil %</th>
                        <th>Wert</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted
                        .map(
                            (row) => `
                        <tr>
                            <td>${row.id}</td>
                            <td>${row.name}</td>
                            <td>${row.percentLabel}</td>
                            <td>${row.value.toFixed(2)}</td>
                        </tr>
                    `
                        )
                        .join('')}
                </tbody>
            </table>
        `;
        return;
    }

    const totalsByRole = records.reduce((acc, record) => {
        const role = record.Rolle || 'Unbekannt';
        const marketValue = Number(String(record.Marktwert).replace(',', '.')) || 0;
        acc[role] = (acc[role] || 0) + marketValue;
        return acc;
    }, {});

    const totalMarketValue = Object.values(totalsByRole).reduce((sum, value) => sum + value, 0);

    const rows = Object.entries(totalsByRole).map(([role, marketValue]) => {
        const weight = totalMarketValue ? ((marketValue / totalMarketValue) * 100).toFixed(2) : '0.00';
        return {
            role,
            marketValue,
            weight
        };
    });

    summaryElement.innerHTML = `
        <table class="summary-table">
            <thead>
                <tr>
                    <th>Rolle</th>
                    <th>Gesamtwert (EUR)</th>
                    <th>Gewicht %</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .map(
                        (row) => `
                    <tr>
                        <td>${row.role}</td>
                        <td>${row.marketValue.toFixed(2)}</td>
                        <td>${row.weight}</td>
                    </tr>
                `
                    )
                    .join('')}
            </tbody>
        </table>
    `;
};

document.addEventListener('DOMContentLoaded', () => {
    setupCsvUpload();
    setupSingleReview();
});
