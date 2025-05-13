import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

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
            console.log(`File not found: ${filePath}. Returning default.`);
            return defaultValue;
        }
        console.error(`Error reading JSON from ${filePath}:`, error);
        throw error; // Re-throw other errors
    }
}

async function saveJson(filePath, data) {
    try {
        const dir = path.dirname(filePath);
        // Ensure directory exists (useful for first run or complex paths)
        await mkdir(dir, { recursive: true });
        await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8'); // Pretty print JSON
        console.log(`Successfully saved data to ${filePath}`);
    } catch (error) {
        console.error(`Error writing JSON to ${filePath}:`, error);
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
        console.error("Error fetching Fishtest API:", error);
        throw error; // Stop execution if API fetch fails
    }
}

function processRawData(rawData) {
    const processedTests = [];
    for (const id in rawData) {
        const test = rawData[id];
        const args = test.args || {}; // Ensure args exists

        const llr = args.sprt?.llr ?? null; // LLR from sprt object if it exists
        const wins = parseInt(test.results?.wins) || 0;
        const losses = parseInt(test.results?.losses) || 0;
        const draws = parseInt(test.results?.draws) || 0;
        const totalGames = wins + losses + draws;
        const workers = parseInt(test.workers) || 0;

        // Get sprtElo0 if sprt object and elo0 property exist
        let sprtElo0 = null;
        if (args.sprt && typeof args.sprt.elo0 !== 'undefined') {
            sprtElo0 = parseFloat(args.sprt.elo0);
            // If parseFloat results in NaN (e.g., for non-numeric input), set to null
            if (isNaN(sprtElo0)) {
                sprtElo0 = null;
            }
        }

        processedTests.push({
            id: test._id,
            username: args.username ?? 'N/A',
            branch: args.new_tag ?? 'N/A',
            llr: llr !== null ? parseFloat(llr) : null, // Ensure numeric or null
            wml: wins - losses,
            wins: wins,
            losses: losses,
            draws: draws,
            totalGames: totalGames,
            workers: workers,
            sprtElo0: sprtElo0
        });
    }
    // Sort by LLR descending immediately after processing
    processedTests.sort((a, b) => {
        if (a.llr === null && b.llr === null) return 0;
        if (a.llr === null) return 1;
        if (b.llr === null) return -1;
        return b.llr - a.llr;
    });
    return processedTests;
}

async function updateHistoricalData(currentHistory, latestProcessedTests) {
    let historyChanged = false;
    const activeTestIds = new Set(latestProcessedTests.map(t => t.id));

    // Add new points for active tests
    latestProcessedTests.forEach(test => {
        if (!currentHistory[test.id]) {
            currentHistory[test.id] = [];
            historyChanged = true; // New test added to history
        }

        const testHistory = currentHistory[test.id];
        const lastEntry = testHistory[testHistory.length - 1];
        const newPoint = {
            // Use timestamp for better time representation
            time: Math.floor(Date.now() / 1000), // Unix timestamp (seconds)
            wml: test.wml,
            llr: test.llr
        };

        // Add point only if it differs from the last one or if history is empty
        if (!lastEntry || lastEntry.wml !== newPoint.wml || lastEntry.llr !== newPoint.llr) {
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
    for (const testId in currentHistory) {
        if (!activeTestIds.has(testId)) {
            console.log(`Cleaning up historical data for ended test: ${testId}`);
            delete currentHistory[testId];
            historyChanged = true; // History structure changed
        }
    }

    return { updatedHistory: currentHistory, historyChanged };
}


// Main Execution Logic
async function main() {
    console.log("Starting data update process...");

    // 1. Load existing historical data (or default to empty object)
    const currentHistory = await loadJson(HISTORY_DATA_PATH, {});

    // 2. Fetch new data from Fishtest API
    const rawData = await fetchFishtestData();

    // 3. Process the new data (this includes sorting)
    const latestProcessedTests = processRawData(rawData);
    console.log(`Fetched and processed ${latestProcessedTests.length} active tests.`);

    // 4. Update historical data
    const { updatedHistory, historyChanged } = await updateHistoricalData(currentHistory, latestProcessedTests);

    // 5. Save the latest processed data (always save this)
    await saveJson(LATEST_DATA_PATH, latestProcessedTests);

    // 6. Save the historical data ONLY if it changed
    if (historyChanged) {
        await saveJson(HISTORY_DATA_PATH, updatedHistory);
    } else {
        console.log("Historical data unchanged, skipping save.");
    }

    console.log("Data update process finished.");
}

// Run the main function and handle potential top-level errors
main().catch(error => {
    console.error("Critical error during script execution:", error);
    process.exit(1); // Exit with error code
});
