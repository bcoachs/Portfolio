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

const YFINANCE_ENDPOINT = '/api/metrics';
const CACHE_EXPIRY_DAYS = 7;

const METRIC_LABELS = {
    dividendYield: 'Dividendenrendite',
    dividendGrowth: 'Dividendenwachstum (5J CAGR)',
    fcfPayout: 'FCF-Payout-Ratio',
    epsPayout: 'EPS-Payout-Ratio',
    debtToEbitda: 'Net Debt / EBITDA',
    interestCoverage: 'Zinsdeckungsgrad',
    roic: 'ROIC'
};

let cachedRules = null;
let showSourceDates = true;

const fundamentalCache = {};
const lastQueries = [];

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

        const [metricsResponse, rules] = await Promise.all([fetchMetricsYFinance(value), loadRules()]);
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

const setupAdminForm = () => {
    const adminForm = document.getElementById('admin-form');
    if (!adminForm) {
        return;
    }

    adminForm.innerHTML = `
        <div class="admin-field">
            <label>
                <input type="checkbox" id="toggle-source-dates" ${showSourceDates ? 'checked' : ''}>
                Quellen & Daten anzeigen
            </label>
        </div>
        <div id="last-queries" class="admin-last-queries"></div>
    `;

    const toggle = document.getElementById('toggle-source-dates');
    toggle?.addEventListener('change', (event) => {
        showSourceDates = event.target.checked;
    });

    updateLastQueriesDisplay();
};

const updateLastQueriesDisplay = () => {
    const container = document.getElementById('last-queries');
    if (!container) {
        return;
    }
    if (!lastQueries.length) {
        container.textContent = 'Noch keine Abfragen durchgeführt.';
        return;
    }
    container.innerHTML = `<strong>Letzte Symbole:</strong> ${lastQueries.join(', ')}`;
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
            const metric = metrics[key];
            const formatted = formatMetricValue(key, metric);
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

const formatMetricValue = (key, metric) => {
    const value = metric?.value ?? null;
    if (value === null || Number.isNaN(value)) {
        return 'n/a';
    }
    let formatted = value.toFixed(2);
    if (key === 'dividendYield' || key === 'dividendGrowth' || key === 'fcfPayout' || key === 'epsPayout' || key === 'roic') {
        formatted = `${(value * 100).toFixed(2)} %`;
    }
    if (showSourceDates) {
        const meta = metric?.source && metric?.date ? ` <span class="metric-meta">(${metric.source}, ${metric.date})</span>` : '';
        return `${formatted}${meta}`;
    }
    return formatted;
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

const updateLastQueries = (symbol) => {
    if (!symbol) {
        return;
    }
    const normalized = symbol.toUpperCase();
    const existingIndex = lastQueries.indexOf(normalized);
    if (existingIndex !== -1) {
        lastQueries.splice(existingIndex, 1);
    }
    lastQueries.unshift(normalized);
    if (lastQueries.length > 10) {
        lastQueries.length = 10;
    }
    updateLastQueriesDisplay();
};

const isFresh = (dateString) => {
    if (!dateString) {
        return false;
    }
    const timestamp = new Date(dateString).getTime();
    if (Number.isNaN(timestamp)) {
        return false;
    }
    const ageMs = Date.now() - timestamp;
    return ageMs < CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
};

const fetchYFinanceEndpoint = async (symbol) => {
    const response = await fetch(`${YFINANCE_ENDPOINT}?symbol=${encodeURIComponent(symbol)}`);
    if (!response.ok) {
        throw new Error('Netzwerkfehler beim Laden der Kennzahlen.');
    }
    return response.json();
};

const buildMetricEntry = (value, date) => ({
    value: value ?? null,
    source: 'yfinance',
    date
});

const buildEmptyMetrics = (date) => ({
    dividendYield: buildMetricEntry(null, date),
    epsPayout: buildMetricEntry(null, date),
    fcfPayout: buildMetricEntry(null, date),
    debtToEbitda: buildMetricEntry(null, date),
    interestCoverage: buildMetricEntry(null, date),
    roic: buildMetricEntry(null, date),
    dividendGrowth: buildMetricEntry(null, date)
});

const fetchMetricsYFinance = async (value) => {
    const symbol = value.trim().toUpperCase();
    const today = new Date().toISOString().slice(0, 10);
    updateLastQueries(symbol);

    const cached = fundamentalCache[symbol];
    if (cached && isFresh(cached.fetchedAt)) {
        return cached.data;
    }

    const emptyMetrics = buildEmptyMetrics(today);

    try {
        const response = await fetchYFinanceEndpoint(symbol);

        fundamentalCache[symbol] = {
            data: response,
            fetchedAt: new Date().toISOString()
        };

        return response;
    } catch (error) {
        console.error('Fehler beim Abruf der Kennzahlen', error);
        return {
            metrics: emptyMetrics,
            companyName: symbol,
            symbol,
            errorMessage: 'Netzwerkfehler beim Laden der Kennzahlen.'
        };
    }
};

const getMetricValue = (metrics, key) => metrics?.[key]?.value ?? null;

const evaluateStock = (metrics, rules) => {
    const kpiThresholds = rules.kpi_thresholds || {};
    const coreKpiStatuses = {
        fcfPayout: compareMax(getMetricValue(metrics, 'fcfPayout'), kpiThresholds.fcf_payout_max),
        epsPayout: compareMax(getMetricValue(metrics, 'epsPayout'), kpiThresholds.eps_payout_max),
        debtToEbitda: compareMax(getMetricValue(metrics, 'debtToEbitda'), kpiThresholds.debt_to_ebitda_max),
        interestCoverage: compareMin(getMetricValue(metrics, 'interestCoverage'), kpiThresholds.interest_coverage_min),
        roic: compareMin(getMetricValue(metrics, 'roic'), kpiThresholds.roic_min)
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
            getMetricValue(metrics, 'dividendYield'),
            roleRules.dividend_yield_min,
            roleRules.dividend_yield_max
        );
        const dividendGrowthOk = isWithinRange(
            getMetricValue(metrics, 'dividendGrowth'),
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
            kpiStatuses.dividendYield === 'neutral'
                ? compareRange(getMetricValue(metrics, 'dividendYield'))
                : kpiStatuses.dividendYield;
        kpiStatuses.dividendGrowth =
            kpiStatuses.dividendGrowth === 'neutral'
                ? compareRange(getMetricValue(metrics, 'dividendGrowth'))
                : kpiStatuses.dividendGrowth;
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
    setupAdminForm();
});
