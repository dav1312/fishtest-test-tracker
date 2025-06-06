// URLs for the data files generated by the GitHub Action
// Add a cache-busting query parameter using the current time (simple approach)
// This helps ensure the browser fetches the latest version after the Action updates the files.
const LATEST_DATA_URL = `./latest_data.json?v=${Date.now()}`;
const HISTORY_DATA_URL = `./historical_data.json?v=${Date.now()}`;

const filterInput = document.getElementById('filterInput');
const testsTableBody = document.querySelector('#testsTable tbody');
const chartContainer = document.getElementById('chartContainer');
const chartTitle = document.getElementById('chartTitle');
const progressChartCanvas = document.getElementById('progressChart');
const toggleScoreButton = document.getElementById('toggleScore');
const toggleLLRButton = document.getElementById('toggleLLR');
const testEndedMessage = document.getElementById('testEndedMessage');
const lastUpdateTimeElement = document.getElementById('lastUpdateTime');

let allTestsData = []; // Populated from latest_data.json
let historicalData = {}; // Populated from historical_data.json
let currentChart = null;
let currentTrackingTestId = null; // Track which chart is visible
let currentTrackingBranchName = null;
let currentVisibleMetric = 'llr';

const LLR_BOUND = 2.94443897916644;

function formatLLR(llrValue) {
    if (llrValue === null || typeof llrValue === 'undefined') {
        return 'N/A';
    }

    // Round LLR to 2 decimal places, always show 2 decimals
    const formattedLLR = llrValue.toFixed(2);

    // Calculate percentage
    let percentage = (llrValue / LLR_BOUND) * 100;
    // Clamp percentage between -100% and 100%
    percentage = Math.max(-100, Math.min(100, percentage));
    const roundedPercentage = Math.round(percentage);

    return `${formattedLLR} (${roundedPercentage}%)`;
}

// --- Utility function to format time ago ---
function formatTimeAgo(timestampSeconds) {
    if (!timestampSeconds) return "N/A";

    const now = Math.floor(Date.now() / 1000); // Current time in seconds
    const diffSeconds = now - timestampSeconds;

    if (diffSeconds < 0) return "in the future?"; // Should not happen
    if (diffSeconds < 60) return `${diffSeconds} sec ago`;

    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} min ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hr ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day(s) ago`;
}

// --- Find the latest update time from historical data ---
function getLatestUpdateTime(history) {
    let latestTime = 0;
    if (history && typeof history === 'object') {
        for (const testId in history) {
            const testEntries = history[testId];
            if (Array.isArray(testEntries) && testEntries.length > 0) {
                const lastEntry = testEntries[testEntries.length - 1];
                if (lastEntry && typeof lastEntry.time === 'number' && lastEntry.time > latestTime) {
                    latestTime = lastEntry.time;
                }
            }
        }
    }
    return latestTime > 0 ? latestTime : null; // Return null if no valid time found
}

// --- Update the display for "Last updated" ---
function displayLastUpdateTime() {
    const latestTimestamp = getLatestUpdateTime(historicalData);
    if (latestTimestamp) {
        lastUpdateTimeElement.textContent = `Last update: ${formatTimeAgo(latestTimestamp)}`;
    } else {
        lastUpdateTimeElement.textContent = 'Last update: N/A (or still loading)';
    }
}

// --- Data Fetching ---
async function loadDataFromFiles() {
    try {
        // Add cache-busting query parameters
        const cacheBuster = `?v=${Date.now()}`;
        const [latestResponse, historyResponse] = await Promise.all([
            fetch(`./latest_data.json${cacheBuster}`),
            fetch(`./historical_data.json${cacheBuster}`)
        ]);

        if (!latestResponse.ok) {
            throw new Error(`Failed to load latest_data.json: ${latestResponse.statusText}`);
        }
         // History file might not exist initially, treat 404 as empty history
        if (!historyResponse.ok && historyResponse.status !== 404) {
             throw new Error(`Failed to load historical_data.json: ${historyResponse.statusText}`);
        }


        allTestsData = await latestResponse.json();
        historicalData = historyResponse.ok ? await historyResponse.json() : {}; // Handle 404 for history

        console.log("Successfully loaded data from local JSON files.");
        displayLastUpdateTime();

    } catch (error) {
        console.error("Error loading data from JSON files:", error);
        testsTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:red;">Error loading test data. Check console or wait for data generation.</td></tr>`;
        allTestsData = []; // Ensure table shows error state
        historicalData = {};
        lastUpdateTimeElement.textContent = 'Last update: Error loading'; // Update status
    }
}


// --- Table Rendering ---
function renderTable(testsToRender) {
    testsTableBody.innerHTML = ''; // Clear existing rows

    // Update colspan for loading/empty messages
    if (testsToRender.length === 0 && allTestsData.length > 0 && filterInput.value.trim() !== '') {
        testsTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No tests match your filter.</td></tr>`;
        return;
    }
     // Check if allTestsData itself is empty (could be due to initial load error or no tests)
    if (testsToRender.length === 0 && allTestsData.length === 0) {
        // Don't show "No active tests found" if there was a load error message already
        if (!testsTableBody.innerHTML.includes('Error loading test data')) {
             testsTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No active tests found or data not yet available.</td></tr>`;
        }
        return;
    }

    testsToRender.forEach(test => {
        const row = testsTableBody.insertRow();

        // Calculate totalGames for display
        const totalGames = (test.wins || 0) + (test.losses || 0) + (test.draws || 0);

        // Calculate the score % for display
        let score = ((test.wins || 0) + (test.draws || 0) / 2) / totalGames * 100 || 0;
        // Format score to 2 decimal places
        score = score.toFixed(2);

        // Apply dimming if workers count is 0, i.e., test is paused
        if (test.workers === 0) {
            row.classList.add('dimmed-row');
        }

        // Apply background color based on sprtElo0's existence and value
        // If sprtElo0 is not null, we assume it's an SPRT test with elo0 data
        if (test.sprtElo0 !== null) { // Check if sprtElo0 has a valid numeric value
            if (test.sprtElo0 < 0) {
                row.style.backgroundColor = 'rgb(80 200 229 / 30%)'; // Simplification
            } else {
                row.style.backgroundColor = 'rgb(117 187 118 / 30%)'; // Gainer
            }
        }

        // Test ID Cell
        const idCell = row.insertCell();
        const idLink = document.createElement('a');
        idLink.href = `https://tests.stockfishchess.org/tests/view/${test.id}`;
        idLink.textContent = test.id.substring(0, 8) + '...';
        idLink.title = test.id; // Show full ID on hover
        idLink.target = '_blank'; // Open in a new tab
        idLink.rel = 'noopener noreferrer'; // Security best practice for _blank links
        idCell.appendChild(idLink);

        // Username Cell
        const userCell = row.insertCell();
        const userLink = document.createElement('a');
        userLink.href = '#'; // Prevent page jump
        userLink.textContent = test.username;
        userLink.classList.add('username-filter-link'); // Add a class for styling and event handling
        userLink.dataset.username = test.username; // Store username for the event handler
        userCell.appendChild(userLink);

        // Branch Name Cell
        const branchCell = row.insertCell();
        const branchLink = document.createElement('a');
        branchLink.href = '#';
        branchLink.classList.add('branch-link');
        branchLink.textContent = test.branch;
        branchLink.title = test.branch; // Tooltip for full branch name
        branchLink.dataset.testId = test.id;
        branchLink.dataset.branchName = test.branch;
        branchCell.appendChild(branchLink);

        // LLR Cell
        row.insertCell().textContent = formatLLR(test.llr);

        // Total Games Cell
        row.insertCell().textContent = `${totalGames} (${score}%)`;
    });
}

// --- Filtering ---
function filterAndRenderTable() {
    const filterText = filterInput.value.toLowerCase().trim();
    if (!filterText) {
        renderTable(allTestsData); // Render all loaded tests
        return;
    }
    const filteredTests = allTestsData.filter(test =>
        test.username.toLowerCase().includes(filterText) ||
        test.branch.toLowerCase().includes(filterText) ||
        test.id.toLowerCase().includes(filterText)
    );
    renderTable(filteredTests);
}

// --- Charting ---
function initializeChart(testId, branchName) {
    currentTrackingTestId = testId;
    currentTrackingBranchName = branchName;
    chartTitle.textContent = `Progress for: ${branchName} (ID: ${testId.substring(0,8)}...)`;
    chartContainer.style.display = 'block';

    const isActive = allTestsData.some(test => test.id === testId);
    testEndedMessage.style.display = isActive ? 'none' : 'block';

    if (currentChart) {
        currentChart.destroy();
    }

    const ctx = progressChartCanvas.getContext('2d');

    // Default Y-axis options, will be overridden by toggleChartMetric if needed
    let initialYAxisOptions = {
         beginAtZero: true, // Score default
         title: { display: true, text: 'Value' }
    };

    // If LLR is the default, adjust initialYAxisOptions before chart creation
    // This is not strictly necessary if toggleChartMetric is called immediately after,
    // but can be a safeguard. The main thing is toggleChartMetric being called.
    if (currentVisibleMetric === 'llr') {
        initialYAxisOptions = {
            min: -3,
            max: 3,
            beginAtZero: false,
            title: { display: true, text: 'Value' }
        };
    }


    currentChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Score',
                    data: [],
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1,
                    // Set initial hidden state based on currentVisibleMetric
                    hidden: currentVisibleMetric !== 'score'
                },
                {
                    label: 'LLR',
                    data: [],
                    borderColor: 'rgb(255, 99, 132)',
                    tension: 0.1,
                    // Set initial hidden state based on currentVisibleMetric
                    hidden: currentVisibleMetric !== 'llr',
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            scales: {
                x: {
                    type: 'time',
                    time: {
                         unit: 'minute',
                         tooltipFormat: 'MMM d, HH:mm:ss',
                         displayFormats: {
                             minute: 'HH:mm',
                             hour: 'HH:mm'
                         }
                    },
                    title: { display: true, text: 'Time' }
                },
                y: initialYAxisOptions // Apply initial options
            },
            responsive: true,
            maintainAspectRatio: true,
             plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            }
        }
    });

    // Crucially, apply the correct scale and visibility AFTER chart object is created
    // This will set the LLR scale if currentVisibleMetric is 'llr'
    toggleChartMetric(currentVisibleMetric);

    updateChartData(); // Populate with historical data
}

function updateChartData() {
    if (!currentChart || !currentTrackingTestId) return;

    const testHistory = historicalData[currentTrackingTestId] || [];

    if (!testHistory.length) {
         console.log(`No historical data found for ${currentTrackingTestId} to update chart.`);
         currentChart.data.labels = [];
         currentChart.data.datasets[0].data = [];
         currentChart.data.datasets[1].data = [];
         currentChart.update('none');
         return;
    }

    // Format data for Chart.js time scale: {x: timestamp, y: value}
    const scoreData = testHistory.map(d => ({ x: d.time * 1000, y: d.score })); // Convert seconds to ms
    const llrData = testHistory.map(d => ({ x: d.time * 1000, y: d.llr !== null ? d.llr : NaN })); // Handle nulls

    currentChart.data.datasets[0].data = scoreData;
    currentChart.data.datasets[1].data = llrData;

    // Check again if the test is active based on the loaded latest data
    const isActive = allTestsData.some(test => test.id === currentTrackingTestId);
    testEndedMessage.style.display = isActive ? 'none' : 'block';

    currentChart.update('none'); // Use 'none' to prevent animation
}


function handleBranchClick(event) {
    if (event.target.classList.contains('branch-link')) {
        event.preventDefault();
        const testId = event.target.dataset.testId;
        const branchName = event.target.dataset.branchName;

        if (testId === currentTrackingTestId) {
            chartContainer.scrollIntoView({ behavior: 'smooth' });
            return;
        }

        currentVisibleMetric = 'llr'; // Reset to LLR view for a new chart
        initializeChart(testId, branchName);
        chartContainer.scrollIntoView({ behavior: 'smooth' });
    }
}

function toggleChartMetric(metricToShow) {
    if (!currentChart) return;

    currentVisibleMetric = metricToShow;
    const isLLR = metricToShow === 'llr';

    currentChart.data.datasets[0].hidden = isLLR;
    currentChart.data.datasets[1].hidden = !isLLR;

    if (isLLR) {
        currentChart.options.scales.y.min = -3;
        currentChart.options.scales.y.max = 3;
        currentChart.options.scales.y.beginAtZero = false;
    } else {
        currentChart.options.scales.y.min = undefined;
        currentChart.options.scales.y.max = undefined;
        currentChart.options.scales.y.beginAtZero = true;
    }

    currentChart.update();
}

// --- Function to handle username click for filtering ---
function handleUsernameFilterClick(event) {
    if (event.target.classList.contains('username-filter-link')) {
        event.preventDefault(); // Prevent default <a> behavior
        const usernameToFilter = event.target.dataset.username;

        if (usernameToFilter) {
            filterInput.value = usernameToFilter; // Set the filter input's value
            filterAndRenderTable();               // Trigger the filtering
            filterInput.focus();                  // Optional: focus the input field
        }
    }
}

// --- Event Listeners ---
filterInput.addEventListener('input', filterAndRenderTable);
testsTableBody.addEventListener('click', (event) => {
    handleBranchClick(event);         // Handle branch clicks for charts
    handleUsernameFilterClick(event); // Handle username clicks for filtering
});
toggleScoreButton.addEventListener('click', () => toggleChartMetric('score'));
toggleLLRButton.addEventListener('click', () => toggleChartMetric('llr'));

// --- Initial Load ---
async function initializeApp() {
    console.log("Initializing application...");
    await loadDataFromFiles(); // Load data from JSON files generated by Action
    filterAndRenderTable(); // Render the initial table based on loaded data
    console.log("Application initialized.");

    setInterval(() => {
        if (Object.keys(historicalData).length > 0) { // Only if data is loaded
            displayLastUpdateTime();
        }
    }, 60000);

}

// Start the application
initializeApp();
