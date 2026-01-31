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
});
