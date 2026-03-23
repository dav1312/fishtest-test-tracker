import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { styleText } from 'node:util';

const API_URL = 'https://tests.stockfishchess.org/api/active_runs';
const LATEST_DATA_PATH = path.resolve(process.cwd(), 'latest_data.json'); // Save in repo root
const HISTORY_DATA_PATH = path.resolve(process.cwd(), 'historical_data.json'); // Save in repo root
const MAX_HISTORY_POINTS = 864; // Limit history points per test.

async function loadJson(filePath, defaultValue) {
    try {
        const data = await readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(styleText('yellow', `File not found: ${filePath}. Returning default.`));
            return defaultValue;
        }
        console.error(styleText('red', `Error reading JSON from ${filePath}:`), error);
        throw error; // Re-throw other errors
    }
}

async function saveJson(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        // Ensure directory exists (useful for first run or complex paths)
        await mkdir(dir, { recursive: true });
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8'); // Pretty print JSON
        console.log(styleText('green', `Successfully saved data to ${filePath}`));
    } catch (error) {
        console.error(styleText('red', `Error writing JSON to ${filePath}:`), error);
        throw error;
    }
}

async function fetchFishtestData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error(styleText('red', "Error fetching Fishtest API:"), error);
        throw error; // Stop execution if API fetch fails
    }
}

function processRawData(rawData) {
    // Replaced 'for...in' with Object.values().map() for functional purity
    const processedTests = Object.values(rawData).map(test => {
        const args = test.args ?? {}; // Ensure args exists
        const llr = args.sprt?.llr ?? null; // LLR from sprt object if it exists

        // Get sprtElo0 if sprt object and elo0 property exist
        let sprtElo0 = args.sprt?.elo0 ? parseFloat(args.sprt.elo0) : null;

        // If parseFloat results in NaN (e.g., for non-numeric input), set to null
        if (Number.isNaN(sprtElo0)) {
            sprtElo0 = null;
        }

        return {
            id: test._id,
            username: args.username ?? 'N/A',
            branch: args.new_tag ?? 'N/A',
            llr: llr !== null ? parseFloat(llr) : null, // Ensure numeric or null
            wins: parseInt(test.results?.wins) || 0,
            losses: parseInt(test.results?.losses) || 0,
            draws: parseInt(test.results?.draws) || 0,
            workers: parseInt(test.workers) || 0,
            sprtElo0
        };
    });

    // Sort by LLR descending immediately after processing
    return processedTests.toSorted((a, b) => {
        if (a.llr === null && b.llr === null) return 0;
        if (a.llr === null) return 1;
        if (b.llr === null) return -1;
        return b.llr - a.llr;
    });
}

function updateHistoricalData(currentHistory, latestProcessedTests) {
    let historyChanged = false;
    const activeTestIds = new Set(latestProcessedTests.map(t => t.id));

    // Add new points for active tests
    latestProcessedTests.forEach(test => {
        if (!currentHistory[test.id]) {
            currentHistory[test.id] = [];
            historyChanged = true; // New test added to history
        }

        const testHistory = currentHistory[test.id];
        const lastEntry = testHistory.at(-1);
        const currentScore = test.wins - test.losses;
        const newPoint = {
            // Use timestamp for better time representation
            time: Math.floor(Date.now() / 1000), // Unix timestamp (seconds)
            score: currentScore,
            llr: test.llr
        };

        // Add point only if it differs from the last one or if history is empty
        if (!lastEntry || lastEntry.score !== newPoint.score || lastEntry.llr !== newPoint.llr) {
            testHistory.push(newPoint);
            historyChanged = true;

            // Limit history size
            if (testHistory.length > MAX_HISTORY_POINTS) {
                testHistory.shift(); // Remove the oldest point
                // historyChanged is already true
            }
        }
    });

    // Cleanup history for tests that are no longer active
    for (const testId of Object.keys(currentHistory)) {
        if (!activeTestIds.has(testId)) {
            console.log(styleText('gray', `Cleaning up historical data for ended test: ${testId}`));
            delete currentHistory[testId];
            historyChanged = true; // History structure changed
        }
    }

    return { updatedHistory: currentHistory, historyChanged };
}


// Main Execution Logic
try {
    console.log(styleText('cyan', "Starting data update process..."));

    // 1. Load existing historical data (or default to empty object)
    const currentHistory = await loadJson(HISTORY_DATA_PATH, {});

    // 2. Fetch new data from Fishtest API
    const rawData = await fetchFishtestData();

    // 3. Process the new data (this includes sorting)
    const latestProcessedTests = processRawData(rawData);
    console.log(`Fetched and processed ${latestProcessedTests.length} active tests.`);

    // 4. Update historical data
    const { updatedHistory, historyChanged } = updateHistoricalData(currentHistory, latestProcessedTests);

    // 5. Save the latest processed data (always save this)
    await saveJson(LATEST_DATA_PATH, latestProcessedTests);

    // 6. Save the historical data ONLY if it changed
    if (historyChanged) {
        await saveJson(HISTORY_DATA_PATH, updatedHistory);
    } else {
        console.log(styleText('gray', "Historical data unchanged, skipping save."));
    }

    console.log(styleText('cyan', "Data update process finished."));

} catch (error) {
    console.error(styleText('red', "Critical error during script execution:"), error);
    process.exitCode = 1; // Exit with error code
}
