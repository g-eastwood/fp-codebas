// ── Mothitor Antenna Data 2025 ──────────────────────────────────────────────
// Matches the sketch: 3 monitor boards (dot plots), display buttons
// (Species / Genus / Family), month & season filters, and a legend.

// ── Seasons ─────────────────────────────────────────────────────────────────
const SEASONS = {
    spring: ["Apr", "May"],
    summer: ["Jun", "Jul", "Aug"],
    fall:   ["Sep", "Oct"]
};

const ALL_MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const DEPLOYMENTS = ["SYD", "AMA", "CAR"];

// ── State ────────────────────────────────────────────────────────────────────
let state = {
    displayMode: "species",          // "species" | "genus" | "family"
    activeMonths: new Set(ALL_MONTHS),
    highlightedGroup: null           // for legend hover
};

// ── Colour palette (up to ~30 distinct groups) ───────────────────────────────
const COLOR_PALETTE = [
    "#6baed6","#2ca25f","#756bb1","#fd8d3c","#e377c2","#17becf",
    "#bcbd22","#9467bd","#8c564b","#e7ba52","#cedb9c","#9edae5",
    "#637939","#843c39","#5254a3","#6b6ecf","#b5cf6b","#d6616b",
    "#ce6dbd","#de9ed6","#3182bd","#31a354","#e6550d","#756bb1",
    "#636363","#a1d99b","#fdae6b","#9ecae1","#bcbddc","#bdbdbd"
];

let colorMap = {};  // groupName → color

function getColor(name) {
    if (!colorMap[name]) {
        const idx = Object.keys(colorMap).length % COLOR_PALETTE.length;
        colorMap[name] = COLOR_PALETTE[idx];
    }
    return colorMap[name];
}

// ── Data loading ─────────────────────────────────────────────────────────────
d3.json("mothitor_antenna_data_2025.json").then(rawData => {

    // Pre-process: aggregate counts per deployment / month / species (+taxonomy)
    const aggMap = new Map();

    rawData.forEach(item => {
        if (item.determination.name === "Not Lepidoptera") return;

        const taxon   = item.determination_details.taxon;
        const parents = Object.fromEntries(
            (taxon.parents || []).map(p => [p.rank, p.name])
        );
        const genus   = parents["GENUS"]  || (taxon.rank === "GENUS"  ? taxon.name : "Unknown");
        const family  = parents["FAMILY"] || (taxon.rank === "FAMILY" ? taxon.name : "Unknown");
        const species = taxon.name;
        const month   = item.event.date_label.split(" ")[0];
        const dep     = item.deployment.name;
        const count   = item.detections_count || 1;

        const key = `${dep}|${month}|${species}`;
        if (!aggMap.has(key)) {
            aggMap.set(key, { dep, month, species, genus, family, count: 0 });
        }
        aggMap.get(key).count += count;
    });

    const allRecords = Array.from(aggMap.values());

    // ── Build legend colour map up-front (by species) ────────────────────────
    const allSpecies = [...new Set(allRecords.map(d => d.species))].sort();
    allSpecies.forEach(s => getColor(s));

    // ── Render everything ─────────────────────────────────────────────────────
    renderBoards(allRecords);
    renderLegend(allRecords);
    setupControls(allRecords);

    // ── Tooltip div ───────────────────────────────────────────────────────────
    d3.select("body").append("div").attr("id", "tooltip");

}).catch(err => {
    document.body.innerHTML += `<p style="color:red">Error loading data: ${err}</p>`;
});

// ── BOARDS ───────────────────────────────────────────────────────────────────
function renderBoards(allRecords) {
    const container = d3.select("#boards");
    container.selectAll(".board-card").remove();

    DEPLOYMENTS.forEach(dep => {
        const card = container.append("div")
            .attr("class", "board-card")
            .attr("id", `board-${dep}`);

        card.append("div").attr("class", "board-title").text(`Mothitor — ${dep}`);
        card.append("div").attr("class", "board-subtitle").text("Avg detections / taxon  ·  click dot for name");
        card.append("div").attr("class", "board-svg-container").attr("id", `svg-container-${dep}`);
    });

    updateBoards(allRecords);
}

function updateBoards(allRecords) {
    DEPLOYMENTS.forEach(dep => {
        drawBoard(dep, allRecords);
    });
}

function drawBoard(dep, allRecords) {
    const container = d3.select(`#svg-container-${dep}`);
    container.selectAll("*").remove();

    // Filter records for this board
    const records = allRecords.filter(d =>
        d.dep === dep && state.activeMonths.has(d.month)
    );

    // Group by display mode
    const groupKey = d => d[state.displayMode];

    // Aggregate counts per group
    const groupMap = d3.rollup(records, v => d3.mean(v, d => d.count), groupKey);
    const groups = Array.from(groupMap, ([name, avg]) => ({ name, avg }))
                        .sort((a, b) => b.avg - a.avg);

    if (groups.length === 0) {
        container.append("p").style("color", "#aaa").style("font-size", "0.8rem")
            .text("No data for selected filters.");
        return;
    }

    // Dimensions
    const W = 340, H = 320;
    const margin = { top: 16, right: 20, bottom: 40, left: 56 };
    const innerW = W - margin.left - margin.right;
    const innerH = H - margin.top - margin.bottom;

    const svg = container.append("svg")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("preserveAspectRatio", "xMidYMid meet");

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    // Scales
    const maxAvg = d3.max(groups, d => d.avg);
    const yScale = d3.scaleLinear()
        .domain([0, maxAvg * 1.1])
        .range([innerH, 0])
        .nice();

    // X: jitter dots in a single strip per group (strip chart / dot plot)
    // We use groups as categories on x-axis, one dot per group
    const xScale = d3.scaleBand()
        .domain(groups.map(d => d.name))
        .range([0, innerW])
        .padding(0.4);

    // Y axis
    g.append("g")
        .attr("class", "axis")
        .call(d3.axisLeft(yScale).ticks(5).tickSize(-innerW))
        .call(ax => ax.select(".domain").remove())
        .call(ax => ax.selectAll(".tick line").attr("stroke", "#eee"));

    // Y axis label
    g.append("text")
        .attr("transform", "rotate(-90)")
        .attr("y", -margin.left + 10)
        .attr("x", -innerH / 2)
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("fill", "#888")
        .text("Avg detections / taxon");

    // Dots
    const tooltip = d3.select("#tooltip");

    g.selectAll(".dot")
        .data(groups)
        .join("circle")
        .attr("class", "dot")
        .attr("cx", d => xScale(d.name) + xScale.bandwidth() / 2)
        .attr("cy", d => yScale(d.avg))
        .attr("r", d => Math.max(4, Math.min(14, 4 + d.avg * 0.8)))
        .attr("fill", d => getGroupColor(d.name))
        .attr("opacity", d => dotOpacity(d.name))
        .on("mousemove", (event, d) => {
            tooltip
                .style("display", "block")
                .style("left", (event.clientX + 14) + "px")
                .style("top",  (event.clientY - 28) + "px")
                .html(`<strong>${d.name}</strong><br>Avg detections: ${d.avg.toFixed(1)}`);
        })
        .on("mouseleave", () => {
            tooltip.style("display", "none");
        });

    // Bottom label: count of taxa shown
    g.append("text")
        .attr("x", innerW / 2)
        .attr("y", innerH + 30)
        .attr("text-anchor", "middle")
        .attr("font-size", "10px")
        .attr("fill", "#999")
        .text(`${groups.length} taxa shown`);
}

// ── Color helpers ─────────────────────────────────────────────────────────────
// When display mode changes we want stable, consistent colors per group name
const groupColorCache = {};

function getGroupColor(name) {
    if (!groupColorCache[name]) {
        const idx = Object.keys(groupColorCache).length % COLOR_PALETTE.length;
        groupColorCache[name] = COLOR_PALETTE[idx];
    }
    return groupColorCache[name];
}

function dotOpacity(name) {
    if (!state.highlightedGroup) return 0.85;
    return name === state.highlightedGroup ? 1 : 0.15;
}

// ── LEGEND ───────────────────────────────────────────────────────────────────
function renderLegend(allRecords) {
    updateLegend(allRecords);
}

function updateLegend(allRecords) {
    const legendEl = d3.select("#legend");
    legendEl.selectAll("*").remove();

    legendEl.append("div").attr("class", "legend-title")
        .text(`Key — ${state.displayMode} (out of ~${getGroupCount(allRecords)} total)`);

    // Get top 20 groups by total count across all boards
    const groupKey = d => d[state.displayMode];
    const filteredRecords = allRecords.filter(d => state.activeMonths.has(d.month));
    const topGroups = Array.from(
        d3.rollup(filteredRecords, v => d3.sum(v, d => d.count), groupKey),
        ([name, total]) => ({ name, total })
    ).sort((a, b) => b.total - a.total).slice(0, 24);

    topGroups.forEach(({ name }) => {
        const item = legendEl.append("div")
            .attr("class", "legend-item")
            .style("cursor", "pointer")
            .on("mouseover", () => {
                state.highlightedGroup = name;
                refreshDots();
                legendEl.selectAll(".legend-item").classed("dimmed",
                    (_, i, nodes) => d3.select(nodes[i]).datum()?.name !== name
                );
            })
            .on("mouseleave", () => {
                state.highlightedGroup = null;
                refreshDots();
                legendEl.selectAll(".legend-item").classed("dimmed", false);
            })
            .datum({ name });

        item.append("div").attr("class", "legend-dot")
            .style("background", getGroupColor(name));
        item.append("span").text(name);
    });
}

function getGroupCount(allRecords) {
    const filteredRecords = allRecords.filter(d => state.activeMonths.has(d.month));
    return new Set(filteredRecords.map(d => d[state.displayMode])).size;
}

function refreshDots() {
    d3.selectAll(".dot")
        .attr("opacity", d => dotOpacity(d.name));
}

// ── CONTROLS ─────────────────────────────────────────────────────────────────
function setupControls(allRecords) {

    // Display mode buttons (Species / Genus / Family)
    d3.selectAll("#display-buttons .toggle-btn").on("click", function () {
        state.displayMode = d3.select(this).attr("data-display");
        d3.selectAll("#display-buttons .toggle-btn").classed("active", false);
        d3.select(this).classed("active", true);
        state.highlightedGroup = null;
        // reset color cache for new mode
        Object.keys(groupColorCache).forEach(k => delete groupColorCache[k]);
        updateBoards(allRecords);
        updateLegend(allRecords);
    });

    // Month buttons — toggle individual months
    d3.selectAll("#month-buttons .toggle-btn").on("click", function () {
        const month = d3.select(this).attr("data-month");
        if (state.activeMonths.has(month)) {
            if (state.activeMonths.size > 1) {
                state.activeMonths.delete(month);
                d3.select(this).classed("active", false);
            }
        } else {
            state.activeMonths.add(month);
            d3.select(this).classed("active", true);
        }
        // Deactivate season buttons (user switched to manual month select)
        d3.selectAll(".season-btn").classed("active", false);
        updateBoards(allRecords);
        updateLegend(allRecords);
    });

    // Season buttons — select preset month sets
    d3.selectAll(".season-btn").on("click", function () {
        const season = d3.select(this).attr("data-season");

        // Toggle: if already active, deactivate (go back to all months)
        const isActive = d3.select(this).classed("active");
        if (isActive) {
            d3.select(this).classed("active", false);
            state.activeMonths = new Set(ALL_MONTHS);
        } else {
            d3.selectAll(".season-btn").classed("active", false);
            d3.select(this).classed("active", true);
            state.activeMonths = new Set(SEASONS[season]);
        }

        // Sync month button highlights
        d3.selectAll("#month-buttons .toggle-btn").classed("active",
            function () { return state.activeMonths.has(d3.select(this).attr("data-month")); }
        );

        updateBoards(allRecords);
        updateLegend(allRecords);
    });
}
